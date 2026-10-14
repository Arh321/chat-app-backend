import { createRoute, z } from "@hono/zod-openapi";
import { createOpenAPIApp } from "../../lib/openapi";
import { requireAuth } from "../../middlewares/auth";
import { supabaseAdmin } from "../../lib/supabase";
import {
  AddMemberSchema,
  ToggleFavoriteSchema,
  ToggleMuteSchema,
  TogglePinSchema,
  UpdateMemberRoleSchema,
} from "./rooms.schema";
import { getMemberRole } from "./helpers";

const roomsApp = createOpenAPIApp();
roomsApp.use("*", requireAuth);

// ۱. لیست تمام اتاق‌های کاربر
const listRoomsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Rooms"],
  summary: "دریافت لیست اتاق‌های چت کاربر",
  description:
    "لیست تمام چت‌های دو نفره و گروه‌هایی که کاربر فعلی در آن‌ها عضو است همراه با آخرین پیام.",
  security: [{ Bearer: [] }],
  responses: {
    200: {
      description: "لیست چت‌ها با موفقیت برگشت داده شد",
    },
  },
});

roomsApp.openapi(listRoomsRoute, async (c) => {
  const userId = c.get("userId");

  // دریافت اتاق‌هایی که کاربر عضو آن‌هاست
  const { data: memberRooms, error: memberError } = await supabaseAdmin
    .from("room_members")
    .select(
      `
      room_id,
      role,
      rooms (
        id,
        type,
        title,
        avatar_url,
        is_public,
        last_message_at,
        created_at
      )
    `,
    )
    .eq("user_id", userId);

  if (memberError) {
    return c.json({ error: memberError.message }, 400);
  }

  // برای چت‌های DM نام و آواتار طرف مقابل را واکشی می‌کنیم
  const rooms = await Promise.all(
    (memberRooms || []).map(async (item: any) => {
      const room = item.rooms;
      if (!room) return null;

      if (room.type === "dm") {
        const { data: otherMember } = await supabaseAdmin
          .from("room_members")
          .select("profiles(id, display_name, avatar_url, email)")
          .eq("room_id", room.id)
          .neq("user_id", userId)
          .single();

        return {
          id: room.id,
          type: room.type,
          title: (otherMember as any)?.profiles?.display_name || "کاربر",
          avatar_url: (otherMember as any)?.profiles?.avatar_url,
          last_message_at: room.last_message_at,
          my_role: item.role,
          dm_partner: otherMember?.profiles,
        };
      }

      return {
        id: room.id,
        type: room.type,
        title: room.title,
        avatar_url: room.avatar_url,
        is_public: room.is_public,
        last_message_at: room.last_message_at,
        my_role: item.role,
      };
    }),
  );

  return c.json(
    {
      rooms: rooms.filter(Boolean).sort((a, b) => {
        const timeA = new Date(a!.last_message_at || 0).getTime();
        const timeB = new Date(b!.last_message_at || 0).getTime();
        return timeB - timeA;
      }),
    },
    200,
  );
});

// ۲. ساخت گروه جدید
const CreateGroupSchema = z.object({
  title: z
    .string()
    .min(2)
    .max(50)
    .openapi({ example: "برنامه‌نویسان React و Next" }),
  is_public: z.boolean().default(false).openapi({ example: false }),
});

const createGroupRoute = createRoute({
  method: "post",
  path: "/group",
  tags: ["Rooms"],
  summary: "ایجاد گروه جدید",
  description:
    "ساخت گروه جدید توسط کاربر؛ فرد سازنده مالک (Owner) می‌شود و یک کد دعوت یکتا برای گروه تولید می‌گردد.",
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateGroupSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "گروه ساخته شد",
    },
    400: {
      description: "خطا در ایجاد گروه",
    },
  },
});

