import { GoogleAuth } from "google-auth-library";
import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth/session";

const ALLOWED_SHEETS = new Set([
  "1hx2CsL5ebZZSWkH4n_RVNulGYWtsVG57ZmMX8ELmT_g",
  "1Yai8tDO_TTZ034rAGdTBKFL7Pkr9RzbObPnRbFw6LcY",
]);

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.fullAccess) {
    return NextResponse.json({ error: "Không có quyền." }, { status: 403 });
  }

  const spreadsheetId = new URL(request.url).searchParams.get("id") || "";
  if (!ALLOWED_SHEETS.has(spreadsheetId)) {
    return NextResponse.json(
      { error: "Spreadsheet không nằm trong danh sách kiểm tra." },
      { status: 400 },
    );
  }

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const accessToken = await auth.getAccessToken();
  if (!accessToken) {
    return NextResponse.json(
      { error: "Cloud Run không lấy được access token." },
      { status: 503 },
    );
  }

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))`,
    {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  const payload = await response.json();
  if (!response.ok) {
    return NextResponse.json(
      {
        error: payload?.error?.message || "Không đọc được Google Sheet.",
        serviceAccount:
          "cong-van-hanh-web@tvg-ops-dev.iam.gserviceaccount.com",
        status: response.status,
      },
      { status: response.status },
    );
  }

  return NextResponse.json({
    serviceAccount: "cong-van-hanh-web@tvg-ops-dev.iam.gserviceaccount.com",
    spreadsheetId,
    title: payload.properties?.title || "",
    sheets: (payload.sheets || []).map(
      (sheet: {
        properties?: {
          gridProperties?: { columnCount?: number; rowCount?: number };
          sheetId?: number;
          title?: string;
        };
      }) => ({
        columnCount: sheet.properties?.gridProperties?.columnCount || 0,
        rowCount: sheet.properties?.gridProperties?.rowCount || 0,
        sheetId: sheet.properties?.sheetId,
        title: sheet.properties?.title || "",
      }),
    ),
  });
}
