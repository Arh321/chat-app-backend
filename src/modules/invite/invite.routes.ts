import { createRoute, z } from "@hono/zod-openapi";
import { createOpenAPIApp } from "../../lib/openapi";
import { requireAuth } from "../../middlewares/auth";
import { createClient } from "@supabase/supabase-js";

const inviteApp = createOpenAPIApp();

// اعمال میدلور روی این ماژول
inviteApp.use("*", requireAuth);

const RedeemCodeSchema = z.object({
  code: z.string().min(4).openapi({ example: "A1B2C3D4" }),
});

const redeemRoute = createRoute({
  method: "post",
  path: "/redeem",
  tags: ["Invite"],
  summary: "اعمال کد دعوت (کاربر یا گروه)",
  description:
    "اگر کد مال کاربر باشد دوستی دوطرفه و DM ساخته می‌شود؛ اگر مال گروه باشد، کاربر عضو گروه خواهد شد.",
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: RedeemCodeSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "کد با موفقیت اعمال شد",
    },
    400: {
      description: "کد نامعتبر است یا خطایی رخ داد",
    },
  },
});

inviteApp.openapi(redeemRoute, async (c) => {
  const { code } = c.req.valid("json");
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.split(" ")[1];

  // ساخت کلاینت موقت با کانتکست همان کاربر تا auth.uid() داخل RPC کار کند
  const userClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    },
  );

  const { data, error } = await userClient.rpc("redeem_invite_code", {
    target_code: code,
  });

  if (error) {
    return c.json({ error: error.message }, 400);
  }

  return c.json(
    {
      message: "کد دعوت با موفقیت ثبت شد",
      result: data,
    },
    200,
  );
});

export default inviteApp;
