import { createRoute, z } from "@hono/zod-openapi";
import { createOpenAPIApp } from "../../lib/openapi";
import { requireAuth } from "../../middlewares/auth";
import { supabaseAdmin } from "../../lib/supabase";
import {
  MessageItemSchema,
  ReactionSummarySchema,
  SendMessageSchema,
  ToggleReactionSchema,
} from "./messages.schema";

const messagesApp = createOpenAPIApp();
messagesApp.use("*", requireAuth);

/* ==========================================================================
   ۱. ارسال پیام (متن، عکس، ویدیو، صوت یا فایل به همراه ریپلای/فوروارد)
   ========================================================================== */
const sendMessageRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Messages"],
  summary: "ارسال پیام جدید در گفتگو",
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: SendMessageSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "پیام با موفقیت ثبت و ارسال شد",
    },
    400: {
      description: "داده‌های ورودی نامعتبر یا پیام ریپلای یافت نشد",
    },
    403: {
      description: "دسترسی غیرمجاز (کاربر عضو این گفتگو نیست)",
    },
  },
});

messagesApp.openapi(sendMessageRoute, async (c) => {
  const userId = c.get("userId");
  const body = c.req.valid("json");

  // ۱. بررسی عضویت کاربر در روم
  const { data: membership } = await supabaseAdmin
    .from("room_members")
    .select("user_id")
    .eq("room_id", body.room_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return c.json({ error: "شما عضو این اتاق چت نیستید" }, 403);
  }

  // ۲. در صورت ریپلای، بررسی صحت پیام مبدأ
  if (body.reply_to_id) {
    const { data: replyMsg } = await supabaseAdmin
      .from("messages")
      .select("id, room_id")
      .eq("id", body.reply_to_id)
      .eq("room_id", body.room_id)
      .maybeSingle();

    if (!replyMsg) {
      return c.json(
        { error: "پیامی که به آن ریپلای می‌زنید در این اتاق یافت نشد" },
        400,
      );
    }
  }

  // ۳. درج پیام جدید
  const { data: message, error: msgError } = await supabaseAdmin
    .from("messages")
    .insert({
      room_id: body.room_id,
      sender_id: userId,
      content: body.content || "",
      type: body.type,
      file_url: body.file_url || null,
      file_name: body.file_name || null,
      file_size: body.file_size || null,
      mime_type: body.mime_type || null,
      metadata: body.metadata || {},
      reply_to_id: body.reply_to_id || null,
      forward_from_id: body.forward_from_id || null,
      is_forwarded: body.is_forwarded || Boolean(body.forward_from_id),
    })
    .select(
      `
      id,
      room_id,
      content,
      type,
      file_url,
      file_name,
      file_size,
      mime_type,
      metadata,
      is_forwarded,
      is_edited,
      is_pinned,
      created_at,
      sender:profiles!sender_id (
        id,
        display_name,
        avatar_url
      ),
      reply_to:messages!reply_to_id (
        id,
        content,
        type,
        sender:profiles!sender_id (
          id,
          display_name
        )
      ),
      forward_from:profiles!forward_from_id (
        id,
        display_name
      )
    `,
    )
    .single();

  if (msgError) {
    return c.json({ error: msgError.message }, 400);
  }

  // ۴. ثبت خودکار سین پیام برای ارسال‌کننده
  await supabaseAdmin.from("message_reads").upsert(
    {
      message_id: message.id,
      user_id: userId,
    },
    { onConflict: "message_id,user_id", ignoreDuplicates: true },
  );

  // ۵. به‌روزرسانی زمان فعالیت اتاق
  await supabaseAdmin
    .from("rooms")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", body.room_id);

  return c.json({ message }, 201);
});

/* ==========================================================================
   ۲. ثبت وضعیت دیده‌شدن پیام‌ها (Mark as Read)
   ========================================================================== */
const markAsReadRoute = createRoute({
  method: "post",
  path: "/read",
  tags: ["Messages"],
  summary: "ثبت وضعیت خوانده‌شدن پیام‌ها (Seen)",
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            room_id: z.string().uuid(),
            message_ids: z.array(z.string().uuid()).min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "پیام‌ها با موفقیت خوانده شدند",
    },
    400: {
      description: "لیست شناسه‌های پیام نامعتبر است",
    },
    500: {
      description: "خطای سرور",
    },
  },
});

messagesApp.openapi(markAsReadRoute, async (c) => {
  const userId = c.get("userId");
  const { message_ids } = c.req.valid("json");

  const records = message_ids.map((msgId: string) => ({
    message_id: msgId,
    user_id: userId,
  }));

  const { error } = await supabaseAdmin.from("message_reads").upsert(records, {
    onConflict: "message_id,user_id",
    ignoreDuplicates: true,
  });

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ success: true, count: message_ids.length }, 200);
});

/* ==========================================================================
   ۳. دریافت تاریخچه پیام‌های یک چت (با Pagination و سین‌ها)
   ========================================================================== */