roomsApp.openapi(createGroupRoute, async (c) => {
  const userId = c.get("userId");
  const { title, is_public } = c.req.valid("json");

  // فراخوانی RPC اتمیک ساخت گروه یا اینسرت مستقیم
  const { data: newRoom, error: roomError } = await supabaseAdmin
    .from("rooms")
    .insert({
      type: "group",
      title,
      is_public,
      created_by: userId,
      last_message_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (roomError) {
    return c.json({ error: roomError.message }, 400);
  }

  // اضافه کردن سازنده به عنوان ادمین/مالک گروه
  await supabaseAdmin.from("room_members").insert({
    room_id: newRoom.id,
    user_id: userId,
    role: "owner",
  });

  // تولید کد دعوت رندوم برای گروه
  const inviteCode = Math.random().toString(36).substring(2, 10).toUpperCase();
  await supabaseAdmin.from("group_invites").insert({
    room_id: newRoom.id,
    code: inviteCode,
    created_by: userId,
  });

  return c.json(
    {
      message: "گروه با موفقیت ساخته شد",
      room: newRoom,
      invite_code: inviteCode,
    },
    201,
  );
});

// ۳. جستجوی گروه‌های عمومی
const searchPublicGroupsRoute = createRoute({
  method: "get",
  path: "/public",
  tags: ["Rooms"],
  summary: "لیست و جستجوی گروه‌های عمومی",
  security: [{ Bearer: [] }],
  request: {
    query: z.object({
      query: z.string().optional().openapi({ example: "React" }),
    }),
  },
  responses: {
    200: {
      description: "لیست گروه‌های عمومی",
    },
  },
});

roomsApp.openapi(searchPublicGroupsRoute, async (c) => {
  const { query } = c.req.valid("query");

  let dbQuery = supabaseAdmin
    .from("rooms")
    .select("id, title, avatar_url, created_at, created_by")
    .eq("type", "group")
    .eq("is_public", true);

  if (query) {
    dbQuery = dbQuery.ilike("title", `%${query}%`);
  }

  const { data, error } = await dbQuery.limit(20);

  if (error) {
    return c.json({ error: error.message }, 400);
  }

  return c.json({ public_groups: data }, 200);
});

// ۴. عضویت مستقیم در گروه عمومی
const joinPublicGroupRoute = createRoute({
  method: "post",
  path: "/{roomId}/join",
  tags: ["Rooms"],
  summary: "عضویت در گروه عمومی",
  description: "کاربر با آیدی گروه می‌تواند مستقیماً وارد گروه‌های عمومی شود.",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      roomId: z.string().openapi({
        param: {
          name: "roomId",
          in: "path", // صراحتاً مشخص می‌کنیم در Path است نه Query
        },
        example: "082d5bb9-8ffb-46ee-b889-2c24fcabc43c",
      }),
    }),
  },
  responses: {
    200: {
      description: "با موفقیت عضو گروه شدید",
    },
    400: {
      description: "خطای اعتبارسنجی یا وضعیت نامعتبر",
    },
    404: {
      description: "این گروه عمومی نیست یا وجود ندارد",
    },
  },
});

roomsApp.openapi(joinPublicGroupRoute, async (c) => {
  const userId = c.get("userId");

  let roomId = c.req.param("roomId");
  if (!roomId || roomId === ":roomId") {
    roomId = c.req.query("roomId") as string;
  }

  if (!roomId || roomId === ":roomId") {
    return c.json({ error: "شناسه اتاق ارسال نشده است" }, 400);
  }

  // ۱. بررسی وجود گروه و عمومی بودن
  const { data: room, error: roomError } = await supabaseAdmin
    .from("rooms")
    .select("id, type, is_public, title")
    .eq("id", roomId)
    .single();

  if (roomError || !room) {
    return c.json({ error: "اتاق مورد نظر یافت نشد" }, 404);
  }

  if (room.type !== "group" || !room.is_public) {
    return c.json({ error: "این گروه عمومی نیست یا وجود ندارد" }, 400);
  }

  // ۲. بررسی عضویت با ستون‌های موجود (room_id, user_id)
  const { data: existingMember } = await supabaseAdmin
    .from("room_members")
    .select("user_id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingMember) {
    return c.json(
      { message: "شما در حال حاضر عضو این گروه هستید", roomId },
      200,
    );
  }

  // ۳. اضافه کردن کاربر (با upsert برای جلوگیری از خطای race condition یا constraint)
  const { error: joinError } = await supabaseAdmin.from("room_members").upsert(
    {
      room_id: roomId,
      user_id: userId,
      role: "member",
    },
    { onConflict: "room_id,user_id", ignoreDuplicates: true },
  );

  if (joinError) {
    return c.json({ error: joinError.message }, 500);
  }

  return c.json(
    {
      message: `شما با موفقیت به گروه «${room.title || "بدون عنوان"}» پیوستید`,
      roomId,
    },
    200,
  );
});

/* ==========================================================================
   افزودن عضو به گروه (مخصوص Owner و Admin)
   ========================================================================== */
