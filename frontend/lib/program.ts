// ================================================================
//  CrowdPass — Anchor Program Helper
//  /frontend/lib/program.ts
//
//  Instancia compartida del programa Anchor para todos los
//  API routes del Blink. Evita crear múltiples conexiones.
// ================================================================

import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { IDL, CrowdPass } from "./idl";

// ── Configuración de red ─────────────────────────────────────────
export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ??
    "4RfgHgQRwssnJuzShFwmZVEw7DjNJj5TFPLjFJWJ8MT1"
);

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? clusterApiUrl("devnet");

// ── Instancia de conexión (singleton) ────────────────────────────
export function getConnection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

// ── Instancia del programa Anchor (read-only, sin wallet) ────────
// Para construir transacciones en el server-side no necesitamos wallet.
// Usamos un provider con PublicKey dummy — la tx la firma el usuario en el cliente.
export function getProgram(): anchor.Program<CrowdPass> {
  const connection = getConnection();
  const provider = new anchor.AnchorProvider(
    connection,
    // Wallet dummy: solo para instanciar, nunca firma en el server
    {
      publicKey: PublicKey.default,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    },
    { commitment: "confirmed" }
  );
  return new anchor.Program<CrowdPass>(IDL, PROGRAM_ID, provider);
}

// ── Helper: deriva PDA de una campaña ────────────────────────────
export function findCampaignPda(
  authority: PublicKey,
  eventId: string
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("campaign"),
      authority.toBuffer(),
      Buffer.from(eventId),
    ],
    PROGRAM_ID
  );
}

// ── Helper: construye la URL base del servidor ───────────────────
export function getBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")
  );
}