const getMessagesRoute = createRoute({
  method: "get",
  path: "/{roomId}",
  tags: ["Messages"],
  summary: "دریافت تاریخچه پیام‌های یک چت به همراه ری‌اکشن‌ها و وضعیت سین",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      roomId: z
        .string()
        .uuid()
        .openapi({ description: "شناسه یکتای اتاق یا چت" }),
    }),
    query: z.object({
      limit: z
        .string()
        .optional()
        .openapi({ example: "30", description: "تعداد پیام‌ها (حداکثر ۱۰۰)" }),
      before: z.string().optional().openapi({
        example: "2026-10-13T12:00:00Z",
        description: "برای Cursor Pagination بر اساس created_at",
      }),
    }),
  },
  responses: {
    200: {
      description: "لیست مرتب‌شده پیام‌ها به صورت زمانی (از قدیم به جدید)",
      content: {
        "application/json": {
          schema: z.object({
            messages: z.array(MessageItemSchema),
            has_more: z.boolean(),
            next_cursor: z.string().nullable(),
          }),
        },
      },
    },
    400: {
      description: "خطا در واکشی داده‌ها",
      content: {
        "application/json": {
          schema: z.object({ error: z.string() }),
        },
      },
    },
    403: {
      description: "کاربر عضو این چت نیست",
      content: {
        "application/json": {
          schema: z.object({ error: z.string() }),
        },
      },
    },
  },
});

/* ==========================================================================
   پیاده‌سازی Controller
   ========================================================================== */
messagesApp.openapi(getMessagesRoute, async (c) => {
  const currentUserId = c.get("userId");
  const { roomId } = c.req.valid("param");
  const { limit = "30", before } = c.req.valid("query");
  const take = Math.min(Math.max(Number(limit) || 30, 1), 100);

  // ۱. بررسی عضویت کاربر در چت
  const { data: membership } = await supabaseAdmin
    .from("room_members")
    .select("user_id")
    .eq("room_id", roomId)
    .eq("user_id", currentUserId)
    .maybeSingle();

  if (!membership) {
    return c.json({ error: "شما عضو این گفتگو نیستید" }, 403);
  }

  // ۲. ساخت کوئری واکشی پیام‌ها، سین‌ها و ری‌اکشن‌ها
  // ۱ رکورد بیشتر می‌گیریم تا وضعیت has_more برای کلاینت مشخص شود
  let query = supabaseAdmin
    .from("messages")
    .select(
      `
      id,
      room_id,
      content,
      type,
      file_url,
      file_name,
      file_size,
      mime_type,
      metadata,
      is_forwarded,
      is_edited,
      is_pinned,
      created_at,
      sender:profiles!sender_id (
        id,
        display_name,
        avatar_url
      ),
      reply_to:messages!reply_to_id (
        id,
        content,
        type,
        sender:profiles!sender_id (
          id,
          display_name
        )
      ),
      forward_from:profiles!forward_from_id (
        id,
        display_name
      ),
      message_reads (
        user_id
      ),
      message_reactions (
        emoji,
        user_id
      )
    `,
    )
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(take + 1);

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data: rawMessages, error } = await query;

  if (error) {
    return c.json({ error: error.message }, 400);
  }

  const items = rawMessages || [];
  const hasMore = items.length > take;
  const pageItems = hasMore ? items.slice(0, take) : items;
  const nextCursor =
    pageItems.length > 0 ? pageItems[pageItems.length - 1].created_at : null;

  // ۳. فرمت‌بندی، شمارش سین‌ها و تجمیع ری‌اکشن‌ها
  const formattedMessages = pageItems.map((msg: any) => {
    // الف) محاسبه وضعیت سین‌ها
    const reads: Array<{ user_id: string }> = msg.message_reads || [];
    const readsCount = reads.length;
    const isReadByMe = reads.some((r) => r.user_id === currentUserId);

    // ب) تجمیع و گروه‌بندی ری‌اکشن‌ها
    const reactionMap = new Map<
      string,
      { emoji: string; count: number; reacted_by_me: boolean }
    >();

    (msg.message_reactions || []).forEach(
      (reaction: { emoji: string; user_id: string }) => {
        if (!reactionMap.has(reaction.emoji)) {
          reactionMap.set(reaction.emoji, {
            emoji: reaction.emoji,
            count: 0,
            reacted_by_me: false,
          });
        }

        const current = reactionMap.get(reaction.emoji)!;
        current.count += 1;
        if (reaction.user_id === currentUserId) {
          current.reacted_by_me = true;
        }
      },
    );

    const reactions = Array.from(reactionMap.values());

    return {
      id: msg.id,
      room_id: msg.room_id,
      content: msg.content,
      type: msg.type,
      file_url: msg.file_url,
      file_name: msg.file_name,
      file_size: msg.file_size,
      mime_type: msg.mime_type,
      metadata: msg.metadata,
      is_forwarded: msg.is_forwarded,
      is_edited: msg.is_edited,
      is_pinned: msg.is_pinned,
      created_at: msg.created_at,
      sender: msg.sender,
      reply_to: msg.reply_to,
      forward_from: msg.forward_from,
      reads_count: readsCount,
      is_read_by_me: isReadByMe,
      reactions,
    };
  });

  // آرایه معکوس می‌شود تا پیام‌ها در رابط کاربری از قدیم به جدید (چیدمان طبیعی چت) رندر شوند
  return c.json(
    {
      messages: formattedMessages.reverse(),
      has_more: hasMore,
      next_cursor: nextCursor,
    },
    200,
  );
});

