import { createRoute, z } from "@hono/zod-openapi";
import { createOpenAPIApp } from "../../lib/openapi";
import { requireAuth } from "../../middlewares/auth";
import { supabaseAdmin } from "../../lib/supabase";
import { UploadResponseSchema } from "./upload.schema";

const uploadApp = createOpenAPIApp();
uploadApp.use("*", requireAuth);

const uploadMediaRoute = createRoute({
  method: "post",
  path: "/media",
  tags: ["Upload"],
  summary: "آپلود مستقل فایل یا مدیا و دریافت مشخصات و لینک",
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.any().openapi({
              type: "string",
              format: "binary",
              description: "فایل ارسالی (تصویر، ویدیو، صوت یا داکیومنت)",
            }),
            folder: z
              .string()
              .optional()
              .openapi({
                example: "chat",
                description: "پوشه ذخیره‌سازی اختیاری",
              }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: UploadResponseSchema,
        },
      },
      description: "فایل با موفقیت آپلود شد و لینک تحویل داده شد",
    },
    400: {
      description: "فایلی ارسال نشده یا حجم فایل بیش از حد مجاز است",
    },
    500: {
      description: "خطای سرور یا باکت ذخیره‌سازی",
    },
  },
});

uploadApp.openapi(uploadMediaRoute, async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"] as File | undefined;
  const folder = (body["folder"] as string) || "chat";

  if (!file || typeof file === "string") {
    return c.json({ error: "هیچ فایلی برای آپلود ارسال نشده است" }, 400);
  }

  // سقف حجم فایل (مثلاً حداکثر ۵۰ مگابایت)
  const MAX_SIZE = 50 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    return c.json({ error: "حجم فایل بیش از سقف مجاز (۵۰ مگابایت) است" }, 400);
  }

  // نام‌گذاری امن و یکتا
  const fileExt = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const filePath = `${folder}/${uniqueId}.${fileExt}`;

  // تبدیل داده به Buffer جهت آپلود در Supabase Storage
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
    .from("chat-media")
    .upload(filePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    return c.json({ error: uploadError.message }, 500);
  }

  // تولید لینک دسترسی ۱ ساله (یا متناسب با نیاز)
  const { data: signedUrlData, error: signedUrlError } =
    await supabaseAdmin.storage
      .from("chat-media")
      .createSignedUrl(filePath, 60 * 60 * 24 * 365);

  if (signedUrlError || !signedUrlData) {
    return c.json({ error: "خطا در تولید لینک دسترسی فایل" }, 500);
  }

  // تشخیص خودکار نوع فایل
  let fileType: "image" | "video" | "voice" | "file" = "file";
  if (file.type.startsWith("image/")) fileType = "image";
  else if (file.type.startsWith("video/")) fileType = "video";
  else if (file.type.startsWith("audio/")) fileType = "voice";

  return c.json(
    {
      file_url: signedUrlData.signedUrl,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type || "application/octet-stream",
      file_type: fileType,
    },
    201,
  );
});

export default uploadApp;
