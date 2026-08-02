// ================================================================
//  CrowdPass — Dashboard del Organizador
//  /frontend/app/page.tsx
//
//  Combina:
//  ✓ dynamic import ssr:false (tu versión) — sin errores de hidratación
//  ✓ htmlFor + id + aria-label (tu versión) — sin warnings de accesibilidad
//  ✓ UI completa con toggle, live preview, sold out (nueva versión)
//  ✓ Modal de éxito con copiar + publicar en X (nueva versión)
//  ✓ Lista de campañas activas (nueva versión)
//  ✓ Lógica web3 real con Anchor (ambas versiones)
// ================================================================
"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useWallet, useConnection }                   from "@solana/wallet-adapter-react";
import dynamic                                         from "next/dynamic";
import { BN, Program, AnchorProvider }                from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  IDL, CrowdPass,
  parseCampaignState,
  parseCrowdPassError,
  CampaignStateAccount,
} from "../lib/idl";

// ── dynamic import — evita error de hidratación en Next.js App Router ──
const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

// ── Program ID ────────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ??
    "4RfgHgQRwssnJuzShFwmZVEw7DjNJj5TFPLjFJWJ8MT1"
);

// ── Tipos ─────────────────────────────────────────────────────────
interface FormState {
  eventId:     string;
  title:       string;
  description: string;
  mode:        "ticket" | "donation";
  ticketPrice: string;
  fundingGoal: string;
  maxTickets:  string;
}

type TxStatus = "idle" | "building" | "confirming" | "success" | "error";

interface ParsedCampaign {
  pda:            string;
  authority:      string;
  eventId:        string;
  title:          string;
  progressPct:    number;
  currentSol:     number;
  fundingGoalSol: number;
  ticketsSold:    number;
  maxTickets:     number;
  isActive:       boolean;
  isTicketMode:   boolean;
  isSoldOut:      boolean;
}

