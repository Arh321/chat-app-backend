import { createMiddleware } from "hono/factory";
import { supabaseAdmin } from "../lib/supabase";

export type AuthContext = {
  Variables: {
    userId: string;
    email: string;
  };
};

export const requireAuth = createMiddleware<AuthContext>(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized: Missing or invalid token" }, 401);
  }

  const token = authHeader.split(" ")[1];
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return c.json({ error: "Unauthorized: Invalid token" }, 401);
  }

  // پاس دادن اطلاعات کاربر به هندلرهای بعدی
  c.set("userId", user.id);
  c.set("email", user.email || "");

  await next();
});