const toggleReactionRoute = createRoute({
  method: "post",
  path: "/:messageId/reactions",
  tags: ["Messages"],
  summary: "ثبت یا حذف ری‌اکشن روی پیام (Toggle)",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      messageId: z.string().uuid(),
    }),
    body: {
      content: {
        "application/json": {
          schema: ToggleReactionSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "نتیجه عملیات ری‌اکشن",
      content: {
        "application/json": {
          schema: z.object({
            action: z.enum(["added", "removed"]),
            emoji: z.string(),
          }),
        },
      },
    },
    403: { description: "دسترسی غیرمجاز (شما عضو این روم نیستید)" },
    404: { description: "پیام یافت نشد" },
    500: { description: "خطای سرور" },
  },
});

messagesApp.openapi(toggleReactionRoute, async (c) => {
  const currentUserId = c.get("userId");
  const { messageId } = c.req.valid("param");
  const { emoji } = c.req.valid("json");

  // ۱. واکشی روم مربوط به این پیام
  const { data: message, error: msgError } = await supabaseAdmin
    .from("messages")
    .select("id, room_id")
    .eq("id", messageId)
    .maybeSingle();

  if (msgError || !message) {
    return c.json({ error: "پیام مورد نظر یافت نشد" }, 404);
  }

  // ۲. بررسی عضویت کاربر در روم پیام
  const { data: isMember } = await supabaseAdmin
    .from("room_members")
    .select("user_id")
    .eq("room_id", message.room_id)
    .eq("user_id", currentUserId)
    .maybeSingle();

  if (!isMember) {
    return c.json({ error: "شما عضو این گفتگو نیستید" }, 403);
  }

  // ۳. بررسی وجود ری‌اکشن قبلی (Toggle Check)
  const { data: existingReaction } = await supabaseAdmin
    .from("message_reactions")
    .select("id")
    .eq("message_id", messageId)
    .eq("user_id", currentUserId)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existingReaction) {
    // قبلاً این ری‌اکشن ثبت شده، پس آن را حذف می‌کنیم (Toggle Off)
    await supabaseAdmin
      .from("message_reactions")
      .delete()
      .eq("id", existingReaction.id);

    return c.json({ action: "removed", emoji }, 200);
  } else {
    // ثبت ری‌اکشن جدید (Add Reaction)
    const { error: insertError } = await supabaseAdmin
      .from("message_reactions")
      .insert({
        message_id: messageId,
        user_id: currentUserId,
        emoji,
      });

    if (insertError) {
      return c.json({ error: insertError.message }, 500);
    }

    return c.json({ action: "added", emoji }, 200);
  }
});

/* ==========================================================================
   ۲. دریافت جزئیات ری‌اکشن‌های یک پیام
   ========================================================================== */
const getMessageReactionsRoute = createRoute({
  method: "get",
  path: "/:messageId/reactions",
  tags: ["Messages"],
  summary: "دریافت لیست ری‌اکشن‌ها و تفکیک کاربران آن برای یک پیام",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      messageId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: "لیست واکنش‌های دسته‌بندی شده",
      content: {
        "application/json": {
          schema: z.object({
            reactions: z.array(ReactionSummarySchema),
          }),
        },
      },
    },
    500: { description: "خطای سرور" },
  },
});

messagesApp.openapi(getMessageReactionsRoute, async (c) => {
  const currentUserId = c.get("userId");
  const { messageId } = c.req.valid("param");

  const { data: rawReactions, error } = await supabaseAdmin
    .from("message_reactions")
    .select(
      `
      emoji,
      user_id,
      user:profiles!user_id (
        id,
        display_name
      )
    `,
    )
    .eq("message_id", messageId);

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  // گروه‌بندی بر اساس اموجی
  const grouped = new Map<
    string,
    { emoji: string; count: number; reacted_by_me: boolean; users: any[] }
  >();

  (rawReactions || []).forEach((r: any) => {
    if (!grouped.has(r.emoji)) {
      grouped.set(r.emoji, {
        emoji: r.emoji,
        count: 0,
        reacted_by_me: false,
        users: [],
      });
    }

    const item = grouped.get(r.emoji)!;
    item.count += 1;
    if (r.user_id === currentUserId) {
      item.reacted_by_me = true;
    }
    if (r.user) {
      item.users.push(r.user);
    }
  });

  return c.json({ reactions: Array.from(grouped.values()) }, 200);
});

export default messagesApp;
