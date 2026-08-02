// ================================================================
//  CrowdPass — Test Suite (TypeScript / Mocha / Chai)
//  Hackathon Solana LATAM 2026
//
//  Cubre los 4 flujos CRUD + todos los casos de error relevantes.
//  Archivo: /backend/tests/crowd_pass.ts
//
//  Cómo correr:
//    anchor test                        ← levanta localnet automático
//    anchor test --skip-local-validator ← si ya tienes surfpool/devnet
// ================================================================

import * as anchor from "@coral-xyz/anchor";
import { Program, BN }  from "@coral-xyz/anchor";
import { CrowdPass }    from "../target/types/crowd_pass";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { assert, expect } from "chai";

// ── Helpers ──────────────────────────────────────────────────────

/** Airdrop + confirma. Útil para wallets de prueba. */
async function airdrop(
  connection: anchor.web3.Connection,
  pubkey: PublicKey,
  sol: number = 2
): Promise<void> {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

/** Deriva el PDA de una campaña con las mismas seeds que el contrato. */
function findCampaignPda(
  programId: PublicKey,
  authority: PublicKey,
  eventId: string
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("campaign"),
      authority.toBuffer(),
      Buffer.from(eventId),
    ],
    programId
  );
}

/** Lee el balance en lamports de una cuenta. */
async function getBalance(
  connection: anchor.web3.Connection,
  pubkey: PublicKey
): Promise<number> {
  return connection.getBalance(pubkey, "confirmed");
}

// ================================================================
//  TEST SUITE PRINCIPAL
// ================================================================

