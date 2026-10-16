// Lõi đồng bộ nhân sự dùng chung cho server action + cron endpoint.
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { EmployeeStatus } from "@/generated/prisma/enums";

import {
  finishMigrationRecord,
  finishMigrationRun,
  mapExternalId,
  migrationFingerprint,
  recordMigrationIssue,
  stageMigrationRecord,
  startMigrationRun,
} from "@/lib/migration/service";
import { getFieldByKey, type PersonnelMappings } from "@/lib/personnel";
import {
  employeeCodeIdentity,
  employeeCodesMatch,
  normalizedEmployeeCode,
} from "@/lib/personnel-code";
import { readSheet } from "@/lib/personnel-sheet";

type SourceLike = {
  apiLink: string;
  companyId: string;
  headerRow: number;
  id: string;
  mappings: unknown;
  sheetName: string;
  syncMode?: string;
};

function cell(row: string[], headers: string[], column: string): string {
  const idx = headers.indexOf(column);
  return idx >= 0 ? String(row[idx] ?? "").trim() : "";
}
function resolve(
  row: string[],
  headers: string[],
  mappings: PersonnelMappings,
  key: string,
): string {
  const def = getFieldByKey(key);
  const m = mappings[key];
  if (def?.allowMultiple) {
    const cols = Array.isArray(m) ? m : m ? [m] : [];
    return cols
      .map((c) => cell(row, headers, c))
      .filter(Boolean)
      .join(def.joinSeparator || " ")
      .trim();
  }
  const col = Array.isArray(m) ? m[0] : m;
  return col ? cell(row, headers, col) : "";
}
function isInactive(statusText: string) {
  return /nghỉ|vô hiệu|inactive|thôi việc|nghi viec|thoi viec/.test(
    statusText.toLowerCase(),
  );
}
function normName(v: string) {
  return v
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
function rowObject(headers: string[], row: string[]) {
  return Object.fromEntries(
    headers.map((header, index) => [
      header || `Cột ${index + 1}`,
      String(row[index] ?? ""),
    ]),
  );
}
function rowErrorMessage(error: unknown) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return "Dữ liệu bị trùng khóa duy nhất, thường là email hoặc mã nhân sự.";
  }
  return error instanceof Error
    ? error.message.slice(0, 500)
    : "Không ghi được dòng nhân sự.";
}

