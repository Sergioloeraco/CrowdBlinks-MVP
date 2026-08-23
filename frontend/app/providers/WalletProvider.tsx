"use client";

import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";

import "@solana/wallet-adapter-react-ui/styles.css";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ConnectionProviderCompat =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConnectionProvider as unknown as React.ComponentType<any>;

interface WalletProviderProps {
  children: React.ReactNode;
}

export default function WalletProvider({
  children,
}: WalletProviderProps) {
  const endpoint = useMemo(
    () =>
      process.env.NEXT_PUBLIC_RPC_URL ??
      clusterApiUrl("devnet"),
    []
  );

  return (
    <ConnectionProviderCompat endpoint={endpoint}>
      <SolanaWalletProvider
        wallets={[]}
        autoConnect={true}
        onError={(err) => {
          console.error(
            "[WalletAdapter ERROR]",
            err
          );
        }}
      >
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProviderCompat>
  );
}
