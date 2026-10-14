import { z } from "@hono/zod-openapi";

// نقش‌های معتبر
export const RoomRoleSchema = z.enum(["owner", "admin", "member"]);

// اسکیمای افزودن عضو جدید
export const AddMemberSchema = z.object({
  user_id: z
    .string()
    .uuid()
    .openapi({ example: "11111111-1111-1111-1111-111111111111" }),
  role: z
    .enum(["admin", "member"])
    .default("member")
    .openapi({ example: "member" }),
});

// اسکیمای تغییر سطح دسترسی یک عضو
export const UpdateMemberRoleSchema = z.object({
  role: z.enum(["admin", "member"]).openapi({ example: "admin" }),
});

// اسکیمای پاسخ لیست اعضای گروه
export const RoomMemberResponseSchema = z.object({
  user_id: z.string().uuid(),
  role: RoomRoleSchema,
  joined_at: z.string().datetime().optional(),
  user: z.object({
    id: z.string().uuid(),
    display_name: z.string().nullable(),
    avatar_url: z.string().nullable(),
  }),
});
