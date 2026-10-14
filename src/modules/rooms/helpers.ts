import { supabaseAdmin } from "../../lib/supabase";

// هلپر بررسی عضویت و واکشی نقش
export async function getMemberRole(roomId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("room_members")
    .select("role")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();

  return data?.role as "owner" | "admin" | "member" | undefined;
}
