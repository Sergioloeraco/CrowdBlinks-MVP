// ================================================================
//  CrowdBlinks — actions.json
//  /frontend/app/actions.json/route.ts
//
//  Archivo para que clientes Blink resuelvan las Actions de CrowdBlinks.
//  Las reglas mantienen el mapeo dinámico de eventos y además
//  permiten que los endpoints /api/actions/** se auto-identifiquen.
// ================================================================

import { NextResponse } from "next/server";

const ACTIONS_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function GET() {
  return NextResponse.json(
    {
      rules: [
        {
          pathPattern: "/event/*",
          apiPath: "/api/actions/event/*",
        },
        {
          pathPattern: "/api/actions/event/**",
          apiPath: "/api/actions/event/**",
        },
        {
          pathPattern: "/api/actions/**",
          apiPath: "/api/actions/**",
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
