import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type CreateEventBody = {
  campaignPda: string;
  authority: string;
  eventId: string;
  title: string;
  description: string;
  imageUrl?: string | null;
  ticketPriceLamports: number;
  maxTickets: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<CreateEventBody>;

    if (
      !body.campaignPda ||
      !body.authority ||
      !body.eventId ||
      !body.title ||
      body.ticketPriceLamports === undefined ||
      body.maxTickets === undefined
    ) {
      return NextResponse.json(
        { error: "Missing required event fields" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("events")
      .insert({
        campaign_pda: body.campaignPda,
        authority: body.authority,
        event_id: body.eventId,
        title: body.title,
        description: body.description ?? "",
        image_url: body.imageUrl ?? null,
        ticket_price_lamports: body.ticketPriceLamports,
        max_tickets: body.maxTickets,
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase event insert error:", error);

      return NextResponse.json(
        { error: "Failed to save event" },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Create event API error:", error);

    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}
