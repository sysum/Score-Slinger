import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
  );
}

// Admin client — bypasses RLS. Never expose this key to the client.
// Prod: a Supabase secret key (sb_secret_...) stored as a Vercel Secret; the env var
// name SUPABASE_SERVICE_ROLE_KEY is kept for compatibility. Local: the service-role
// demo key from `supabase status -o env`.
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);
