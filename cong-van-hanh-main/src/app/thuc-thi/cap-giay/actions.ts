"use server";

import { Prisma } from "@/generated/prisma/client";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { issueDocumentNumber } from "@/lib/document-issue";

import {
  submitRequestAction,
  type RequestActionState,
} from "../actions";
import {
  buildAuthorizationPrintDocument,
  buildAuthorizationPrintItems,
} from "./print-runtime";
import type { AuthorizationReceiptRow } from "./types";

const SERVICE_CODE = "authorization-letter";
const MAX_CART_ITEMS = 100;
const MAX_EXPANDED_ITEMS = 300;

type JsonObject = Record<string, unknown>;

export type AuthorizationActionState = RequestActionState & {
  printUrl?: string;
  receiptRows?: AuthorizationReceiptRow[];
};

export type AuthorizationPreviewResult =
  | { error: string; ok: false }
  | { html: string; ok: true };

function objectOf(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi-VN");
}

function validDate(value: unknown) {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime());
}

function normalizedIdentity(value: unknown) {
  const raw = text(value);
  const digits = raw.replace(/\D+/g, "");
  if (digits.length === 11) return `0${digits}`;
  if (digits.length === 12) return digits;
  return raw;
}

function hasAccess(
  session: Awaited<ReturnType<typeof requireCurrentSession>>,
) {
  return session.fullAccess || session.modules.includes(SERVICE_CODE);
}

function isLetterType(value: unknown) {
  const key = normalize(value);
  return key.includes("uy quyen") || key.includes("gioi thieu");
}

function typeLabel(value: unknown) {
  return normalize(value).includes("gioi thieu")
    ? "Giấy Giới thiệu"
    : "Giấy Ủy quyền";
}

function typeCode(value: unknown) {
  return normalize(value).includes("gioi thieu") ? "GT" : "UQ";
}

function dateRange(fromDate: string, toDate: string) {
  const formatter = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  });
  return `${formatter.format(new Date(`${fromDate}T00:00:00.000Z`))} — ${formatter.format(new Date(`${toDate}T00:00:00.000Z`))}`;
}

async function employeeSnapshot(
  employeeId: string,
  source: "self" | "system",
) {
  const employee = await getDb().employee.findFirst({
    include: { company: true },
    where: { archivedAt: null, id: employeeId, status: "ACTIVE" },
  });
  if (!employee) return null;
  return {
    birthDate: employee.birthDate || "",
    companyId: employee.companyId || "",
    companyName: employee.company?.legalName || "",
    department: employee.department || "",
    email: employee.email || "",
    employeeCode: employee.employeeCode,
    employeeId: employee.id,
    identityDate: employee.identityDate || "",
    identityNumber: normalizedIdentity(employee.identityNumber),
    identityPlace: employee.identityPlace || "",
    name: employee.fullName,
    source,
    title: employee.title || "",
  };
}