const addMemberRoute = createRoute({
  method: "post",
  path: "/:roomId/members",
  tags: ["Rooms Management"],
  summary: "افزودن کاربر به گروه توسط مدیر یا ادمین",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ roomId: z.string().uuid() }),
    body: {
      content: {
        "application/json": {
          schema: AddMemberSchema,
        },
      },
    },
  },
  responses: {
    200: { description: "کاربر با موفقیت به گروه افزوده شد" },
    400: { description: "کاربر قبلاً عضو گروه است" },
    403: { description: "دسترسی غیرمجاز (تنها مدیر و ادمین مجاز هستند)" },
  },
});

roomsApp.openapi(addMemberRoute, async (c) => {
  const currentUserId = c.get("userId");
  const { roomId } = c.req.valid("param");
  const { user_id: targetUserId, role: newMemberRole } = c.req.valid("json");

  // بررسی نقش کاربر درخواست‌دهنده
  const requesterRole = await getMemberRole(roomId, currentUserId);
  if (
    !requesterRole ||
    (requesterRole !== "owner" && requesterRole !== "admin")
  ) {
    return c.json({ error: "شما اجازه افزودن عضو به این گروه را ندارید" }, 403);
  }

  // ادمین معمولی نمی‌تواند ادمین اضافه کند؛ فقط عضو عادی می‌تواند بیفزاید
  const assignedRole = requesterRole === "owner" ? newMemberRole : "member";

  const { error } = await supabaseAdmin.from("room_members").insert({
    room_id: roomId,
    user_id: targetUserId,
    role: assignedRole,
  });

  if (error) {
    if (error.code === "23505") {
      return c.json({ error: "این کاربر در حال حاضر عضو گروه است" }, 400);
    }
    return c.json({ error: error.message }, 500);
  }

  return c.json({ success: true, message: "کاربر با موفقیت اضافه شد" }, 200);
});

/* ==========================================================================
   اخراج عضو از گروه (توسط Owner یا Admin)
   ========================================================================== */
const removeMemberRoute = createRoute({
  method: "delete",
  path: "/:roomId/members/:targetUserId",
  tags: ["Rooms Management"],
  summary: "حذف/اخراج یک عضو از گروه",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      roomId: z.string().uuid(),
      targetUserId: z.string().uuid(),
    }),
  },
  responses: {
    200: { description: "عضو با موفقیت از گروه حذف شد" },
    403: { description: "عدم دسترسی به حذف این کاربر" },
    404: { description: "کاربر مورد نظر در این گروه یافت نشد" },
  },
});

roomsApp.openapi(removeMemberRoute, async (c) => {
  const currentUserId = c.get("userId");
  const { roomId, targetUserId } = c.req.valid("param");

  const requesterRole = await getMemberRole(roomId, currentUserId);
  if (
    !requesterRole ||
    (requesterRole !== "owner" && requesterRole !== "admin")
  ) {
    return c.json({ error: "شما دسترسی اخراج اعضا را ندارید" }, 403);
  }

  // گرفتن نقش کاربری که قرار است اخراج شود
  const targetRole = await getMemberRole(roomId, targetUserId);
  if (!targetRole) {
    return c.json({ error: "کاربر مورد نظر در این گروه حضور ندارد" }, 404);
  }

  // مالک گروه را هیچ‌کس نمی‌تواند اخراج کند
  if (targetRole === "owner") {
    return c.json({ error: "امکان اخراج سازنده/مالک گروه وجود ندارد" }, 403);
  }

  // ادمین نمی‌تواند ادمین دیگر را اخراج کند (فقط مالک می‌تواند ادمین را بردارد)
  if (requesterRole === "admin" && targetRole === "admin") {
    return c.json({ error: "ادمین نمی‌تواند ادمین دیگری را اخراج کند" }, 403);
  }

  const { error } = await supabaseAdmin
    .from("room_members")
    .delete()
    .eq("room_id", roomId)
    .eq("user_id", targetUserId);

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json(
    { success: true, message: "کاربر با موفقیت از گروه اخراج شد" },
    200,
  );
});

/* ==========================================================================
   تغییر سطح دسترسی عضو (ارتقا به ادمین یا تنزل به ممبر) - اختصاصی Owner
   ========================================================================== */
