import "dotenv/config";

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

const SOURCE_KEY = "google-sheet-18-mail-orders";
const DEFAULT_SPREADSHEET_ID =
  "1_aDstrpRuxLuaEKHTuuWuL3ybyBvCPVcyFMouQxVjyg";

type SourceRow = Record<string, unknown> & { __rowNumber: number };

function options() {
  return new Map(
    process.argv.slice(2).map((argument) => {
      const normalized = argument.replace(/^--/, "");
      const separator = normalized.indexOf("=");
      return separator < 0
        ? [normalized, "true"]
        : [normalized.slice(0, separator), normalized.slice(separator + 1)];
    }),
  );
}

function text(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  return String(value ?? "").trim();
}

function integer(value: unknown, fallback: number | null = null) {
  const normalized = text(value).replace(/[^\d-]/g, "");
  if (!normalized) return fallback;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function date(value: unknown) {
  const normalized = text(value);
  const dayFirst = normalized.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (dayFirst) {
    return new Date(
      Number(dayFirst[3]),
      Number(dayFirst[2]) - 1,
      Number(dayFirst[1]),
      Number(dayFirst[4] || 0),
      Number(dayFirst[5] || 0),
      Number(dayFirst[6] || 0),
    );
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function jsonObject(value: unknown): Record<string, unknown> {
  const normalized = text(value);
  if (!normalized) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(normalized);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { legacyValue: parsed };
  } catch {
    return { legacyText: normalized };
  }
}

function asJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

async function googleRows(spreadsheetId: string) {
  const token = text(process.env.GOOGLE_ACCESS_TOKEN);
  if (!token) throw new Error("Thiếu GOOGLE_ACCESS_TOKEN chỉ đọc Google Sheets.");
  const headers = { Authorization: `Bearer ${token}` };
  const metadataResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
    { headers },
  );
  if (!metadataResponse.ok) {
    throw new Error(`Không đọc được metadata (${metadataResponse.status}).`);
  }
  const metadata = await metadataResponse.json();
  const sheetName = (metadata.sheets || [])
    .map((item: { properties?: { title?: string } }) => item.properties?.title)
    .find((title: string | undefined) => title?.startsWith("18_"));
  if (!sheetName) throw new Error("Không tìm thấy sheet 18_Gửi thư.");
  const range = `'${sheetName.replaceAll("'", "''")}'!A1:AZ`;
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
  );
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
  url.searchParams.set("dateTimeRenderOption", "FORMATTED_STRING");
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Không đọc được sheet ${sheetName} (${response.status}).`);
  }
  const payload = await response.json();
  const values = Array.isArray(payload.values) ? payload.values : [];
  const columnNames = (values[0] || []).map(text);
  const rows: SourceRow[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const source = values[index] || [];
    if (!source.some((value: unknown) => text(value))) continue;
    const row = Object.fromEntries(
      columnNames.map((header: string, column: number) => [header, source[column] ?? ""]),
    ) as SourceRow;
    row.__rowNumber = index + 1;
    if (text(row["Record Type"]) === "viettel-post-order") rows.push(row);
  }
  return { rows, sheetName };
}

async function main() {
  const args = options();
  const mode = text(args.get("mode") || "preview").toLowerCase();
  if (!new Set(["preview", "apply"]).has(mode)) {
    throw new Error("--mode chỉ nhận preview hoặc apply.");
  }
  if (mode === "apply" && args.get("confirm-apply") !== "18_Gui_thu") {
    throw new Error("Lệnh ghi cần --confirm-apply=18_Gui_thu sau khi preview.");
  }
  const spreadsheetId = text(args.get("spreadsheet-id")) || DEFAULT_SPREADSHEET_ID;
  const { rows, sheetName } = await googleRows(spreadsheetId);
  const db = getDb();
  try {
    const source = await db.migrationSource.upsert({
      create: {
        config: { sheetName, spreadsheetId },
        key: SOURCE_KEY,
        kind: "GOOGLE_SHEET",
        name: "V2 18_Gửi thư",
        status: "ACTIVE",
      },
      update: {
        config: { sheetName, spreadsheetId },
        lastRunAt: new Date(),
        status: "ACTIVE",
      },
      where: { key: SOURCE_KEY },
    });
    const externalIds = rows.map((row) => `18_Gửi thư:${text(row["Record ID"])}`);
    const existingMaps = await db.externalIdMap.findMany({
      where: { entityType: "MailOrder", externalId: { in: externalIds }, sourceId: source.id },
    });
    const mapped = new Set(existingMaps.map((row) => row.externalId));
    const trackingCodes = rows.map((row) => text(row["Mã vận đơn"])).filter(Boolean);
    const existingOrders = await db.mailOrder.findMany({
      select: { id: true, orderNumber: true, trackingCode: true },
      where: { OR: [{ trackingCode: { in: trackingCodes } }] },
    });
    const byTracking = new Map(
      existingOrders.filter((row) => row.trackingCode).map((row) => [row.trackingCode!, row]),
    );
    const invalid = rows.filter((row) => !text(row["Record ID"]));
    const preview = {
      alreadyMapped: externalIds.filter((id) => mapped.has(id)).length,
      existingByTracking: rows.filter(
        (row) => !mapped.has(`18_Gửi thư:${text(row["Record ID"])}`) && byTracking.has(text(row["Mã vận đơn"])),
      ).length,
      invalid: invalid.length,
      missingToCreate: rows.filter(
        (row) =>
          text(row["Record ID"]) &&
          !mapped.has(`18_Gửi thư:${text(row["Record ID"])}`) &&
          !byTracking.has(text(row["Mã vận đơn"])),
      ).length,
      rowsRead: rows.length,
      sheetName,
    };
    if (mode === "preview") return { mode, ...preview };

    const run = await db.migrationRun.create({
      data: {
        mode: "APPLY",
        phase: "IMPORT_MAIL_ORDERS",
        rowsRead: rows.length,
        rowsValid: rows.length - invalid.length,
        sourceConfigSnapshot: { sheetName, spreadsheetId },
        sourceId: source.id,
        status: "RUNNING",
      },
    });
    const counters = { created: 0, failed: 0, mappedExisting: 0, skipped: 0 };
    for (const row of rows) {
      const recordId = text(row["Record ID"]);
      const externalId = `18_Gửi thư:${recordId}`;
      let status = "IMPORTED";
      let internalId: string | undefined;
      let errorMessage = "";
      try {
        if (!recordId) throw new Error("Thiếu Record ID.");
        const currentMap = await db.externalIdMap.findUnique({
          where: { sourceId_entityType_externalId: { entityType: "MailOrder", externalId, sourceId: source.id } },
        });
        if (currentMap) {
          internalId = currentMap.internalId;
          status = "SKIPPED";
          counters.skipped += 1;
        } else {
          const trackingCode = text(row["Mã vận đơn"]);
          const orderNumber = text(row["Mã đơn nội bộ"]);
          const existing = await db.mailOrder.findFirst({
            where: {
              OR: [
                ...(trackingCode ? [{ trackingCode }] : []),
                ...(orderNumber ? [{ orderNumber }] : []),
              ],
            },
          });
          if (existing) {
            internalId = existing.id;
            counters.mappedExisting += 1;
          } else {
            const requestJson = jsonObject(row["Raw request JSON"]);
            const responseJson = jsonObject(row["Raw response JSON"]);
            const company = await db.company.findFirst({
              where: {
                OR: [
                  { code: text(row["Mã công ty"]) },
                  { shortName: text(row["Mã công ty"]) },
                  { legalName: text(row["Tên công ty"]) },
                ],
              },
            });
            const actor = await db.employee.findUnique({
              include: { user: true },
              where: { employeeCode: text(row["Actor Employee ID"]) },
            });
            const created = await db.mailOrder.create({
              data: {
                companyId: company?.id || null,
                createdAt: date(row["Ngày tạo"]),
                createdById: actor?.user?.id || null,
                createdByName: text(row["Người tạo"]) || null,
                fee: integer(row["Tổng cước"]),
                moneyCollection: integer(row["Tiền thu hộ"], 0) || 0,
                note: text(row["Ghi chú"]) || null,
                orderNumber: text(row["Mã đơn nội bộ"]) || null,
                orderPayment: integer(row["ORDER_PAYMENT"], 1) || 1,
                productName: text(row["Tên hàng"]) || null,
                productPrice: integer(row["Giá trị hàng"], 0) || 0,
                productType: text(row["Loại hàng"]) || "TH",
                quantity: integer(row["Số lượng"], 1) || 1,
                rawResponse: asJson({
                  ...responseJson,
                  _legacy18Mail: {
                    accountId: text(row["Account ID"]),
                    lastCheckedAt: text(row["Dò trạng thái gần nhất"]),
                    recordId,
                    request: requestJson,
                    sourceRow: row.__rowNumber,
                    statusChangedAt: text(row["Đổi trạng thái lúc"]),
                    statusChangeCount: integer(row["Số lần đổi trạng thái"], 0) || 0,
                    previousVtpStatus: text(row["Trạng thái ViettelPost trước"]),
                  },
                }),
                receiverAddress: text(row["Địa chỉ nhận"]),
                receiverDistrict: integer(row["Quận/Huyện nhận ID"]),
                receiverName: text(row["Người nhận"]),
                receiverPhone: text(requestJson.RECEIVER_PHONE) || text(row["SĐT nhận"]),
                receiverProvince: integer(row["Tỉnh nhận ID"]),
                receiverWard: integer(row["Phường/Xã nhận ID"]),
                senderAddress: text(row["Địa chỉ gửi"]),
                senderDistrict: integer(row["Quận/Huyện gửi ID"]),
                senderName: text(row["Người gửi"]),
                senderPhone: text(requestJson.SENDER_PHONE) || text(row["SĐT gửi"]),
                senderProvince: integer(row["Tỉnh gửi ID"]),
                senderWard: integer(row["Phường/Xã gửi ID"]),
                service: text(row["Dịch vụ"]) || null,
                serviceName: text(row["Tên dịch vụ"]) || null,
                status: text(row["Trạng thái"]) || "Đang theo dõi",
                trackingCode: text(row["Mã vận đơn"]) || null,
                updatedAt: date(row["Cập nhật lúc"] || row["Ngày tạo"]),
                vtpAccountId: text(row["Account ID"]) || null,
                vtpStatus:
                  text(row["Trạng thái ViettelPost"]) ||
                  text(row["Mã trạng thái ViettelPost"]) ||
                  "Đã tạo vận đơn",
                weight: integer(row["Trọng lượng gram"], 50) || 50,
              },
            });
            internalId = created.id;
            counters.created += 1;
          }
          await db.externalIdMap.create({
            data: {
              entityType: "MailOrder",
              externalId,
              internalId,
              metadata: { sourceRow: row.__rowNumber, trackingCode: text(row["Mã vận đơn"]) },
              sourceId: source.id,
            },
          });
        }
      } catch (error) {
        counters.failed += 1;
        status = "FAILED";
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      await db.migrationRecord.create({
        data: {
          entityType: "MailOrder",
          externalId,
          internalId,
          issueCount: errorMessage ? 1 : 0,
          processedAt: new Date(),
          rawData: asJson(row),
          rowNumber: row.__rowNumber,
          runId: run.id,
          status,
        },
      });
      if (errorMessage) {
        await db.migrationIssue.create({
          data: {
            code: "MAIL_ORDER_IMPORT_FAILED",
            externalId,
            message: errorMessage,
            rawData: asJson({ recordId, sourceRow: row.__rowNumber }),
            rowNumber: row.__rowNumber,
            runId: run.id,
            severity: "ERROR",
          },
        });
      }
    }
    const finalStatus = counters.failed ? "PARTIAL" : "COMPLETED";
    await db.migrationRun.update({
      data: {
        completedAt: new Date(),
        phase: "IMPORT_MAIL_ORDERS_COMPLETED",
        rowsCreated: counters.created,
        rowsFailed: counters.failed,
        rowsSkipped: counters.skipped + counters.mappedExisting,
        status: finalStatus,
        summary: `18_Gửi thư: ${counters.created} tạo mới, ${counters.mappedExisting} nối bản có sẵn, ${counters.skipped} bỏ qua, ${counters.failed} lỗi.`,
      },
      where: { id: run.id },
    });
    return { mode, runId: run.id, status: finalStatus, ...counters };
  } finally {
    await db.$disconnect();
  }
}

main()
  .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
