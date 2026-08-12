import {
  AnchorProvider,
  BN,
  Idl,
  Program,
  setProvider,
} from "@anchor-lang/core";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { IDL, CrowdPass } from "./idl";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ??
    "AAMoMd6pMFKkSwWuvyG6XNUh1wa3UBv4jbmdtQ8nmTb"
);

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? clusterApiUrl("devnet");

export function getConnection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

export function getProgram(): Program<CrowdPass> {
  const connection = getConnection();
  const provider = new AnchorProvider(
    connection,
    {
      publicKey: PublicKey.default,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    },
    { commitment: "confirmed" }
  );

  setProvider(provider);

  // Anchor 1.x uses the renamed TS client package and native 1.x IDL shape.
  // Keeping this direct avoids a lossy adapter from old @coral-xyz/anchor IDLs.
  return new Program<CrowdPass>(IDL as unknown as CrowdPass, { connection });
}

export function findCampaignPda(
  authority: PublicKey,
  eventId: string
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("campaign"), authority.toBuffer(), Buffer.from(eventId)],
    PROGRAM_ID
  );
}

export function getTreasuryPublicKey(): PublicKey {
  const value =
    process.env.CROWDBLINKS_TREASURY_ADDRESS ??
    process.env.NEXT_PUBLIC_TREASURY_ADDRESS ??
    "11111111111111111111111111111111111111111";

  return new PublicKey(value);
}

export function getBaseUrl(req?: Request): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;

  const protocol = req?.headers.get("x-forwarded-proto") ?? "https";
  const host = req?.headers.get("x-forwarded-host") ?? req?.headers.get("host");
  return host ? `${protocol}://${host}` : "http://localhost:3000";
}

export function toNumber(value: BN | number): number {
  return typeof value === "number" ? value : value.toNumber();
}

export type ParsedCampaignState = {
  authority: string;
  eventId: string;
  ticketPriceSol: number;
  maxTickets: number;
  ticketsSold: number;
  isActive: boolean;
  isSoldOut: boolean;
};

export function parseCampaignState(raw: any): ParsedCampaignState {
  const maxTickets = toNumber(raw.maxTickets);
  const ticketsSold = toNumber(raw.ticketsSold);

  return {
    authority: raw.authority?.toBase58() ?? "",
    eventId: raw.eventId ?? "",
    ticketPriceSol: toNumber(raw.ticketPrice) / 1e9,
    maxTickets,
    ticketsSold,
    isActive: raw.isActive ?? false,
    isSoldOut: ticketsSold >= maxTickets,
  };
}

export function parseCrowdBlinksError(err: any): string {
  return err?.error?.errorMessage ?? err?.message ?? "Error desconocido";
}

export type CrowdBlinksIdl = Idl;
