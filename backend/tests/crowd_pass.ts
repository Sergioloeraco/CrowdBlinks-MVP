import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import assert from "assert";

// Debe coincidir EXACTO con TREASURY_PUBKEY en lib.rs
const TREASURY_PUBKEY = new PublicKey(
  "7fHsf7Ggr6RNuxFV7zLTrs6yXMdboLJDtBroHefe1PcP"
);

describe("CrowdBlinks MVP", () => {
  // event_id único por corrida para no chocar con el PDA de una prueba anterior
  const eventId = `mvp-test-${Date.now().toString().slice(-8)}`;
  const ticketPriceLamports = 0.005 * LAMPORTS_PER_SOL; // igual al micro-pago del piloto
  const maxTickets = 3;

  const [campaignPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("campaign"),
      pg.wallet.publicKey.toBuffer(),
      Buffer.from(eventId),
    ],
    pg.program.programId
  );

  // Este sandbox de tests no expone setTimeout, así que en vez de "dormir"
  // reintentamos la lectura real varias veces; cada intento de red ya tarda
  // lo suyo y eso nos da el margen que antes buscábamos con sleep().
  // No solo reintenta si el fetch falla (cuenta aún no visible) — también
  // reintenta si el fetch tiene éxito pero trae un valor viejo (stale read
  // de un nodo del RPC público que no alcanzó a ver la última escritura).
  async function fetchCampaignUntil(
    pda: PublicKey,
    predicate: (c: any) => boolean,
    attempts = 10
  ) {
    let last: any;
    for (let i = 0; i < attempts; i++) {
      try {
        last = await pg.program.account.campaignState.fetch(pda);
        if (predicate(last)) return last;
      } catch (err) {
        // cuenta aún no visible en este nodo, seguimos intentando
      }
      await pg.connection.getLatestBlockhash().catch(() => {});
    }
    return last; // devolvemos el último estado visto para que el assert falle con info útil
  }

  async function waitUntilAccountClosed(pda: PublicKey, attempts = 8) {
    for (let i = 0; i < attempts; i++) {
      try {
        await pg.program.account.campaignState.fetch(pda);
        await pg.connection.getLatestBlockhash().catch(() => {});
      } catch (err) {
        return true; // ya no existe
      }
    }
    return false;
  }

  // pg.provider no existe directo; el provider de Anchor cuelga de pg.program.
  async function fundWallet(pubkey: PublicKey, sol: number) {
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: pg.wallet.publicKey,
        toPubkey: pubkey,
        lamports: sol * LAMPORTS_PER_SOL,
      })
    );
    await pg.program.provider.sendAndConfirm(tx);
  }

  // La cuenta de tesorería arranca en 0 SOL. Solana no permite que una cuenta
  // termine una tx con un balance positivo pero por debajo del mínimo
  // rent-exempt (~0.00089 SOL) — y el 1% de fee (50,000 lamports) no alcanza.
  // La "activamos" una sola vez antes de que le lleguen fees pequeños.
  before(async () => {
    await fundWallet(TREASURY_PUBKEY, 0.002);
  });

  it("crea el evento (initialize_campaign)", async () => {
    const txHash = await pg.program.methods
      .initializeCampaign(
        eventId,
        new anchor.BN(ticketPriceLamports),
        maxTickets
      )
      .accounts({
        campaign: campaignPda,
        authority: pg.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`initialize_campaign tx: ${txHash}`);

    const campaign = await fetchCampaignUntil(
      campaignPda,
      (c) => c.eventId === eventId
    );
    assert.strictEqual(campaign.eventId, eventId);
    assert.strictEqual(campaign.ticketPrice.toNumber(), ticketPriceLamports);
    assert.strictEqual(campaign.maxTickets, maxTickets);
    assert.strictEqual(campaign.ticketsSold, 0);
    assert.strictEqual(campaign.isActive, true);
  });

  it("compra un boleto y reparte el fee 1% (support_campaign)", async () => {
    const supporter = Keypair.generate();
    await fundWallet(supporter.publicKey, 0.02);

    const organizerBefore = await pg.connection.getBalance(pg.wallet.publicKey);
    const treasuryBefore = await pg.connection.getBalance(TREASURY_PUBKEY);

    const txHash = await pg.program.methods
      .supportCampaign(new anchor.BN(ticketPriceLamports))
      .accounts({
        campaign: campaignPda,
        supporter: supporter.publicKey,
        authority: pg.wallet.publicKey,
        treasury: TREASURY_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .signers([supporter])
      .rpc();

    console.log(`support_campaign tx: ${txHash}`);

    const campaign = await fetchCampaignUntil(
      campaignPda,
      (c) => c.ticketsSold === 1
    );
    assert.strictEqual(campaign.ticketsSold, 1);

    const organizerAfter = await pg.connection.getBalance(pg.wallet.publicKey);
    const treasuryAfter = await pg.connection.getBalance(TREASURY_PUBKEY);

    const feeExpected = Math.floor((ticketPriceLamports * 100) / 10_000); // 1%
    const organizerExpected = ticketPriceLamports - feeExpected;

    // Margen por el fee de red que tu wallet paga como fee-payer de esta tx.
    assert.strictEqual(treasuryAfter - treasuryBefore, feeExpected);
    assert.ok(organizerAfter - organizerBefore >= organizerExpected - 10_000);
  });

  it("agota el cupo y desactiva el evento automáticamente", async () => {
    // Ya vendimos 1 de 3 boletos en la prueba anterior; compramos 2 más
    for (let i = 0; i < maxTickets - 1; i++) {
      const supporter = Keypair.generate();
      await fundWallet(supporter.publicKey, 0.02);

      await pg.program.methods
        .supportCampaign(new anchor.BN(ticketPriceLamports))
        .accounts({
          campaign: campaignPda,
          supporter: supporter.publicKey,
          authority: pg.wallet.publicKey,
          treasury: TREASURY_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .signers([supporter])
        .rpc();
    }

    const campaign = await fetchCampaignUntil(
      campaignPda,
      (c) => c.ticketsSold === maxTickets
    );
    assert.strictEqual(campaign.ticketsSold, maxTickets);
    assert.strictEqual(campaign.isActive, false);
  });

  it("rechaza una compra una vez agotado el cupo", async () => {
    const supporter = Keypair.generate();
    await fundWallet(supporter.publicKey, 0.02);

    let failed = false;
    try {
      await pg.program.methods
        .supportCampaign(new anchor.BN(ticketPriceLamports))
        .accounts({
          campaign: campaignPda,
          supporter: supporter.publicKey,
          authority: pg.wallet.publicKey,
          treasury: TREASURY_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .signers([supporter])
        .rpc();
    } catch (err) {
      failed = true;
    }
    assert.ok(failed, "la compra debió fallar: evento inactivo / sold out");
  });

  it("cierra el evento y recupera el rent (close_campaign)", async () => {
    await pg.program.methods
      .closeCampaign()
      .accounts({
        campaign: campaignPda,
        authority: pg.wallet.publicKey,
      })
      .rpc();

    const closed = await waitUntilAccountClosed(campaignPda);
    assert.ok(closed, "la cuenta campaign debió cerrarse");
  });
});
