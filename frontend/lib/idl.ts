import { Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import idlJson from './idl.json';

export const IDL = {
  ...idlJson,
  address: "4RfgHgQRwssnJuzShFwmZVEw7DjNJj5TFPLjFJWJ8MT1"
} as unknown as Idl;

export type CrowdPass = Idl;

export interface CampaignStateAccount {
  authority: PublicKey;
  eventId: string;
  ticketPrice: BN;
  fundingGoal: BN;
  currentFunding: BN;
  maxTickets: BN;
  ticketsSold: BN;
  isActive: boolean;
  title: string;
  description: string;
  createdAt: BN;
  bump: number;
}

export function parseCampaignState(raw: any) {
  const currentSol = raw.currentFunding ? raw.currentFunding.toNumber() / 1e9 : 0;
  const fundingGoalSol = raw.fundingGoal ? raw.fundingGoal.toNumber() / 1e9 : 0;
  return {
    authority: raw.authority ? raw.authority.toBase58() : '',
    eventId: raw.eventId || '',
    title: raw.title || '',
    currentSol,
    fundingGoalSol,
    progressPct: fundingGoalSol > 0 ? Math.min(Math.round((currentSol / fundingGoalSol) * 100), 100) : 0,
    ticketsSold: raw.ticketsSold ? raw.ticketsSold.toNumber() : 0,
    maxTickets: raw.maxTickets ? raw.maxTickets.toNumber() : 0,
    isActive: raw.isActive ?? false,
    isTicketMode: raw.ticketPrice && raw.ticketPrice.toNumber() > 0,
    isSoldOut: raw.maxTickets && raw.ticketsSold ? raw.ticketsSold.toNumber() >= raw.maxTickets.toNumber() : false,
  };
}

export function parseCrowdPassError(err: any): string {
  return err?.message || 'Error desconocido';
}