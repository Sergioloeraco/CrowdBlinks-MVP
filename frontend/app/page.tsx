"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, BN, Program, setProvider } from "@anchor-lang/core";
import { LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { IDL, CrowdPass as CrowdBlinksProgram } from "../lib/idl";
import {
  findEventPda,
  parseEventState,
  parseCrowdBlinksError,
  ParsedEventState,
} from "../lib/program";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

type TxStatus = "idle" | "building" | "confirming" | "success" | "error";

type EventRow = ParsedEventState & {
  pda: string;
};

export default function Dashboard() {
  const { connected, publicKey, sendTransaction } = useWallet();
  const wallet = useAnchorWallet();
  const { connection } = useConnection();

  const [eventId, setEventId] = useState("");
  const [title, setTitle] = useState("");
  const [ticketPrice, setTicketPrice] = useState("0.1");
  const [maxTickets, setMaxTickets] = useState("100");
  const [status, setStatus] = useState<TxStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [txSig, setTxSig] = useState("");
  const [blinkUrl, setBlinkUrl] = useState("");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const program = useMemo(() => {
    if (!wallet) return null;

    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });

    setProvider(provider);

    return new Program<CrowdBlinksProgram>(
      IDL as unknown as CrowdBlinksProgram,
      provider
    );
  }, [connection, wallet]);

  const fetchEvents = useCallback(async () => {
    if (!program || !publicKey) return;

    setLoadingEvents(true);
    try {
      const accounts = await (program.account as any).campaignState.all([
        { memcmp: { offset: 8, bytes: publicKey.toBase58() } },
      ]);

      setEvents(
        accounts
          .map((acc: any) => ({
            pda: acc.publicKey.toBase58(),
            ...parseEventState(acc.account),
          }))
          .reverse()
      );
    } catch (err) {
      console.error("[CrowdBlinks] fetchEvents:", err);
    } finally {
      setLoadingEvents(false);
    }
  }, [program, publicKey]);

  useEffect(() => {
    if (connected && program) fetchEvents();
    else setEvents([]);
  }, [connected, fetchEvents, program]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!program || !publicKey) return;

    setStatus("building");
    setErrorMsg("");

    try {
      const cleanEventId = eventId
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-");
      const cleanTitle = title.trim() || cleanEventId;
      const priceSol = parseFloat(ticketPrice);
      const capacity = parseInt(maxTickets, 10);

      if (!cleanEventId || cleanEventId.length > 32) {
        throw new Error("El ID debe tener entre 1 y 32 caracteres.");
      }
      if (isNaN(priceSol) || priceSol <= 0) {
        throw new Error("El precio del boleto debe ser mayor a 0 SOL.");
      }
      if (isNaN(capacity) || capacity < 1 || capacity > 65535) {
        throw new Error("La capacidad debe estar entre 1 y 65535 boletos.");
      }

      const [pda] = findEventPda(publicKey, cleanEventId);
      const existing = await connection.getAccountInfo(pda);
      if (existing) throw new Error(`Ya existe un evento con el ID "${cleanEventId}".`);

      setStatus("confirming");

      const transaction = await program.methods
        .initializeCampaign(
          cleanEventId,
          new BN(Math.round(priceSol * LAMPORTS_PER_SOL)),
          capacity
        )
        .accounts({
          campaign: pda,
          authority: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");

      transaction.recentBlockhash = blockhash;
      transaction.lastValidBlockHeight = lastValidBlockHeight;
      transaction.feePayer = publicKey;

      const sig = await sendTransaction(transaction, connection, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash,
          lastValidBlockHeight,
        },
        "confirmed"
      );

      const eventActionId = `${publicKey.toBase58()}_${cleanEventId}`;
      const origin =
        process.env.NEXT_PUBLIC_APP_URL ||
        (typeof window !== "undefined" ? window.location.origin : "");
      const blink = `https://dial.to/?action=solana-action:${encodeURIComponent(
        `${origin}/api/actions/event/${eventActionId}`
      )}`;
      const tweetText =
        `${cleanTitle}\n\n` +
        `Compra tu boleto por ${priceSol} SOL con Solana Blinks.\n\n` +
        `${blink}\n\n#Solana #Web3 #CrowdBlinks`;

      setTxSig(sig);
      setBlinkUrl(blink);
      setStatus("success");
      await navigator.clipboard?.writeText(blink).catch(() => undefined);
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`,
        "_blank",
        "noopener,noreferrer"
      );
      await fetchEvents();
    } catch (err) {
      console.error("[CrowdBlinks] handleCreate:", err);
      setErrorMsg(parseCrowdBlinksError(err));
      setStatus("error");
    }
  }

  async function handleClose(closeEventId: string) {
    if (!program || !publicKey) return;
    if (!window.confirm("Cerrar este evento recuperara el rent de la cuenta.")) return;

    try {
      const [pda] = findEventPda(publicKey, closeEventId);
      setLoadingEvents(true);

      const transaction = await program.methods
        .closeCampaign()
        .accounts({
          campaign: pda,
          authority: publicKey,
        })
        .transaction();

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");

      transaction.recentBlockhash = blockhash;
      transaction.lastValidBlockHeight = lastValidBlockHeight;
      transaction.feePayer = publicKey;

      const signature = await sendTransaction(transaction, connection, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      await connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight,
        },
        "confirmed"
      );

      await fetchEvents();
    } catch (err) {
      console.error("[CrowdBlinks] handleClose:", err);
      alert(parseCrowdBlinksError(err));
      setLoadingEvents(false);
    }
  }

  function resetForm() {
    setEventId("");
    setTitle("");
    setTicketPrice("0.1");
    setMaxTickets("100");
    setErrorMsg("");
    setStatus("idle");
    setTxSig("");
    setBlinkUrl("");
    setCopied(false);
  }

  async function copyBlink() {
    await navigator.clipboard.writeText(blinkUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!mounted) return null;

  const previewTitle = title || "Nombre del evento";
  const previewCapacity = maxTickets || "0";
  const previewPrice = ticketPrice || "0";

  return (
    <div className="min-h-screen bg-[#08060F] text-white" style={{ fontFamily: "'Syne', sans-serif" }}>
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(153,69,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(20,241,149,0.5) 1px,transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <header style={{ background: "#0B0816", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center font-black text-sm"
              style={{ background: "linear-gradient(135deg,#9945FF,#14F195)" }}
            >
              C
            </div>
            <span className="font-black text-base tracking-tight">CrowdBlinks</span>
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 3, color: "#14F195" }}>
              DEVNET
            </span>
          </div>
          <WalletMultiButton />
        </div>
      </header>

      <main className="grid lg:grid-cols-2 min-h-[calc(100vh-57px)]">
        <section className="flex flex-col gap-4 p-6 overflow-y-auto border-r border-white/5">
          <div>
            <p style={monoLabel}>ORGANIZADOR</p>
            <h1 className="font-black text-2xl leading-tight tracking-tight mb-1">
              Crea eventos con boletos on-chain
            </h1>
            <p className="text-xs leading-relaxed text-white/40">
              Tu audiencia compra directo desde X. Cada compra reparte 99% al organizador y 1% a tesoreria.
            </p>
          </div>

          {connected ? (
            <form onSubmit={handleCreate} className="flex flex-col gap-4 flex-1">
              <Field label="ID del evento">
                <input
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                  required
                  maxLength={50}
                  placeholder="hackathon-gdl-2026"
                  className={inputCls}
                />
              </Field>

              <Field label="Nombre visible">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Hackathon Meetup Guadalajara"
                  className={inputCls}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Precio boleto">
                  <input
                    value={ticketPrice}
                    onChange={(e) => setTicketPrice(e.target.value)}
                    required
                    type="number"
                    min="0.001"
                    step="0.001"
                    className={inputCls}
                  />
                </Field>

                <Field label="Capacidad">
                  <input
                    value={maxTickets}
                    onChange={(e) => setMaxTickets(e.target.value)}
                    required
                    type="number"
                    min="1"
                    max="65535"
                    step="1"
                    className={inputCls}
                  />
                </Field>
              </div>

              {status === "error" && errorMsg && (
                <div className="p-3 rounded-lg text-xs leading-relaxed text-red-200 bg-red-500/10 border border-red-400/20">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={status === "building" || status === "confirming"}
                className="mt-auto w-full py-4 rounded-lg font-black text-sm transition-all"
                style={{
                  background:
                    status === "building" || status === "confirming"
                      ? "rgba(153,69,255,0.3)"
                      : "linear-gradient(135deg,#9945FF,#1FAE78)",
                  opacity: status === "building" || status === "confirming" ? 0.65 : 1,
                }}
              >
                {status === "building"
                  ? "Preparando transaccion..."
                  : status === "confirming"
                    ? "Confirmando en Solana..."
                    : "Crear Blink de boletos"}
              </button>
            </form>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl"
                style={{ background: "rgba(153,69,255,0.1)", border: "1px solid rgba(153,69,255,0.2)" }}
              >
                CB
              </div>
              <p className="text-sm max-w-xs leading-relaxed text-white/40">
                Conecta tu wallet para crear eventos y publicar Blinks.
              </p>
              <WalletMultiButton />
            </div>
          )}
        </section>

        <section className="hidden lg:flex flex-col gap-5 p-6 overflow-y-auto" style={{ background: "#07050F" }}>
          <div>
            <p style={monoLabel}>PREVIEW DEL BLINK</p>
            <div className="mt-3 w-full max-w-[340px] rounded-lg overflow-hidden border border-white/10">
              <div
                className="p-5 flex flex-col justify-between h-44"
                style={{ background: "linear-gradient(135deg,#0F0B1E,#102018)" }}
              >
                <span style={{ ...monoLabel, color: "#14F195" }}>CROWDBLINKS</span>
                <div>
                  <p className="font-black text-lg leading-tight">{previewTitle}</p>
                  <p className="mt-2 text-xs text-white/40">
                    {previewCapacity} boletos disponibles
                  </p>
                </div>
              </div>
              <div className="px-4 py-3 flex items-center justify-between" style={{ background: "#0F0922" }}>
                <span className="text-sm font-bold">Comprar boleto</span>
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: "#14F195" }}>
                  {previewPrice} SOL
                </span>
              </div>
            </div>
          </div>

          {status === "success" && (
            <div className="w-full max-w-[340px] rounded-lg p-4 border border-emerald-400/20 bg-emerald-400/10">
              <p className="font-bold text-sm">Evento creado</p>
              <a
                href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-emerald-200"
              >
                Ver transaccion
              </a>
              <button onClick={copyBlink} className="mt-3 w-full rounded-lg py-2 text-sm bg-white/10">
                {copied ? "Copiado" : "Copiar Blink"}
              </button>
              <button onClick={resetForm} className="mt-2 w-full rounded-lg py-2 text-sm bg-white/5">
                Crear otro evento
              </button>
            </div>
          )}

          {connected && (
            <div className="w-full max-w-[340px]">
              <div className="flex items-center justify-between mb-3">
                <p style={monoLabel}>MIS EVENTOS</p>
                <button onClick={fetchEvents} className="text-xs text-white/50">
                  {loadingEvents ? "Cargando..." : "Actualizar"}
                </button>
              </div>

              {events.length === 0 ? (
                <p className="py-4 text-xs text-white/30">Aun no tienes eventos.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {events.map((event) => {
                    const origin =
                      process.env.NEXT_PUBLIC_APP_URL ||
                      (typeof window !== "undefined" ? window.location.origin : "");
                    const eventActionId = `${event.authority}_${event.eventId}`;
                    const blink = `https://dial.to/?action=solana-action:${encodeURIComponent(
                      `${origin}/api/actions/event/${eventActionId}`
                    )}`;

                    return (
                      <div key={event.pda} className="rounded-lg p-3 bg-white/[0.03] border border-white/10">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-bold text-sm">{event.eventId}</p>
                            <p className="text-xs text-white/35">
                              {event.ticketsSold}/{event.maxTickets} vendidos
                            </p>
                          </div>
                          <span
                            className="text-[10px] px-2 py-1 rounded-full border"
                            style={{
                              color: event.isActive ? "#14F195" : "#9945FF",
                              borderColor: event.isActive ? "rgba(20,241,149,0.3)" : "rgba(153,69,255,0.4)",
                            }}
                          >
                            {event.isActive ? "Activo" : event.isSoldOut ? "Sold out" : "Cerrado"}
                          </span>
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <a href={blink} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-200">
                            Ver Blink
                          </a>
                          <button onClick={() => handleClose(event.eventId)} className="text-xs text-red-300">
                            Cerrar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span style={monoLabel}>{label}</span>
      {children}
    </label>
  );
}

const monoLabel = {
  fontFamily: "'DM Mono',monospace",
  fontSize: 10,
  letterSpacing: 2,
  textTransform: "uppercase" as const,
  color: "rgba(255,255,255,0.35)",
};

const inputCls = [
  "w-full rounded-lg px-4 py-3 text-sm text-white outline-none transition-all",
  "bg-white/[0.04] border border-white/10 focus:border-purple-400/40",
].join(" ");
