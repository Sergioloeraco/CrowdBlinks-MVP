import { Idl, BN } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import idlJson from "./idl.json";

export const IDL = {
  ...idlJson,
  address: "AAMoMd6pMFKkSwWuvyG6XNUh1wa3UBv4jbmdtQ8nmTb",
} as unknown as Idl;

export type CrowdPass = Idl;

export interface CampaignStateAccount {
  authority: PublicKey;
  eventId: string;
  ticketPrice: BN;
  maxTickets: number;
  ticketsSold: number;
  isActive: boolean;
}
