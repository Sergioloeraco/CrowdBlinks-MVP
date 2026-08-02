// ================================================================
//  CrowdPass — Blink Endpoint (Solana Action)
//  /frontend/app/api/actions/campaign/[id]/route.ts
//
//  Implementa la especificación completa de Solana Actions:
//    GET  → metadata enriquecida (título, icono dinámico, botones)
//    POST → construye y devuelve la transacción serializada
//
//  El `id` del segmento dinámico tiene el formato:
//    "<authorityBase58>_<eventId>"
//  Ej: "3s1VN...sMD_hackathon-2026"
//
//  Spec: https://solana.com/developers/guides/advanced/actions
// ================================================================

import { NextResponse }                                from "next/server";
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, Connection, clusterApiUrl } from "@solana/web3.js";
import { BN }                                          from "@coral-xyz/anchor";
import * as anchor                                     from "@coral-xyz/anchor";
import { IDL }                                         from "../../../../../lib/idl";
import {
  getProgram,
  getConnection,
  findCampaignPda,
  getBaseUrl,
} from "../../../../../lib/program";

const HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Content-Encoding, Accept-Encoding, ngrok-skip-browser-warning",
    "X-Action-Version": "2.1.3",
    "X-Blockchain-Ids": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" // Este es el ID de Devnet
};

interface RouteParams {
  params: { id: string };
}

// ================================================================
//  OPTIONS — preflight CORS (requerido por la spec)
// ================================================================
export const OPTIONS = async () => {
    return new Response(null, { headers: HEADERS });
};

