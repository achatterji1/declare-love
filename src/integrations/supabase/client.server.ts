// Server-only privileged client. Import this only from *.server.ts modules or
// inside server handlers — never from code that ships to the browser.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export function getSupabaseAdmin() {
  const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    throw new Error("Missing Supabase server credentials");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
