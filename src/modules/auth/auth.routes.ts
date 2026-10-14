import { createRoute, z } from "@hono/zod-openapi";
import { createOpenAPIApp } from "../../lib/openapi";
import { supabasePublic, supabaseAdmin } from "../../lib/supabase";

const authApp = createOpenAPIApp();

// اسکیمای درخواست
const AuthBodySchema = z.object({
  email: z.string().email().openapi({ example: "user@example.com" }),
  password: z.string().min(6).openapi({ example: "123456" }),
});

// ۱. روت ثبت‌نام
const registerRoute = createRoute({
  method: "post",
  path: "/register",
  tags: ["Authentication"],
  summary: "ثبت‌نام کاربر جدید",
  description:
    "ثبت‌نام با ایمیل و پسورد - بلافاصله در سوپابیس پروفایل و کد دعوت ساخته می‌شود.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: AuthBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "کاربر با موفقیت ثبت شد",
    },
    400: {
      description: "خطا در ثبت‌نام (مثلاً ایمیل تکراری)",
    },
  },
});

authApp.openapi(registerRoute, async (c) => {
  const { email, password } = c.req.valid("json");

  const { data, error } = await supabasePublic.auth.signUp({
    email,
    password,
  });

  if (error) {
    return c.json({ error: error.message }, 400);
  }

  return c.json(
    {
      message: "ثبت‌نام با موفقیت انجام شد",
      user: data.user,
      session: data.session,
    },
    201,
  );
});

// ۲. روت ورود (Login)
const loginRoute = createRoute({
  method: "post",
  path: "/login",
  tags: ["Authentication"],
  summary: "ورود به حساب کاربری",
  description:
    "ورود با ایمیل و پسورد و دریافت توکن JWT همراه با اطلاعات پروفایل و کد دعوت.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: AuthBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "ورود موفقیت‌آمیز",
    },
    401: {
      description: "ایمیل یا پسورد اشتباه است",
    },
  },
});

authApp.openapi(loginRoute, async (c) => {
  const { email, password } = c.req.valid("json");

  const { data, error } = await supabasePublic.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return c.json({ error: error.message }, 401);
  }

  // دریافت اطلاعات پروفایل همراه با کد دعوت تولید شده
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, email, display_name, user_invite_code, avatar_url")
    .eq("id", data.user.id)
    .single();

  return c.json(
    {
      access_token: data.session?.access_token,
      user: profile,
    },
    200,
  );
});

export default authApp;
