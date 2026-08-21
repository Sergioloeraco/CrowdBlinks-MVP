import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Create and return a Supabase client on demand.
 * This avoids throwing during module import so Next.js can compile
 * pages that don't use Supabase (useful for local development).
 */
export function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.\n" +
        "Create a .env.local from .env.example or set these environment variables."
    );
  }

  return createClient(supabaseUrl, supabasePublishableKey);
}
