import { z } from "@hono/zod-openapi";

export const StoryPrivacyEnum = z.enum(["public", "friends"]);
export const StoryMediaTypeEnum = z.enum(["image", "video", "text"]);

// اسکیمای ساخت استوری جدید
export const CreateStorySchema = z.object({
  media_url: z.string().url().optional().openapi({
    example:
      "https://your-bucket.supabase.co/storage/v1/object/public/chat-media/story.jpg",
  }),
  media_type: StoryMediaTypeEnum.default("image").openapi({ example: "image" }),
  caption: z
    .string()
    .max(500)
    .optional()
    .openapi({ example: "یه روز کاری عالی!" }),
  privacy: StoryPrivacyEnum.default("friends").openapi({ example: "friends" }),
  metadata: z
    .record(z.string(), z.any())
    .optional()
    .openapi({
      example: { background_color: "#1e1e2e", font: "vazirmatn" },
    }),
});

// اسکیمای هر آیتم استوری در خروجی
export const StoryItemSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  media_url: z.string().nullable(),
  media_type: StoryMediaTypeEnum,
  caption: z.string().nullable(),
  privacy: StoryPrivacyEnum,
  metadata: z.record(z.string(), z.any()).nullable(),
  created_at: z.string(),
  expires_at: z.string(),
  is_seen: z.boolean().optional(),
  user: z.object({
    id: z.string().uuid(),
    display_name: z.string().nullable(),
    avatar_url: z.string().nullable(),
  }),
});

// اسکیمای دسته‌بندی‌شده استوری‌ها بر اساس کاربر (فرمت استاندارد مانند اینستاگرام/تلگرام)
export const UserStoriesGroupSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    display_name: z.string().nullable(),
    avatar_url: z.string().nullable(),
  }),
  all_seen: z.boolean(),
  stories: z.array(StoryItemSchema),
});
