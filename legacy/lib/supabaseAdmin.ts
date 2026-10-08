// Legacy file kept for compatibility. When DATABASE_URL is provided we use direct Postgres via src/lib/db.ts
import { createClient } from "@supabase/supabase-js";

let supabaseAdmin: ReturnType<typeof createClient<any>> | null = null;

export function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables. For direct Postgres use, the app now expects DATABASE_URL in .env and will use a pg client instead.");
  }

  if (supabaseAdmin) return supabaseAdmin;

  supabaseAdmin = createClient<any>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabaseAdmin;
}
