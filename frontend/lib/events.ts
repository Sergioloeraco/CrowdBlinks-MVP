import { getSupabaseClient } from "./supabase";

export type EventMetadata = {
  campaign_pda: string;
  authority: string;
  event_id: string;
  title: string;
  description: string;
  image_url: string | null;
  ticket_price_lamports: number;
  max_tickets: number;
  created_at: string;
};

export async function getEvents(authority: string): Promise<EventMetadata[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("events")
    .select(
      "campaign_pda, authority, event_id, title, description, image_url, ticket_price_lamports, max_tickets, created_at"
    )
    .eq("authority", authority)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Error loading events: ${error.message}`);
  }

  return data ?? [];
}
