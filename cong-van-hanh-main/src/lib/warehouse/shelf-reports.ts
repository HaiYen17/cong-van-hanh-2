import "server-only";

import { randomUUID } from "node:crypto";
import type { AppSession } from "@/lib/auth/session";
import { assertWarehouseDeleteCredential } from "./secure-delete";
import {
  compareShelfWarehouseReports,
  reportSummary,
  shelfEntityType,
  shelfFloorCount,
  type ShelfSavedReportSummary,
  type ShelfWarehouseReport,
} from "./shelf-report-domain";
import { canUseShelf, getShelfPool } from "./shelves";

const identifier = (value: unknown, name: string) => {
  const result = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(result))
    throw new Error(`${name} không hợp lệ.`);
  return result;
};

function assertAccess(actor: AppSession) {
  if (!canUseShelf(actor, "shelf-inventory:read")) {
    throw new Error("Không có quyền xem kiểm kê theo Kệ/Xe.");
  }
}

function assertDeleteAccess(actor: AppSession) {
  if (!canUseShelf(actor, "shelf-inventory:delete")) {
    throw new Error("Không có quyền xóa dữ liệu kiểm kê theo Kệ/Xe.");
  }
}

function savedReport(value: unknown): ShelfWarehouseReport {
  const report = value as ShelfWarehouseReport;
  if (!report || typeof report !== "object" || !Array.isArray(report.shelves)) {
    throw new Error("Dữ liệu báo cáo đã lưu không hợp lệ.");
  }
  return {
    ...report,
    shelves: report.shelves.map((shelf) => {
      const entityType = shelfEntityType(shelf);
      return {
        ...shelf,
        entityType,
        floorCount: shelfFloorCount({ ...shelf, entityType }),
      };
    }),
  };
}

export async function listShelfInventoryReports(
  actor: AppSession,
  offsetValue = 0,
): Promise<{ hasMore: boolean; reports: ShelfSavedReportSummary[] }> {
  assertAccess(actor);
  const offset = Number.isInteger(offsetValue)
    ? Math.max(0, Math.min(offsetValue, 1_000_000))
    : 0;
  const rows = (
    await getShelfPool().query<{
      created_at: Date;
      name: string;
      prepared_by: string;
      report_id: string;
      shelf_count: number;
      sku_count: number;
      total_quantity: number;
      warehouse: string;
    }>(
      `SELECT report_id,name,warehouse,prepared_by,shelf_count,sku_count,total_quantity,created_at
      FROM rfid_shelf_inventory_reports
      ORDER BY created_at DESC,report_id DESC LIMIT 31 OFFSET $1`,
      [offset],
    )
  ).rows;
  return {
    hasMore: rows.length > 30,
    reports: rows.slice(0, 30).map((row) => ({
      createdAt: row.created_at.toISOString(),
      name: row.name,
      preparedBy: row.prepared_by,
      reportId: row.report_id,
      shelfCount: row.shelf_count,
      skuCount: row.sku_count,
      totalQuantity: row.total_quantity,
      warehouse: row.warehouse,
    })),
  };
}

export async function getShelfInventoryReport(
  actor: AppSession,
  reportIdValue: string,
) {
  assertAccess(actor);
  const reportId = identifier(reportIdValue, "Mã báo cáo");
  const row = (
    await getShelfPool().query<{ snapshot: unknown; warehouse: string }>(
      "SELECT snapshot,warehouse FROM rfid_shelf_inventory_reports WHERE report_id=$1",
      [reportId],
    )
  ).rows[0];
  if (!row) throw new Error("Không tìm thấy báo cáo kiểm kê Kệ/Xe.");
  return savedReport(row.snapshot);
}

