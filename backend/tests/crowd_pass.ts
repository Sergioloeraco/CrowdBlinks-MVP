import * as anchor from "@anchor-lang/core";
import { BN, Program } from "@anchor-lang/core";
import { CrowdPass } from "../target/types/crowd_pass";
import {
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import assert from "assert";

async function airdrop(
  connection: anchor.web3.Connection,
  pubkey: PublicKey,
  sol: number = 2
): Promise<void> {
  const sig = await connection.requestAirdrop(
    pubkey,
    sol * LAMPORTS_PER_SOL
  );

  await connection.confirmTransaction(sig, "confirmed");
}

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

async function getBalance(
  connection: anchor.web3.Connection,
  pubkey: PublicKey
): Promise<number> {
  return connection.getBalance(pubkey, "confirmed");
}

describe("CrowdBlinks ticketing contract", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CrowdPass as Program<CrowdPass>;
  const connection = provider.connection;

  const organizer = Keypair.generate();

  const treasury = new PublicKey(
    "5Ef7KDsuTB5XzHPJ3D9aX2R4seobdC5ADJb98brrCEm6"
  );

  const wrongTreasury = Keypair.generate();
  const supporter1 = Keypair.generate();
  const supporter2 = Keypair.generate();
  const stranger = Keypair.generate();

  const EVENT_ID = "ticket-event";
  const CLOSE_EVENT_ID = "close-event";

  const TICKET_PRICE = new BN(0.1 * LAMPORTS_PER_SOL);
  const MAX_TICKETS = 2;

  let eventPda: PublicKey;
  let closeEventPda: PublicKey;

  before(async () => {
    await Promise.all([
      airdrop(connection, organizer.publicKey, 5),
      airdrop(connection, supporter1.publicKey, 2),
      airdrop(connection, supporter2.publicKey, 2),
      airdrop(connection, stranger.publicKey, 1),
    ]);

    [eventPda] = findCampaignPda(
      program.programId,
      organizer.publicKey,
      EVENT_ID
    );

    [closeEventPda] = findCampaignPda(
      program.programId,
      organizer.publicKey,
      CLOSE_EVENT_ID
    );
  });

  it("creates an event with ticketing state", async () => {
    await program.methods
      .initializeCampaign(EVENT_ID, TICKET_PRICE, MAX_TICKETS)
      .accounts({
        authority: organizer.publicKey,
      })
      .signers([organizer])
      .rpc();

    const state =
      await program.account.campaignState.fetch(eventPda);

    assert.equal(
      state.authority.toBase58(),
      organizer.publicKey.toBase58()
    );

    assert.equal(state.eventId, EVENT_ID);
    assert.equal(
      state.ticketPrice.toNumber(),
      TICKET_PRICE.toNumber()
    );
    assert.equal(state.maxTickets, MAX_TICKETS);
    assert.equal(state.ticketsSold, 0);
    assert.equal(state.isActive, true);
  });

  it("rejects invalid event setup", async () => {
    const [pda] = findCampaignPda(
      program.programId,
      organizer.publicKey,
      "bad-event"
    );

    try {
      await program.methods
        .initializeCampaign("bad-event", new BN(0), 1)
        .accounts({
          authority: organizer.publicKey,
        })
        .signers([organizer])
        .rpc();

      assert.fail("expected InvalidTicketPrice");
    } catch (err: any) {
      assert.ok(
        err.message.includes("InvalidTicketPrice")
      );
    }
  });

  it("splits ticket payment instantly: 99% organizer and 1% treasury", async () => {
    const organizerBefore = await getBalance(
      connection,
      organizer.publicKey
    );

    const treasuryBefore = await getBalance(
      connection,
      treasury
    );

    const price = TICKET_PRICE.toNumber();

    const fee = Math.floor(
      (price * 100) / 10_000
    );

    const organizerAmount = price - fee;

    await program.methods
      .supportCampaign(TICKET_PRICE)
      .accounts({
        supporter: supporter1.publicKey,
        treasury,
      })
      .signers([supporter1])
      .rpc();

    const organizerAfter = await getBalance(
      connection,
      organizer.publicKey
    );

    const treasuryAfter = await getBalance(
      connection,
      treasury
    );

    const state =
      await program.account.campaignState.fetch(eventPda);

    assert.equal(
      organizerAfter - organizerBefore,
      organizerAmount
    );

    assert.equal(
      treasuryAfter - treasuryBefore,
      fee
    );

    assert.equal(state.ticketsSold, 1);
    assert.equal(state.isActive, true);
  });

  it("rejects wrong ticket amount and wrong treasury account", async () => {
    try {
      await program.methods
        .supportCampaign(
          new BN(0.05 * LAMPORTS_PER_SOL)
        )
        .accounts({
          supporter: supporter2.publicKey,
          treasury,
        })
        .signers([supporter2])
        .rpc();

      assert.fail("expected IncorrectPaymentAmount");
    } catch (err: any) {
      assert.ok(
        err.message.includes("IncorrectPaymentAmount")
      );
    }

    try {
      await program.methods
        .supportCampaign(TICKET_PRICE)
        .accounts({
          supporter: supporter2.publicKey,
          treasury: wrongTreasury.publicKey,
        })
        .signers([supporter2])
        .rpc();

      assert.fail("expected InvalidTreasury");
    } catch (err: any) {
      assert.ok(
        err.message.includes("InvalidTreasury")
      );
    }
  });

  it("sells out at max capacity and blocks further purchases", async () => {
    await program.methods
      .supportCampaign(TICKET_PRICE)
      .accounts({
        supporter: supporter2.publicKey,
        treasury,
      })
      .signers([supporter2])
      .rpc();

    const soldOutState =
      await program.account.campaignState.fetch(eventPda);

    assert.equal(
      soldOutState.ticketsSold,
      MAX_TICKETS
    );

    assert.equal(
      soldOutState.isActive,
      false
    );

    try {
      await program.methods
        .supportCampaign(TICKET_PRICE)
        .accounts({
          supporter: supporter1.publicKey,
          treasury,
        })
        .signers([supporter1])
        .rpc();

      assert.fail("expected CampaignInactive");
    } catch (err: any) {
      assert.ok(
        err.message.includes("CampaignInactive")
      );
    }
  });

  it("closes an event and recovers rent for the organizer", async () => {
    await program.methods
      .initializeCampaign(
        CLOSE_EVENT_ID,
        TICKET_PRICE,
        1
      )
      .accounts({
        authority: organizer.publicKey,
      })
      .signers([organizer])
      .rpc();

    const organizerBefore = await getBalance(
      connection,
      organizer.publicKey
    );

    await program.methods
      .closeCampaign()
      .accounts({})
      .signers([organizer])
      .rpc();

    const organizerAfter = await getBalance(
      connection,
      organizer.publicKey
    );

    const closedAccount =
      await connection.getAccountInfo(closeEventPda);

    assert.equal(closedAccount, null);
    assert.ok(
      organizerAfter > organizerBefore
    );
  });

  it("rejects close attempts from non-authority wallets", async () => {
    try {
      await program.methods
        .closeCampaign()
        .accounts({})
        .signers([stranger])
        .rpc();

      assert.fail(
        "expected close constraint failure"
      );
    } catch (err: any) {
      assert.ok(
        err.message.includes("ConstraintSeeds") ||
        err.message.includes("ConstraintHasOne") ||
        err.message.includes("unknown signer") ||
        err.message.includes("Signature verification failed")
      );
    }
  });
});