describe("CrowdPass — Smart Contract Tests", () => {
  // ── Setup global ───────────────────────────────────────────────
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program    = anchor.workspace.CrowdPass as Program<CrowdPass>;
  const connection = provider.connection;

  // Wallets de prueba
  const organizer  = Keypair.generate();  // crea campañas
  const supporter1 = Keypair.generate();  // compra boleto
  const supporter2 = Keypair.generate();  // intenta doble pago
  const stranger   = Keypair.generate();  // intenta retirar sin permiso

  // IDs de campaña para cada escenario
  const TICKET_EVENT_ID   = "hackathon-2026";
  const DONATION_EVENT_ID = "donacion-libre";

  // Constantes del evento de boletos
  const TICKET_PRICE_SOL  = 0.1;
  const FUNDING_GOAL_SOL  = 1.0;
  const MAX_TICKETS       = 5;

  let ticketCampaignPda:   PublicKey;
  let donationCampaignPda: PublicKey;

  // ── Before: fondear todas las wallets ──────────────────────────
  before(async () => {
    await Promise.all([
      airdrop(connection, organizer.publicKey,  5),
      airdrop(connection, supporter1.publicKey, 2),
      airdrop(connection, supporter2.publicKey, 2),
      airdrop(connection, stranger.publicKey,   1),
    ]);

    [ticketCampaignPda]   = findCampaignPda(program.programId, organizer.publicKey, TICKET_EVENT_ID);
    [donationCampaignPda] = findCampaignPda(program.programId, organizer.publicKey, DONATION_EVENT_ID);
  });

  // ================================================================
  //  BLOQUE 1 — INITIALIZE CAMPAIGN (CREATE)
  // ================================================================
  describe("1 · initialize_campaign", () => {

    it("✓ Crea campaña en modo TICKET correctamente", async () => {
      await program.methods
        .initializeCampaign(
          TICKET_EVENT_ID,
          new BN(TICKET_PRICE_SOL * LAMPORTS_PER_SOL),
          new BN(FUNDING_GOAL_SOL * LAMPORTS_PER_SOL),
          new BN(MAX_TICKETS),
          "Hackathon Solana LATAM 2026",
          "El mejor hackathon de Web3 en LATAM. Consigue tu boleto on-chain."
        )
        .accounts({
          campaign:      ticketCampaignPda,
          authority:     organizer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([organizer])
        .rpc();

      const state = await (program.account as any).campaignState.fetch(ticketCampaignPda);

      assert.equal(state.authority.toBase58(), organizer.publicKey.toBase58());
      assert.equal(state.eventId, TICKET_EVENT_ID);
      assert.equal(state.ticketPrice.toNumber(), TICKET_PRICE_SOL * LAMPORTS_PER_SOL);
      assert.equal(state.fundingGoal.toNumber(), FUNDING_GOAL_SOL * LAMPORTS_PER_SOL);
      assert.equal(state.currentFunding.toNumber(), 0);
      assert.equal(state.maxTickets.toNumber(), MAX_TICKETS);
      assert.equal(state.ticketsSold.toNumber(), 0);
      assert.isTrue(state.isActive);
    });

    it("✓ Crea campaña en modo DONACIÓN LIBRE (ticket_price = 0)", async () => {
      await program.methods
        .initializeCampaign(
          DONATION_EVENT_ID,
          new BN(0),                                   // donación libre
          new BN(0.5 * LAMPORTS_PER_SOL),
          new BN(100),
          "Donación para causa benéfica",
          "Apoya este proyecto comunitario con lo que puedas."
        )
        .accounts({
          campaign:      donationCampaignPda,
          authority:     organizer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([organizer])
        .rpc();

      const state = await (program.account as any).campaignState.fetch(donationCampaignPda);
      assert.equal(state.ticketPrice.toNumber(), 0);
      assert.isTrue(state.isActive);
    });

    it("✗ Falla si event_id está vacío", async () => {
      const [pda] = findCampaignPda(program.programId, organizer.publicKey, "x");
      try {
        await program.methods
          .initializeCampaign("", new BN(0), new BN(1_000_000), new BN(10), "T", "D")
          .accounts({ campaign: pda, authority: organizer.publicKey, systemProgram: SystemProgram.programId })
          .signers([organizer])
          .rpc();
        assert.fail("Debió lanzar error");
      } catch (e: any) {
        expect(e.message).to.include("InvalidEventId");
      }
    });

    it("✗ Falla si funding_goal = 0", async () => {
      const [pda] = findCampaignPda(program.programId, organizer.publicKey, "bad-goal");
      try {
        await program.methods
          .initializeCampaign("bad-goal", new BN(0), new BN(0), new BN(10), "T", "D")
          .accounts({ campaign: pda, authority: organizer.publicKey, systemProgram: SystemProgram.programId })
          .signers([organizer])
          .rpc();
        assert.fail("Debió lanzar error");
      } catch (e: any) {
        expect(e.message).to.include("InvalidFundingGoal");
      }
    });

    it("✗ Falla si max_tickets = 0", async () => {
      const [pda] = findCampaignPda(program.programId, organizer.publicKey, "bad-tickets");
      try {
        await program.methods
          .initializeCampaign("bad-tickets", new BN(0), new BN(1_000_000), new BN(0), "T", "D")
          .accounts({ campaign: pda, authority: organizer.publicKey, systemProgram: SystemProgram.programId })
          .signers([organizer])
          .rpc();
        assert.fail("Debió lanzar error");
      } catch (e: any) {
        expect(e.message).to.include("InvalidMaxTickets");
      }
    });
  });

  // ================================================================
  //  BLOQUE 2 — SUPPORT CAMPAIGN (UPDATE)
  // ================================================================
  describe("2 · support_campaign", () => {

    it("✓ Supporter compra boleto con monto EXACTO en modo ticket", async () => {
      const beforeBalance = await getBalance(connection, organizer.publicKey);

      await program.methods
        .supportCampaign(new BN(TICKET_PRICE_SOL * LAMPORTS_PER_SOL))
        .accounts({
          campaign:      ticketCampaignPda,
          supporter:     supporter1.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([supporter1])
        .rpc();

      const state = await (program.account as any).campaignState.fetch(ticketCampaignPda);
      assert.equal(state.ticketsSold.toNumber(), 1);
      assert.equal(
        state.currentFunding.toNumber(),
        TICKET_PRICE_SOL * LAMPORTS_PER_SOL
      );
      // Los lamports deben estar en el PDA, no en la wallet del organizador
      const afterBalance = await getBalance(connection, organizer.publicKey);
      assert.equal(beforeBalance, afterBalance); // organizador no recibió nada aún
    });

    it("✓ Donación libre acepta cualquier monto positivo", async () => {
      const donationAmount = 0.05 * LAMPORTS_PER_SOL;

      await program.methods
        .supportCampaign(new BN(donationAmount))
        .accounts({
          campaign:      donationCampaignPda,
          supporter:     supporter1.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([supporter1])
        .rpc();

      const state = await (program.account as any).campaignState.fetch(donationCampaignPda);
      assert.equal(state.currentFunding.toNumber(), donationAmount);
      assert.equal(state.ticketsSold.toNumber(), 1);
    });

    it("✗ Falla si monto != ticket_price en modo ticket", async () => {
      const wrongAmount = new BN(0.05 * LAMPORTS_PER_SOL); // mitad del precio
      try {
        await program.methods
          .supportCampaign(wrongAmount)
          .accounts({
            campaign:      ticketCampaignPda,
            supporter:     supporter2.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([supporter2])
          .rpc();
        assert.fail("Debió lanzar IncorrectPaymentAmount");
      } catch (e: any) {
        expect(e.message).to.include("IncorrectPaymentAmount");
      }
    });

    it("✗ Falla si monto = 0 en modo donación", async () => {
      try {
        await program.methods
          .supportCampaign(new BN(0))
          .accounts({
            campaign:      donationCampaignPda,
            supporter:     supporter2.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([supporter2])
          .rpc();
        assert.fail("Debió lanzar AmountMustBePositive");
      } catch (e: any) {
        expect(e.message).to.include("AmountMustBePositive");
      }
    });

    it("✓ Auto-desactiva campaña al llegar a sold-out", async () => {
      // La campaña de ticket tiene MAX_TICKETS=5, ya vendimos 1. Vendemos 4 más.
      for (let i = 0; i < 4; i++) {
        await program.methods
          .supportCampaign(new BN(TICKET_PRICE_SOL * LAMPORTS_PER_SOL))
          .accounts({
            campaign:      ticketCampaignPda,
            supporter:     supporter1.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([supporter1])
          .rpc();
      }

      const state = await (program.account as any).campaignState.fetch(ticketCampaignPda);
      assert.equal(state.ticketsSold.toNumber(), MAX_TICKETS);
      assert.isFalse(state.isActive, "Campaña debe estar inactiva al llegar al máximo");
    });

    it("✗ Falla si la campaña ya está inactiva (sold out)", async () => {
      try {
        await program.methods
          .supportCampaign(new BN(TICKET_PRICE_SOL * LAMPORTS_PER_SOL))
          .accounts({
            campaign:      ticketCampaignPda,
            supporter:     supporter2.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([supporter2])
          .rpc();
        assert.fail("Debió lanzar CampaignInactive");
      } catch (e: any) {
        expect(e.message).to.include("CampaignInactive");
      }
    });
  });

  // ================================================================
  //  BLOQUE 3 — WITHDRAW FUNDS (UPDATE)
  // ================================================================
  describe("3 · withdraw_funds", () => {

    it("✗ Falla si alguien diferente al organizador intenta retirar", async () => {
      try {
        await program.methods
          .withdrawFunds()
          .accounts({
            campaign:  ticketCampaignPda,
            authority: stranger.publicKey,
          })
          .signers([stranger])
          .rpc();
        assert.fail("Debió lanzar UnauthorizedWithdrawal");
      } catch (e: any) {
        // Anchor lanza ConstraintHasOne cuando has_one falla
        expect(e.message).to.satisfy(
          (msg: string) =>
            msg.includes("UnauthorizedWithdrawal") ||
            msg.includes("ConstraintHasOne")
        );
      }
    });

    it("✓ Organizador retira fondos correctamente", async () => {
      const beforeBalance = await getBalance(connection, organizer.publicKey);
      const campaignBalance = await getBalance(connection, ticketCampaignPda);

      await program.methods
        .withdrawFunds()
        .accounts({
          campaign:  ticketCampaignPda,
          authority: organizer.publicKey,
        })
        .signers([organizer])
        .rpc();

      const afterBalance = await getBalance(connection, organizer.publicKey);

      // El organizador debe tener más lamports (menos fees de tx)
      assert.isAbove(afterBalance, beforeBalance);

      // El PDA debe conservar el mínimo de Rent
      const campaignAfter = await getBalance(connection, ticketCampaignPda);
      assert.isAbove(campaignAfter, 0, "PDA debe mantener el mínimo de Rent");
      assert.isBelow(
        campaignAfter,
        campaignBalance,
        "El PDA debe tener menos lamports que antes del retiro"
      );
    });

    it("✗ Falla si ya no hay fondos disponibles (solo Rent)", async () => {
      try {
        await program.methods
          .withdrawFunds()
          .accounts({
            campaign:  ticketCampaignPda,
            authority: organizer.publicKey,
          })
          .signers([organizer])
          .rpc();
        assert.fail("Debió lanzar NoFundsToWithdraw");
      } catch (e: any) {
        expect(e.message).to.include("NoFundsToWithdraw");
      }
    });
  });

  // ================================================================
  //  BLOQUE 4 — CLOSE CAMPAIGN (DELETE)
  // ================================================================
  describe("4 · close_campaign", () => {

    it("✗ Falla si alguien diferente al organizador intenta cerrar", async () => {
      try {
        await program.methods
          .closeCampaign()
          .accounts({
            campaign:  donationCampaignPda,
            authority: stranger.publicKey,
          })
          .signers([stranger])
          .rpc();
        assert.fail("Debió lanzar UnauthorizedClose");
      } catch (e: any) {
        expect(e.message).to.satisfy(
          (msg: string) =>
            msg.includes("UnauthorizedClose") || msg.includes("ConstraintHasOne")
        );
      }
    });

    it("✓ Organizador cierra campaña y recupera Rent", async () => {
      const beforeBalance = await getBalance(connection, organizer.publicKey);

      await program.methods
        .closeCampaign()
        .accounts({
          campaign:  donationCampaignPda,
          authority: organizer.publicKey,
        })
        .signers([organizer])
        .rpc();

      // La cuenta ya no debe existir en la blockchain
      const closedAccount = await connection.getAccountInfo(donationCampaignPda);
      assert.isNull(closedAccount, "La cuenta PDA debe haber sido destruida");

      // El organizador debe haber recibido el Rent de vuelta
      const afterBalance = await getBalance(connection, organizer.publicKey);
      assert.isAbove(afterBalance, beforeBalance);
    });

    it("✓ Cierra también la campaña de tickets (limpieza)", async () => {
      await program.methods
        .closeCampaign()
        .accounts({
          campaign:  ticketCampaignPda,
          authority: organizer.publicKey,
        })
        .signers([organizer])
        .rpc();

      const closedAccount = await connection.getAccountInfo(ticketCampaignPda);
      assert.isNull(closedAccount, "La cuenta PDA de ticket debe haberse destruido");
    });
  });

  // ================================================================
  //  BLOQUE 5 — LECTURA DE ESTADO (READ — off-chain)
  //  Demuestra cómo el frontend / Blink consulta el estado del PDA.
  // ================================================================
  describe("5 · read — consulta del estado (simulación frontend)", () => {
    const READ_EVENT_ID = "read-test-event";
    let readPda: PublicKey;

    before(async () => {
      [readPda] = findCampaignPda(program.programId, organizer.publicKey, READ_EVENT_ID);

      await program.methods
        .initializeCampaign(
          READ_EVENT_ID,
          new BN(0.2 * LAMPORTS_PER_SOL),
          new BN(1 * LAMPORTS_PER_SOL),
          new BN(5),
          "Evento de lectura",
          "Test de consulta de estado."
        )
        .accounts({
          campaign:      readPda,
          authority:     organizer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([organizer])
        .rpc();
    });

    it("✓ fetch() devuelve todos los campos del PDA correctamente", async () => {
      const state = await (program.account as any).campaignState.fetch(readPda);

      // Campos escalares
      assert.equal(state.eventId, READ_EVENT_ID);
      assert.equal(state.ticketPrice.toNumber(), 0.2 * LAMPORTS_PER_SOL);
      assert.equal(state.fundingGoal.toNumber(), 1 * LAMPORTS_PER_SOL);
      assert.equal(state.maxTickets.toNumber(), 5);
      assert.equal(state.currentFunding.toNumber(), 0);
      assert.equal(state.ticketsSold.toNumber(), 0);
      assert.isTrue(state.isActive);

      // El porcentaje de progreso se calcula en el cliente (útil para el Blink)
      const progressPct =
        (state.currentFunding.toNumber() / state.fundingGoal.toNumber()) * 100;
      assert.equal(progressPct, 0);
    });

    it("✓ Calcula correctamente el porcentaje de progreso tras un pago", async () => {
      await program.methods
        .supportCampaign(new BN(0.2 * LAMPORTS_PER_SOL))
        .accounts({
          campaign:      readPda,
          supporter:     supporter1.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([supporter1])
        .rpc();

      const state = await (program.account as any).campaignState.fetch(readPda);
      const progressPct =
        (state.currentFunding.toNumber() / state.fundingGoal.toNumber()) * 100;

      assert.equal(progressPct, 20, "Con 0.2 SOL de 1 SOL debe ser 20%");
    });

    after(async () => {
      // Limpiar PDA de test
      await program.methods
        .closeCampaign()
        .accounts({ campaign: readPda, authority: organizer.publicKey })
        .signers([organizer])
        .rpc();
    });
  });
});
