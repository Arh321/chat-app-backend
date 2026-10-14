import { createRoute, z } from "@hono/zod-openapi";
import { createOpenAPIApp } from "../../lib/openapi";
import { requireAuth } from "../../middlewares/auth";
import { supabaseAdmin } from "../../lib/supabase";
import {
  CreateStorySchema,
  StoryItemSchema,
  UserStoriesGroupSchema,
} from "./stories.schema";

export const storiesApp = createOpenAPIApp();

// محافظت تمام روت‌ها با توکن لاگین
storiesApp.use("*", requireAuth);

/* ==========================================================================
   ۱. ارسال استوری جدید
   ========================================================================== */
const createStoryRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Stories"],
  summary: "ایجاد یک استوری جدید (۲۴ ساعته)",
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateStorySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "استوری با موفقیت ثبت شد",
      content: {
        "application/json": {
          schema: z.object({ story: StoryItemSchema }),
        },
      },
    },
    400: { description: "خطا در ورودی‌ها" },
    500: { description: "خطای سرور" },
  },
});

storiesApp.openapi(createStoryRoute, async (c) => {
  const userId = c.get("userId");
  const payload = c.req.valid("json");

  // اگر نوع مدیا text نبود، وجود media_url الزامی است
  if (payload.media_type !== "text" && !payload.media_url) {
    return c.json(
      {
        error: "برای استوری تصویر یا ویدیو، آدرس رسانه (media_url) الزامی است",
      },
      400,
    );
  }

  const { data: newStory, error } = await supabaseAdmin
    .from("stories")
    .insert({
      user_id: userId,
      media_url: payload.media_url || null,
      media_type: payload.media_type,
      caption: payload.caption || null,
      privacy: payload.privacy,
      metadata: payload.metadata || {},
    })
    .select(
      `
      id,
      user_id,
      media_url,
      media_type,
      caption,
      privacy,
      metadata,
      created_at,
      expires_at,
      user:profiles!user_id (
        id,
        display_name,
        avatar_url
      )
    `,
    )
    .single();

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ story: newStory as any }, 201);
});

/* ==========================================================================
   ۲. دریافت استوری‌های فعال خود کاربر (My Stories)
   ========================================================================== */
const getMyStoriesRoute = createRoute({
  method: "get",
  path: "/my",
  tags: ["Stories"],
  summary: "دریافت استوری‌های من که هنوز منقضی نشده‌اند",
  security: [{ Bearer: [] }],
  responses: {
    200: {
      description: "لیست استوری‌های فعال کاربر",
      content: {
        "application/json": {
          schema: z.object({
            stories: z.array(
              StoryItemSchema.extend({
                views_count: z.number(),
              }),
            ),
          }),
        },
      },
    },
    500: { description: "خطای سرور" },
  },
});

storiesApp.openapi(getMyStoriesRoute, async (c) => {
  const userId = c.get("userId");
  const now = new Date().toISOString();

  // واکشی استوری‌های فعلی که expires_at آن‌ها هنوز فرانرسیده
  const { data: stories, error } = await supabaseAdmin
    .from("stories")
    .select(
      `
      id,
      user_id,
      media_url,
      media_type,
      caption,
      privacy,
      metadata,
      created_at,
      expires_at,
      user:profiles!user_id (
        id,
        display_name,
        avatar_url
      ),
      story_views (count)
    `,
    )
    .eq("user_id", userId)
    .gt("expires_at", now)
    .order("created_at", { ascending: true });

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  const formattedStories = (stories || []).map((s: any) => ({
    ...s,
    views_count: s.story_views?.[0]?.count ?? 0,
  }));

  return c.json({ stories: formattedStories }, 200);
});

/* ==========================================================================
   ۳. فید استوری‌ها (Stories Feed: شامل Public + دوستان + استوری‌های من)
   ========================================================================== */
const getStoriesFeedRoute = createRoute({
  method: "get",
  path: "/feed",
  tags: ["Stories"],
  summary: "دریافت فید تمام استوری‌های قابل مشاهده (عمومی + دوستان)",
  security: [{ Bearer: [] }],
  responses: {
    200: {
      description: "فید گروه‌بندی‌شده استوری‌ها برای نمایش در فرانت‌اند",
      content: {
        "application/json": {
          schema: z.object({
            feed: z.array(UserStoriesGroupSchema),
          }),
        },
      },
    },
    500: { description: "خطای سرور" },
  },
});

