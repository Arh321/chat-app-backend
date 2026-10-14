import { createRoute, z } from "@hono/zod-openapi";
import { createOpenAPIApp } from "../../lib/openapi";
import { requireAuth } from "../../middlewares/auth";
import { supabaseAdmin } from "../../lib/supabase";
import {
  ProfileErrorSchema,
  ProfileResponseSchema,
  UpdateMyProfileSchema,
} from "./profile.schema";

const profileApp = createOpenAPIApp();

profileApp.use("*", requireAuth);

const profileSelect = `
  id,
  display_name,
  avatar_url,
  bio,
  social_links
`;

/* ==========================================================================
   GET /me — دریافت پروفایل کاربر فعلی
   ========================================================================== */

const getMyProfileRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["Profile"],
  summary: "دریافت پروفایل کاربر فعلی",
  security: [{ Bearer: [] }],
  responses: {
    200: {
      description: "پروفایل کاربر",
      content: {
        "application/json": {
          schema: z.object({
            profile: ProfileResponseSchema,
          }),
        },
      },
    },
    404: {
      description: "پروفایل کاربر پیدا نشد",
      content: {
        "application/json": {
          schema: ProfileErrorSchema,
        },
      },
    },
    500: {
      description: "خطای داخلی سرور",
      content: {
        "application/json": {
          schema: ProfileErrorSchema,
        },
      },
    },
  },
});

profileApp.openapi(getMyProfileRoute, async (c) => {
  const userId = c.get("userId");

  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select(profileSelect)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("getMyProfile error:", error);
    return c.json({ error: "خطا در دریافت پروفایل" }, 500);
  }

  if (!profile) {
    return c.json({ error: "پروفایل کاربر پیدا نشد" }, 404);
  }

  return c.json({ profile }, 200);
});

/* ==========================================================================
   PATCH /me — ویرایش پروفایل کاربر فعلی
   ========================================================================== */

const updateMyProfileRoute = createRoute({
  method: "patch",
  path: "/me",
  tags: ["Profile"],
  summary: "ویرایش پروفایل کاربر فعلی",
  security: [{ Bearer: [] }],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateMyProfileSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "پروفایل ویرایش شد",
      content: {
        "application/json": {
          schema: z.object({
            profile: ProfileResponseSchema,
          }),
        },
      },
    },
    404: {
      description: "پروفایل کاربر پیدا نشد",
      content: {
        "application/json": {
          schema: ProfileErrorSchema,
        },
      },
    },
    500: {
      description: "خطای داخلی سرور",
      content: {
        "application/json": {
          schema: ProfileErrorSchema,
        },
      },
    },
  },
});

profileApp.openapi(updateMyProfileRoute, async (c) => {
  const userId = c.get("userId");
  const updates = c.req.valid("json");

  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select(profileSelect)
    .maybeSingle();

  if (error) {
    console.error("updateMyProfile error:", error);
    return c.json({ error: "خطا در ویرایش پروفایل" }, 500);
  }

  if (!profile) {
    return c.json({ error: "پروفایل کاربر پیدا نشد" }, 404);
  }

  return c.json({ profile }, 200);
});

/* ==========================================================================
   GET /:userId — دریافت اطلاعات عمومی یک کاربر
   ========================================================================== */

const getProfileByIdRoute = createRoute({
  method: "get",
  path: "/{userId}",
  tags: ["Profile"],
  summary: "دریافت اطلاعات عمومی یک کاربر",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      userId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: "اطلاعات عمومی پروفایل",
      content: {
        "application/json": {
          schema: z.object({
            profile: ProfileResponseSchema,
          }),
        },
      },
    },
    404: {
      description: "پروفایل کاربر پیدا نشد",
      content: {
        "application/json": {
          schema: ProfileErrorSchema,
        },
      },
    },
    500: {
      description: "خطای داخلی سرور",
      content: {
        "application/json": {
          schema: ProfileErrorSchema,
        },
      },
    },
  },
});

profileApp.openapi(getProfileByIdRoute, async (c) => {
  const { userId } = c.req.valid("param");

  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select(profileSelect)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("getProfileById error:", error);
    return c.json({ error: "خطا در دریافت پروفایل" }, 500);
  }

  if (!profile) {
    return c.json({ error: "پروفایل کاربر پیدا نشد" }, 404);
  }

  return c.json({ profile }, 200);
});

export { profileApp };
