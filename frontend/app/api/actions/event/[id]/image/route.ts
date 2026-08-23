import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { findEventPda, getProgram, toNumber } from "@/lib/program";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "image/svg+xml",
  "Cache-Control": "no-store, max-age=0",
};

interface Params {
  params: { id: string };
}

export async function GET(_req: Request, { params }: Params) {
  const [authorityStr, ...rest] = decodeURIComponent(params.id).split("_");
  const eventId = rest.join("_");

  let title = eventId || "Evento";
  let ticketsSold = 0;
  let maxTickets = 0;
  let isActive = false;

  try {
    const authority = new PublicKey(authorityStr);
    const [pda] = findEventPda(authority, eventId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = await (getProgram().account as any).campaignState.fetch(pda);

    title = state.eventId;
    ticketsSold = toNumber(state.ticketsSold);
    maxTickets = toNumber(state.maxTickets);
    isActive = state.isActive && ticketsSold < maxTickets;
  } catch {
    title = "CrowdBlinks";
  }

  const pct = maxTickets > 0 ? Math.min(Math.round((ticketsSold / maxTickets) * 100), 100) : 0;
  const progressWidth = Math.max(4, (pct / 100) * 520);
  const status = isActive ? "ACTIVO" : pct >= 100 ? "SOLD OUT" : "NO DISPONIBLE";

  const svg = `
<svg width="600" height="314" viewBox="0 0 600 314" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#08060F"/>
      <stop offset="100%" stop-color="#102018"/>
    </linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#9945FF"/>
      <stop offset="100%" stop-color="#14F195"/>
    </linearGradient>
  </defs>
  <rect width="600" height="314" fill="url(#bg)" rx="16"/>
  <text x="40" y="52" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="#14F195" letter-spacing="2">CROWDBLINKS</text>
  <text x="40" y="108" font-family="system-ui,sans-serif" font-size="30" font-weight="800" fill="#FFFFFF">
    ${escapeSvg(title.length > 30 ? title.slice(0, 30) + "..." : title)}
  </text>
  <text x="40" y="168" font-family="system-ui,sans-serif" font-size="48" font-weight="900" fill="#FFFFFF">${ticketsSold}/${maxTickets}</text>
  <text x="40" y="196" font-family="system-ui,sans-serif" font-size="15" fill="#8B8BA8">boletos vendidos</text>
  <rect x="40" y="224" width="520" height="16" rx="8" fill="#242136"/>
  <rect x="40" y="224" width="${progressWidth}" height="16" rx="8" fill="url(#bar)"/>
  <text x="40" y="266" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="${isActive ? "#14F195" : "#9945FF"}">${status}</text>
  <text x="560" y="266" font-family="system-ui,sans-serif" font-size="13" fill="#8B8BA8" text-anchor="end">${pct}% vendido</text>
</svg>`.trim();

  return new NextResponse(svg, { headers: CORS });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
