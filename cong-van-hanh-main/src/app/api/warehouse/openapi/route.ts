import { NextResponse } from "next/server";

import { warehouseApiContract } from "@/lib/warehouse/api-contract";
import { extendShelfOpenApi } from "@/lib/warehouse/shelf-core/openapi.mjs";

export const dynamic = "force-static";

export function GET() {
  const contract = extendShelfOpenApi(warehouseApiContract);
  contract.info.version = "2026-09-05";
  return NextResponse.json(contract, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
