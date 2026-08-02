// ================================================================
//  CrowdPass — Root Layout
//  /frontend/app/layout.tsx
//
//  Layout raíz de Next.js App Router. Configura:
//    - Metadata SEO / Open Graph (para el preview en X)
//    - Fuentes de Google Fonts (Syne + DM Mono)
//    - WalletProvider envolviendo toda la app
//    - Estilos globales base
// ================================================================

import type { Metadata, Viewport } from "next";
import { Syne, DM_Mono } from "next/font/google";
import WalletProvider from "./providers/WalletProvider";
import "./globals.css";

// ── Fuentes ────────────────────────────────────────────────────────
const syne = Syne({
  subsets:  ["latin"],
  weight:   ["400", "600", "700", "800"],
  variable: "--font-syne",
  display:  "swap",
});

const dmMono = DM_Mono({
  subsets:  ["latin"],
  weight:   ["400", "500"],
  variable: "--font-dm-mono",
  display:  "swap",
});

// ── Metadata SEO + Open Graph ──────────────────────────────────────
// Open Graph es clave: cuando alguien comparte el link del dashboard
// en X, Twitter renderiza la preview card con estos metadatos.
export const metadata: Metadata = {
  title:       "CrowdPass — Boletos on-chain para eventos",
  description:
    "Vende boletos o recibe donaciones para tu evento directamente desde X (Twitter). " +
    "Powered by Solana Actions & Blinks.",

  // Open Graph
  openGraph: {
    title:       "CrowdPass — Boletos on-chain",
    description: "Crea tu campaña en Solana y comparte tu Blink en X.",
    url:         process.env.NEXT_PUBLIC_BASE_URL ?? "https://crowdpass.vercel.app",
    siteName:    "CrowdPass",
    images: [
      {
        url:    "/og-image.png",   // ← agrega una imagen 1200×630 en /public/
        width:  1200,
        height: 630,
        alt:    "CrowdPass — Venta de boletos on-chain en Solana",
      },
    ],
    locale: "es_MX",
    type:   "website",
  },

  // Twitter Card
  twitter: {
    card:        "summary_large_image",
    title:       "CrowdPass — Boletos on-chain",
    description: "Compra boletos para eventos directamente desde X. Powered by Solana Blinks.",
    images:      ["/og-image.png"],
  },

  // Iconos
  icons: {
    icon:  [
      { url: '/icon.svg', type: 'image/svg+xml' }
    ]
  },

  // Robots
  robots: {
    index:  true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width:        "device-width",
  initialScale: 1,
  themeColor:   "#0F0B1E",
};

// ── Layout Component ───────────────────────────────────────────────
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es"
      className={`${syne.variable} ${dmMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        {/*
          WalletProvider es un Client Component que envuelve toda la app.
          Provee: ConnectionProvider + WalletProvider + WalletModalProvider
          Cualquier página hija puede usar useWallet() y useConnection().
        */}
        <WalletProvider>
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}