const updateMemberRoleRoute = createRoute({
  method: "patch",
  path: "/:roomId/members/:targetUserId/role",
  tags: ["Rooms Management"],
  summary: "تغییر نقش یک عضو (ارتقا به ادمین / تنزل به عضو عادی)",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      roomId: z.string().uuid(),
      targetUserId: z.string().uuid(),
    }),
    body: {
      content: {
        "application/json": {
          schema: UpdateMemberRoleSchema,
        },
      },
    },
  },
  responses: {
    200: { description: "نقش کاربر با موفقیت تغییر کرد" },
    403: { description: "فقط مالک گروه می‌تواند نقش‌ها را تغییر دهد" },
  },
});

roomsApp.openapi(updateMemberRoleRoute, async (c) => {
  const currentUserId = c.get("userId");
  const { roomId, targetUserId } = c.req.valid("param");
  const { role: newRole } = c.req.valid("json");

  // فقط Owner حق ارتقا یا عزل ادمین‌ها را دارد
  const requesterRole = await getMemberRole(roomId, currentUserId);
  if (requesterRole !== "owner") {
    return c.json(
      { error: "تنها مالک اصلی گروه می‌تواند نقش کاربران را تغییر دهد" },
      403,
    );
  }

  if (currentUserId === targetUserId) {
    return c.json(
      { error: "امکان تغییر نقش خودتان از این طریق وجود ندارد" },
      400,
    );
  }

  const { error } = await supabaseAdmin
    .from("room_members")
    .update({ role: newRole })
    .eq("room_id", roomId)
    .eq("user_id", targetUserId);

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json(
    { success: true, message: `نقش کاربر به ${newRole} تغییر یافت` },
    200,
  );
});

/* ==========================================================================
   ریست کردن کد دعوت گروه (Invite Code)
   ========================================================================== */
const regenerateInviteCodeRoute = createRoute({
  method: "post",
  path: "/:roomId/regenerate-invite",
  tags: ["Rooms Management"],
  summary: "تولید مجدد و تغییر کد دعوت گروه",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ roomId: z.string().uuid() }),
  },
  responses: {
    200: { description: "کد دعوت جدید تولید شد" },
    403: { description: "عدم دسترسی" },
  },
});

roomsApp.openapi(regenerateInviteCodeRoute, async (c) => {
  const currentUserId = c.get("userId");
  const { roomId } = c.req.valid("param");

  const requesterRole = await getMemberRole(roomId, currentUserId);
  if (
    !requesterRole ||
    (requesterRole !== "owner" && requesterRole !== "admin")
  ) {
    return c.json(
      { error: "تنها مدیر یا ادمین‌های گروه می‌توانند کد دعوت را تغییر دهند" },
      403,
    );
  }

  const newInviteCode = Math.random()
    .toString(36)
    .substring(2, 10)
    .toUpperCase();

  const { data: updatedRoom, error } = await supabaseAdmin
    .from("rooms")
    .update({ invite_code: newInviteCode })
    .eq("id", roomId)
    .select("id, invite_code")
    .single();

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ invite_code: updatedRoom.invite_code }, 200);
});

/* ==========================================================================
   دریافت لیست اعضای روم به تفکیک نقش
   ========================================================================== */
const getRoomMembersRoute = createRoute({
  method: "get",
  path: "/:roomId/members",
  tags: ["Rooms Management"],
  summary: "دریافت لیست اعضای گروه و نقش هرکدام",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ roomId: z.string().uuid() }),
  },
  responses: {
    200: { description: "لیست اعضا بازگردانده شد" },
    403: { description: "عدم عضویت در گروه" },
  },
});

roomsApp.openapi(getRoomMembersRoute, async (c) => {
  const currentUserId = c.get("userId");
  const { roomId } = c.req.valid("param");

  const requesterRole = await getMemberRole(roomId, currentUserId);
  if (!requesterRole) {
    return c.json({ error: "شما عضو این گروه نیستید" }, 403);
  }

  const { data: members, error } = await supabaseAdmin
    .from("room_members")
    .select(
      `
      user_id,
      role,
      user:profiles!user_id (
        id,
        display_name,
        avatar_url
      )
    `,
    )
    .eq("room_id", roomId);

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ members: members || [] }, 200);
});

/* ==========================================================================
   ۱. سنجاق کردن یا برداشتن سنجاق چت (Pin / Unpin Room)
   ========================================================================== */
