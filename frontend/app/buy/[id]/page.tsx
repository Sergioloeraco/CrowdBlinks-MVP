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

      console.log(
        "[CrowdBlinks BUY] solicitando firma de VersionedTransaction"
      );

      const signedTransaction =
        await signTransaction(transaction);

      console.log(
        "[CrowdBlinks BUY] transacción firmada correctamente"
      );

      setStatus("Enviando transacción firmada a Solana...");

      const txSignature =
        await connection.sendRawTransaction(
          signedTransaction.serialize(),
          {
            skipPreflight: false,
            preflightCommitment: "confirmed",
          }
        );

      console.log(
        "[CrowdBlinks BUY] transacción enviada:",
        txSignature
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

  if (!mounted) {
    return null;
  }

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
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 max-w-[720px] mx-auto">
          <div className="flex min-w-0 items-center gap-2">
            <div
              className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center font-black text-sm"
              style={{
                background: "linear-gradient(135deg,#9945FF,#14F195)",
              }}
            >
              C
            </div>
            <span className="font-black text-base tracking-tight truncate">
              CrowdBlinks
            </span>
            <span
              className="shrink-0"
              style={{
                fontFamily: "'DM Mono',monospace",
                fontSize: 9,
                letterSpacing: 3,
                color: "#14F195",
              }}
            >
              DEVNET
            </span>
          </div>

          {connected ? (
            <button
              onClick={() => disconnect()}
              className="px-3.5 py-2 min-h-[44px] rounded-lg border border-[#9945FF] bg-transparent text-white text-xs sm:text-sm font-semibold cursor-pointer touch-manipulation"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={handleWalletButtonClick}
              disabled={connecting}
              className="px-3.5 py-2 min-h-[44px] rounded-lg border-none bg-[#9945FF] text-white text-xs sm:text-sm font-bold cursor-pointer touch-manipulation"
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

      <div className="relative w-full max-w-[720px] mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {loading && (
          <p className="text-sm text-white/50 text-center">
            Cargando evento...
          </p>
        )}

        {error && (
          <div className="max-w-[620px] mx-auto p-4 mb-5 rounded-xl bg-red-500/10 border border-red-400/20 text-red-200 text-xs sm:text-sm leading-relaxed break-words">
            {error}
          </div>
        )}

        {action && (
          <section className="w-full max-w-[620px] mx-auto rounded-lg overflow-hidden border border-white/10">
            <div
              className="p-5 sm:p-6 flex flex-col justify-between min-h-44 sm:min-h-48"
              style={{
                background: "linear-gradient(135deg,#0F0B1E,#102018)",
              }}
            >
              <span
                className="text-[#14F195] text-[11px] sm:text-xs tracking-widest font-bold uppercase"
                style={{
                  fontFamily: "'DM Mono',monospace",
                }}
              >
                CROWDBLINKS
              </span>

              <div className="mt-6">
                <h1 className="font-black text-xl sm:text-2xl leading-tight break-words">
                  {action.title}
                </h1>

                <p className="text-xs text-white/40 mt-2 break-words">
                  {action.description || "Boleto on-chain para este evento."}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-4 bg-[#0F0B1E] border-t border-white/5">
              <span className="font-bold text-sm">
                {action.disabled
                  ? "Evento no disponible"
                  : "Comprar boleto"}
              </span>

              <button
                onClick={buyTicket}
                disabled={action.disabled}
                className={`w-full sm:w-auto sm:min-w-[210px] py-3 px-5 min-h-[44px] rounded-lg border-none font-black text-sm transition-all touch-manipulation ${
                  action.disabled
                    ? "bg-white/10 text-white/40 cursor-not-allowed"
                    : "bg-[#14F195] text-[#08060F] cursor-pointer hover:opacity-90"
                }`}
              >
                {action.disabled
                  ? "Evento no disponible"
                  : action.label}
              </button>
            </div>
          </section>
        )}

        {status && (
          <div className="w-full max-w-[620px] mx-auto mt-5 p-4 rounded-xl bg-[#10251C] border border-[#14F195]/10 text-xs sm:text-sm text-emerald-200 leading-relaxed break-words">
            {status}
          </div>
        )}

        {signature && (
          <div className="w-full max-w-[620px] mx-auto mt-5 p-4 sm:p-5 rounded-xl bg-[#111827] text-xs sm:text-sm border border-white/5">
            <strong className="block font-bold">Transacción confirmada</strong>

            <p className="mt-2.5 break-all text-xs opacity-70 font-mono">
              {signature}
            </p>

            <a
              href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-3 text-xs font-semibold text-[#14F195] hover:underline break-all"
            >
              Ver en Solana Explorer
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
