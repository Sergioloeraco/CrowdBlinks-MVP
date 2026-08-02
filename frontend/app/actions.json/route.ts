// ================================================================
//  CrowdPass — actions.json
//  /frontend/app/actions.json/route.ts
//
//  Archivo obligatorio en el dominio raíz para que los clientes
//  Blink (wallets, extensiones) resuelvan las Actions de CrowdPass.
//  Debe responder con Access-Control-Allow-Origin: * (CORS abierto).
//
//  Spec: https://solana.com/developers/guides/advanced/actions
// ================================================================

import { NextResponse } from "next/server";

// Cabeceras CORS requeridas por la especificación de Solana Actions
const ACTIONS_CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function GET() {
  return NextResponse.json(
    {
      rules: [
        {
          // Mapea cualquier ruta /campaign/* al endpoint de la Action
          pathPattern: "/campaign/*",
          apiPath:     "/api/actions/campaign/*",
        },
        {
          // Idempotent rule: el endpoint se auto-identifica como Action
          pathPattern: "/api/actions/campaign/**",
          apiPath:     "/api/actions/campaign/**",
        },
      ],
    },
    { headers: ACTIONS_CORS_HEADERS }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: ACTIONS_CORS_HEADERS,
  });
}