storiesApp.openapi(getStoriesFeedRoute, async (c) => {
  const currentUserId = c.get("userId");
  const now = new Date().toISOString();

  // مرحله ۱: استخراج آی‌دی تمام دوستانی که وضعیت دوستی‌شان accepted است
  const { data: friendRows, error: friendsError } = await supabaseAdmin
    .from("friendships")
    .select("user_id, friend_id")
    .or(`user_id.eq.${currentUserId},friend_id.eq.${currentUserId}`)
    .eq("status", "accepted");

  if (friendsError) {
    return c.json({ error: friendsError.message }, 500);
  }

  const friendIds = new Set<string>();
  friendRows?.forEach((f) => {
    if (f.user_id !== currentUserId) friendIds.add(f.user_id);
    if (f.friend_id !== currentUserId) friendIds.add(f.friend_id);
  });

  const friendIdsArray = Array.from(friendIds);

  // مرحله ۲: کوئری استوری‌های فعال با ۲ شرط:
  // - یا public باشد
  // - یا مال خود کاربر باشد
  // - یا مال دوستانش باشد
  let query = supabaseAdmin
    .from("stories")
    .select(
      `
      id,
      user_id,
      media_url,
      media_type,
      caption,
      privacy,
      metadata,
      created_at,
      expires_at,
      user:profiles!user_id (
        id,
        display_name,
        avatar_url
      ),
      story_views!left (
        user_id
      )
    `,
    )
    .gt("expires_at", now)
    .order("created_at", { ascending: true });

  if (friendIdsArray.length > 0) {
    query = query.or(
      `privacy.eq.public,user_id.eq.${currentUserId},and(privacy.eq.friends,user_id.in.(${friendIdsArray.join(",")}))`,
    );
  } else {
    // اگر دوستی ندارد، فقط پابلیک‌ها و استوری‌های خودش را ببیند
    query = query.or(`privacy.eq.public,user_id.eq.${currentUserId}`);
  }

  const { data: rawStories, error: storiesError } = await query;

  if (storiesError) {
    return c.json({ error: storiesError.message }, 500);
  }

  // مرحله ۳: گروه‌بندی استوری‌ها بر اساس کاربر (Group by User)
  // مناسب برای کامپوننت دایره‌های استوری در فرانت‌اند
  const userMap = new Map<
    string,
    { user: any; all_seen: boolean; stories: any[] }
  >();

  (rawStories || []).forEach((item: any) => {
    // بررسی اینکه آیا کاربر فعلی این استوری خاص را دیده یا خیر
    const isSeen =
      item.story_views?.some((v: any) => v.user_id === currentUserId) ?? false;
    const storyItem = {
      ...item,
      is_seen: isSeen,
    };
    delete storyItem.story_views;

    if (!userMap.has(item.user_id)) {
      userMap.set(item.user_id, {
        user: item.user,
        all_seen: true,
        stories: [],
      });
    }

    const userGroup = userMap.get(item.user_id)!;
    userGroup.stories.push(storyItem);
    if (!isSeen) {
      userGroup.all_seen = false;
    }
  });

  // مرتب‌سازی فید: استوری‌های دیده نشده جلوتر، و استوری خود کاربر اول از همه
  const feedArray = Array.from(userMap.values()).sort((a, b) => {
    if (a.user.id === currentUserId) return -1;
    if (b.user.id === currentUserId) return 1;
    if (a.all_seen === b.all_seen) return 0;
    return a.all_seen ? 1 : -1;
  });

  return c.json({ feed: feedArray }, 200);
});

/* ==========================================================================
   ۴. ثبت مشاهده استوری (Mark Story as Viewed)
   ========================================================================== */
const viewStoryRoute = createRoute({
  method: "post",
  path: "/:storyId/view",
  tags: ["Stories"],
  summary: "ثبت مشاهده یک استوری توسط کاربر جاری",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ storyId: z.string().uuid() }),
  },
  responses: {
    200: { description: "مشاهده استوری ثبت شد" },
    500: { description: "خطای سرور" },
  },
});

storiesApp.openapi(viewStoryRoute, async (c) => {
  const currentUserId = c.get("userId");
  const { storyId } = c.req.valid("param");

  // با استفاده از upsert جلوی خطای تکراری بودن کلید مرکب گرفته می‌شود
  await supabaseAdmin.from("story_views").upsert(
    {
      story_id: storyId,
      user_id: currentUserId,
      viewed_at: new Date().toISOString(),
    },
    { onConflict: "story_id,user_id", ignoreDuplicates: true },
  );

  return c.json({ success: true }, 200);
});