const togglePinRoute = createRoute({
  method: "patch",
  path: "/:roomId/pin",
  tags: ["Rooms"],
  summary: "پین یا آن‌پین کردن چت برای کاربر جاری",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      roomId: z.string().uuid(),
    }),
    body: {
      content: {
        "application/json": {
          schema: TogglePinSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "وضعیت پین با موفقیت تغییر کرد",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            is_pinned: z.boolean(),
            pinned_at: z.string().nullable(),
          }),
        },
      },
    },
    403: { description: "شما عضو این چت نیستید" },
    500: { description: "خطای سرور" },
  },
});

roomsApp.openapi(togglePinRoute, async (c) => {
  const currentUserId = c.get("userId");
  const { roomId } = c.req.valid("param");
  const { is_pinned } = c.req.valid("json");

  const pinnedAt = is_pinned ? new Date().toISOString() : null;

  const { data, error } = await supabaseAdmin
    .from("room_members")
    .update({
      is_pinned,
      pinned_at: pinnedAt,
    })
    .eq("room_id", roomId)
    .eq("user_id", currentUserId)
    .select("is_pinned, pinned_at")
    .maybeSingle();

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  if (!data) {
    return c.json({ error: "شما عضو این گفتگو نیستید" }, 403);
  }

  return c.json(
    {
      message: is_pinned ? "چت سنجاق شد" : "چت از حالت سنجاق خارج شد",
      is_pinned: data.is_pinned,
      pinned_at: data.pinned_at,
    },
    200,
  );
});

/* ==========================================================================
   ۲. افزودن/حذف از علاقه‌مندی‌ها (Favorite / Unfavorite Room)
   ========================================================================== */
const toggleFavoriteRoute = createRoute({
  method: "patch",
  path: "/:roomId/favorite",
  tags: ["Rooms"],
  summary: "افزودن به یا حذف از علاقه‌مندی‌ها",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      roomId: z.string().uuid(),
    }),
    body: {
      content: {
        "application/json": {
          schema: ToggleFavoriteSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "وضعیت علاقه‌مندی تغییر کرد",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            is_favorite: z.boolean(),
          }),
        },
      },
    },
    403: { description: "شما عضو این چت نیستید" },
    500: { description: "خطای سرور" },
  },
});

roomsApp.openapi(toggleFavoriteRoute, async (c) => {
  const currentUserId = c.get("userId");
  const { roomId } = c.req.valid("param");
  const { is_favorite } = c.req.valid("json");

  const { data, error } = await supabaseAdmin
    .from("room_members")
    .update({ is_favorite })
    .eq("room_id", roomId)
    .eq("user_id", currentUserId)
    .select("is_favorite")
    .maybeSingle();

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  if (!data) {
    return c.json({ error: "شما عضو این گفتگو نیستید" }, 403);
  }

  return c.json(
    {
      message: is_favorite
        ? "به علاقه‌مندی‌ها اضافه شد"
        : "از علاقه‌مندی‌ها حذف شد",
      is_favorite: data.is_favorite,
    },
    200,
  );
});

/* ==========================================================================
   ۳. بی‌صدا کردن چت (Mute / Unmute Room)
   ========================================================================== */
const toggleMuteRoute = createRoute({
  method: "patch",
  path: "/:roomId/mute",
  tags: ["Rooms"],
  summary: "بی‌صدا کردن یا فعال‌سازی نوتیفیکیشن چت",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      roomId: z.string().uuid(),
    }),
    body: {
      content: {
        "application/json": {
          schema: ToggleMuteSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "وضعیت بی‌صدا تغییر کرد",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            is_muted: z.boolean(),
          }),
        },
      },
    },
    403: { description: "شما عضو این چت نیستید" },
  },
});

roomsApp.openapi(toggleMuteRoute, async (c) => {
  const currentUserId = c.get("userId");
  const { roomId } = c.req.valid("param");
  const { is_muted } = c.req.valid("json");

  const { data, error } = await supabaseAdmin
    .from("room_members")
    .update({ is_muted })
    .eq("room_id", roomId)
    .eq("user_id", currentUserId)
    .select("is_muted")
    .maybeSingle();

  if (error || !data) {
    return c.json({ error: "خطا در به‌روزرسانی یا عدم عضویت در چت" }, 403);
  }

  return c.json(
    {
      message: is_muted ? "اعلان‌های این چت بی‌صدا شد" : "اعلان‌های چت فعال شد",
      is_muted: data.is_muted,
    },
    200,
  );
});

export default roomsApp;
