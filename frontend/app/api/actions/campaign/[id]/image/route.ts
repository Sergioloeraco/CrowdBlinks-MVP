// ================================================================
//  CrowdPass — Dynamic Progress Bar Image
//  /frontend/app/api/actions/campaign/[id]/image/route.ts
//
//  Genera un SVG dinámico con barra de progreso para el campo
//  `icon` del GET response del Blink. Se actualiza en tiempo real
//  reflejando current_funding / funding_goal de la campaña.
// ================================================================

import { NextResponse } from "next/server";
import { PublicKey }    from "@solana/web3.js";
import { getProgram, findCampaignPda } from "@/lib/program";

// CORS headers requeridos
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "image/svg+xml",
  "Cache-Control": "no-store, max-age=0",
};

interface Params {
  params: { id: string };
}

export async function GET(_req: Request, { params }: Params) {
  // params.id = "<authorityBase58>_<eventId>"
  const [authorityStr, ...rest] = params.id.split("_");
  const eventId = rest.join("_");

  let title        = "CrowdPass";
  let progressPct  = 0;
  let currentSol   = 0;
  let goalSol      = 0;
  let ticketsSold  = 0;
  let maxTickets   = 0;
  let isActive     = true;
  let mode         = "ticket"; // "ticket" | "donation"

  try {
    const authority = new PublicKey(authorityStr);
    const [pda]     = findCampaignPda(authority, eventId);
    const program   = getProgram();
    const state     = await (program.account as any).campaignState.fetch(pda);

    const LAMPORTS = 1_000_000_000;
    currentSol  = state.currentFunding.toNumber() / LAMPORTS;
    goalSol     = state.fundingGoal.toNumber()    / LAMPORTS;
    ticketsSold = state.ticketsSold.toNumber();
    maxTickets  = state.maxTickets.toNumber();
    isActive    = state.isActive;
    mode        = state.ticketPrice.toNumber() > 0 ? "ticket" : "donation";
    title       = state.title;
    progressPct = Math.min(
      Math.round((currentSol / goalSol) * 100),
      100
    );
  } catch {
    // Si la campaña no existe aún, mostramos estado vacío
    title = "CrowdPass — Campaña";
  }

  // ── Colores según estado ──────────────────────────────────────
  const barColor      = !isActive ? "#9945FF" : progressPct >= 100 ? "#14F195" : "#9945FF";
  const statusLabel   = !isActive ? "COMPLETADO" : `${progressPct}% financiado`;
  const modeIcon      = mode === "ticket" ? "🎟️" : "💜";
  const progressWidth = Math.max(4, (progressPct / 100) * 520); // mínimo 4px para visualizar

  const svg = `
<svg width="600" height="314" viewBox="0 0 600 314" xmlns="http://www.w3.org/2000/svg">
  <!-- Fondo degradado oscuro estilo Solana -->
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#0F0B1E"/>
      <stop offset="100%" stop-color="#1A0533"/>
    </linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#9945FF"/>
      <stop offset="100%" stop-color="#14F195"/>
    </linearGradient>
    <linearGradient id="barGray" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#2a2a3e"/>
      <stop offset="100%" stop-color="#2a2a3e"/>
    </linearGradient>
  </defs>

  <!-- Fondo -->
  <rect width="600" height="314" fill="url(#bg)" rx="16"/>

  <!-- Logo / marca superior -->
  <text x="40" y="48" font-family="system-ui,sans-serif" font-size="13" font-weight="600"
        fill="#9945FF" letter-spacing="2">CROWDPASS</text>

  <!-- Ícono de modo -->
  <text x="554" y="48" font-family="system-ui,sans-serif" font-size="18" text-anchor="middle">${modeIcon}</text>

  <!-- Título del evento -->
  <text x="40" y="96" font-family="system-ui,sans-serif" font-size="26" font-weight="700"
        fill="#FFFFFF" letter-spacing="-0.5">
    ${title.length > 30 ? title.slice(0, 30) + "…" : title}
  </text>

  <!-- Cifras principales -->
  <text x="40" y="152" font-family="system-ui,sans-serif" font-size="42" font-weight="800"
        fill="#14F195">${currentSol.toFixed(2)} SOL</text>
  <text x="40" y="180" font-family="system-ui,sans-serif" font-size="15"
        fill="#8B8BA8">de ${goalSol.toFixed(2)} SOL meta</text>

  <!-- Boletos (solo si es modo ticket) -->
  ${mode === "ticket" ? `
  <text x="420" y="152" font-family="system-ui,sans-serif" font-size="36" font-weight="800"
        fill="#9945FF" text-anchor="middle">${ticketsSold}/${maxTickets}</text>
  <text x="420" y="180" font-family="system-ui,sans-serif" font-size="13"
        fill="#8B8BA8" text-anchor="middle">boletos</text>
  ` : ""}

  <!-- Barra de progreso: fondo -->
  <rect x="40" y="210" width="520" height="16" rx="8" fill="url(#barGray)"/>

  <!-- Barra de progreso: relleno dinámico -->
  <rect x="40" y="210" width="${progressWidth}" height="16" rx="8" fill="url(#bar)"/>

  <!-- Porcentaje / estado -->
  <text x="40" y="252" font-family="system-ui,sans-serif" font-size="13" font-weight="600"
        fill="${barColor}">${statusLabel}</text>

  <!-- Powered by Solana -->
  <text x="560" y="292" font-family="system-ui,sans-serif" font-size="11"
        fill="#4a4a6a" text-anchor="end">Powered by Solana</text>

  <!-- Punto de estado (activo/inactivo) -->
  <circle cx="572" cy="248" r="5" fill="${isActive ? "#14F195" : "#9945FF"}"/>
  <text x="563" y="252" font-family="system-ui,sans-serif" font-size="11"
        fill="${isActive ? "#14F195" : "#9945FF"}" text-anchor="end">
    ${isActive ? "Activo" : "Cerrado"}
  </text>
</svg>`.trim();

  return new NextResponse(svg, { headers: CORS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
}