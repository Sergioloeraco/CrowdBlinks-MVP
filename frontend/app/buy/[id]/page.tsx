"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";

type ActionResponse = {
  type: string;
  title: string;
  description: string;
  label: string;
  disabled?: boolean;
  icon?: string;
};

export default function BuyTicketPage() {
  const params = useParams();
  const { setVisible } = useWalletModal();
  const { connection } = useConnection();

  const {
    publicKey,
    connected,
    connecting,
    wallet,
    connect,
    signTransaction,
    disconnect,
  } = useWallet();

  const [mounted, setMounted] = useState(false);
  const [action, setAction] = useState<ActionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [signature, setSignature] = useState("");

  const id = decodeURIComponent(String(params.id));

  useEffect(() => {
    setMounted(true);
  }, []);

  function handleWalletButtonClick() {
    if (!wallet) {
      setVisible(true);
      return;
    }

    if (!connected && !connecting) {
      connect().catch((err) => {
        console.error("[CrowdBlinks] connect error:", err);
      });
    }
  }

  async function loadAction() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        `/api/actions/event/${encodeURIComponent(id)}`,
        {
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.message ??
            `La Action respondió HTTP ${response.status}.`
        );
      }

      setAction(data);
    } catch (err) {
      console.error("[CrowdBlinks BUY GET]", err);

      setError(
        err instanceof Error
          ? err.message
          : "No se pudo cargar el evento."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (id) {
      loadAction();
    }
  }, [id]);

  async function buyTicket() {
    if (!publicKey) {
      handleWalletButtonClick();
      return;
    }

    if (!signTransaction) {
      setError("La wallet no permite firmar transacciones.");
      return;
    }

    try {
      setStatus("Preparando transacción...");
      setError("");
      setSignature("");

      const response = await fetch(
        `/api/actions/event/${encodeURIComponent(id)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            account: publicKey.toBase58(),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.message ??
            `La Action respondió HTTP ${response.status}.`
        );
      }

      if (!data.transaction) {
        throw new Error(
          "La Action no devolvió una transacción."
        );
      }

      const raw = Uint8Array.from(
        atob(data.transaction),
        (char) => char.charCodeAt(0)
      );

      const transaction =
        VersionedTransaction.deserialize(raw);

      const payerKey =
        transaction.message.staticAccountKeys[0];

      if (!payerKey || !payerKey.equals(publicKey)) {
        throw new Error(
          "La transacción no pertenece a la wallet conectada."
        );
      }

      setStatus("Esperando firma en Phantom...");

      const signedTransaction =
        await signTransaction(transaction);

      setStatus("Enviando transacción a Solana...");

      const txSignature =
        await connection.sendRawTransaction(
          signedTransaction.serialize(),
          {
            skipPreflight: false,
            preflightCommitment: "confirmed",
          }
        );

      setStatus("Confirmando transacción en Solana...");

      if (data.lastValidBlockHeight !== undefined) {
        await connection.confirmTransaction(
          {
            signature: txSignature,
            blockhash:
              transaction.message.recentBlockhash,
            lastValidBlockHeight:
              data.lastValidBlockHeight,
          },
          "confirmed"
        );
      } else {
        await connection.confirmTransaction(
          txSignature,
          "confirmed"
        );
      }

      setSignature(txSignature);
      setStatus("¡Boleto comprado correctamente!");

      await loadAction();
    } catch (err) {
      console.error("[CrowdBlinks BUY]", err);

      setError(
        err instanceof Error
          ? err.message
          : "Error al comprar el boleto."
      );

      setStatus("");
    }
  }

  function getProgress() {
    if (!action) return 0;

    const match =
      action.description.match(
        /Boletos:\s*(\d+)\s*\/\s*(\d+)/
      );

    if (!match) return 0;

    const sold = Number(match[1]);
    const total = Number(match[2]);

    if (!total) return 0;

    return Math.min(
      100,
      Math.round((sold / total) * 100)
    );
  }

  function getTickets() {
    if (!action) {
      return {
        sold: 0,
        total: 0,
        available: 0,
      };
    }

    const match =
      action.description.match(
        /Boletos:\s*(\d+)\s*\/\s*(\d+)/
      );

    if (!match) {
      return {
        sold: 0,
        total: 0,
        available: 0,
      };
    }

    const sold = Number(match[1]);
    const total = Number(match[2]);

    return {
      sold,
      total,
      available: Math.max(total - sold, 0),
    };
  }

  if (!mounted) {
    return null;
  }

  const progress = getProgress();
  const tickets = getTickets();
  const soldOut =
    tickets.total > 0 &&
    tickets.available === 0;

  return (
    <main
      className="min-h-[100dvh] min-h-screen bg-[#08060F] text-white safe-pb"
      style={{
        fontFamily: "var(--font-syne), sans-serif",
      }}
    >
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(153,69,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(20,241,149,0.5) 1px,transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <header
        style={{
          background: "#0B0816",
          borderBottom:
            "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 max-w-[720px] mx-auto">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center font-black text-sm"
              style={{
                background:
                  "linear-gradient(135deg,#9945FF,#14F195)",
              }}
            >
              C
            </div>

            <span className="font-black text-base truncate">
              CrowdBlinks
            </span>

            <span
              className="text-[#14F195] shrink-0"
              style={{
                fontFamily: "'DM Mono',monospace",
                fontSize: 9,
                letterSpacing: 3,
              }}
            >
              DEVNET
            </span>
          </div>

          {connected ? (
            <button
              onClick={() => disconnect()}
              className="px-3 py-2 min-h-[44px] rounded-lg border border-[#9945FF] text-xs font-semibold"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={handleWalletButtonClick}
              disabled={connecting}
              className="px-3 py-2 min-h-[44px] rounded-lg bg-[#9945FF] text-xs font-bold"
            >
              {!wallet
                ? "Connect Wallet"
                : connecting
                  ? "Conectando..."
                  : `Conectar ${wallet.adapter.name}`}
            </button>
          )}
        </div>
      </header>

      <div className="relative max-w-[720px] mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {loading && (
          <div className="max-w-[620px] mx-auto py-12 text-center">
            <p className="text-sm text-white/40">
              Cargando evento...
            </p>
          </div>
        )}

        {error && (
          <div className="max-w-[620px] mx-auto mb-5 p-4 rounded-xl bg-red-500/10 border border-red-400/20 text-red-200 text-xs sm:text-sm">
            {error}
          </div>
        )}

        {action && !loading && (
          <section className="max-w-[620px] mx-auto overflow-hidden rounded-2xl border border-white/10 bg-[#0B0816] shadow-2xl">
            {action.icon ? (
              <div className="relative h-48 sm:h-60 overflow-hidden bg-[#0F0B1E]">
                <img
                  src={action.icon}
                  alt={action.title}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />

                <div className="absolute inset-0 bg-gradient-to-t from-[#0B0816] via-transparent to-transparent" />
              </div>
            ) : (
              <div
                className="h-48 sm:h-60 p-6 flex flex-col justify-between"
                style={{
                  background:
                    "linear-gradient(135deg,#0F0B1E,#102018)",
                }}
              >
                <span className="text-[#14F195] text-xs tracking-[3px] font-bold">
                  CROWDBLINKS
                </span>
              </div>
            )}

            <div className="p-5 sm:p-7">
              <span className="text-[#14F195] text-[10px] tracking-[3px] font-bold">
                BOLETO ON-CHAIN
              </span>

              <h1 className="mt-3 text-2xl sm:text-3xl font-black leading-tight break-words">
                {action.title.replace(
                  "CrowdBlinks: ",
                  ""
                )}
              </h1>

              <p className="mt-3 text-sm text-white/45 leading-relaxed">
                {action.description
                  .replace(/Precio:[^\n]+\n?/g, "")
                  .replace(/Boletos:[^\n]+/g, "")
                  .trim() ||
                  "Compra tu boleto directamente desde Solana."}
              </p>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[10px] text-white/35 tracking-[2px] uppercase">
                    Disponibles
                  </p>

                  <p className="mt-2 text-2xl font-black">
                    {tickets.available}
                  </p>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[10px] text-white/35 tracking-[2px] uppercase">
                    Vendidos
                  </p>

                  <p className="mt-2 text-2xl font-black">
                    {tickets.sold}
                    <span className="text-white/25 text-base">
                      {" "}
                      / {tickets.total}
                    </span>
                  </p>
                </div>
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-white/35 tracking-[2px] uppercase">
                    Progreso
                  </span>

                  <span className="text-xs font-mono text-[#14F195]">
                    {progress}%
                  </span>
                </div>

                <div className="h-3 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${progress}%`,
                      background:
                        "linear-gradient(90deg,#9945FF,#14F195)",
                    }}
                  />
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between">
                <span className="text-xs text-white/40">
                  Precio del boleto
                </span>

                <span className="font-mono font-bold text-[#14F195]">
                  {action.description.match(
                    /Precio:\s*([0-9.]+)\s*SOL/
                  )?.[1] ?? "—"}{" "}
                  SOL
                </span>
              </div>

              <button
                onClick={buyTicket}
                disabled={action.disabled || soldOut}
                className="mt-6 w-full min-h-[52px] rounded-xl font-black text-sm transition-all"
                style={{
                  background:
                    action.disabled || soldOut
                      ? "rgba(255,255,255,0.08)"
                      : "#14F195",
                  color:
                    action.disabled || soldOut
                      ? "rgba(255,255,255,0.35)"
                      : "#08060F",
                }}
              >
                {soldOut
                  ? "SOLD OUT"
                  : action.disabled
                    ? "Evento no disponible"
                    : action.label}
              </button>

              {status && (
                <div className="mt-4 rounded-xl border border-[#14F195]/20 bg-[#14F195]/5 p-4 text-xs text-emerald-200">
                  {status}
                </div>
              )}

              {signature && (
                <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs font-bold">
                    ✓ Transacción confirmada
                  </p>

                  <a
                    href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-3 text-xs text-[#14F195]"
                  >
                    Ver en Solana Explorer ↗
                  </a>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}