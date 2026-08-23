"use client";

import { useEffect, useState } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";

const ACTION_URL =
  "https://crowd-blinks-mvp.vercel.app/api/actions/event/2UgioYmgnL5WcDm8vZLdb3cvtigFV3xaePC3jgfHZDoG_supabase-real-2026";

type ActionResponse = {
  type: string;
  title: string;
  description: string;
  label: string;
  disabled?: boolean;
  links?: {
    actions?: Array<{
      type: string;
      label: string;
      href: string;
    }>;
  };
};

export default function ActionTestPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { setVisible } = useWalletModal();
  const { connection } = useConnection();

  const {
    publicKey,
    connected,
    connecting,
    disconnecting,
    wallet,
    sendTransaction,
    disconnect,
  } = useWallet();

  const [action, setAction] = useState<ActionResponse | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [signature, setSignature] = useState("");

  async function loadAction() {
    setStatus("Consultando Solana Action...");
    setError("");
    setSignature("");

    try {
      const response = await fetch(ACTION_URL, {
        method: "GET",
        headers: {
          "ngrok-skip-browser-warning": "true",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(
          `La Action respondió HTTP ${response.status}.`
        );
      }

      const data = (await response.json()) as ActionResponse;

      setAction(data);
      setStatus("Action cargada correctamente.");
    } catch (err) {
      console.error("[ActionTest GET]", err);

      setError(
        err instanceof Error
          ? err.message
          : "No se pudo cargar la Action."
      );

      setStatus("");
    }
  }

  async function buyTicket() {
    if (!publicKey) {
      setError("Primero conecta Phantom.");
      return;
    }

    if (!sendTransaction) {
      setError("La wallet no permite enviar transacciones.");
      return;
    }

    setStatus("Solicitando transacción...");
    setError("");
    setSignature("");

    try {
      const response = await fetch(ACTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({
          account: publicKey.toBase58(),
        }),
      });

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

      const transaction = Transaction.from(raw);

      if (
        !transaction.feePayer ||
        !transaction.feePayer.equals(publicKey)
      ) {
        throw new Error(
          "La transacción no tiene como fee payer a la wallet conectada."
        );
      }

      setStatus("Esperando confirmación en Phantom...");

      const txSignature = await sendTransaction(
        transaction,
        connection,
        {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        }
      );

      setStatus("Confirmando transacción en Solana...");

      if (
        transaction.recentBlockhash &&
        transaction.lastValidBlockHeight !== undefined
      ) {
        await connection.confirmTransaction(
          {
            signature: txSignature,
            blockhash: transaction.recentBlockhash,
            lastValidBlockHeight:
              transaction.lastValidBlockHeight,
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
    } catch (err) {
      console.error("[ActionTest BUY]", err);

      setError(
        err instanceof Error
          ? err.message
          : "Error al comprar el boleto."
      );

      setStatus("");
    }
  }

  return (
    <main
      className="min-h-[100dvh] min-h-screen p-4 sm:p-10 bg-[#090611] text-white safe-pb"
      style={{
        fontFamily: "var(--font-syne), sans-serif",
      }}
    >
      <div
        className="w-full max-w-[720px] mx-auto"
      >
        <h1 className="text-xl sm:text-3xl font-black mb-1">CrowdBlinks — Action Test</h1>

        <p className="text-xs sm:text-sm text-white/70">
          Cliente de prueba de Solana Actions sin dial.to.
        </p>

        <div
          className="p-4 sm:p-6 mt-6 border border-white/10 rounded-2xl bg-[#0F0B1E]"
        >
          <div className="mb-5">
            {!connected ? (
              <button
                type="button"
                onClick={() => setVisible(true)}
                className="px-4 py-3 min-h-[44px] rounded-lg border border-[#6d3df5] bg-[#6d3df5] text-white text-xs sm:text-sm font-semibold cursor-pointer touch-manipulation"
              >
                Connect Wallet
              </button>
            ) : (
              <button
                type="button"
                onClick={() => disconnect()}
                className="px-4 py-3 min-h-[44px] rounded-lg border border-[#6d3df5] bg-[#6d3df5] text-white text-xs sm:text-sm font-semibold cursor-pointer touch-manipulation"
              >
                Disconnect Wallet
              </button>
            )}
          </div>

          <p className="text-xs sm:text-sm break-all mb-2">
            <strong>Wallet:</strong>{" "}
            {!mounted
              ? "Cargando..."
              : connected && publicKey
              ? publicKey.toBase58()
              : "No conectada"}
          </p>

          {mounted && (
            <>
              <p className="text-xs sm:text-sm mb-2">
                <strong>Estado:</strong>{" "}
                {connecting
                  ? "Conectando..."
                  : disconnecting
                  ? "Desconectando..."
                  : connected
                  ? "Conectada"
                  : "Desconectada"}
              </p>

              <p className="text-xs sm:text-sm mb-4">
                <strong>Adapter:</strong>{" "}
                {wallet?.adapter.name ?? "Ninguno"}
              </p>
            </>
          )}

          <button
            onClick={loadAction}
            className="px-4 py-3 min-h-[44px] rounded-lg border-none bg-white/10 text-white text-xs sm:text-sm font-semibold cursor-pointer touch-manipulation mb-4"
          >
            Cargar Action
          </button>

          {action && (
            <div className="mt-6 border-t border-white/10 pt-5">
              <h2 className="text-lg sm:text-2xl font-bold break-words">{action.title}</h2>

              <p className="whitespace-pre-line text-xs sm:text-sm text-white/70 my-3 leading-relaxed break-words">
                {action.description}
              </p>

              <p className="text-xs sm:text-sm">
                <strong>Estado:</strong>{" "}
                {action.disabled
                  ? "No disponible"
                  : "Disponible"}
              </p>

              <button
                onClick={buyTicket}
                disabled={!connected || action.disabled}
                className={`w-full py-4 min-h-[44px] mt-4 rounded-xl border-none text-sm font-bold transition-all touch-manipulation ${
                  !connected || action.disabled
                    ? "bg-white/10 text-white/40 cursor-not-allowed"
                    : "bg-[#14F195] text-[#08060F] cursor-pointer hover:opacity-90"
                }`}
              >
                Comprar boleto — 0.1 SOL
              </button>
            </div>
          )}
        </div>

        {status && (
          <div
            className="mt-5 p-4 rounded-xl bg-[#10251c] text-xs sm:text-sm text-emerald-200 leading-relaxed break-words"
          >
            {status}
          </div>
        )}

        {error && (
          <div
            className="mt-5 p-4 rounded-xl bg-[#351414] text-[#ffaaaa] text-xs sm:text-sm leading-relaxed break-words"
          >
            {error}
          </div>
        )}

        {signature && (
          <div
            className="mt-5 p-4 sm:p-5 rounded-xl bg-[#111b30] text-xs sm:text-sm border border-white/5"
          >
            <strong className="block font-bold">Transaction Signature:</strong>

            <p
              className="mt-2.5 break-all text-xs opacity-70 font-mono"
            >
              {signature}
            </p>

            <a
              href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-3 text-xs font-semibold text-[#9f8cff] hover:underline break-all"
            >
              Ver transacción en Solana Explorer
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