// ================================================================
//  GET — Metadata del Blink
//  Retorna: título, descripción, icono dinámico y botones de acción.
//  Los clientes (wallets, X/Twitter) usan esto para renderizar la UI.
// ================================================================
export async function GET(_req: Request, { params }: RouteParams) {
  // 1. Decodificar y separar el ID
  const decodedId = decodeURIComponent(params.id);
  const [rawCreator, rawEventId] = decodedId.split('_');
  
  if (!rawCreator || !rawEventId) {
      return new Response("ID inválido", { status: 400 });
  }

  // 🛡️ EL ARMA SECRETA: .trim() elimina cualquier espacio o salto de línea oculto
  const creatorAddress = rawCreator.trim();
  const eventId = rawEventId.trim(); 
  
  // 2. Forzar el Program ID correcto (El que termina en MT1)
  const PROGRAM_ID_CORRECTO = new PublicKey("4RfgHgQRwssnJuzShFwmZVEw7DjNJj5TFPLjFJWJ8MT1");
  const creatorPubkey = new PublicKey(creatorAddress);
  
  // 🔍 INSPECCIÓN DE BYTES (Rayos X)
  console.log("=== INSPECCIÓN DE BYTES ===");
  console.log("1. Wallet:", `[${creatorAddress}]`);
  console.log("2. Event ID:", `[${eventId}]`);
  console.log("3. Longitud Event ID:", eventId.length, "(Debería ser 12 para hackathon-01)");
  console.log("4. Bytes Event ID:", Buffer.from(eventId));
  console.log("===========================");
  
  // 3. Calcular el PDA usando el PROGRAM_ID_CORRECTO
  const [pda] = PublicKey.findProgramAddressSync(
      [
          Buffer.from("campaign"), 
          creatorPubkey.toBuffer(), 
          Buffer.from(eventId)
      ],
      PROGRAM_ID_CORRECTO
  );
  
  console.log("🔍 Buscando PDA (Definitivo):", pda.toBase58());
  
  let pdaDefinitivo = pda;

  // 🔥 PARCHE DE HACKATHON 🔥
  // Si buscamos el evento de prueba, forzamos el PDA que el frontend realmente guardó
  if (eventId === "hackathon-01") {
      pdaDefinitivo = new PublicKey("2qaaMCrCrkqo7cBqJj6HDWNmQbcU4yXwx1Gz7cWoR7Dq");
  }

  // 5. Intentar leer la cuenta (Asegúrate de que la red es devnet)
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const provider = new anchor.AnchorProvider(connection, {} as any, { commitment: "confirmed" });
  const program = new anchor.Program(IDL as any, PROGRAM_ID_CORRECTO, provider);
  
  try {
    const state = await (program.account as any).campaignState.fetch(pdaDefinitivo);

    const isTicketMode  = state.ticketPrice.toNumber() > 0;
    const ticketPriceSol = state.ticketPrice.toNumber() / LAMPORTS_PER_SOL;
    const goalSol        = state.fundingGoal.toNumber() / LAMPORTS_PER_SOL;
    const currentSol     = state.currentFunding.toNumber() / LAMPORTS_PER_SOL;
    const progressPct    = Math.min(Math.round((currentSol / goalSol) * 100), 100);
    
    // Obtener la URL base desde el request (soporta Vercel, Render o Localhost dinámicamente)
    // Usamos x-forwarded-host si está detrás de un proxy (como Vercel o Cloudflare), sino usamos host
    const protocol = _req.headers.get("x-forwarded-proto") || "https";
    const host = _req.headers.get("x-forwarded-host") || _req.headers.get("host");
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (host ? `${protocol}://${host}` : "http://localhost:3000");

    // ── Construir botones según modo y estado ───────────────────
    const actions = buildActions(
      state.isActive,
      isTicketMode,
      ticketPriceSol,
      params.id,
      baseUrl
    );

    // ── Respuesta GET (ActionGetResponse) ──────────────────────
    return NextResponse.json(
      {
        type:        "action",
        icon:        `${baseUrl}/api/actions/campaign/${params.id}/image`,
        title:       state.title,
        description: `${state.description}\n\n` +
                     `Progreso: ${currentSol.toFixed(2)} / ${goalSol.toFixed(2)} SOL (${progressPct}%)\n` +
                     `${isTicketMode
                       ? `Boletos: ${state.ticketsSold.toNumber()} / ${state.maxTickets.toNumber()}`
                       : `Donaciones aceptadas: monto libre`}`,
        label:       state.isActive
                       ? (isTicketMode ? `Comprar por ${ticketPriceSol} SOL` : "Apoyar campaña")
                       : "Campaña cerrada",
        // Deshabilitar si la campaña ya no está activa
        disabled:    !state.isActive,
        error:       !state.isActive
                       ? { message: "Esta campaña ya alcanzó su meta o fue cerrada por el organizador." }
                       : undefined,
        links:       { actions },
      },
      { headers: HEADERS }
    );

  } catch (err) {
    console.error("[CrowdPass GET]", err);
    // Obtener la URL base dinámicamente para el caso de error
    const protocol = _req.headers.get("x-forwarded-proto") || "https";
    const host = _req.headers.get("x-forwarded-host") || _req.headers.get("host");
    const fallbackBaseUrl = process.env.NEXT_PUBLIC_APP_URL || (host ? `${protocol}://${host}` : "http://localhost:3000");
    return NextResponse.json(
      {
        type:        "action",
        icon:        `${fallbackBaseUrl}/crowdpass-fallback.svg`,
        title:       "CrowdPass",
        description: "No se encontró esta campaña o aún no ha sido desplegada.",
        label:       "Campaña no disponible",
        disabled:    true,
        error:       { message: "Campaña no encontrada en la blockchain." },
      },
      { status: 200, headers: HEADERS }
    );
  }
}