async function validateAndExpand(
  rawValue: unknown,
  session: Awaited<ReturnType<typeof requireCurrentSession>>,
) {
  const raw = objectOf(rawValue);
  const cart = Array.isArray(raw.items) ? raw.items.map(objectOf) : [];
  if (!cart.length) throw new Error("Chưa có mục nào trong giỏ cấp giấy.");
  if (cart.length > MAX_CART_ITEMS) {
    throw new Error(`Mỗi đơn được tối đa ${MAX_CART_ITEMS} mục.`);
  }

  const companyIds = [
    ...new Set(
      cart.flatMap((row) =>
        Array.isArray(row.companyIds)
          ? row.companyIds.map(text).filter(Boolean)
          : [],
      ),
    ),
  ];
  const documentTypeIds = [
    ...new Set(cart.map((row) => text(row.documentTypeId)).filter(Boolean)),
  ];
  const [companies, documentTypes, currentUser] = await Promise.all([
    getDb().company.findMany({
      where: { id: { in: companyIds }, status: "ACTIVE" },
    }),
    getDb().documentType.findMany({
      where: {
        id: { in: documentTypeIds },
        status: "ACTIVE",
        takesNumber: true,
      },
    }),
    getDb().user.findUnique({
      select: { employeeId: true },
      where: { id: session.userId },
    }),
  ]);
  const companyMap = new Map(companies.map((item) => [item.id, item]));
  const typeMap = new Map(documentTypes.map((item) => [item.id, item]));
  const expanded: JsonObject[] = [];

  for (let index = 0; index < cart.length; index += 1) {
    const row = cart[index];
    const line = index + 1;
    const documentTypeId = text(row.documentTypeId);
    const documentType = typeMap.get(documentTypeId);
    if (!documentType || !isLetterType(documentType.name)) {
      throw new Error(`Mục ${line} chưa chọn đúng loại giấy.`);
    }
    const selectedCompanyIds = Array.isArray(row.companyIds)
      ? [...new Set(row.companyIds.map(text).filter(Boolean))]
      : [];
    if (!selectedCompanyIds.length) {
      throw new Error(`Mục ${line} chưa chọn pháp nhân áp dụng.`);
    }
    if (selectedCompanyIds.some((id) => !companyMap.has(id))) {
      throw new Error(`Mục ${line} có pháp nhân không còn hoạt động.`);
    }
    const fromDate = text(row.fromDate);
    const toDate = text(row.toDate);
    if (!validDate(fromDate) || !validDate(toDate)) {
      throw new Error(`Mục ${line} chưa chọn đủ thời hạn hiệu lực.`);
    }
    if (
      new Date(`${fromDate}T00:00:00.000Z`).getTime() >
      new Date(`${toDate}T00:00:00.000Z`).getTime()
    ) {
      throw new Error(
        `Mục ${line} có ngày bắt đầu sau ngày kết thúc.`,
      );
    }
    const reason = text(row.reason);
    if (!reason) throw new Error(`Mục ${line} chưa nhập lý do.`);
    if (reason.length > 4000) {
      throw new Error(`Lý do ở mục ${line} dài quá 4.000 ký tự.`);
    }

    const clientPerson = objectOf(row.person);
    const mode = text(clientPerson.source);
    let person: JsonObject | null = null;
    if (mode === "self") {
      person = currentUser?.employeeId
        ? await employeeSnapshot(currentUser.employeeId, "self")
        : {
            birthDate: "",
            companyId: "",
            companyName: "",
            department: "",
            email: "",
            employeeCode: "",
            employeeId: "",
            identityDate: "",
            identityNumber: "",
            identityPlace: "",
            name: session.displayName,
            source: "self",
            title: "",
          };
    } else if (mode === "system") {
      person = await employeeSnapshot(
        text(clientPerson.employeeId),
        "system",
      );
      if (!person) {
        throw new Error(
          `Mục ${line} chưa chọn đúng nhân sự trong hệ thống.`,
        );
      }
    } else if (mode === "manual") {
      const required = [
        ["họ và tên", clientPerson.name],
        ["chức vụ", clientPerson.title],
        ["ngày sinh", clientPerson.birthDate],
        ["số CCCD", clientPerson.identityNumber],
        ["nơi cấp CCCD", clientPerson.identityPlace],
        ["ngày cấp CCCD", clientPerson.identityDate],
      ] as const;
      const missing = required.find(([, value]) => !text(value));
      if (missing) {
        throw new Error(`Mục ${line} chưa nhập ${missing[0]} người được cấp.`);
      }
      if (
        !validDate(clientPerson.birthDate) ||
        !validDate(clientPerson.identityDate)
      ) {
        throw new Error(`Mục ${line} có ngày sinh/ngày cấp CCCD không hợp lệ.`);
      }
      const identityNumber = normalizedIdentity(clientPerson.identityNumber);
      if (!/^\d{9,12}$/.test(identityNumber)) {
        throw new Error(`Mục ${line} có số CCCD không hợp lệ.`);
      }
      const email = text(clientPerson.email);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error(`Mục ${line} có email không hợp lệ.`);
      }
      person = {
        birthDate: text(clientPerson.birthDate),
        companyId: "",
        companyName: text(clientPerson.companyName),
        department: text(clientPerson.department),
        email,
        employeeCode: "",
        employeeId: "",
        identityDate: text(clientPerson.identityDate),
        identityNumber,
        identityPlace: text(clientPerson.identityPlace),
        name: text(clientPerson.name),
        source: "manual",
        title: text(clientPerson.title),
      };
    } else {
      throw new Error(`Mục ${line} chưa chọn người được cấp giấy.`);
    }

    if (!person) {
      throw new Error(`Mục ${line} chưa có thông tin người được cấp giấy.`);
    }
    const resolvedPerson: JsonObject = person;

    for (const companyId of selectedCompanyIds) {
      const company = companyMap.get(companyId);
      if (!company) continue;
      const adjustedPerson =
        (resolvedPerson.source === "self" ||
          resolvedPerson.source === "system") &&
        text(resolvedPerson.companyId) &&
        resolvedPerson.companyId !== companyId
          ? { ...resolvedPerson, title: "Nhân viên" }
          : resolvedPerson;
      const label = typeLabel(documentType.name);
      expanded.push({
        companyId,
        companyName: company.legalName,
        companyShort: company.shortName || company.code,
        companyShortName: company.shortName || company.code,
        documentTypeId: documentType.id,
        documentTypeName: documentType.name,
        documentTypeRowIndex: documentType.legacySheetRow || 0,
        fromDate,
        issuedNumber: "",
        loai: label,
        lydo: reason,
        nguoi: [adjustedPerson.name, adjustedPerson.title]
          .filter(Boolean)
          .join(" • "),
        nguoiCCCD: adjustedPerson.identityNumber,
        nguoiChucVu: adjustedPerson.title,
        nguoiMode: adjustedPerson.source,
        nguoiNgayCap: adjustedPerson.identityDate,
        nguoiNgaySinh: adjustedPerson.birthDate,
        nguoiNoiCap: adjustedPerson.identityPlace,
        nguoiPhongBan: adjustedPerson.department,
        nguoiTen: adjustedPerson.name,
        personMode: adjustedPerson.source,
        personSnapshot: adjustedPerson,
        phapNhan: company.legalName,
        reason,
        signDate: fromDate,
        soVanBan: "",
        thoihan: dateRange(fromDate, toDate),
        toDate,
        type: label,
        typeCode: typeCode(label),
        typeLabel: label,
        urgent: row.urgent ? "Có" : "Không",
        urgentFlag: Boolean(row.urgent),
      });
    }
  }

  if (expanded.length > MAX_EXPANDED_ITEMS) {
    throw new Error(
      `Sau khi tách pháp nhân, mỗi đơn được tối đa ${MAX_EXPANDED_ITEMS} bản in.`,
    );
  }
  return expanded;
}

