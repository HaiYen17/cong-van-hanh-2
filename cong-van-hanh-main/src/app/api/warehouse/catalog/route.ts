import { NextResponse } from "next/server";

import {
  assertWarehouseApiRequest,
  WarehouseApiAuthError,
} from "@/lib/warehouse/api-auth";
import { lookupWarehouseCatalog } from "@/lib/warehouse/mobile-catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message, message, ok: false },
    { status },
  );
}

export async function GET(request: Request) {
  try {
    await assertWarehouseApiRequest(request);
    const url = new URL(request.url);
    const data = await lookupWarehouseCatalog({
      barcode: url.searchParams.get("barcode"),
      limit: url.searchParams.get("limit"),
      page: url.searchParams.get("page"),
      query: url.searchParams.get("query"),
      sku: url.searchParams.get("sku"),
      updatedAfter: url.searchParams.get("updatedAfter"),
    });
    return NextResponse.json({
      action: "warehouseCatalogLookup",
      data,
      ok: true,
      ...data,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Không tra cứu được danh mục Kho.";
    const status = error instanceof WarehouseApiAuthError ? error.status : 400;
    return jsonError(message, status);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-API-Key",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Origin": "*",
    },
    status: 204,
  });
}