// Đồng bộ 1 nguồn. snapshot=true → nhân sự của công ty này KHÔNG còn trong sheet sẽ bị set INACTIVE.
export async function runPersonnelSync(
  db: PrismaClient,
  source: SourceLike,
  options: { triggeredById?: string } = {},
): Promise<{
  count: number;
  failed: number;
  message: string;
  runId?: string;
  skipped: number;
}> {
  const mappings = (source.mappings ?? {}) as PersonnelMappings;
  const snapshot = (source.syncMode ?? "interval") === "snapshot";
  let count = 0;
  let created = 0;
  let updated = 0;
  let failed = 0;
  let skipped = 0;
  let rowsRead = 0;
  let rowsValid = 0;
  const seen = new Set<string>();
  const fingerprints: string[] = [];
  let migration: { runId: string; sourceId: string } | null = null;

  try {
    migration = await startMigrationRun(db, {
      config: {
        apiLink: source.apiLink,
        companyId: source.companyId,
        headerRow: source.headerRow,
        mappings,
        sheetName: source.sheetName,
        syncMode: source.syncMode ?? "interval",
      },
      kind: "GOOGLE_SHEET",
      name: `Đồng bộ nhân sự · ${source.sheetName}`,
      sourceKey: `personnel:${source.id}`,
      triggeredById: options.triggeredById,
    });

    // Bảng tra công ty: tên pháp lý / viết tắt / mã (bỏ dấu) → id, để tách công ty theo từng dòng.
    const companies = await db.company.findMany({
      select: { code: true, id: true, legalName: true, shortName: true },
    });
    const companyByName = new Map<string, string>();
    for (const co of companies) {
      for (const key of [co.legalName, co.shortName, co.code]) {
        const n = normName(String(key ?? ""));
        if (n && !companyByName.has(n)) companyByName.set(n, co.id);
      }
    }
    const resolveCompanyId = (value: string): string =>
      companyByName.get(normName(value)) ?? source.companyId;

    const read = await readSheet(
      source.apiLink,
      source.sheetName,
      source.headerRow,
    );
    rowsRead = read.rows.length;

    for (const [index, row] of read.rows.entries()) {
      const rowNumber = read.headerRowIndex + index + 1;
      const rawData = rowObject(read.headers, row);
      const fingerprint = migrationFingerprint(rawData);
      fingerprints.push(fingerprint);
      const code = normalizedEmployeeCode(
        resolve(row, read.headers, mappings, "employeeId"),
      );

      if (!code) {
        const staged = await stageMigrationRecord(db, {
          entityType: "Employee",
          fingerprint,
          rawData,
          rowNumber,
          runId: migration.runId,
        });
        await recordMigrationIssue(db, {
          code: "MISSING_EMPLOYEE_CODE",
          field: "employeeId",
          message: "Dòng không có mã nhân sự nên chưa được nhập.",
          rawData,
          rowNumber,
          runId: migration.runId,
          severity: "WARNING",
        });
        await finishMigrationRecord(db, staged.id, {
          issueCount: 1,
          status: "SKIPPED",
        });
        skipped++;
        continue;
      }

      rowsValid++;
      const fullName = resolve(row, read.headers, mappings, "name") || code;
      const email = resolve(row, read.headers, mappings, "email") || null;
      const status: EmployeeStatus = isInactive(
        resolve(row, read.headers, mappings, "status"),
      )
        ? "INACTIVE"
        : "ACTIVE";
      const data = {
        bankAccount:
          resolve(row, read.headers, mappings, "bankAccount") || null,
        bankName: resolve(row, read.headers, mappings, "bankName") || null,
        birthDate: resolve(row, read.headers, mappings, "birthDate") || null,
        companyId: resolveCompanyId(
          resolve(row, read.headers, mappings, "company"),
        ),
        department: resolve(row, read.headers, mappings, "department") || null,
        email,
        fullName,
        identityDate:
          resolve(row, read.headers, mappings, "identityDate") || null,
        identityNumber:
          resolve(row, read.headers, mappings, "identityNumber") || null,
        identityPlace:
          resolve(row, read.headers, mappings, "identityPlace") || null,
        permanentResidence:
          resolve(row, read.headers, mappings, "permanentResidence") || null,
        personalTaxCode:
          resolve(row, read.headers, mappings, "personalTaxCode") || null,
        phone: resolve(row, read.headers, mappings, "phone") || null,
        socialInsuranceNumber:
          resolve(row, read.headers, mappings, "socialInsuranceNumber") || null,
        status,
        terminationDate:
          resolve(row, read.headers, mappings, "terminationDate") || null,
        title: resolve(row, read.headers, mappings, "title") || null,
      };
      const staged = await stageMigrationRecord(db, {
        entityType: "Employee",
        externalId: code,
        fingerprint,
        normalizedData: { employeeCode: code, ...data },
        rawData,
        rowNumber,
        runId: migration.runId,
      });

      try {
        const codeIdentity = employeeCodeIdentity(code);
        const canonicalNumericCode = /^\d+$/.test(code) ? codeIdentity : "";
        const candidates = await db.employee.findMany({
          select: {
            companyId: true,
            email: true,
            employeeCode: true,
            id: true,
          },
          where: {
            OR: [
              { employeeCode: code },
              ...(canonicalNumericCode && canonicalNumericCode !== code
                ? [{ employeeCode: canonicalNumericCode }]
                : []),
              ...(email ? [{ email }] : []),
            ],
          },
        });
        const existing =
          candidates.find((candidate) => candidate.employeeCode === code) ||
          candidates.find(
            (candidate) =>
              candidate.companyId === data.companyId &&
              employeeCodesMatch(candidate.employeeCode, code),
          ) ||
          candidates.find(
            (candidate) =>
              candidate.companyId === data.companyId &&
              Boolean(email) &&
              candidate.email?.toLowerCase() === email?.toLowerCase(),
          );

        const employee = existing
          ? await db.employee.update({
              data: {
                employeeCode: code,
                ...data,
                email: email ?? undefined,
              },
              where: { id: existing.id },
            })
          : await db.employee.create({
              data: { employeeCode: code, ...data },
            });
        await mapExternalId(db, {
          entityType: "Employee",
          externalId: code,
          fingerprint,
          internalId: employee.id,
          metadata: { rowNumber },
          sourceId: migration.sourceId,
        });
        await finishMigrationRecord(db, staged.id, {
          internalId: employee.id,
          status: "IMPORTED",
        });
        seen.add(code);
        if (existing) updated++;
        else created++;
        count++;
      } catch (error) {
        const message = rowErrorMessage(error);
        await recordMigrationIssue(db, {
          code: "EMPLOYEE_UPSERT_FAILED",
          externalId: code,
          message,
          rawData,
          rowNumber,
          runId: migration.runId,
        });
        await finishMigrationRecord(db, staged.id, {
          issueCount: 1,
          status: "FAILED",
        });
        failed++;
      }
    }

    let deactivated = 0;
    if (snapshot && failed === 0) {
      // Thay danh sách: nhân sự thuộc công ty này mà không có trong sheet → tạm dừng.
      const existing = await db.employee.findMany({
        select: { employeeCode: true, id: true },
        where: { companyId: source.companyId, status: { not: "ARCHIVED" } },
      });
      const stale = existing.filter((e) => !seen.has(e.employeeCode));
      if (stale.length) {
        await db.employee.updateMany({
          data: { status: "INACTIVE" },
          where: { id: { in: stale.map((e) => e.id) } },
        });
        deactivated = stale.length;
      }
    }

    const resultCounts = `Thêm ${created}, cập nhật ${updated}.`;
    const message = snapshot
      ? failed
        ? `Snapshot: ${count} nhân sự. ${resultCounts} Chưa tạm dừng hồ sơ vắng mặt vì còn ${failed} dòng lỗi.`
        : `Snapshot: ${count} nhân sự. ${resultCounts} Tạm dừng ${deactivated} người không còn trong danh sách.`
      : `Đồng bộ ${count} nhân sự. ${resultCounts}`;
    const detail =
      failed || skipped
        ? `${message} Bỏ qua ${skipped} dòng, lỗi ${failed} dòng.`
        : message;
    await finishMigrationRun(db, migration.runId, {
      checksum: migrationFingerprint(fingerprints),
      rowsCreated: created,
      rowsFailed: failed,
      rowsRead,
      rowsSkipped: skipped,
      rowsUpdated: updated,
      rowsValid,
      status: failed ? "PARTIAL" : "COMPLETED",
      summary: detail,
    });

    return { count, failed, message: detail, runId: migration.runId, skipped };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Không đồng bộ được.";
    if (migration) {
      await finishMigrationRun(db, migration.runId, {
        checksum: fingerprints.length
          ? migrationFingerprint(fingerprints)
          : undefined,
        rowsCreated: created,
        rowsFailed: Math.max(failed, 1),
        rowsRead,
        rowsSkipped: skipped,
        rowsUpdated: updated,
        rowsValid,
        status: "FAILED",
        summary: message,
      });
    }
    return {
      count,
      failed: Math.max(failed, 1),
      message,
      runId: migration?.runId,
      skipped,
    };
  }
}
