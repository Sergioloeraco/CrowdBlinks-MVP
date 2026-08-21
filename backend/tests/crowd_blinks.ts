import * as anchor from "@anchor-lang/core";
import { BN, Program } from "@anchor-lang/core";
import {
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

// The generated Anchor types file is not present in this repo, so fall back to the
// generic IDL type while keeping the program wiring intact.
type CrowdPass = anchor.Idl;
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

function findEventPda(
  programId: PublicKey,
  authority: PublicKey,
  eventId: string
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("event"),
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
  return connection.getBalance(pubkey, "processed");
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
  const UNAUTHORIZED_CLOSE_EVENT_ID = "unauthorized-close-event";

  const TICKET_PRICE = new BN(0.1 * LAMPORTS_PER_SOL);
  const MAX_TICKETS = 2;

  let eventPda: PublicKey;
  let closeEventPda: PublicKey;
  let unauthorizedCloseEventPda: PublicKey;

  before(async () => {
    await Promise.all([
      airdrop(connection, organizer.publicKey, 5),
      airdrop(connection, supporter1.publicKey, 2),
      airdrop(connection, supporter2.publicKey, 2),
      airdrop(connection, stranger.publicKey, 1),
    ]);

    [eventPda] = findEventPda(
      program.programId,
      organizer.publicKey,
      EVENT_ID
    );

    [closeEventPda] = findEventPda(
      program.programId,
      organizer.publicKey,
      CLOSE_EVENT_ID
    );

    [unauthorizedCloseEventPda] = findEventPda(
      program.programId,
      organizer.publicKey,
      UNAUTHORIZED_CLOSE_EVENT_ID
    );
  });

  it("creates an event with ticketing state", async () => {
    await program.methods
      .initializeEvent(EVENT_ID, TICKET_PRICE, MAX_TICKETS)
      .accounts({
        authority: organizer.publicKey,
      })
      .signers([organizer])
      .rpc();

    const state =
      await (program.account as any).eventState.fetch(eventPda);

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
    try {
      await program.methods
        .initializeEvent("bad-event", new BN(0), 1)
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

    const supporterBefore = await getBalance(
      connection,
      supporter1.publicKey
    );

    const price = TICKET_PRICE.toNumber();

    const fee = Math.floor(
      (price * 100) / 10_000
    );

    const organizerAmount = price - fee;

    console.log("DEBUG payment before", {
      organizerBefore,
      treasuryBefore,
      supporterBefore,
      price,
      fee,
      organizerAmount,
    });

    await program.methods
      .buyTicket(TICKET_PRICE)
      .accounts({
        event: eventPda,
        buyer: supporter1.publicKey,
        authority: organizer.publicKey,
        treasury,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
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

    const supporterAfter = await getBalance(
      connection,
      supporter1.publicKey
    );

    console.log("DEBUG payment after", {
      organizerAfter,
      treasuryAfter,
      supporterAfter,
      organizerDelta:
        organizerAfter - organizerBefore,
      treasuryDelta:
        treasuryAfter - treasuryBefore,
      supporterDelta:
        supporterAfter - supporterBefore,
    });

    const state =
      await (program.account as any).eventState.fetch(eventPda);

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
        .buyTicket(
          new BN(0.05 * LAMPORTS_PER_SOL)
        )
        .accounts({
          event: eventPda,
          buyer: supporter2.publicKey,
          authority: organizer.publicKey,
          treasury,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .signers([supporter2])
        .rpc();

      assert.fail(
        "expected IncorrectPaymentAmount"
      );
    } catch (err: any) {
      assert.ok(
        err.message.includes("IncorrectPaymentAmount")
      );
    }

    try {
      await program.methods
        .buyTicket(TICKET_PRICE)
        .accounts({
          event: eventPda,
          buyer: supporter2.publicKey,
          authority: organizer.publicKey,
          treasury: wrongTreasury.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
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
      .buyTicket(TICKET_PRICE)
      .accounts({
        event: eventPda,
        buyer: supporter2.publicKey,
        authority: organizer.publicKey,
        treasury,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([supporter2])
      .rpc();

    const soldOutState =
      await (program.account as any).eventState.fetch(
        eventPda
      );

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
        .buyTicket(TICKET_PRICE)
        .accounts({
          event: eventPda,
          buyer: supporter1.publicKey,
          authority: organizer.publicKey,
          treasury,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .signers([supporter1])
        .rpc();

      assert.fail("expected EventInactive");
    } catch (err: any) {
      assert.ok(
        err.message.includes("EventInactive")
      );
    }
  });

  it("closes an event and recovers rent for the organizer", async () => {
    const organizerBeforeInitialize =
      await getBalance(
        connection,
        organizer.publicKey
      );

    await program.methods
      .initializeEvent(
        CLOSE_EVENT_ID,
        TICKET_PRICE,
        1
      )
      .accounts({
        authority: organizer.publicKey,
      })
      .signers([organizer])
      .rpc();

    const closePdaBeforeClose =
      await connection.getAccountInfo(
        closeEventPda
      );

    const organizerBefore =
      await getBalance(
        connection,
        organizer.publicKey
      );

    assert.ok(closePdaBeforeClose);
    assert.ok(
      closePdaBeforeClose.lamports > 0
    );

    console.log("DEBUG close before", {
      organizerBeforeInitialize,
      organizerBefore,
      closePdaLamports:
        closePdaBeforeClose.lamports,
    });

    const closeSig =
      await program.methods
        .closeEvent()
        .accounts({
          event: closeEventPda,
          authority: organizer.publicKey,
        } as any)
        .signers([organizer])
        .rpc();

    const organizerAfter =
      await getBalance(
        connection,
        organizer.publicKey
      );

    const closedAccount =
      await connection.getAccountInfo(
        closeEventPda
      );

    const closeTx =
      await connection.getTransaction(
        closeSig,
        {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        }
      );

    const closeTxFee =
      closeTx?.meta?.fee ?? 0;

    const organizerDelta =
      organizerAfter - organizerBefore;

    console.log("DEBUG close after", {
      organizerAfter,
      organizerDelta,
      closedAccount: !!closedAccount,
      closeTxFee,
    });

    assert.equal(
      closedAccount,
      null
    );

    assert.ok(
      organizerDelta > 0,
      `Expected organizer to recover rent, delta=${organizerDelta}`
    );
  });

  it("rejects close attempts from non-authority wallets", async () => {
    await program.methods
      .initializeEvent(
        UNAUTHORIZED_CLOSE_EVENT_ID,
        TICKET_PRICE,
        1
      )
      .accounts({
        authority: organizer.publicKey,
      })
      .signers([organizer])
      .rpc();

    const accountBefore =
      await connection.getAccountInfo(
        unauthorizedCloseEventPda
      );

    assert.ok(
      accountBefore,
      "Unauthorized-close event should exist before the attack"
    );

    try {
      await program.methods
        .closeEvent()
        .accounts({
          event: unauthorizedCloseEventPda,
          authority: stranger.publicKey,
        } as any)
        .signers([stranger])
        .rpc();

      assert.fail(
        "expected close constraint failure"
      );
    } catch (err: any) {
      const errorCode =
        err?.error?.errorCode?.code;

      const errorMessage =
        err?.error?.errorMessage ??
        err?.message ??
        "";

      console.log(
        "DEBUG unauthorized close",
        {
          errorCode,
          errorMessage,
        }
      );

      assert.ok(
        errorCode === "ConstraintHasOne" ||
        errorCode === "ConstraintSeeds" ||
        errorMessage.includes("ConstraintHasOne") ||
        errorMessage.includes("ConstraintSeeds"),
        `Unexpected error: ${errorMessage}`
      );
    }

    const accountAfter =
      await connection.getAccountInfo(
        unauthorizedCloseEventPda
      );

    assert.ok(
      accountAfter,
      "Event must remain initialized after unauthorized close attempt"
    );
  });
});