import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabaseClient: SupabaseClient | null = null;

/**
 * Create and return the shared Supabase client.
 * The client is created only once and reused on subsequent calls.
 */
export function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.\n" +
        "Create a .env.local from .env.example or set these environment variables."
    );
  }

  supabaseClient = createClient(
    supabaseUrl,
    supabasePublishableKey
  );

  return supabaseClient;
}
