import { z } from "@hono/zod-openapi";

const SocialLinksSchema = z
  .object({
    instagram: z.string().url().nullable().optional(),
    linkedin: z.string().url().nullable().optional(),
    github: z.string().url().nullable().optional(),
    x: z.string().url().nullable().optional(),
    youtube: z.string().url().nullable().optional(),
    tiktok: z.string().url().nullable().optional(),
    website: z.string().url().nullable().optional(),
  })
  .strict();

export const UpdateMyProfileSchema = z
  .object({
    display_name: z.string().trim().min(1).max(80).optional(),
    avatar_url: z.string().url().nullable().optional(),
    bio: z.string().trim().max(500).nullable().optional(),
    social_links: SocialLinksSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "حداقل یک فیلد برای ویرایش ارسال کنید",
  });

export const ProfileResponseSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  bio: z.string().nullable(),
  social_links: SocialLinksSchema,
});

export const ProfileErrorSchema = z.object({
  error: z.string(),
});