// ================================================================
//  COMPONENTE PRINCIPAL
// ================================================================
export default function Dashboard() {
  const { publicKey, signTransaction, signAllTransactions, connected } = useWallet();
  const { connection } = useConnection();

  const [form, setForm] = useState<FormState>({
    eventId: "", title: "", description: "",
    mode: "ticket", ticketPrice: "0.1",
    fundingGoal: "1", maxTickets: "100",
  });

  const [txStatus,         setTxStatus]         = useState<TxStatus>("idle");
  const [txSig,            setTxSig]            = useState("");
  const [blinkUrl,         setBlinkUrl]         = useState("");
  const [tweetUrl,         setTweetUrl]         = useState("");
  const [errorMsg,         setErrorMsg]         = useState("");
  const [copied,           setCopied]           = useState(false);
  const [campaigns,        setCampaigns]        = useState<ParsedCampaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [soldOutPreview,   setSoldOutPreview]   = useState(false);
  const [mounted,          setMounted]          = useState(false);

  useEffect(() => setMounted(true), []);

  // ── Instancia del programa Anchor (useMemo — solo recrea si cambia wallet) ──
  const program = useMemo(() => {
    if (!publicKey || !signTransaction || !signAllTransactions) return null;
    const provider = new AnchorProvider(
      connection,
      {
        publicKey,
        signTransaction,
        signAllTransactions: async (txs) =>
          Promise.all(txs.map((t) => signTransaction(t))),
      },
      { commitment: "confirmed" }
    );
    return new Program<CrowdPass>(IDL, PROGRAM_ID, provider);
  }, [connection, publicKey, signTransaction, signAllTransactions]);

  // ── Cargar campañas del organizador ───────────────────────────
  const fetchMyCampaigns = useCallback(async () => {
    if (!program || !publicKey) return;
    setLoadingCampaigns(true);
    try {
      const accounts = await (program.account as any).campaignState.all([
        { memcmp: { offset: 8, bytes: publicKey.toBase58() } },
      ]);
      setCampaigns(
        accounts
          .map((acc: any) => ({
            pda: acc.publicKey.toBase58(),
            ...parseCampaignState(acc.account as CampaignStateAccount),
          }))
          .reverse()
      );
    } catch (err) {
      console.error("[CrowdPass] fetchMyCampaigns:", err);
    } finally {
      setLoadingCampaigns(false);
    }
  }, [program, publicKey]);

  useEffect(() => {
    if (connected && program) fetchMyCampaigns();
    else setCampaigns([]);
  }, [connected, fetchMyCampaigns]);

  // ── Crear campaña on-chain ─────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!program || !publicKey) return;

    setTxStatus("building");
    setErrorMsg("");

    try {
      const eventId     = form.eventId.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const title       = form.title.trim();
      const description = form.description.trim();
      const goalSol     = parseFloat(form.fundingGoal);
      const maxT        = parseInt(form.maxTickets, 10);
      const priceSol    = form.mode === "ticket" ? parseFloat(form.ticketPrice) : 0;

      if (!eventId || eventId.length > 32) throw new Error("El ID debe tener entre 1 y 32 caracteres.");
      if (!title || title.length > 64)     throw new Error("El nombre es obligatorio (máx. 64 chars).");
      if (isNaN(goalSol) || goalSol <= 0)  throw new Error("La meta debe ser mayor a 0 SOL.");
      if (isNaN(maxT) || maxT < 1)         throw new Error("La capacidad debe ser al menos 1.");
      if (form.mode === "ticket" && (isNaN(priceSol) || priceSol <= 0))
        throw new Error("El precio del boleto debe ser mayor a 0 SOL.");

      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), publicKey.toBuffer(), Buffer.from(eventId)],
        PROGRAM_ID
      );

      console.log("[CrowdPass] PDA:", pda.toBase58());
      console.log("[CrowdPass] Program ID:", PROGRAM_ID.toBase58());

      const existing = await connection.getAccountInfo(pda);
      if (existing) throw new Error(`Ya existe una campaña con el ID "${eventId}".`);

      setTxStatus("confirming");

      const sig = await (program.methods as any)
        .initializeCampaign(
          eventId,
          new BN(Math.round(priceSol * LAMPORTS_PER_SOL)),
          new BN(Math.round(goalSol  * LAMPORTS_PER_SOL)),
          new BN(maxT),
          title,
          description || `Apoya "${title}" directamente desde X.`
        )
        .accounts({
          campaign:      pda,
          authority:     publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const campaignId = `${publicKey.toBase58()}_${eventId}`;
      const origin = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== "undefined" ? window.location.origin : "");
      const blink      = `https://dial.to/?action=solana-action:${encodeURIComponent(origin + "/api/actions/campaign/" + campaignId)}`;
      const tweetText  =
        `🚀 ¡Apoya "${title}"!\n\n` +
        (form.mode === "ticket"
          ? `🎟️ Consigue tu boleto por ${priceSol} SOL con @solana Blinks\n\n`
          : `💜 Dona lo que puedas con @solana Blinks\n\n`) +
        `${blink}\n\n#Solana #Web3 #CrowdPass`;

      setTxSig(sig);
      setBlinkUrl(blink);
      setTweetUrl(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`);
      setTxStatus("success");
      await fetchMyCampaigns();

    } catch (err: unknown) {
      console.error("[CrowdPass] handleCreate:", err);
      setErrorMsg(parseCrowdPassError(err));
      setTxStatus("error");
    }
  }

  async function handleDelete(eventId: string) {
    if (!program || !publicKey) return;
    
    if (!window.confirm("¿Seguro que deseas eliminar esta campaña? Esta acción no se puede deshacer y recuperarás el SOL del 'rent'.")) return;

    try {
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), publicKey.toBuffer(), Buffer.from(eventId)],
        PROGRAM_ID
      );

      setLoadingCampaigns(true);
      await (program.methods as any)
        .closeCampaign()
        .accounts({
          campaign:  pda,
          authority: publicKey,
        })
        .rpc();

      alert("Campaña eliminada correctamente ✅");
      await fetchMyCampaigns();
    } catch (err: unknown) {
      console.error("[CrowdPass] handleDelete:", err);
      alert(`Error al eliminar: ${parseCrowdPassError(err)}`);
      setLoadingCampaigns(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(blinkUrl).catch(console.error);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleReset() {
    setTxStatus("idle");
    setErrorMsg("");
    setBlinkUrl("");
    setTxSig("");
    setSoldOutPreview(false);
    setForm({
      eventId: "", title: "", description: "",
      mode: "ticket", ticketPrice: "0.1",
      fundingGoal: "1", maxTickets: "100",
    });
  }

  function update(field: keyof FormState, value: string) {
    setForm((p) => ({ ...p, [field]: value }));
  }

  // ── Preview values ────────────────────────────────────────────
  const previewTitle    = form.title       || "Nombre del evento";
  const previewGoal     = form.fundingGoal || "—";
  const previewPrice    = form.ticketPrice || "0";
  const previewCapacity = form.maxTickets  || "0";
  const previewDesc     = form.description || "Una breve descripción del evento aparecerá aquí.";

  if (!mounted) return null;

  // ================================================================
  //  RENDER
  // ================================================================
  return (
    <div className="min-h-screen bg-[#08060F] text-white" style={{ fontFamily: "'Syne', sans-serif" }}>

      {/* Grid de fondo */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage: "linear-gradient(rgba(153,69,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(153,69,255,0.5) 1px,transparent 1px)",
          backgroundSize: "48px 48px",
        }} />

      {/* ── HEADER ─────────────────────────────────────────────── */}
      <header style={{ background: "#0B0816", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="logo flex items-center gap-2">
            <div className="relative">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center font-black text-sm text-white"
                style={{ background: "linear-gradient(135deg,#9945FF,#14F195)" }}>C</div>
              <div className="logo-dot absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#14F195]"
                style={{ boxShadow: "0 0 6px #14F195" }} />
            </div>
            <span className="logo-text font-black text-base tracking-tight">CrowdPass</span>
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 3, color: "#9945FF" }}>DEVNET</span>
          </div>
          <WalletMultiButton />
        </div>
      </header>

      {/* ── MAIN: split-screen ─────────────────────────────────── */}
      <main className="grid lg:grid-cols-2 min-h-[calc(100vh-57px)]">

        {/* ── COLUMNA IZQUIERDA: Formulario ─────────────────────── */}
        <div className="flex flex-col gap-4 p-6 overflow-y-auto border-r border-white/5">

          <div>
            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#9945FF", marginBottom: 4 }}>
              Paso 1 de 1
            </p>
            <h1 className="font-black text-2xl leading-tight tracking-tight mb-1">
              Crea tu campaña<br />
              <span style={{ background: "linear-gradient(90deg,#9945FF,#14F195)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                on-chain
              </span>
            </h1>
            <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.35)" }}>
              Tu audiencia compra directo desde X sin salir del feed.
            </p>
          </div>

          {connected ? (
            <form onSubmit={handleCreate} className="flex flex-col gap-4 flex-1">

              {/* Modo */}
              <div className="grid grid-cols-2 gap-2">
                {(["ticket", "donation"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => update("mode", m)}
                    className="py-3 rounded-xl text-sm font-bold border transition-all"
                    style={{
                      background:   form.mode === m ? "rgba(153,69,255,0.15)" : "transparent",
                      borderColor:  form.mode === m ? "rgba(153,69,255,0.5)"  : "rgba(255,255,255,0.08)",
                      color:        form.mode === m ? "#fff" : "rgba(255,255,255,0.4)",
                    }}>
                    {m === "ticket" ? "🎟️ Venta de boletos" : "💜 Donación libre"}
                  </button>
                ))}
              </div>

              {/* ID del evento */}
              <div className="field flex flex-col gap-1.5">
                <label htmlFor="eventId" style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "rgba(255,255,255,0.3)" }}>
                  ID del evento *
                </label>
                <input
                  id="eventId" name="eventId" type="text" required maxLength={32}
                  placeholder="hackathon-gdl-2026"
                  value={form.eventId}
                  onChange={(e) => update("eventId", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                  className={inputCls}
                />
                <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>
                  Minúsculas, números y guiones. Seed del PDA.
                </p>
              </div>

              {/* Nombre */}
              <div className="field flex flex-col gap-1.5">
                <label htmlFor="title" style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "rgba(255,255,255,0.3)" }}>
                  Nombre del evento *
                </label>
                <input
                  id="title" name="title" type="text" required maxLength={64}
                  placeholder="Hackathon Meetup Guadalajara 2026"
                  value={form.title}
                  onChange={(e) => update("title", e.target.value)}
                  className={inputCls}
                />
              </div>

              {/* Descripción */}
              <div className="field flex flex-col gap-1.5">
                <label htmlFor="description" style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "rgba(255,255,255,0.3)" }}>
                  Descripción
                </label>
                <textarea
                  id="description" name="description" maxLength={256} rows={2}
                  placeholder="Una breve descripción que verán los compradores en el Blink…"
                  value={form.description}
                  onChange={(e) => update("description", e.target.value)}
                  className={`${inputCls} resize-none`}
                />
              </div>

              {/* Meta */}
              <div className="field flex flex-col gap-1.5">
                <label htmlFor="fundingGoal" style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "rgba(255,255,255,0.3)" }}>
                  Meta de recaudación (SOL) *
                </label>
                <div className="relative">
                  <input
                    id="fundingGoal" name="fundingGoal" type="number"
                    required min="0.001" step="0.1" placeholder="10"
                    aria-label="Meta de recaudación en SOL"
                    value={form.fundingGoal}
                    onChange={(e) => update("fundingGoal", e.target.value)}
                    className={`${inputCls} pr-14`}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-white/25" style={{ fontFamily: "'DM Mono',monospace" }}>SOL</span>
                </div>
              </div>

              {/* Precio y capacidad (condicional) */}
              {form.mode === "ticket" && (
                <div className="row-2 grid grid-cols-2 gap-3">
                  <div className="field flex flex-col gap-1.5">
                    <label htmlFor="ticketPrice" style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "rgba(255,255,255,0.3)" }}>
                      Precio boleto (SOL) *
                    </label>
                    <div className="relative">
                      <input
                        id="ticketPrice" name="ticketPrice" type="number"
                        required min="0.001" step="0.01" placeholder="0.1"
                        aria-label="Precio por boleto en SOL"
                        value={form.ticketPrice}
                        onChange={(e) => update("ticketPrice", e.target.value)}
                        className={`${inputCls} pr-12`}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/25" style={{ fontFamily: "'DM Mono',monospace" }}>SOL</span>
                    </div>
                  </div>
                  <div className="field flex flex-col gap-1.5">
                    <label htmlFor="maxTickets" style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "rgba(255,255,255,0.3)" }}>
                      Capacidad máxima *
                    </label>
                    <div className="relative">
                      <input
                        id="maxTickets" name="maxTickets" type="number"
                        required min="1" max="10000" placeholder="200"
                        aria-label="Capacidad máxima de boletos"
                        value={form.maxTickets}
                        onChange={(e) => update("maxTickets", e.target.value)}
                        className={`${inputCls} pr-14`}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/25" style={{ fontFamily: "'DM Mono',monospace" }}>seats</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Error */}
              {txStatus === "error" && errorMsg && (
                <div className="status error flex items-start gap-2 p-3 rounded-xl text-xs leading-relaxed"
                  style={{ background: "rgba(255,70,70,0.08)", border: "1px solid rgba(255,70,70,0.25)", color: "rgba(255,128,128,0.8)" }}>
                  <span className="flex-shrink-0">⚠</span>{errorMsg}
                </div>
              )}

              {/* Submit */}
              <button type="submit"
                className="btn-primary mt-auto w-full py-4 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all"
                disabled={txStatus === "building" || txStatus === "confirming"}
                style={{
                  background: txStatus === "building" || txStatus === "confirming"
                    ? "rgba(153,69,255,0.3)"
                    : "linear-gradient(135deg,#9945FF,#7B2FBE)",
                  cursor:  txStatus === "building" || txStatus === "confirming" ? "not-allowed" : "pointer",
                  opacity: txStatus === "building" || txStatus === "confirming" ? 0.6 : 1,
                }}>
                {txStatus === "building"   ? <><Spinner /> Preparando transacción…</> :
                 txStatus === "confirming" ? <><Spinner /> Confirmando en Solana…</>  :
                 <><span>⚡</span> Crear Blink On-Chain</>}
              </button>

            </form>
          ) : (
            <div className="hero flex-1 flex flex-col items-center justify-center gap-5 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl"
                style={{ background: "rgba(153,69,255,0.1)", border: "1px solid rgba(153,69,255,0.2)" }}>🔗</div>
              <div>
                <h1 className="font-black text-lg mb-1">Conecta tu wallet para empezar</h1>
                <p className="text-sm max-w-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>
                  Necesitas Phantom o Backpack. El organizador paga ~0.003 SOL de Rent.
                </p>
              </div>
              <WalletMultiButton />
            </div>
          )}
        </div>

        {/* ── COLUMNA DERECHA: Live Preview + Campañas ──────────── */}
        <div className="hidden lg:flex flex-col items-center gap-5 p-6 overflow-y-auto" style={{ background: "#07050F" }}>

          <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: "rgba(255,255,255,0.18)" }}>
            Preview del Blink en X
          </p>

          {/* Blink Card */}
          <div className="w-full max-w-[320px] rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>

            {/* Imagen dinámica */}
            <div className="relative p-4 flex flex-col justify-between"
              style={{ background: "linear-gradient(135deg,#0F0B1E,#1a0533)", height: 150 }}>
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: "#9945FF" }}>CrowdPass</span>
              <div>
                <p className="font-black text-base text-white leading-tight mb-2">{previewTitle}</p>
                <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.1)" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: "32%", background: "linear-gradient(90deg,#9945FF,#14F195)" }} />
                </div>
                <div className="flex justify-between mt-1">
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "rgba(255,255,255,0.35)" }}>32% recaudado</span>
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "rgba(255,255,255,0.35)" }}>Meta: {previewGoal} SOL</span>
                </div>
              </div>
              <div className="absolute top-3 right-3 flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full"
                  style={{ background: soldOutPreview ? "#9945FF" : "#14F195", boxShadow: `0 0 6px ${soldOutPreview ? "#9945FF" : "#14F195"}` }} />
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: soldOutPreview ? "#9945FF" : "#14F195" }}>
                  {soldOutPreview ? "Cerrado" : "Activo"}
                </span>
              </div>
              {soldOutPreview && (
                <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(8,6,15,0.7)" }}>
                  <div style={{ padding: "8px 20px", border: "2px solid rgba(153,69,255,0.6)", borderRadius: 8, fontFamily: "'DM Mono',monospace", fontSize: 13, letterSpacing: 4, color: "#9945FF", textTransform: "uppercase", background: "rgba(153,69,255,0.1)" }}>
                    SOLD OUT
                  </div>
                </div>
              )}
            </div>

            {/* Meta */}
            <div className="px-4 py-2.5" style={{ background: "#150D2E", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <p className="text-[11px] mb-1 line-clamp-1" style={{ color: "rgba(255,255,255,0.5)" }}>{previewDesc}</p>
              <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "rgba(153,69,255,0.5)" }}>crowdpass.vercel.app</p>
            </div>

            {/* Botones del Blink */}
            <div className="px-4 py-3 flex flex-col gap-2" style={{ background: "#0F0922", opacity: soldOutPreview ? 0.3 : 1 }}>
              {form.mode === "ticket" && (
                <div className="w-full py-2.5 rounded-lg text-center font-bold flex items-center justify-center gap-1"
                  style={{ fontSize: 11, border: "1px solid rgba(153,69,255,0.4)", background: "rgba(153,69,255,0.15)", color: "#c4a0ff" }}>
                  🎟️ Comprar Boleto{previewPrice && previewPrice !== "0" ? ` — ${previewPrice} SOL` : ""}
                </div>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <div className="py-2 rounded-lg text-center font-semibold flex items-center justify-center gap-1"
                  style={{ fontSize: 11, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.55)" }}>
                  ☕ Donar 0.1
                </div>
                <div className="py-2 rounded-lg text-center font-semibold flex items-center justify-center gap-1"
                  style={{ fontSize: 11, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.55)" }}>
                  🔥 Donar 0.5
                </div>
              </div>
              {form.mode === "ticket" && previewCapacity && previewCapacity !== "0" && (
                <p className="text-center" style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "rgba(255,255,255,0.2)" }}>
                  {previewCapacity} lugares disponibles
                </p>
              )}
            </div>
          </div>

          {/* Botones simular estado */}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setSoldOutPreview(false)}
              style={{
                fontFamily: "'DM Mono',monospace", fontSize: 9, padding: "6px 12px", borderRadius: 8, cursor: "pointer",
                color: !soldOutPreview ? "#14F195" : "rgba(255,255,255,0.25)",
                background: !soldOutPreview ? "rgba(20,241,149,0.08)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${!soldOutPreview ? "rgba(20,241,149,0.3)" : "rgba(255,255,255,0.08)"}`,
              }}>
              ● Estado: Activo
            </button>
            <button onClick={() => setSoldOutPreview(true)}
              style={{
                fontFamily: "'DM Mono',monospace", fontSize: 9, padding: "6px 12px", borderRadius: 8, cursor: "pointer",
                color: soldOutPreview ? "#9945FF" : "rgba(153,69,255,0.5)",
                background: soldOutPreview ? "rgba(153,69,255,0.15)" : "rgba(153,69,255,0.06)",
                border: `1px solid ${soldOutPreview ? "rgba(153,69,255,0.5)" : "rgba(153,69,255,0.2)"}`,
              }}>
              Simular Sold Out
            </button>
          </div>

          {/* Lista de campañas activas */}
          {connected && (
            <div className="w-full max-w-[320px]">
              <div className="flex items-center justify-between mb-3">
                <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: "rgba(255,255,255,0.18)" }}>
                  Mis Campañas Activas
                </p>
                <button onClick={fetchMyCampaigns}
                  style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "rgba(153,69,255,0.6)", background: "none", border: "none", cursor: "pointer" }}>
                  {loadingCampaigns ? "Cargando…" : "↻ Actualizar"}
                </button>
              </div>

              {loadingCampaigns ? (
                <div className="flex items-center gap-2 text-xs py-4" style={{ color: "rgba(255,255,255,0.3)" }}>
                  <Spinner /> Consultando Solana…
                </div>
              ) : campaigns.length === 0 ? (
                <p className="py-4" style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
                  Aún no tienes campañas. Crea una arriba.
                </p>
              ) : (
                <div className="campaign-list flex flex-col gap-2">
                  {campaigns.map((c) => {
                    const campaignId = `${c.authority}_${c.eventId}`;
                    const origin = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== "undefined" ? window.location.origin : "");
                    const blink = `https://dial.to/?action=solana-action:${encodeURIComponent(origin + "/api/actions/campaign/" + campaignId)}`;
                    return (
                      <div key={c.pda} className="card success-card p-3 rounded-xl"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", marginBottom: 0 }}>
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="text-sm font-bold leading-tight">{c.title}</p>
                            <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{c.eventId}</p>
                          </div>
                          <span style={{
                            fontFamily: "'DM Mono',monospace", fontSize: 9, padding: "2px 8px", borderRadius: 99,
                            color:      c.isActive ? "#14F195" : "#9945FF",
                            border:     `1px solid ${c.isActive ? "rgba(20,241,149,0.3)" : "rgba(153,69,255,0.3)"}`,
                            background: c.isActive ? "rgba(20,241,149,0.08)" : "rgba(153,69,255,0.08)",
                          }}>
                            {c.isActive ? "Activo" : c.isSoldOut ? "Sold out" : "Cerrado"}
                          </span>
                        </div>
                        <div className="w-full h-1 rounded-full overflow-hidden mb-1.5" style={{ background: "rgba(255,255,255,0.08)" }}>
                          <div className="h-full rounded-full" style={{ width: `${c.progressPct}%`, background: "linear-gradient(90deg,#9945FF,#14F195)" }} />
                        </div>
                        <div className="flex justify-between mb-2">
                          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                            {c.currentSol.toFixed(3)} / {c.fundingGoalSol.toFixed(2)} SOL
                          </span>
                          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{c.progressPct}%</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <a href={blink} target="_blank" rel="noopener noreferrer"
                            style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "rgba(153,69,255,0.6)", textDecoration: "none" }}>
                            Ver Blink ↗
                          </a>
                          <button
                            onClick={() => handleDelete(c.eventId)}
                            style={{ 
                              fontFamily: "'DM Mono',monospace", fontSize: 9, 
                              color: "rgba(255,70,70,0.8)", background: "none", 
                              border: "none", cursor: "pointer", textTransform: "uppercase", 
                              letterSpacing: 1 
                            }}>
                            Borrar ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── MODAL DE ÉXITO ──────────────────────────────────────── */}
      {txStatus === "success" && (
        <div className="modal-wrap fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}>
          <div className="modal w-full max-w-sm rounded-2xl overflow-hidden"
            style={{ background: "#0C0920", border: "1px solid rgba(20,241,149,0.2)", boxShadow: "0 0 60px rgba(20,241,149,0.1)" }}>
            <div className="modal-stripe h-1 w-full" style={{ background: "linear-gradient(90deg,#9945FF,#14F195)" }} />
            <div className="p-7">
              <div className="modal-badge inline-flex items-center gap-1.5 px-3 py-1 rounded-full mb-5"
                style={{ background: "rgba(20,241,149,0.1)", border: "1px solid rgba(20,241,149,0.25)", fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#14F195", letterSpacing: 2, textTransform: "uppercase" }}>
                <span style={{ fontSize: 7 }}>●</span> Confirmado en Devnet
              </div>
              <h2 className="modal-title font-black text-xl tracking-tight mb-1">¡Campaña creada! 🚀</h2>
              <p className="modal-sub text-xs leading-relaxed mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>
                <span className="text-white font-semibold">"{form.title}"</span> ya vive on-chain en Solana.
              </p>
              {txSig && (
                <a href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
                  target="_blank" rel="noopener noreferrer" className="inline-block mb-4"
                  style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "rgba(153,69,255,0.6)", textDecoration: "none" }}>
                  Ver tx en Explorer ↗
                </a>
              )}
              <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, textTransform: "uppercase", letterSpacing: 2, color: "rgba(255,255,255,0.25)", marginBottom: 6 }}>
                Tu Blink URL
              </p>
              <div className="url-box rounded-xl p-3 mb-4 break-all leading-relaxed"
                style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.08)", fontFamily: "'DM Mono',monospace", fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                {blinkUrl}
              </div>
              <div className="modal-btns grid grid-cols-2 gap-3 mb-3">
                <button className="btn-copy py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all"
                  onClick={handleCopy}
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }}>
                  {copied ? <><span style={{ color: "#14F195" }}>✓</span> Copiado</> : <>📋 Copiar link</>}
                </button>
                <a className="btn-tweet py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 no-underline text-white"
                  href={tweetUrl} target="_blank" rel="noopener noreferrer"
                  style={{ background: "#000", border: "1px solid rgba(255,255,255,0.15)" }}>
                  <span className="font-black">𝕏</span> Publicar en X
                </a>
              </div>
              <button className="btn-reset w-full text-xs"
                onClick={handleReset}
                style={{ fontFamily: "'DM Mono',monospace", color: "rgba(255,255,255,0.2)", background: "none", border: "none", cursor: "pointer" }}>
                Crear otra campaña →
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap');
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.6;transform:scale(1.3)} }
        .logo-dot { animation: pulse 2s infinite; }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance:none; }
      `}</style>
    </div>
  );
}

// ── Sub-componentes ───────────────────────────────────────────────
function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
    </svg>
  );
}

const inputCls = [
  "w-full rounded-xl px-4 py-3 text-sm text-white outline-none transition-all",
  "focus:ring-2 focus:ring-purple-500/20",
].join(" ");
