"use client";

// ================================================================
//  CrowdPass — Wallet Provider
//  /frontend/app/providers/WalletProvider.tsx
//
//  Encapsula toda la configuración de @solana/wallet-adapter en
//  un Client Component. Necesario porque App Router renderiza
//  los layouts en el servidor por defecto — los hooks de wallet
//  requieren contexto del navegador ("use client").
//
//  Wallets soportadas: Phantom, Backpack, Solflare + detección
//  automática de cualquier wallet estándar instalada.
// ================================================================

import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { clusterApiUrl } from "@solana/web3.js";

// Estilos base del modal de selección de wallet
// (se sobreescriben parcialmente en globals.css)
import "@solana/wallet-adapter-react-ui/styles.css";

interface WalletProviderProps {
  children: React.ReactNode;
}

export default function WalletProvider({ children }: WalletProviderProps) {
  // RPC endpoint — usa variable de entorno o devnet por defecto
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_RPC_URL ?? clusterApiUrl("devnet"),
    []
  );

  // Lista de wallets explícitas
  // StandardWalletAdapter detecta automáticamente el resto (Backpack, etc.)
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider
        wallets={wallets}
        autoConnect={false} // el usuario conecta manualmente — mejor UX
        onError={(err) => {
          // Errores silenciosos de wallet (ej. usuario rechazó conexión)
          // Los logueamos pero no rompemos la app
          console.warn("[WalletAdapter]", err.message);
        }}
      >
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}