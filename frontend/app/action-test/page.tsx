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
      style={{
        minHeight: "100vh",
        padding: "40px",
        background: "#090611",
        color: "white",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "720px",
          margin: "0 auto",
        }}
      >
        <h1>CrowdBlinks — Action Test</h1>

        <p style={{ opacity: 0.7 }}>
          Cliente de prueba de Solana Actions sin dial.to.
        </p>

        <div
          style={{
            padding: "20px",
            marginTop: "25px",
            border: "1px solid #333",
            borderRadius: "12px",
          }}
        >
          <div style={{ marginBottom: "20px" }}>
            {!connected ? (
              <button
                type="button"
                onClick={() => setVisible(true)}
                style={{
                  padding: "10px 20px",
                  borderRadius: "8px",
                  border: "1px solid #6d3df5",
                  background: "#6d3df5",
                  color: "white",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Connect Wallet
              </button>
            ) : (
              <button
                type="button"
                onClick={() => disconnect()}
                style={{
                  padding: "10px 20px",
                  borderRadius: "8px",
                  border: "1px solid #6d3df5",
                  background: "#6d3df5",
                  color: "white",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Disconnect Wallet
              </button>
            )}
          </div>

          <p>
            <strong>Wallet:</strong>{" "}
            {!mounted
              ? "Cargando..."
              : connected && publicKey
              ? publicKey.toBase58()
              : "No conectada"}
          </p>

          {mounted && (
            <>
              <p>
                <strong>Estado:</strong>{" "}
                {connecting
                  ? "Conectando..."
                  : disconnecting
                  ? "Desconectando..."
                  : connected
                  ? "Conectada"
                  : "Desconectada"}
              </p>

              <p>
                <strong>Adapter:</strong>{" "}
                {wallet?.adapter.name ?? "Ninguno"}
              </p>
            </>
          )}

          <button
            onClick={loadAction}
            style={{
              padding: "12px 18px",
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
              marginRight: "10px",
            }}
          >
            Cargar Action
          </button>

          {action && (
            <div style={{ marginTop: "25px" }}>
              <h2>{action.title}</h2>

              <p style={{ whiteSpace: "pre-line" }}>
                {action.description}
              </p>

              <p>
                <strong>Estado:</strong>{" "}
                {action.disabled
                  ? "No disponible"
                  : "Disponible"}
              </p>

              <button
                onClick={buyTicket}
                disabled={!connected || action.disabled}
                style={{
                  width: "100%",
                  padding: "15px",
                  marginTop: "15px",
                  borderRadius: "8px",
                  border: "none",
                  cursor:
                    !connected || action.disabled
                      ? "not-allowed"
                      : "pointer",
                  fontWeight: "bold",
                }}
              >
                Comprar boleto — 0.1 SOL
              </button>
            </div>
          )}
        </div>

        {status && (
          <div
            style={{
              marginTop: "20px",
              padding: "15px",
              borderRadius: "8px",
              background: "#10251c",
            }}
          >
            {status}
          </div>
        )}

        {error && (
          <div
            style={{
              marginTop: "20px",
              padding: "15px",
              borderRadius: "8px",
              background: "#351414",
              color: "#ffaaaa",
            }}
          >
            {error}
          </div>
        )}

        {signature && (
          <div
            style={{
              marginTop: "20px",
              padding: "15px",
              borderRadius: "8px",
              background: "#111b30",
            }}
          >
            <strong>Transaction Signature:</strong>

            <p
              style={{
                wordBreak: "break-all",
                fontSize: "13px",
              }}
            >
              {signature}
            </p>

            <a
              href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#9f8cff" }}
            >
              Ver transacción en Solana Explorer
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
