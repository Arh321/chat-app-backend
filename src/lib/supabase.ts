import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
  throw new Error("Supabase environment variables are missing!");
}

// کلاینت عادی برای اعتبارسنجی Auth کلاینت
export const supabasePublic = createClient(supabaseUrl, supabaseAnonKey);

// کلاینت ادمین با دسترسی کامل به استوریج‌های Private و اجرای امن RPCها
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
