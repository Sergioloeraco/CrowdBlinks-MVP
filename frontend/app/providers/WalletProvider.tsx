"use client";

import { useEffect, useMemo } from "react";

import {
  ConnectionProvider,
  useWallet,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";

import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";

import { clusterApiUrl } from "@solana/web3.js";

import "@solana/wallet-adapter-react-ui/styles.css";

function WalletDebug() {
  const { wallet, publicKey, connected, connecting } = useWallet();

  useEffect(() => {
    console.log("[CrowdBlinks DEBUG] wallet:", wallet?.adapter.name ?? null);
    console.log(
      "[CrowdBlinks DEBUG] publicKey:",
      publicKey?.toBase58() ?? null
    );
    console.log("[CrowdBlinks DEBUG] connected:", connected);
    console.log("[CrowdBlinks DEBUG] connecting:", connecting);
  }, [wallet, publicKey, connected, connecting]);

  return null;
}

const ConnectionProviderCompat =
  ConnectionProvider as unknown as React.ComponentType<any>;

interface WalletProviderProps {
  children: React.ReactNode;
}

export default function WalletProvider({
  children,
}: WalletProviderProps) {
  /*
   * ============================================================
   * SOLANA RPC
   * ============================================================
   */

  const endpoint = useMemo(
    () =>
      process.env.NEXT_PUBLIC_RPC_URL ??
      clusterApiUrl("devnet"),
    []
  );

  /*
   * ============================================================
   * WALLETS
   * ============================================================
   */

  const wallets = useMemo(() => [], []);

  /*
   * ============================================================
   * PROVIDERS
   * ============================================================
   */

  return (
    <ConnectionProviderCompat
      endpoint={endpoint}
    >
      <SolanaWalletProvider
        wallets={wallets}
        autoConnect={false}
        onError={(error) => {
          console.error(
            "[CrowdBlinks WalletAdapter]",
            error
          );
        }}
      >
        <WalletModalProvider>
          <WalletDebug />
          {children}
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProviderCompat>
  );
}