export async function deleteShelfInventorySession(
  actor: AppSession,
  input: { password: string; reason: string; sessionId: string },
) {
  assertDeleteAccess(actor);
  const sessionId = identifier(input.sessionId, "Mã phiên");
  const reason = await assertWarehouseDeleteCredential(actor, input);
  const pool = getShelfPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const session = (
      await client.query<{
        operator_name: string;
        shelf_id: string;
        warehouse: string;
      }>(
        `SELECT shelf_id,warehouse,operator_name
         FROM rfid_shelf_inventory_sessions WHERE session_id=$1 FOR UPDATE`,
        [sessionId],
      )
    ).rows[0];
    if (!session) {
      throw new Error("Phiên kiểm kê Kệ/Xe không còn tồn tại.");
    }
    const linkedReports = (
      await client.query<{ report_id: string }>(
        `DELETE FROM rfid_shelf_inventory_report_sessions
         WHERE session_id=$1 RETURNING report_id`,
        [sessionId],
      )
    ).rows.map((row) => row.report_id);
    const deletedLineCount = Number(
      (
        await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM rfid_shelf_inventory_lines WHERE session_id=$1",
          [sessionId],
        )
      ).rows[0]?.count ?? 0,
    );
    await client.query(
      "DELETE FROM rfid_shelf_inventory_lines WHERE session_id=$1",
      [sessionId],
    );
    await client.query(
      "DELETE FROM rfid_shelf_inventory_sessions WHERE session_id=$1",
      [sessionId],
    );
    await client.query(
      `INSERT INTO "AuditLog"("id","actorId","action","targetType","targetId","summary","metadata")
       VALUES($1,$2,'DELETE','ShelfInventorySession',$3,$4,$5)`,
      [
        randomUUID(),
        actor.userId,
        sessionId,
        `Xóa phiên kiểm kê Kệ/Xe ${sessionId}. Lý do: ${reason}`,
        JSON.stringify({
          deletedLineCount,
          linkedReportIds: linkedReports,
          operatorName: session.operator_name,
          reason,
          sessionId,
          shelfId: session.shelf_id,
          warehouse: session.warehouse,
        }),
      ],
    );
    await client.query("COMMIT");
    return {
      deletedLineCount,
      linkedReportCount: linkedReports.length,
      sessionId,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteShelfInventoryReport(
  actor: AppSession,
  input: { password: string; reason: string; reportId: string },
) {
  assertDeleteAccess(actor);
  const reportId = identifier(input.reportId, "Mã báo cáo");
  const reason = await assertWarehouseDeleteCredential(actor, input);
  const pool = getShelfPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const report = (
      await client.query<{
        name: string;
        shelf_count: number;
        warehouse: string;
      }>(
        `SELECT name,warehouse,shelf_count
         FROM rfid_shelf_inventory_reports WHERE report_id=$1 FOR UPDATE`,
        [reportId],
      )
    ).rows[0];
    if (!report) {
      throw new Error("Báo cáo kiểm kê Kệ/Xe không còn tồn tại.");
    }
    await client.query(
      "DELETE FROM rfid_shelf_inventory_reports WHERE report_id=$1",
      [reportId],
    );
    await client.query(
      `INSERT INTO "AuditLog"("id","actorId","action","targetType","targetId","summary","metadata")
       VALUES($1,$2,'DELETE','ShelfInventoryReport',$3,$4,$5)`,
      [
        randomUUID(),
        actor.userId,
        reportId,
        `Xóa báo cáo kiểm kê Kệ/Xe ${reportId}. Lý do: ${reason}`,
        JSON.stringify({
          name: report.name,
          reason,
          reportId,
          shelfCount: report.shelf_count,
          warehouse: report.warehouse,
        }),
      ],
    );
    await client.query("COMMIT");
    return { reportId, shelfCount: report.shelf_count };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createShelfInventoryReport(
  actor: AppSession,
  sessionIdValues: string[],
): Promise<ShelfWarehouseReport> {
  assertAccess(actor);
  if (!Array.isArray(sessionIdValues))
    throw new Error("Danh sách phiên Kệ/Xe không hợp lệ.");
  const sessionIds = [
    ...new Set(sessionIdValues.map((value) => identifier(value, "Mã phiên"))),
  ];
  if (sessionIds.length < 2)
    throw new Error("Vui lòng chọn ít nhất hai phiên Kệ/Xe để ghép.");
  if (sessionIds.length > 100)
    throw new Error("Mỗi lần chỉ ghép tối đa 100 phiên Kệ/Xe.");

  const pool = getShelfPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = (
      await client.query<{
        payload: unknown;
        received_at: Date;
        entity_type: "SHELF" | "VEHICLE";
        floor_count: number;
        session_id: string;
        shelf_id: string;
        warehouse: string;
      }>(
        `SELECT session_id,shelf_id,warehouse,payload,received_at,entity_type,floor_count
        FROM rfid_shelf_inventory_sessions
        WHERE session_id=ANY($1::text[]) FOR SHARE`,
        [sessionIds],
      )
    ).rows;
    if (rows.length !== sessionIds.length)
      throw new Error("Có phiên Kệ/Xe đã chọn không còn tồn tại.");
    const warehouses = new Set(rows.map((row) => row.warehouse));
    if (warehouses.size !== 1)
      throw new Error(
        "Các phiên được ghép phải thuộc cùng một khu vực kiểm kê.",
      );
    if (new Set(rows.map((row) => row.shelf_id)).size !== rows.length) {
      throw new Error("Mỗi Kệ/Xe chỉ được chọn một phiên trong báo cáo ghép.");
    }
    const lineRows = (
      await client.query<{
        floor: number;
        name: string;
        quantity: number;
        session_id: string;
        sku: string;
      }>(
        `SELECT session_id,floor,sku,name,quantity FROM rfid_shelf_inventory_lines
        WHERE session_id=ANY($1::text[]) ORDER BY session_id,floor DESC,sku`,
        [sessionIds],
      )
    ).rows;
    const linesBySession = new Map<string, typeof lineRows>();
    for (const line of lineRows) {
      const current = linesBySession.get(line.session_id) || [];
      current.push(line);
      linesBySession.set(line.session_id, current);
    }
    const shelves = rows
      .map((row) => {
        const payload = row.payload as Record<string, unknown>;
        const shelfCode = String(payload?.shelfCode ?? "").trim();
        const shelfName = String(payload?.shelfName ?? "").trim();
        const sessionId = String(payload?.sessionId ?? row.session_id).trim();
        if (!shelfCode || !shelfName || sessionId !== row.session_id) {
          throw new Error(
            `Phiên ${row.session_id} có dữ liệu Kệ/Xe không hợp lệ.`,
          );
        }
        return {
          entityType:
            row.entity_type === "VEHICLE"
              ? ("VEHICLE" as const)
              : ("SHELF" as const),
          excludedReadCount: Math.max(
            0,
            Number(payload?.excludedReadCount) || 0,
          ),
          floorCount:
            row.entity_type === "VEHICLE"
              ? 0
              : Math.max(1, Math.min(20, Number(row.floor_count) || 3)),
          lines: (linesBySession.get(row.session_id) || []).map((line) => ({
            floor: line.floor,
            name: line.name,
            quantity: line.quantity,
            sku: line.sku,
          })),
          operatorName: String(payload?.operatorName ?? "").trim(),
          sessionId: row.session_id,
          shelfCode,
          shelfId: row.shelf_id,
          shelfName,
          submittedAt: String(
            payload?.submittedAt ?? row.received_at.toISOString(),
          ),
        };
      })
      .sort((left, right) =>
        left.shelfCode.localeCompare(right.shelfCode, "vi", {
          numeric: true,
          sensitivity: "base",
        }),
      );
    const now = new Date();
    const reportId = `shelf-report-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8)}`;
    const warehouse = rows[0].warehouse;
    const report: ShelfWarehouseReport = {
      createdAt: now.toISOString(),
      generatedAt: now.toISOString(),
      name: `Kiểm kê Kệ/Xe · ${warehouse} · ${new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(now)}`,
      preparedBy: actor.displayName,
      reportId,
      shelves,
      sourceSessionIds: shelves.map((shelf) => shelf.sessionId),
      warehouse,
    };
    const summary = reportSummary(report);
    await client.query(
      `INSERT INTO rfid_shelf_inventory_reports
      (report_id,name,warehouse,actor_id,prepared_by,snapshot,shelf_count,sku_count,total_quantity,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        reportId,
        report.name,
        warehouse,
        actor.userId,
        actor.displayName,
        JSON.stringify(report),
        summary.shelfCount,
        summary.skuCount,
        summary.totalQuantity,
        now,
      ],
    );
    await client.query(
      `INSERT INTO rfid_shelf_inventory_report_sessions(report_id,session_id,shelf_id,position)
      SELECT $1,x.session_id,x.shelf_id,x.position FROM jsonb_to_recordset($2::jsonb)
      AS x(session_id text,shelf_id text,position smallint)`,
      [
        reportId,
        JSON.stringify(
          shelves.map((shelf, index) => ({
            position: index + 1,
            session_id: shelf.sessionId,
            shelf_id: shelf.shelfId,
          })),
        ),
      ],
    );
    await client.query(
      `INSERT INTO "AuditLog"("id","actorId","action","targetType","targetId","summary","metadata")
      VALUES($1,$2,'CREATE','ShelfInventoryReport',$3,$4,$5)`,
      [
        randomUUID(),
        actor.userId,
        reportId,
        `Ghép ${shelves.length} phiên Kệ/Xe thành báo cáo ${reportId}.`,
        JSON.stringify({
          reportId,
          sessionIds: report.sourceSessionIds,
          warehouse,
        }),
      ],
    );
    await client.query("COMMIT");
    return report;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function compareShelfInventoryReports(
  actor: AppSession,
  inputReportIdValue: string,
  outputReportIdValue: string,
) {
  assertAccess(actor);
  const inputReportId = identifier(inputReportIdValue, "Mã báo cáo đầu vào");
  const outputReportId = identifier(outputReportIdValue, "Mã báo cáo đầu ra");
  if (inputReportId === outputReportId)
    throw new Error("Đầu vào và đầu ra phải là hai báo cáo khác nhau.");
  const rows = (
    await getShelfPool().query<{ report_id: string; snapshot: unknown }>(
      "SELECT report_id,snapshot FROM rfid_shelf_inventory_reports WHERE report_id=ANY($1::text[])",
      [[inputReportId, outputReportId]],
    )
  ).rows;
  if (rows.length !== 2)
    throw new Error("Không tìm thấy đủ hai báo cáo đã chọn.");
  const byId = new Map(
    rows.map((row) => [row.report_id, savedReport(row.snapshot)]),
  );
  return compareShelfWarehouseReports(
    byId.get(inputReportId)!,
    byId.get(outputReportId)!,
  );
}