export async function previewAuthorizationLettersAction(
  rawValue: unknown,
): Promise<AuthorizationPreviewResult> {
  const session = await requireCurrentSession();
  if (!hasAccess(session)) {
    return {
      error: "Tài khoản chưa được cấp quyền Cấp giấy Ủy quyền/Giới thiệu.",
      ok: false,
    };
  }
  try {
    const rows = await validateAndExpand(rawValue, session);
    const items = await buildAuthorizationPrintItems(getDb(), rows, {
      draft: true,
    });
    return {
      html: buildAuthorizationPrintDocument({ draft: true, items }),
      ok: true,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Không dựng được bản nháp.",
      ok: false,
    };
  }
}

export async function submitAuthorizationLettersAction(
  state: AuthorizationActionState,
  formData: FormData,
): Promise<AuthorizationActionState> {
  const session = await requireCurrentSession();
  if (!hasAccess(session)) {
    return {
      error: "Tài khoản chưa được cấp quyền Cấp giấy Ủy quyền/Giới thiệu.",
    };
  }

  let rawPayload: JsonObject;
  let rows: JsonObject[];
  try {
    rawPayload = objectOf(
      JSON.parse(String(formData.get("payload") || "{}")),
    );
    rows = await validateAndExpand(rawPayload, session);
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Dữ liệu cấp giấy không hợp lệ.",
    };
  }

  const priority = rows.some((row) => Boolean(row.urgentFlag))
    ? "Khẩn"
    : "Bình thường";
  const firstPerson = text(objectOf(rows[0].personSnapshot).name);
  const requestPayload: JsonObject = {
    items: rows,
    meta: {
      expandedCount: rows.length,
      source: "authorization-letter-v3",
    },
  };
  formData.set("serviceCode", SERVICE_CODE);
  formData.set(
    "title",
    rows.length === 1
      ? `${text(rows[0].typeLabel)}: ${firstPerson}`
      : `Cấp ${rows.length} giấy Ủy quyền/Giới thiệu`,
  );
  formData.set("priority", priority);
  formData.set("note", text(rows[0].reason));
  formData.set("payload", JSON.stringify(requestPayload));

  const created = await submitRequestAction(state, formData);
  if (!created.success || !created.requestCode) return created;

  const db = getDb();
  const request = await db.request.findUnique({
    where: { code: created.requestCode },
  });
  if (!request) {
    return {
      error: `${created.requestCode} đã được ghi nhận nhưng chưa thể dựng bản in.`,
      requestCode: created.requestCode,
    };
  }

  const issuedRegistryIds: string[] = [];
  const issuedRows: JsonObject[] = [];
  try {
    for (const row of rows) {
      const signDate = new Date(`${text(row.signDate)}T00:00:00.000Z`);
      const issued = await issueDocumentNumber(db, {
        companyId: text(row.companyId),
        createdById: session.userId,
        createdByName: session.displayName,
        documentTypeId: text(row.documentTypeId),
        note: text(row.reason),
        partnerName: text(objectOf(row.personSnapshot).name),
        quantity: 1,
        sealTypes: [],
        signDate,
      });
      if (!issued.ok) throw new Error(issued.error);
      issuedRegistryIds.push(issued.id);
      issuedRows.push({
        ...row,
        documentNumber: issued.documentNumber,
        documentNumberMeta: {
          assignedAt: new Date().toISOString(),
          documentRegistryId: issued.id,
          serial: issued.serial,
        },
        documentRegistryId: issued.id,
        issuedNumber: issued.documentNumber,
        soVanBan: issued.documentNumber,
      });
    }

    const nextPayload = {
      ...requestPayload,
      documentRegistryIssuedAt: new Date().toISOString(),
      issuedDocumentNumbers: issuedRows.map((row) => row.issuedNumber),
      items: issuedRows,
    } as Prisma.InputJsonValue;
    await db.$transaction(async (tx) => {
      await tx.request.update({
        data: { payload: nextPayload },
        where: { id: request.id },
      });
      await tx.requestEvent.create({
        data: {
          actorId: session.userId,
          note: `Đã giữ số khi mở bản in: ${issuedRows
            .map((row) => text(row.issuedNumber))
            .join(", ")}`,
          requestId: request.id,
          type: "COMMENT",
        },
      });
    });
  } catch (error) {
    if (issuedRegistryIds.length) {
      await db.documentRegistry.updateMany({
        data: { status: "CANCELLED" },
        where: { id: { in: issuedRegistryIds } },
      });
    }
    await db.$transaction(async (tx) => {
      await tx.request.update({
        data: {
          completedAt: new Date(),
          note: "Đã hủy tự động vì không cấp đủ số văn bản.",
          status: "CANCELLED",
        },
        where: { id: request.id },
      });
      await tx.requestEvent.create({
        data: {
          actorId: session.userId,
          fromStatus: "SUBMITTED",
          note:
            error instanceof Error
              ? `Không cấp đủ số: ${error.message}`
              : "Không cấp đủ số.",
          requestId: request.id,
          toStatus: "CANCELLED",
          type: "CANCELLED",
        },
      });
    });
    return {
      error:
        error instanceof Error
          ? `${created.requestCode} đã hủy an toàn: ${error.message}`
          : `${created.requestCode} đã hủy an toàn vì không cấp đủ số.`,
      requestCode: created.requestCode,
    };
  }

  const companyIds = [...new Set(issuedRows.map((row) => text(row.companyId)))];
  const companies = await db.company.findMany({
    select: { id: true, legalName: true },
    where: { id: { in: companyIds } },
  });
  const companyMap = new Map(
    companies.map((company) => [
      company.id,
      company.legalName,
    ]),
  );
  const receiptRows: AuthorizationReceiptRow[] = issuedRows.map((row) => ({
    companies: companyMap.get(text(row.companyId)) || text(row.companyName),
    period: dateRange(text(row.fromDate), text(row.toDate)),
    person: text(objectOf(row.personSnapshot).name),
    type: text(row.typeLabel),
  }));

  return {
    printUrl: `/thuc-thi/cap-giay/in/${encodeURIComponent(request.code)}`,
    receiptRows,
    requestCode: request.code,
    submittedAt: request.createdAt.toISOString(),
    success: `Đã gửi đăng ký ${request.code} và cấp ${issuedRows.length} số văn bản.`,
  };
}
