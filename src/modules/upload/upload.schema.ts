import { z } from "@hono/zod-openapi";

export const UploadResponseSchema = z.object({
  file_url: z.string().url().describe("آدرس دانلود یا دسترسی فایل"),
  file_name: z.string().describe("نام اصلی فایل"),
  file_size: z.number().int().describe("حجم فایل بر حسب بایت"),
  mime_type: z.string().describe("فرمت MIME فایل"),
  file_type: z
    .enum(["image", "video", "voice", "file"])
    .describe("نوع تشخیص داده شده مدیا"),
});