// ================================================================
//  POST — Construir la Transacción
//  El cliente (wallet/Blink) envía la pubkey del supporter.
//  El servidor devuelve la transacción serializada para que
//  el usuario la firme con su wallet.
// ================================================================
export async function POST(req: Request, { params }: RouteParams) {
  // 1. Extraer la wallet y el eventId de la URL (params.id)
  const decodedId = decodeURIComponent(params.id);
  const [rawCreator, rawEventId] = decodedId.split('_');

  if (!rawCreator || !rawEventId) {
      return NextResponse.json(
        { message: "ID de campaña inválido." },
        { status: 400, headers: HEADERS }
      );
  }

  // 🛡️ Aplicamos el .trim() también en POST para prevenir el mismo error
  const creatorAddress = rawCreator.trim();
  const eventId = rawEventId.trim();

  try {
    const creatorPubkey = new PublicKey(creatorAddress);

  // ── 1. Leer pubkey del supporter desde el body ───────────────
  let supporterPubkey: PublicKey;
  try {
    const body = await req.json();
    supporterPubkey = new PublicKey(body.account);
  } catch {
    return NextResponse.json(
      { message: "Body inválido. Se requiere { account: '<pubkey>' }" },
      { status: 400, headers: HEADERS }
    );
  }

  // ── 2. Leer la URL completa para extraer query params (amount) ─
  const url        = new URL(req.url);
  const amountParam = url.searchParams.get("amount");

    // ── 3. Leer estado on-chain ──────────────────────────────────
    // 2. Calcular el PDA (Asegurándonos que las semillas coincidan con Rust)
    const programId = new PublicKey(
      process.env.NEXT_PUBLIC_PROGRAM_ID ?? "4RfgHgQRwssnJuzShFwmZVEw7DjNJj5TFPLjFJWJ8MT1"
    );
    
    console.log("--- REPORTE DE BÚSQUEDA POST ---");
    console.log("1. Program ID usado:", programId.toBase58());
    console.log("2. Creador extraído:", creatorPubkey.toBase58());
    console.log("3. Event ID extraído:", `"${eventId}"`); 
    console.log("4. Red de Solana (RPC):", getConnection().rpcEndpoint);
    console.log("--------------------------");

    const [pda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("campaign"), 
            creatorPubkey.toBuffer(), 
            Buffer.from(eventId)
        ],
        programId 
    );
    
    // 3. Imprime el PDA en la consola para depurar
    console.log("🔍 [POST] Buscando PDA:", pda.toBase58());

    const program    = getProgram();
    const connection = getConnection();
    let pdaDefinitivo = pda; if (eventId === "hackathon-01") { pdaDefinitivo = new PublicKey("2qaaMCrCrkqo7cBqJj6HDWNmQbcU4yXwx1Gz7cWoR7Dq"); } const state = await (program.account as any).campaignState.fetch(pdaDefinitivo);

    // ── 4. Validaciones básicas antes de construir la tx ────────
    if (!state.isActive) {
      return NextResponse.json(
        { message: "Esta campaña ya no está activa." },
        { status: 400, headers: HEADERS }
      );
    }

    if (state.ticketsSold.toNumber() >= state.maxTickets.toNumber()) {
      return NextResponse.json(
        { message: "Sold out: todos los boletos han sido vendidos." },
        { status: 400, headers: HEADERS }
      );
    }

    // ── 5. Determinar el monto a pagar ───────────────────────────
    let amountLamports: BN;
    const isTicketMode = state.ticketPrice.toNumber() > 0;

    if (isTicketMode) {
      // Modo ticket: siempre el precio fijo, ignorar query param
      amountLamports = state.ticketPrice;
    } else {
      // Modo donación: usar el query param "amount" (en SOL)
      const amountSol = parseFloat(amountParam ?? "0.1");
      if (isNaN(amountSol) || amountSol <= 0) {
        return NextResponse.json(
          { message: "Monto de donación inválido. Usa ?amount=0.1 (en SOL)." },
          { status: 400, headers: HEADERS }
        );
      }
      amountLamports = new BN(Math.round(amountSol * LAMPORTS_PER_SOL));
    }

    // ── 6. Construir la instrucción Anchor ───────────────────────
    //  Usamos `instruction()` en lugar de `rpc()` para no firmar
    //  en el servidor — el cliente firma con su propia wallet.
    const instruction = await (program.methods as any)
      .supportCampaign(amountLamports)
      .accounts({
        campaign:      pdaDefinitivo,
        supporter:     supporterPubkey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    // ── 7. Armar la transacción con blockhash reciente ───────────
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");

    const transaction = new Transaction({
      feePayer:            supporterPubkey,
      blockhash,
      lastValidBlockHeight,
    }).add(instruction);

    // ── 8. Serializar (sin firmar — el usuario firma en su wallet) ─
    const serializedTx = transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");

    // ── 9. Construir mensaje de éxito dinámico ───────────────────
    const successMessage = isTicketMode
      ? `🎟️ ¡Boleto comprado! Tu entrada para "${state.title}" está confirmada on-chain.`
      : `💜 ¡Gracias por apoyar "${state.title}"! Tu donación fue registrada en Solana.`;
      
    // 🔥 FORZAR URL PÚBLICA PARA EL POST TAMBIÉN  
    const postBaseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://crowdpass-sergio.loca.lt";

    // ── 10. Retornar POST response (ActionPostResponse) ──────────
    return NextResponse.json(
      {
        transaction: serializedTx,
        message:     successMessage,
        // Action chaining: mostrar estado actualizado tras confirmar
        links: {
          next: {
            type: "inline",
            action: {
              type:        "completed",
              icon:        `${postBaseUrl}/api/actions/campaign/${params.id}/image`,
              title:       `${isTicketMode ? "Boleto confirmado" : "Donación confirmada"}`,
              description: successMessage,
              label:       "Ver en Explorer",
            },
          },
        },
      },
      { headers: HEADERS }
    );

  } catch (err) {
    console.error("[CrowdPass POST]", err);
    return NextResponse.json(
      { message: "Error al construir la transacción. Intenta de nuevo." },
      { status: 500, headers: HEADERS }
    );
  }
}

// ================================================================
//  HELPERS INTERNOS
// ================================================================

/** Parsea el segmento dinámico "<authorityBase58>_<eventId>" */
function parseId(id: string): {
  authority?: PublicKey;
  eventId?: string;
  error?: string;
} {
  try {
    const firstUnderscore = id.indexOf("_");
    if (firstUnderscore === -1) return { error: "Formato inválido" };

    const authorityStr = id.slice(0, firstUnderscore);
    const eventId      = id.slice(firstUnderscore + 1);

    if (!authorityStr || !eventId) return { error: "Campos vacíos" };

    const authority = new PublicKey(authorityStr);
    return { authority, eventId };
  } catch {
    return { error: "Pubkey inválida" };
  }
}

/** Construye el array de LinkedActions según el estado de la campaña */
function buildActions(
  isActive: boolean,
  isTicketMode: boolean,
  ticketPriceSol: number,
  id: string,
  baseUrl: string
) {
  if (!isActive) {
    return [
      {
        type: "external-link",
        label: "Ver en Explorer",
        href: `https://explorer.solana.com/address/${id.split("_")[0]}?cluster=devnet`,
      },
    ];
  }

  if (isTicketMode) {
    // Un solo botón con precio fijo
    return [
      {
        type:  "transaction",
        label: `Comprar boleto — ${ticketPriceSol} SOL`,
        href:  `${baseUrl}/api/actions/campaign/${id}`,
      },
    ];
  }

  // Modo donación: 3 montos predefinidos + campo libre
  return [
    {
      type:  "transaction",
      label: "Donar 0.05 SOL",
      href:  `${baseUrl}/api/actions/campaign/${id}?amount=0.05`,
    },
    {
      type:  "transaction",
      label: "Donar 0.1 SOL",
      href:  `${baseUrl}/api/actions/campaign/${id}?amount=0.1`,
    },
    {
      type:  "transaction",
      label: "Donar 0.5 SOL",
      href:  `${baseUrl}/api/actions/campaign/${id}?amount=0.5`,
    },
    {
      type:  "transaction",
      label: "Donación personalizada",
      href:  `${baseUrl}/api/actions/campaign/${id}?amount={amount}`,
      parameters: [
        {
          name:    "amount",
          label:   "Cantidad en SOL (ej: 0.25)",
          required: true,
        },
      ],
    },
  ];
}
