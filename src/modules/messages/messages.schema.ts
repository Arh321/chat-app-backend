import { z } from "@hono/zod-openapi";

export const MessageTypeEnum = z.enum([
  "text",
  "image",
  "video",
  "voice",
  "file",
]);
export const MessageReactionSummarySchema = z.object({
  emoji: z.string().openapi({ example: "❤️" }),
  count: z.number().openapi({ example: 4 }),
  reacted_by_me: z.boolean().openapi({ example: true }),
});

export const UserBriefSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable().optional(),
});

export const MessageItemSchema = z.object({
  id: z.string().uuid(),
  room_id: z.string().uuid(),
  content: z.string().nullable(),
  type: z.enum(["text", "image", "video", "voice", "file"]),
  file_url: z.string().nullable(),
  file_name: z.string().nullable(),
  file_size: z.number().nullable(),
  mime_type: z.string().nullable(),
  metadata: z.record(z.any(), z.any()).nullable(),
  is_forwarded: z.boolean(),
  is_edited: z.boolean(),
  is_pinned: z.boolean(),
  created_at: z.string(),
  sender: UserBriefSchema.nullable(),
  reply_to: z
    .object({
      id: z.string().uuid(),
      content: z.string().nullable(),
      type: z.string(),
      sender: z
        .object({
          id: z.string().uuid(),
          display_name: z.string().nullable(),
        })
        .nullable(),
    })
    .nullable(),
  forward_from: z
    .object({
      id: z.string().uuid(),
      display_name: z.string().nullable(),
    })
    .nullable(),
  reads_count: z.number().openapi({ example: 2 }),
  is_read_by_me: z.boolean().openapi({ example: true }),
  reactions: z.array(MessageReactionSummarySchema),
});
// اسکیمای ارسال پیام جدید
export const SendMessageSchema = z.object({
  room_id: z.string().uuid({ message: "شناسه اتاق نامعتبر است" }),
  content: z.string().max(4000).optional().default(""),
  type: MessageTypeEnum.default("text"),

  // مدیا و فایل
  file_url: z.string().url().optional().nullable(),
  file_name: z.string().optional().nullable(),
  file_size: z.number().int().nonnegative().optional().nullable(),
  mime_type: z.string().optional().nullable(),
  metadata: z
    .record(z.string(), z.any())
    .optional()
    .describe("اطلاعات تکمیلی مانند duration, width, height"),

  // تعاملات چت (Reply & Forward)
  reply_to_id: z.string().uuid().optional().nullable(),
  forward_from_id: z.string().uuid().optional().nullable(),
  is_forwarded: z.boolean().optional().default(false),
});

// اسکیمای مارک کردن پیام‌ها به عنوان خوانده شده (Mark as Read)
export const MarkAsReadSchema = z.object({
  room_id: z.string().uuid(),
  message_ids: z.array(z.string().uuid()).min(1),
});

// اسکیمای درخواست Presigned URL برای آپلود مستقیم از کلاینت
export const RequestUploadUrlSchema = z.object({
  room_id: z.string().uuid({ message: "شناسه اتاق نامعتبر است" }),
  file_name: z.string().min(1, { message: "نام فایل الزامی است" }),
  mime_type: z.string().min(1, { message: "نوع فایل الزامی است" }),
  file_size: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024, { message: "حداکثر حجم فایل ۵۰ مگابایت است" })
    .optional(),
});

// اسکیمای ثبت/حذف ری‌اکشن
export const ToggleReactionSchema = z.object({
  emoji: z.string().min(1).max(32).openapi({
    example: "❤️",
    description: "اموجی واکنش مورد نظر",
  }),
});

// ساختار خلاصه‌شده ری‌اکشن‌ها در پاسخ پیام
export const ReactionSummarySchema = z.object({
  emoji: z.string(),
  count: z.number(),
  reacted_by_me: z.boolean(),
  users: z
    .array(
      z.object({
        id: z.string().uuid(),
        display_name: z.string().nullable(),
      }),
    )
    .optional(),
});
