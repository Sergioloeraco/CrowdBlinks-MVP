"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Transaction } from "@solana/web3.js";

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
    sendTransaction,
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

    if (!sendTransaction) {
      setError("La wallet no permite enviar transacciones.");
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

      const transaction = Transaction.from(raw);

      if (
        !transaction.feePayer ||
        !transaction.feePayer.equals(publicKey)
      ) {
        throw new Error(
          "La transacción no pertenece a la wallet conectada."
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
      style={{
        minHeight: "100vh",
        padding: "32px 20px",
        background: "#08060F",
        color: "white",
        fontFamily: "var(--font-syne), sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "620px",
          margin: "0 auto",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "30px",
          }}
        >
          <strong style={{ fontSize: "20px" }}>
            CrowdBlinks
          </strong>

          {connected ? (
            <button
              onClick={() => disconnect()}
              style={{
                padding: "9px 14px",
                borderRadius: "8px",
                border: "1px solid #9945FF",
                background: "transparent",
                color: "white",
                cursor: "pointer",
              }}
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={handleWalletButtonClick}
              disabled={connecting}
              style={{
                padding: "9px 14px",
                borderRadius: "8px",
                border: "none",
                background: "#9945FF",
                color: "white",
                cursor: connecting ? "not-allowed" : "pointer",
                fontWeight: 700,
                opacity: connecting ? 0.6 : 1,
              }}
            >
              {!wallet ? "Connect Wallet" : connecting ? "Conectando..." : `Conectar ${wallet.adapter.name}`}
            </button>
          )}
        </header>

        {loading && <p>Cargando evento...</p>}

        {error && (
          <div
            style={{
              padding: "15px",
              marginBottom: "20px",
              borderRadius: "10px",
              background: "#351414",
              color: "#ffaaaa",
            }}
          >
            {error}
          </div>
        )}

        {action && (
          <section
            style={{
              padding: "28px",
              borderRadius: "18px",
              border: "1px solid rgba(255,255,255,0.08)",
              background: "#0F0B1E",
            }}
          >
            <p
              style={{
                color: "#14F195",
                fontSize: "12px",
                letterSpacing: "2px",
                fontWeight: 700,
              }}
            >
              CROWDBLINKS
            </p>

            <h1 style={{ fontSize: "32px", margin: "15px 0 10px" }}>
              {action.title}
            </h1>

            <p
              style={{
                whiteSpace: "pre-line",
                color: "rgba(255,255,255,0.65)",
                lineHeight: 1.6,
              }}
            >
              {action.description}
            </p>

            <button
              onClick={buyTicket}
              disabled={action.disabled}
              style={{
                width: "100%",
                padding: "16px",
                marginTop: "25px",
                borderRadius: "10px",
                border: "none",
                background: "#14F195",
                color: "#08060F",
                fontWeight: 800,
                cursor: action.disabled
                  ? "not-allowed"
                  : "pointer",
              }}
            >
              {action.disabled
                ? "Evento no disponible"
                : action.label}
            </button>
          </section>
        )}

        {status && (
          <div
            style={{
              marginTop: "20px",
              padding: "15px",
              borderRadius: "10px",
              background: "#10251C",
            }}
          >
            {status}
          </div>
        )}

        {signature && (
          <div
            style={{
              marginTop: "20px",
              padding: "18px",
              borderRadius: "10px",
              background: "#111827",
            }}
          >
            <strong>Transacción confirmada</strong>

            <p
              style={{
                marginTop: "10px",
                wordBreak: "break-all",
                fontSize: "12px",
                opacity: 0.7,
              }}
            >
              {signature}
            </p>

            <a
              href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "#14F195",
              }}
            >
              Ver en Solana Explorer
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
