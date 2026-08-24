import { NextResponse } from "next/server";
import { BN } from "@anchor-lang/core";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  findEventPda,
  getBaseUrl,
  getConnection,
  getProgram,
  getTreasuryPublicKey,
  toNumber,
} from "../../../../../lib/program";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Content-Encoding, Accept-Encoding, ngrok-skip-browser-warning",
  "X-Action-Version": "2.1.3",
  "X-Blockchain-Ids": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
};

interface RouteParams {
  params: { id: string };
}

export const OPTIONS = async () =>
  new Response(null, { headers: HEADERS });

export async function GET(req: Request, { params }: RouteParams) {
  const parsed = parseId(params.id);

  if (parsed.error || !parsed.authority || !parsed.eventId) {
    return new Response("ID invalido", {
      status: 400,
      headers: HEADERS,
    });
  }

  const [pda] = findEventPda(
    parsed.authority,
    parsed.eventId
  );

  const program = getProgram();
  const baseUrl = getBaseUrl(req);

  try {
    const state =
      await (program.account as any).campaignState.fetch(pda)

    const ticketPriceSol =
      toNumber(state.ticketPrice) / LAMPORTS_PER_SOL;

    const maxTickets = toNumber(state.maxTickets);
    const ticketsSold = toNumber(state.ticketsSold);

    const soldOut = ticketsSold >= maxTickets;
    const isActive = state.isActive && !soldOut;

    return NextResponse.json(
      {
        type: "action",
        icon: `${baseUrl}/api/actions/event/${params.id}/image`,
        title: `CrowdBlinks: ${state.eventId}`,
        description:
          `Boleto on-chain para ${state.eventId}.\n\n` +
          `Precio: ${ticketPriceSol} SOL\n` +
          `Boletos: ${ticketsSold} / ${maxTickets}`,
        label: isActive
          ? `Comprar boleto - ${ticketPriceSol} SOL`
          : "Sold out",
        disabled: !isActive,
        error: !isActive
          ? {
              message:
                "Este evento ya no esta activo o hizo sold out.",
            }
          : undefined,
        links: {
          actions: buildActions(
            isActive,
            ticketPriceSol,
            params.id,
            baseUrl
          ),
        },
      },
      { headers: HEADERS }
    );
  } catch (err) {
    console.error("[CrowdBlinks GET]", err);

    return NextResponse.json(
      {
        type: "action",
        icon: `${baseUrl}/api/actions/event/${params.id}/image`,
        title: "CrowdBlinks",
        description:
          "No se encontro este evento en la blockchain.",
        label: "Evento no disponible",
        disabled: true,
        error: {
          message: "Evento no encontrado en Solana.",
        },
      },
      {
        status: 200,
        headers: HEADERS,
      }
    );
  }
}

export async function POST(
  req: Request,
  { params }: RouteParams
) {
  const parsed = parseId(params.id);

  if (parsed.error || !parsed.authority || !parsed.eventId) {
    return NextResponse.json(
      {
        message: "ID de evento invalido.",
      },
      {
        status: 400,
        headers: HEADERS,
      }
    );
  }

  let supporterPubkey: PublicKey;

  try {
    const body = await req.json();

    supporterPubkey = new PublicKey(body.account);
  } catch {
    return NextResponse.json(
      {
        message:
          "Body invalido. Se requiere { account: '<pubkey>' }",
      },
      {
        status: 400,
        headers: HEADERS,
      }
    );
  }

  try {
    const [pda] = findEventPda(
      parsed.authority,
      parsed.eventId
    );

    const program = getProgram();
    const connection = getConnection();
    const treasury = getTreasuryPublicKey();

    const state =
      await (program.account as any).campaignState.fetch(pda)

    if (!state.isActive) {
      return NextResponse.json(
        {
          message: "Este evento ya no esta activo.",
        },
        {
          status: 400,
          headers: HEADERS,
        }
      );
    }

    if (
      toNumber(state.ticketsSold) >=
      toNumber(state.maxTickets)
    ) {
      return NextResponse.json(
        {
          message:
            "Sold out: todos los boletos han sido vendidos.",
        },
        {
          status: 400,
          headers: HEADERS,
        }
      );
    }

    const amountLamports = state.ticketPrice as BN;

    const instruction = await program.methods
      .supportCampaign(amountLamports)
      .accounts({
        campaign: pda,
        supporter: supporterPubkey,
        authority: parsed.authority,
        treasury,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const {
      blockhash,
      lastValidBlockHeight,
    } =
      await connection.getLatestBlockhash("confirmed");

    const messageV0 = new TransactionMessage({
      payerKey: supporterPubkey,
      recentBlockhash: blockhash,
      instructions: [instruction],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);

    const serializedTx = Buffer.from(
      transaction.serialize()
    ).toString("base64");

    const baseUrl = getBaseUrl(req);

    const successMessage =
      `Boleto comprado para ${state.eventId}. ` +
      `Tu entrada quedo registrada on-chain.`;

    return NextResponse.json(
      {
        transaction: serializedTx,
        lastValidBlockHeight,
        message: successMessage,
        links: {
          next: {
            type: "inline",
            action: {
              type: "completed",
              icon:
                `${baseUrl}/api/actions/event/` +
                `${params.id}/image`,
              title: "Boleto confirmado",
              description: successMessage,
              label: "Ver en Explorer",
            },
          },
        },
      },
      {
        headers: HEADERS,
      }
    );
  } catch (err) {
    console.error("[CrowdBlinks POST]", err);

    return NextResponse.json(
      {
        message:
          "Error al construir la transaccion. " +
          "Intenta de nuevo.",
      },
      {
        status: 500,
        headers: HEADERS,
      }
    );
  }
}

function parseId(id: string): {
  authority?: PublicKey;
  eventId?: string;
  error?: string;
} {
  try {
    const decodedId = decodeURIComponent(id);

    const firstUnderscore =
      decodedId.indexOf("_");

    if (firstUnderscore === -1) {
      return { error: "Formato invalido" };
    }

    const authorityStr =
      decodedId
        .slice(0, firstUnderscore)
        .trim();

    const eventId =
      decodedId
        .slice(firstUnderscore + 1)
        .trim();

    if (!authorityStr || !eventId) {
      return { error: "Campos vacios" };
    }

    return {
      authority: new PublicKey(authorityStr),
      eventId,
    };
  } catch {
    return { error: "Pubkey invalida" };
  }
}

function buildActions(
  isActive: boolean,
  ticketPriceSol: number,
  id: string,
  baseUrl: string
) {
  if (!isActive) {
    return [
      {
        type: "external-link",
        label: "Ver en Explorer",
        href:
          `https://explorer.solana.com/address/` +
          `${id.split("_")[0]}?cluster=devnet`,
      },
    ];
  }

  return [
    {
      type: "transaction",
      label:
        `Comprar boleto - ${ticketPriceSol} SOL`,
      href:
        `${baseUrl}/api/actions/event/${id}`,
    },
  ];
}
