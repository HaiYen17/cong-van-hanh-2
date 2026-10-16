import "server-only";

import type { AppSession } from "@/lib/auth/session";
import { can, canAny } from "@/lib/auth/authorization";
import { issueDocumentNumber } from "@/lib/document-issue";
import {
  buildCycleKey,
  buildPoolKey,
  effectiveDocumentStartIndex,
  maxSerial,
  nextDocumentSerial,
  renderNumber,
} from "@/lib/document-registry";
import type { FormatToken } from "@/lib/document-numbering";
import { getDb } from "@/lib/db";
import { dispatchEvaluationRpc } from "@/lib/evaluation/runtime";
import type { Prisma } from "@/generated/prisma/client";
import {
  assertElectronicSignatureCompletionReady,
  renameElectronicSignatureInputsForProcessing,
} from "@/lib/requests/electronic-signature";
import {
  electronicSignatureFileIds,
  isElectronicSignatureItem,
  signatureFiles,
} from "@/lib/requests/electronic-signature-payload";
import {
  buildAllocationReceiptView,
  confirmAllocationReceiptRows,
} from "@/lib/assets/allocation-receipt";

type JsonRecord = Record<string, unknown>;

export class InboxRuntimeError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "InboxRuntimeError";
    this.status = status;
  }
}

const SERVICE_MAP: Record<string, { label: string; legacy: string }> = {
  "asset-allocation": {
    label: "Đề xuất cấp phát hàng hóa / CCDC",
    legacy: "05DE_XUAT_CAP_PHAT",
  },
  "authorization-letter": {
    label: "Cấp Giấy Uỷ quyền / Giới thiệu",
    legacy: "09CAP_GIAY_UY_QUYEN_GIOI_THIEU",
  },
  "business-trip": {
    label: "Đăng ký công tác",
    legacy: "10DANG_KY_CONG_TAC",
  },
  "document-archive": {
    label: "Trích lục / Lưu trữ hồ sơ",
    legacy: "08TRICH_LUC_VA_LUU_TRU_HO_SO",
  },
  "document-seal": {
    label: "Đóng dấu và Ký số",
    legacy: "07DE_NGHI_DONG_DAU_VA_CAP_SO_VAN_BAN",
  },
  "repair-request": {
    label: "Yêu cầu sửa chữa, bảo trì",
    legacy: "06YEU_CAU_SUA_CHUA_BAO_TRI",
  },
  "review-contract": {
    label: "Review hồ sơ",
    legacy: "12REVIEW_HOP_DONG",
  },
  "send-mail": {
    label: "Gửi thư",
    legacy: "13GUI_THU_VIETTEL_POST",
  },
  "support-request": {
    label: "Yêu cầu hỗ trợ",
    legacy: "11YEU_CAU_HO_TRO",
  },
  "workshop-order": {
    label: "Đặt hàng Xưởng",
    legacy: "18DAT_HANG_XUONG",
  },
  "workshop-plan": {
    label: "Kế hoạch xưởng đã duyệt",
    legacy: "17KE_HOACH_XUONG_DA_DUYET",
  },
};

const LEGACY_SERVICE_MAP = Object.fromEntries(
  Object.entries(SERVICE_MAP).map(([key, value]) => [
    value.legacy,
    { key, ...value },
  ]),
);

const WORKFLOW_STEPS: Record<string, { code: string; label: string }[]> = {
  "05DE_XUAT_CAP_PHAT": [
    { code: "ORDERING", label: "Hàng hóa đang được Order" },
    { code: "IN_STOCK", label: "Hàng hóa đã được cập nhật vào Kho" },
    { code: "PACKED", label: "Hàng hóa đã được đóng gói và gửi đi" },
  ],
  "06YEU_CAU_SUA_CHUA_BAO_TRI": [
    { code: "CONTACTED", label: "Đã liên hệ Dịch vụ sửa chữa" },
    { code: "REPAIRING", label: "Đang được sửa chữa" },
  ],
  "08TRICH_LUC_VA_LUU_TRU_HO_SO": [
    { code: "SCHEDULE_COPY", label: "Hồ sơ đang được lên lịch sao y" },
    { code: "DRAFT_DONE", label: "Hồ sơ đã soạn xong" },
  ],
  "09CAP_GIAY_UY_QUYEN_GIOI_THIEU": [
    { code: "WAIT_HARDCOPY", label: "Đang chờ Người dùng nộp bản cứng" },
    { code: "BOD_SIGN", label: "Đang lấy chữ ký BOD" },
  ],
  "10DANG_KY_CONG_TAC": [
    { code: "CONTACT_SERVICES", label: "Liên hệ các dịch vụ" },
  ],
};

const STATUS_TO_STAGE = {
  APPROVED: "Xử lý",
  CANCELLED: "Hủy đơn",
  COMPLETED: "Hoàn thành",
  IN_PROGRESS: "Xử lý",
  NEEDS_INFO: "Bổ sung hồ sơ",
  REJECTED: "Hủy đơn",
  SUBMITTED: "Chờ duyệt",
} as const;

type RequestStatusKey = keyof typeof STATUS_TO_STAGE;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function bool(value: unknown) {
  if (value === true) return true;
  return ["1", "true", "yes", "y", "có", "co"].includes(
    text(value).toLocaleLowerCase("vi"),
  );
}

function list<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

function normalize(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/\s+/g, " ");
}

function legacyServiceCode(serviceCode: string, payload: JsonRecord) {
  const embedded = text(payload.serviceCode);
  if (embedded && /^\d{2}/.test(embedded)) return embedded.replace(/^(\d{2})_/, "$1");
  return SERVICE_MAP[serviceCode]?.legacy || serviceCode;
}

function serviceLabel(serviceCode: string, payload?: JsonRecord) {
  const embedded = text(payload?.serviceName);
  return embedded || SERVICE_MAP[serviceCode]?.label || serviceCode || "Đơn hàng";
}

function isAssetAllocationRequest(serviceCode: string, payload: JsonRecord) {
  const candidates = [
    serviceCode,
    payload.serviceCode,
    payload.maHeThong,
    payload.service,
  ].map((value) => normalize(value).replace(/[_-]+/g, " "));
  return candidates.some(
    (candidate) =>
      candidate === "asset allocation" ||
      candidate.includes("05de xuat cap phat") ||
      candidate.includes("de xuat cap phat"),
  );
}

function serviceNameMap() {
  const result: Record<string, string> = {};
  for (const [code, value] of Object.entries(LEGACY_SERVICE_MAP)) {
    result[code] = value.label;
  }
  result["03HOAN_UNG_CHI_PHI"] = "Hoàn ứng chi phí";
  return result;
}

export function extractInboxPayloadItems(payload: JsonRecord) {
  const visit = (value: unknown, depth = 0): JsonRecord[] => {
    if (depth > 4 || value == null) return [];
    if (typeof value === "string") {
      try {
        return visit(JSON.parse(value) as unknown, depth + 1);
      } catch {
        return [];
      }
    }
    if (Array.isArray(value)) {
      return value
        .filter((item) => item && typeof item === "object" && !Array.isArray(item))
        .map((item) => record(item));
    }
    if (typeof value !== "object") return [];

    const wrapper = record(value);
    // V3 lưu mảng ở `items`; dữ liệu migrated có thể nằm ở `rows`, `payload`
    // hoặc lồng thêm một lớp. Ưu tiên mảng thật để một đơn nhiều hồ sơ không
    // bị đọc nhầm thành một hồ sơ duy nhất.
    for (const key of ["items", "rows", "payload", "payload0"] as const) {
      if (!(key in wrapper)) continue;
      const items = visit(wrapper[key], depth + 1);
      if (items.length) return items;
      if (Array.isArray(wrapper[key])) return [];
    }

    return depth > 0 ? [wrapper] : [];
  };

  const items = visit(payload);
  return items.length ? items : [payload];
}

function payloadItems(payload: JsonRecord) {
  return extractInboxPayloadItems(payload);
}

function replacePayloadItems(payload: JsonRecord, items: JsonRecord[]) {
  const next = clone(payload);
  if (Array.isArray(next.items)) next.items = items;
  else if (Array.isArray(next.rows)) next.rows = items;
  else if (Array.isArray(next.payload)) next.payload = items;
  else if (next.payload && typeof next.payload === "object") {
    const nested = record(next.payload);
    if (Array.isArray(nested.items)) nested.items = items;
    else if (Array.isArray(nested.rows)) nested.rows = items;
    else if (Array.isArray(nested.payload)) nested.payload = items;
    else nested.items = items;
    next.payload = nested;
  }
  else if (next.payload0 && typeof next.payload0 === "object" && items.length === 1) {
    next.payload0 = items[0];
  } else {
    next.items = items;
  }
  if (next.payload0 && typeof next.payload0 === "object" && items[0]) {
    next.payload0 = items[0];
  }
  return next;
}

function stageFor(payload: JsonRecord, status: RequestStatusKey) {
  const embedded = text(payload.stage);
  const allowed = [
    "Chờ duyệt",
    "Tiếp nhận",
    "Xử lý",
    "Bổ sung hồ sơ",
    "Hoàn thành một phần",
    "Hoàn thành",
    "Hủy đơn",
  ];
  if (allowed.includes(embedded)) {
    if (status === "COMPLETED") return "Hoàn thành";
    if (status === "CANCELLED" || status === "REJECTED") return "Hủy đơn";
    if (status === "NEEDS_INFO") return "Bổ sung hồ sơ";
    if (status === "SUBMITTED") return "Chờ duyệt";
    return embedded;
  }
  return STATUS_TO_STAGE[status];
}

function statusForStage(stage: string) {
  switch (stage) {
    case "Chờ duyệt":
      return "SUBMITTED" as const;
    case "Bổ sung hồ sơ":
      return "NEEDS_INFO" as const;
    case "Hoàn thành":
      return "COMPLETED" as const;
    case "Hủy đơn":
      return "CANCELLED" as const;
    default:
      return "IN_PROGRESS" as const;
  }
}

function eventTypeForStage(stage: string) {
  switch (stage) {
    case "Chờ duyệt":
      return "SUBMITTED" as const;
    case "Bổ sung hồ sơ":
      return "NEEDS_INFO" as const;
    case "Hoàn thành":
      return "COMPLETED" as const;
    case "Hủy đơn":
      return "CANCELLED" as const;
    default:
      return "PROCESSING" as const;
  }
}

function dueIso(payload: JsonRecord, createdAt: Date, serviceCode: string) {
  const direct = text(payload.dueAt || record(payload.meta).dueAt);
  if (direct) return direct;
  const hours = Number(payload.slaHours || (serviceCode === "document-archive" ? 48 : 24));
  return new Date(createdAt.getTime() + (Number.isFinite(hours) ? hours : 24) * 3_600_000)
    .toISOString();
}

async function currentUserProfile(session: AppSession) {
  const user = await getDb().user.findUnique({
    include: {
      employee: {
        include: {
          company: true,
          personnelIdentityMemberships: {
            include: {
              link: {
                include: {
                  members: { include: { employee: true } },
                },
              },
            },
          },
        },
      },
    },
    where: { id: session.userId },
  });
  if (!user) throw new InboxRuntimeError("Phiên đăng nhập đã hết hạn.", 401);
  return user;
}

async function ownerIdentity(session: AppSession) {
  const user = await currentUserProfile(session);
  const employeeIds = new Set<string>();
  const employeeCodes = new Set<string>();
  const emails = new Set<string>([normalize(user.email)]);
  const names = new Set<string>([normalize(user.displayName)]);

  if (user.employee) {
    employeeIds.add(user.employee.id);
    employeeCodes.add(normalize(user.employee.employeeCode));
    if (user.employee.email) emails.add(normalize(user.employee.email));
    names.add(normalize(user.employee.fullName));
    for (const membership of user.employee.personnelIdentityMemberships) {
      for (const member of membership.link.members) {
        employeeIds.add(member.employee.id);
        employeeCodes.add(normalize(member.employee.employeeCode));
        if (member.employee.email) emails.add(normalize(member.employee.email));
        names.add(normalize(member.employee.fullName));
      }
    }
  }
  return { emails, employeeCodes, employeeIds, names, user };
}

function requestOwnedBy(
  request: {
    createdById: string;
    createdBy: {
      displayName: string;
      email: string;
      employeeId: string | null;
    };
    payload: unknown;
  },
  identity: Awaited<ReturnType<typeof ownerIdentity>>,
) {
  if (request.createdById === identity.user.id) return true;
  if (request.createdBy.employeeId && identity.employeeIds.has(request.createdBy.employeeId)) {
    return true;
  }
  const payload = record(request.payload);
  const meta = record(payload.meta);
  const employee = record(payload.employee);
  const legacy = record(payload._legacy98Inbox);
  const codeCandidates = [
    payload.employeeId,
    payload.requesterEmployeeId,
    payload.actorEmployeeId,
    payload.createdByEmployeeId,
    meta.actorEmployeeId,
    meta.requesterEmployeeId,
    employee.id,
    legacy.creatorEmployeeCode,
  ].map(normalize);
  if (codeCandidates.some((value) => value && identity.employeeCodes.has(value))) {
    return true;
  }
  const emailCandidates = [
    payload.email,
    payload.requesterEmail,
    payload.actorEmail,
    request.createdBy.email,
  ].map(normalize);
  if (emailCandidates.some((value) => value && identity.emails.has(value))) {
    return true;
  }
  return false;
}

const requestInclude = {
  assignedTo: { select: { displayName: true } },
  attachments: { orderBy: { createdAt: "asc" as const } },
  company: { select: { code: true, legalName: true, shortName: true } },
  createdBy: {
    select: {
      displayName: true,
      email: true,
      employeeId: true,
      employee: {
        select: {
          department: true,
          employeeCode: true,
          fullName: true,
          title: true,
        },
      },
    },
  },
  events: {
    include: { actor: { select: { displayName: true } } },
    orderBy: { createdAt: "asc" as const },
  },
  followUps: { orderBy: { createdAt: "desc" as const } },
  items: {
    include: {
      legalDossier: {
        include: {
          company: true,
          documentRegistry: true,
          documentType: { include: { companyNumbering: true } },
        },
      },
    },
    orderBy: { itemIndex: "asc" as const },
  },
};

async function allRequests(extraWhere: Prisma.RequestWhereInput = {}) {
  return getDb().request.findMany({
    include: requestInclude,
    orderBy: [{ createdAt: "desc" }],
    where: { ...extraWhere, archivedAt: null },
  });
}

function ticketFromRequest(
  request: Awaited<ReturnType<typeof allRequests>>[number],
  identity?: Awaited<ReturnType<typeof ownerIdentity>>,
) {
  let payload = clone(record(request.payload));
  const code = legacyServiceCode(request.serviceCode, payload);
  const stage = stageFor(payload, request.status as RequestStatusKey);
  // Metadata phục vụ di dời không thuộc JSON gốc mà người dùng thấy trong Inbox.
  // Bỏ khỏi DTO để modal 1:1 gọn và tránh gửi lại nguyên payload trùng lặp.
  delete payload._legacy98Inbox;
  const items = payloadItems(payload);

  if (!items.length && request.items.length) {
    payload = replacePayloadItems(
      payload,
      request.items.map((item) => clone(record(item.payload))),
    );
  }

  const normalizedItems = payloadItems(payload);
  if (request.attachments.length) {
    const signatureFileIds = electronicSignatureFileIds(payload);
    const attachments = request.attachments
      .filter(
        (file) =>
          !file.fileObjectId || !signatureFileIds.has(file.fileObjectId),
      )
      .map((file) => ({
      fileId: file.fileObjectId || "",
      mimeType: file.mimeType || "",
      name: file.fileName,
      size: file.sizeBytes || 0,
      url: file.fileObjectId
        ? `/api/requests/files/${encodeURIComponent(file.fileObjectId)}`
        : file.fileUrl,
      }));
    if (normalizedItems[0]) {
      const existing = list(normalizedItems[0].files);
      normalizedItems[0] = {
        ...normalizedItems[0],
        files: [...existing, ...attachments],
      };
      payload = replacePayloadItems(payload, normalizedItems);
    } else {
      payload.files = attachments;
    }
  }

  const issuedItems = request.items
    .map((item) => {
      const dossier = item.legalDossier;
      if (!dossier?.documentRegistry?.documentNumber) return null;
      return {
        companyName:
          dossier.companyNameSnapshot ||
          dossier.company?.shortName ||
          dossier.company?.legalName ||
          "",
        currentNumber: dossier.documentRegistry.documentNumber,
        documentNumber: dossier.documentRegistry.documentNumber,
        documentTypeName:
          dossier.documentTypeSnapshot || dossier.documentType?.name || item.title || "",
        fileStatus: dossier.fileStatus,
        numberStatus: dossier.numberStatus,
        registryId: dossier.id,
        requestId: request.code,
        serial: dossier.documentRegistry.serial,
      };
    })
    .filter(Boolean);
  if (issuedItems.length) {
    payload.documentRegistryIssuedItems = issuedItems;
    payload.issuedDocumentNumbers = issuedItems.map((item) => item?.documentNumber);
    payload.documentRegistryIssuedAt =
      request.completedAt?.toISOString() || request.updatedAt.toISOString();
  }

  payload.stage = stage;
  payload.serviceCode = text(payload.serviceCode) || code;
  payload.serviceName = text(payload.serviceName) || serviceLabel(request.serviceCode, payload);
  payload.requestId = text(payload.requestId) || request.code;
  payload.createdAt = text(payload.createdAt) || request.createdAt.toISOString();
  payload.updatedAt = request.updatedAt.toISOString();
  payload.dueAt = dueIso(payload, request.createdAt, request.serviceCode);
  if (!payload.employee || typeof payload.employee !== "object") {
    payload.employee = {
      dept: request.createdBy.employee?.department || "",
      id: request.createdBy.employee?.employeeCode || "",
      name: request.createdBy.displayName,
    };
  }

  const pendingFollowUp = request.followUps.find(
    (followUp) => normalize(followUp.status) === "pending",
  );
  const first = payloadItems(payload)[0] || {};
  const documentName =
    text(
      payload.manualDocumentName ||
        payload.displayDocumentName ||
        payload.documentName ||
        payload.generatedName ||
        first.storageGeneratedName ||
        first.generatedName ||
        first.documentName ||
        first.tenHoSo ||
        first.hoso ||
        first.name ||
        first.title,
    ) || request.title;
  const allocationReceiptView =
    identity && isAssetAllocationRequest(request.serviceCode, payload)
      ? buildAllocationReceiptView(payloadItems(payload), identity)
      : null;
  const allocationReceipt = allocationReceiptView
    ? {
        ...allocationReceiptView,
        canConfirm: stage === "Hoàn thành",
      }
    : null;

  return {
    allocationReceipt,
    assignedTo: request.assignedTo?.displayName || "",
    attachments: request.attachments.map((file) => ({
      fileId: file.fileObjectId || "",
      fileName: file.fileName,
      fileUrl: file.fileObjectId
        ? `/api/requests/files/${encodeURIComponent(file.fileObjectId)}`
        : file.fileUrl,
      mimeType: file.mimeType || "",
      sizeBytes: file.sizeBytes || 0,
    })),
    completedAt: request.completedAt?.toISOString() || "",
    createdAt: request.createdAt.toISOString(),
    department:
      request.createdBy.employee?.department ||
      text(payload.requesterDepartment || record(payload.employee).dept),
    documentName,
    duLieuJson: JSON.stringify(payload),
    dueAt: payload.dueAt,
    events: request.events.map((event) => ({
      actor: event.actor?.displayName || "Hệ thống",
      createdAt: event.createdAt.toISOString(),
      fromStatus: event.fromStatus,
      note: event.note || "",
      toStatus: event.toStatus,
      type: event.type,
    })),
    followUp: pendingFollowUp
      ? {
          dueAt: "",
          note: pendingFollowUp.reason || "",
          status: pendingFollowUp.status,
          type: pendingFollowUp.type,
        }
      : null,
    followUpPending: Boolean(pendingFollowUp),
    json: payload,
    khanCap: bool(payload.urgent) || normalize(request.priority) === "khan cap",
    maDon: request.code,
    maDonDv: request.code,
    maHeThong: code,
    mnvNguoiTao:
      request.createdBy.employee?.employeeCode ||
      text(payload.employeeId || payload.requesterEmployeeId),
    ngayTao: text(payload.createdAt) || request.createdAt.toISOString(),
    nguoiTao: request.createdBy.displayName,
    note: request.note || text(payload.note),
    phongBan:
      request.createdBy.employee?.department ||
      text(payload.requesterDepartment || record(payload.employee).dept),
    priority: request.priority || "",
    requestDbId: request.id,
    requestId: request.code,
    serviceCode: code,
    serviceName: serviceLabel(request.serviceCode, payload),
    tenHeThong: serviceLabel(request.serviceCode, payload),
    title: request.title,
    trangThai: stage,
    updatedAt: request.updatedAt.toISOString(),
  };
}

async function listTickets(session: AppSession, mine: boolean) {
  if (!mine) {
    return (await allRequests()).map((request) => ticketFromRequest(request));
  }
  const identity = await ownerIdentity(session);
  const db = getDb();
  const employeeIds = [...identity.employeeIds].filter(Boolean);
  const employeeCodes = [...identity.employeeCodes].filter(Boolean);
  const emails = [...identity.emails].filter(Boolean);
  const names = [...identity.names].filter(Boolean);
  const linkedUsers = await db.user.findMany({
    select: { id: true },
    where: {
      OR: [
        { id: session.userId },
        ...(employeeIds.length ? [{ employeeId: { in: employeeIds } }] : []),
        ...(emails.length
          ? [{ email: { in: emails, mode: "insensitive" as const } }]
          : []),
      ],
    },
  });
  const ownerFilters: Prisma.RequestWhereInput[] = [
    { createdById: { in: linkedUsers.map((user) => user.id) } },
  ];
  for (const employeeCode of employeeCodes) {
    for (const path of [
      ["employeeId"],
      ["requesterEmployeeId"],
      ["actorEmployeeId"],
      ["createdByEmployeeId"],
      ["meta", "actorEmployeeId"],
      ["meta", "requesterEmployeeId"],
      ["employee", "id"],
      ["_legacy98Inbox", "creatorEmployeeCode"],
    ]) {
      ownerFilters.push({ payload: { equals: employeeCode, path } });
    }
  }
  for (const email of emails) {
    for (const path of [["email"], ["requesterEmail"], ["actorEmail"]]) {
      ownerFilters.push({ payload: { equals: email, path } });
    }
  }
  for (const name of names) {
    for (const path of [
      ["requesterName"],
      ["employeeName"],
      ["actorName"],
      ["employee", "name"],
    ]) {
      ownerFilters.push({
        payload: { mode: "insensitive", path, string_contains: name },
      });
    }
  }
  const requests = await allRequests({
    OR: [
      ...ownerFilters,
      { serviceCode: { in: ["asset-allocation", "05DE_XUAT_CAP_PHAT"] } },
      { payload: { equals: "05DE_XUAT_CAP_PHAT", path: ["serviceCode"] } },
    ],
  });
  return requests
    .filter((request) => {
      if (requestOwnedBy(request, identity)) return true;
      if (!isAssetAllocationRequest(request.serviceCode, record(request.payload))) {
        return false;
      }
      return Boolean(
        buildAllocationReceiptView(payloadItems(record(request.payload)), identity),
      );
    })
    .map((request) => ticketFromRequest(request, identity));
}

// Adapter chỉ chạy phía server cho Bàn làm việc. Giữ nguyên toàn bộ logic nhận
// diện chủ đơn cũ để widget không bỏ sót dữ liệu đã nhập từ 98_Inbox.
export async function listMyInboxTicketsForWorkbench(session: AppSession) {
  return listTickets(session, true);
}

function requireAdminRead(session: AppSession) {
  if (!canAny(session, ["admin_requests.read", "admin_requests.process"])) {
    throw new InboxRuntimeError(
      "Tài khoản này chưa được cấp quyền mở module order-management.",
      403,
    );
  }
}

function requireAdminProcess(session: AppSession) {
  if (!can(session, "admin_requests.process")) {
    throw new InboxRuntimeError("Tài khoản chưa có quyền xử lý đơn hàng.", 403);
  }
}

async function requestByCode(requestId: string) {
  const db = getDb();
  const request = await db.request.findFirst({
    include: requestInclude,
    where: {
      archivedAt: null,
      OR: [{ id: requestId }, { code: requestId }],
    },
  });
  if (!request) throw new InboxRuntimeError("Không tìm thấy đơn hàng.");
  return request;
}

async function writeAudit(
  session: AppSession,
  requestId: string,
  summary: string,
  metadata?: JsonRecord,
) {
  await getDb().auditLog.create({
    data: {
      action: "UPDATE",
      actorId: session.userId,
      metadata: metadata ? inputJson(metadata) : undefined,
      summary,
      targetId: requestId,
      targetType: "Request",
    },
  });
}

async function updateStage(
  session: AppSession,
  requestId: string,
  nextStage: string,
  note?: string,
  stepCode?: string | null,
) {
  requireAdminProcess(session);
  let request = await requestByCode(requestId);
  if (await getDb().digitalSignatureWorkflow.findUnique({ where: { requestId: request.id } })) {
    throw new InboxRuntimeError(
      "Hồ sơ Ký số được xử lý tại tab Ký số trong Quản lý đơn hàng.",
    );
  }
  if (normalize(nextStage) === normalize("Xử lý")) {
    try {
      await renameElectronicSignatureInputsForProcessing(session, request.id);
      request = await requestByCode(request.id);
    } catch (error) {
      throw new InboxRuntimeError(
        error instanceof Error
          ? error.message
          : "Không đổi tên được file ký điện tử.",
      );
    }
  }
  if (normalize(nextStage) === normalize("Hoàn thành")) {
    try {
      assertElectronicSignatureCompletionReady(record(request.payload));
    } catch (error) {
      throw new InboxRuntimeError(
        error instanceof Error
          ? error.message
          : "Hồ sơ ký điện tử chưa có file Hành chính đã ký.",
      );
    }
  }
  const oldStage = stageFor(record(request.payload), request.status as RequestStatusKey);
  const status = statusForStage(nextStage);
  const payload = clone(record(request.payload));
  payload.stage = nextStage;
  payload.updatedAt = new Date().toISOString();
  if (note !== undefined) payload.note = note;
  if (stepCode !== undefined) {
    const service = legacyServiceCode(request.serviceCode, payload);
    const step = WORKFLOW_STEPS[service]?.find((item) => item.code === stepCode);
    if (stepCode) {
      payload.stepCode = stepCode;
      payload.stepLabel = step?.label || "";
    } else {
      delete payload.stepCode;
      delete payload.stepLabel;
    }
  }

  const completedAt =
    status === "COMPLETED"
      ? request.completedAt || new Date()
      : status === "CANCELLED"
        ? request.completedAt
        : null;

  await getDb().$transaction(async (tx) => {
    await tx.request.update({
      data: {
        assignedToId:
          ["Tiếp nhận", "Xử lý"].includes(nextStage)
            ? session.userId
            : request.assignedToId,
        completedAt,
        note: note !== undefined ? note || null : request.note,
        payload: inputJson(payload),
        status,
      },
      where: { id: request.id },
    });
    await tx.requestItem.updateMany({
      data: {
        status:
          status === "COMPLETED"
            ? "COMPLETED"
            : status === "CANCELLED"
              ? "CANCELLED"
              : status === "NEEDS_INFO"
                ? "NEEDS_INFO"
                : "PROCESSING",
      },
      where: { requestId: request.id },
    });
    await tx.legalDossier.updateMany({
      data: { orderStatus: nextStage },
      where: { requestItem: { requestId: request.id } },
    });
    await tx.requestEvent.create({
      data: {
        actorId: session.userId,
        fromStatus: request.status,
        note: note || (oldStage === nextStage ? "" : `${oldStage} → ${nextStage}`),
        requestId: request.id,
        toStatus: status,
        type: eventTypeForStage(nextStage),
      },
    });
  });
  await writeAudit(
    session,
    request.id,
    `Request ${request.code}: ${oldStage} -> ${nextStage}.`,
  );

  const updated = await requestByCode(request.id);
  const ticket = ticketFromRequest(updated);
  return {
    json: ticket.json,
    ok: true,
    stage: ticket.trangThai,
    stepCode: text(record(ticket.json).stepCode),
    stepLabel: text(record(ticket.json).stepLabel),
  };
}

async function cancelMine(session: AppSession, requestId: string, note: string) {
  const request = await requestByCode(requestId);
  const identity = await ownerIdentity(session);
  if (!requestOwnedBy(request, identity)) {
    throw new InboxRuntimeError("Bạn không có quyền hủy đơn này.", 403);
  }
  if (["COMPLETED", "CANCELLED", "REJECTED"].includes(request.status)) {
    throw new InboxRuntimeError("Đơn đã kết thúc nên không thể hủy.");
  }
  const signatureWorkflow = await getDb().digitalSignatureWorkflow.findUnique({
    where: { requestId: request.id },
  });
  if (signatureWorkflow && ["SIGN_QUEUED", "SIGN_PENDING", "SIGN_UNKNOWN", "SIGNED"].includes(signatureWorkflow.state)) {
    throw new InboxRuntimeError(
      "Hồ sơ đã gửi sang MISA eSign nên không thể hủy tự động. Liên hệ Admin để đối chiếu giao dịch.",
    );
  }
  const payload = clone(record(request.payload));
  payload.stage = "Hủy đơn";
  payload.updatedAt = new Date().toISOString();
  const meta = record(payload.meta);
  payload.meta = {
    ...meta,
    cancelNote: note,
    serverTs: new Date().toISOString(),
  };
  await getDb().$transaction(async (tx) => {
    await tx.request.update({
      data: {
        note: note || request.note,
        payload: inputJson(payload),
        status: "CANCELLED",
      },
      where: { id: request.id },
    });
    await tx.requestItem.updateMany({
      data: { status: "CANCELLED" },
      where: { requestId: request.id },
    });
    if (signatureWorkflow) {
      await tx.digitalSignatureWorkflow.update({
        where: { id: signatureWorkflow.id },
        data: {
          state: "CANCELLED",
          error: note || "Người dùng hủy hồ sơ.",
          leaseToken: null,
          leaseExpiresAt: null,
          version: { increment: 1 },
        },
      });
    }
    await tx.legalDossier.updateMany({
      data: { orderStatus: "Hủy đơn" },
      where: { requestItem: { requestId: request.id } },
    });
    await tx.requestEvent.create({
      data: {
        actorId: session.userId,
        fromStatus: request.status,
        note: note || "Người dùng hủy đơn.",
        requestId: request.id,
        toStatus: "CANCELLED",
        type: "CANCELLED",
      },
    });
  });
  return { ok: true, stage: "Hủy đơn" };
}

async function confirmMyAllocationReceipt(
  session: AppSession,
  requestId: string,
) {
  const request = await requestByCode(requestId);
  const payload = clone(record(request.payload));
  if (!isAssetAllocationRequest(request.serviceCode, payload)) {
    throw new InboxRuntimeError(
      "Xác nhận đã nhận chỉ áp dụng cho đề xuất cấp phát.",
    );
  }
  if (["CANCELLED", "REJECTED"].includes(request.status)) {
    throw new InboxRuntimeError("Đơn đã hủy nên không thể xác nhận đã nhận.");
  }
  if (
    stageFor(payload, request.status as RequestStatusKey) !== "Hoàn thành"
  ) {
    throw new InboxRuntimeError(
      "Đề xuất chưa hoàn tất cấp phát. Bạn chỉ xác nhận sau khi đã nhận hàng thực tế.",
    );
  }

  const identity = await ownerIdentity(session);
  const rows = payloadItems(payload);
  const now = new Date();
  const result = confirmAllocationReceiptRows(
    rows,
    identity,
    {
      employeeCode: identity.user.employee?.employeeCode || "",
      employeeId: identity.user.employee?.id || "",
      name: identity.user.displayName,
      userId: session.userId,
    },
    now.toISOString(),
  );
  if (!result.confirmedIndexes.length && !result.alreadyConfirmedIndexes.length) {
    throw new InboxRuntimeError(
      "Tài khoản này không nằm trong danh sách người nhận của đề xuất cấp phát.",
      403,
    );
  }

  if (result.confirmedIndexes.length) {
    const nextPayload = replacePayloadItems(payload, result.rows);
    const receivedCount = result.rows.filter((row) => {
      const receipt = record(row.recipientReceipt);
      return normalize(receipt.status) === "received";
    }).length;
    nextPayload.allocationReceiptSummary = {
      pendingCount: Math.max(0, result.rows.length - receivedCount),
      receivedCount,
      totalCount: result.rows.length,
      updatedAt: now.toISOString(),
    };
    nextPayload.updatedAt = now.toISOString();

    const receivedItems = result.confirmedIndexes.map((itemIndex) => {
      const row = result.rows[itemIndex] || {};
      const name = text(row.itemName || row.name || row.title) || `Mục ${itemIndex + 1}`;
      const quantity = text(row.quantity || row.qty || row.soLuong) || "1";
      return `${name} (SL ${quantity})`;
    });
    const note = `${identity.user.displayName} xác nhận đã nhận: ${receivedItems.join(", ")}.`;

    await getDb().$transaction(async (tx) => {
      await tx.request.update({
        data: { payload: inputJson(nextPayload) },
        where: { id: request.id },
      });
      await tx.requestEvent.create({
        data: {
          actorId: session.userId,
          fromStatus: request.status,
          note,
          requestId: request.id,
          toStatus: request.status,
          type: "COMMENT",
        },
      });
    });
    await writeAudit(session, request.id, note, {
      confirmedItemIndexes: result.confirmedIndexes,
      kind: "ASSET_ALLOCATION_RECEIPT",
    });
  }

  const updated = await requestByCode(request.id);
  const ticket = ticketFromRequest(updated, identity);
  return {
    allocationReceipt: ticket.allocationReceipt,
    alreadyConfirmed: result.confirmedIndexes.length === 0,
    json: ticket.json,
    message: result.confirmedIndexes.length
      ? `Đã ghi nhận ${result.confirmedIndexes.length} mục cấp phát bạn đã nhận.`
      : "Các mục cấp phát của bạn đã được xác nhận trước đó.",
    ok: true,
    ticket,
  };
}

async function reopenSeal(session: AppSession, requestId: string, note: string) {
  const request = await requestByCode(requestId);
  const identity = await ownerIdentity(session);
  if (!requestOwnedBy(request, identity)) {
    throw new InboxRuntimeError("Bạn không có quyền mở lại đơn này.", 403);
  }
  if (request.serviceCode !== "document-seal" || request.status !== "COMPLETED") {
    throw new InboxRuntimeError(
      "Chỉ hồ sơ Đóng dấu đã hoàn thành mới có thể xin lại dấu.",
    );
  }
  const now = new Date();
  let payload = clone(record(request.payload));
  const previous = record(payload.sealReissue);
  const count = Number(previous.count || payload.sealReissueCount || 0) + 1;
  payload = {
    ...payload,
    completedAt: undefined,
    dueAt: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
    sealReissue: {
      ...previous,
      active: true,
      count,
      label: "Hồ sơ xin lại dấu",
      reason:
        note || "Người dùng yêu cầu xử lý lại hồ sơ đóng dấu trên cùng mã đơn.",
      requested: true,
      requestedAt: now.toISOString(),
    },
    sealReissueCount: count,
    stage: "Chờ duyệt",
    updatedAt: now.toISOString(),
  };
  delete payload.stepCode;
  delete payload.stepLabel;
  const tags = list<string>(payload.tags).filter(Boolean);
  if (!tags.some((tag) => normalize(tag) === "ho so xin lai dau")) {
    tags.push("Hồ sơ xin lại dấu");
  }
  payload.tags = tags;
  await getDb().$transaction(async (tx) => {
    await tx.request.update({
      data: {
        completedAt: null,
        payload: inputJson(payload),
        status: "SUBMITTED",
      },
      where: { id: request.id },
    });
    await tx.requestItem.updateMany({
      data: { status: "PENDING" },
      where: { requestId: request.id },
    });
    await tx.legalDossier.updateMany({
      data: { orderStatus: "Chờ duyệt" },
      where: { requestItem: { requestId: request.id } },
    });
    await tx.requestEvent.create({
      data: {
        actorId: session.userId,
        fromStatus: request.status,
        note: note || "Người dùng xin lại dấu.",
        requestId: request.id,
        toStatus: "SUBMITTED",
        type: "SUBMITTED",
      },
    });
  });
  return { json: payload, ok: true, reissue: payload.sealReissue, stage: "Chờ duyệt" };
}

function itemNamePatch(item: JsonRecord, name: string) {
  const next: JsonRecord = {
    ...item,
    documentName: name,
    generatedName: name,
    tenHoSo: name,
    tenHoSoGoiY: name,
    updatedAt: new Date().toISOString(),
  };
  if (item.storageGeneratedName != null || normalize(item.module) === "luu tru") {
    next.storageGeneratedName = name;
  }
  return next;
}

async function renameRequest(
  session: AppSession,
  requestId: string,
  documentName: string,
) {
  requireAdminProcess(session);
  if (!documentName) throw new InboxRuntimeError("Vui lòng nhập tên hồ sơ.");
  const request = await requestByCode(requestId);
  const payload = {
    ...clone(record(request.payload)),
    displayDocumentName: documentName,
    documentName,
    manualDocumentName: documentName,
    updatedAt: new Date().toISOString(),
  };
  await getDb().request.update({
    data: { payload: inputJson(payload) },
    where: { id: request.id },
  });
  await writeAudit(session, request.id, `Đổi tên hồ sơ ${request.code}: ${documentName}.`);
  return { documentName, json: payload, ok: true };
}

async function renameItem(
  session: AppSession,
  input: JsonRecord,
) {
  requireAdminProcess(session);
  const request = await requestByCode(text(input.requestId));
  const itemIndex = Math.max(0, Number(input.itemIndex || 1) - 1);
  const documentName = text(input.documentName);
  if (!documentName) throw new InboxRuntimeError("Vui lòng nhập tên hồ sơ.");
  const rows = payloadItems(record(request.payload));
  if (!rows[itemIndex]) throw new InboxRuntimeError("Không tìm thấy mục hồ sơ.");
  rows[itemIndex] = itemNamePatch(rows[itemIndex], documentName);
  let payload = replacePayloadItems(record(request.payload), rows);
  if (rows.length === 1) {
    payload = {
      ...payload,
      displayDocumentName: documentName,
      documentName,
    };
  }
  payload.updatedAt = new Date().toISOString();
  await getDb().$transaction(async (tx) => {
    await tx.request.update({
      data: { payload: inputJson(payload) },
      where: { id: request.id },
    });
    const requestItem = request.items[itemIndex];
    if (requestItem) {
      await tx.requestItem.update({
        data: {
          payload: inputJson(rows[itemIndex]),
          title: documentName,
        },
        where: { id: requestItem.id },
      });
    }
  });
  await writeAudit(
    session,
    request.id,
    `Đổi tên mục ${itemIndex + 1} của ${request.code}: ${documentName}.`,
  );
  return { documentName, itemIndex: itemIndex + 1, json: payload, ok: true };
}

async function updateSealItem(session: AppSession, input: JsonRecord) {
  requireAdminProcess(session);
  const request = await requestByCode(text(input.requestId));
  const itemIndex = Math.max(0, Number(input.itemIndex || 1) - 1);
  const rows = payloadItems(record(request.payload));
  if (await getDb().digitalSignatureWorkflow.findUnique({ where: { requestId: request.id } })) {
    throw new InboxRuntimeError(
      "Hồ sơ Ký số đã khóa PDF, vùng ký và pháp nhân. Nếu cần thay đổi, hãy từ chối rồi tạo hồ sơ mới.",
    );
  }
  if (!rows[itemIndex]) throw new InboxRuntimeError("Không tìm thấy mục đóng dấu.");
  const documentTypeName = text(input.documentTypeName || input.loai);
  const companyName = text(input.companyName || input.phapNhan);
  const partner = text(input.partner || input.doiTac);
  const signedDate = text(input.date || input.ngayKy);
  const documentName = text(input.documentName);
  const stamps = list<string>(input.stamps || input.dau).map(text).filter(Boolean);
  if (!documentTypeName || !companyName || !partner || !signedDate || !documentName) {
    throw new InboxRuntimeError("Thông tin mục đóng dấu chưa đầy đủ.");
  }
  if (!stamps.length) throw new InboxRuntimeError("Vui lòng chọn ít nhất một loại dấu.");
  const currentElectronic = isElectronicSignatureItem(rows[itemIndex]);
  const nextElectronic = isElectronicSignatureItem({
    ...rows[itemIndex],
    dau: stamps,
    sealTypes: stamps,
    stamps,
  });
  const currentSignatureFiles = [
    ...signatureFiles(rows[itemIndex], "input"),
    ...signatureFiles(rows[itemIndex], "output"),
  ];
  if (currentElectronic && !nextElectronic && currentSignatureFiles.length) {
    throw new InboxRuntimeError(
      "Không thể bỏ Ký số sau khi hồ sơ đã có file.",
    );
  }
  if (!currentElectronic && nextElectronic) {
    throw new InboxRuntimeError(
      "Không thể thêm Ký số tại Quản lý đơn hàng vì người dùng chưa nạp PDF và vùng ký.",
    );
  }
  const customNumberingText = text(
    input.customNumberingText || input.counterpartyShortName,
  );
  const patch: JsonRecord = {
    ...rows[itemIndex],
    companyDisplayName: companyName,
    companyName,
    companyNames: [companyName],
    counterpartyShortName: customNumberingText,
    customNumberingText,
    date: signedDate,
    dau: stamps,
    documentName,
    documentTypeChoice: documentTypeName,
    documentTypeName,
    doiTac: partner,
    generatedName: documentName,
    legalEntityValues: [companyName],
    loai: documentTypeName,
    ngayKy: signedDate,
    partner,
    phapNhan: companyName,
    phapNhanDisplay: companyName,
    phapNhanList: [companyName],
    primaryPhapNhan: companyName,
    shortPartnerName: customNumberingText,
    signedDate,
    stamps,
    tenHoSo: documentName,
    tenHoSoGoiY: documentName,
    type: documentTypeName,
    updatedAt: new Date().toISOString(),
  };
  rows[itemIndex] = patch;
  const payload = {
    ...replacePayloadItems(record(request.payload), rows),
    updatedAt: new Date().toISOString(),
  };
  const [documentType, company] = await Promise.all([
    getDb().documentType.findFirst({
      where: {
        OR: [
          { name: { equals: documentTypeName, mode: "insensitive" } },
          Number.isFinite(Number(input.documentTypeRowIndex))
            ? { legacySheetRow: Number(input.documentTypeRowIndex) }
            : { id: "__never__" },
        ],
      },
    }),
    getDb().company.findFirst({
      where: {
        OR: [
          { legalName: { equals: companyName, mode: "insensitive" } },
          { shortName: { equals: companyName, mode: "insensitive" } },
          { code: { equals: companyName, mode: "insensitive" } },
        ],
      },
    }),
  ]);
  const requestItem = request.items[itemIndex];
  await getDb().$transaction(async (tx) => {
    await tx.request.update({
      data: { payload: inputJson(payload) },
      where: { id: request.id },
    });
    if (requestItem) {
      await tx.requestItem.update({
        data: {
          payload: inputJson(patch),
          title: [documentTypeName, partner].filter(Boolean).join(" · "),
        },
        where: { id: requestItem.id },
      });
      if (requestItem.legalDossier) {
        await tx.legalDossier.update({
          data: {
            companyId: company?.id || requestItem.legalDossier.companyId,
            companyNameSnapshot: company?.legalName || companyName,
            companyShortSnapshot:
              company?.shortName || company?.code || companyName,
            documentTypeId:
              documentType?.id || requestItem.legalDossier.documentTypeId,
            documentTypeSnapshot: documentType?.name || documentTypeName,
            conditionSnapshot:
              documentType?.condition ||
              text(patch.documentCondition) ||
              requestItem.legalDossier.conditionSnapshot,
            numberStatus: documentType?.takesNumber ? "PENDING" : "NONE",
            takesNumber:
              documentType?.takesNumber ?? requestItem.legalDossier.takesNumber,
          },
          where: { id: requestItem.legalDossier.id },
        });
      }
    }
  });
  await writeAudit(
    session,
    request.id,
    `Cập nhật mục đóng dấu ${itemIndex + 1} của ${request.code}.`,
  );
  return { item: patch, itemIndex: itemIndex + 1, json: payload, ok: true };
}

function archiveResultFiles(value: string, item: JsonRecord) {
  const results = value
    .split(/[\n,]+/)
    .map(text)
    .filter((entry) => /^https?:\/\//i.test(entry))
    .map((url, index) => ({
      fileId: "",
      name:
        text(item.archiveSourceFileName || item.fileName || item.name) ||
        `File phản hồi ${index + 1}`,
      url,
    }));
  if (!results.length) {
    const fallbackUrl = text(
      item.archiveSourceFileUrl || item.sourceFileUrl || item.fileUrl,
    );
    const fallbackId = text(
      item.archiveSourceFileId || item.sourceFileId || item.fileId,
    );
    if (fallbackUrl || fallbackId) {
      results.push({
        fileId: fallbackId,
        name:
          text(item.archiveSourceFileName || item.fileName || item.name) ||
          "File trích lục",
        url: fallbackUrl,
      });
    }
  }
  return results;
}

function archiveDone(item: JsonRecord) {
  const status = normalize(
    item.fulfillmentStatus ||
      item.archiveStatus ||
      item.outputStatus ||
      item.resultStatus,
  );
  return ["done", "completed", "hoan thanh", "da tra file"].some((value) =>
    status.includes(value),
  );
}

async function updateArchiveItem(session: AppSession, input: JsonRecord) {
  requireAdminProcess(session);
  const request = await requestByCode(text(input.requestId));
  const itemIndex = Math.max(0, Number(input.itemIndex || 1) - 1);
  const action = text(input.action);
  const rows = payloadItems(record(request.payload));
  const current = rows[itemIndex];
  if (!current) throw new InboxRuntimeError("Không tìm thấy mục Trích lục.");
  const now = new Date().toISOString();
  const note = text(input.note || input.resultLinks);
  let patch: JsonRecord;
  if (action === "reopen") {
    patch = {
      fulfillmentNote: "",
      fulfillmentStatus: "pending",
      fulfillmentType: "",
      fulfilledAt: "",
      resultFiles: [],
    };
  } else if (action === "scan") {
    const resultFiles = archiveResultFiles(text(input.resultLinks), current);
    if (!resultFiles.length) {
      throw new InboxRuntimeError(
        "Kho lưu trữ chưa có file cho mục này. Vui lòng dán link file phản hồi trước khi trả file.",
      );
    }
    patch = {
      fulfillmentNote: note,
      fulfillmentStatus: "done",
      fulfillmentType: "scan",
      fulfilledAt: now,
      resultFiles,
    };
  } else {
    patch = {
      fulfillmentNote: note,
      fulfillmentStatus: "done",
      fulfillmentType: "hard-copy",
      fulfilledAt: now,
    };
  }
  rows[itemIndex] = { ...current, ...patch, updatedAt: now };
  const doneCount = rows.filter(archiveDone).length;
  const stage =
    rows.length && doneCount === rows.length
      ? "Hoàn thành"
      : doneCount
        ? "Hoàn thành một phần"
        : "Xử lý";
  const status = statusForStage(stage);
  const payload = {
    ...replacePayloadItems(record(request.payload), rows),
    stage,
    updatedAt: now,
  };
  const requestItem = request.items[itemIndex];
  await getDb().$transaction(async (tx) => {
    await tx.request.update({
      data: {
        completedAt: status === "COMPLETED" ? new Date() : null,
        payload: inputJson(payload),
        status,
      },
      where: { id: request.id },
    });
    if (requestItem) {
      await tx.requestItem.update({
        data: {
          payload: inputJson(rows[itemIndex]),
          status: archiveDone(rows[itemIndex]) ? "COMPLETED" : "PROCESSING",
        },
        where: { id: requestItem.id },
      });
      if (requestItem.legalDossier) {
        await tx.legalDossier.update({
          data: { orderStatus: stage },
          where: { id: requestItem.legalDossier.id },
        });
      }
    }
    await tx.requestEvent.create({
      data: {
        actorId: session.userId,
        fromStatus: request.status,
        note:
          action === "scan"
            ? `Đã trả file mục ${itemIndex + 1}.`
            : action === "reopen"
              ? `Mở lại mục ${itemIndex + 1}.`
              : `Hoàn thành mục ${itemIndex + 1}.${note ? ` ${note}` : ""}`,
        requestId: request.id,
        toStatus: status,
        type: status === "COMPLETED" ? "COMPLETED" : "PROCESSING",
      },
    });
  });
  await writeAudit(
    session,
    request.id,
    `Cập nhật mục Trích lục ${itemIndex + 1} của ${request.code}: ${action}.`,
  );
  return {
    itemIndex: itemIndex + 1,
    json: payload,
    ok: true,
    resultFiles: list(rows[itemIndex].resultFiles),
    stage,
  };
}

function tokensOf(value: unknown): FormatToken[] {
  return list<JsonRecord>(value).map((token) => ({
    type: text(token.type),
    ...(token.value != null ? { value: text(token.value) } : {}),
  }));
}

function signDateOf(item: JsonRecord) {
  const raw = text(
    item.date || item.ngayKy || item.signedDate || item.storageIssuedDate,
  );
  const date = raw ? new Date(`${raw.slice(0, 10)}T00:00:00.000Z`) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function issuePreview(session: AppSession, requestId: string) {
  requireAdminProcess(session);
  if (!can(session, "documents.manage")) {
    throw new InboxRuntimeError("Tài khoản chưa có quyền cấp số văn bản.", 403);
  }
  const request = await requestByCode(requestId);
  const poolSerials = new Map<
    string,
    Array<{ serial: number; status: string }>
  >();
  const items = [];
  for (const item of request.items) {
    const dossier = item.legalDossier;
    if (!dossier?.takesNumber || !dossier.documentType || !dossier.company) continue;
    const itemPayload = record(item.payload);
    if (dossier.documentRegistry) {
      items.push({
        companyName:
          dossier.companyNameSnapshot ||
          dossier.company.shortName ||
          dossier.company.legalName,
        currentNumber: dossier.documentRegistry.documentNumber,
        documentNumber: dossier.documentRegistry.documentNumber,
        documentTypeName:
          dossier.documentTypeSnapshot || dossier.documentType.name,
        fileStatus: dossier.fileStatus,
        numberStatus: dossier.numberStatus,
        registryId: dossier.id,
        requestId: request.code,
        serial: dossier.documentRegistry.serial,
        takesNumberState: "Đã cấp số",
      });
      continue;
    }
    const signDate = signDateOf(itemPayload);
    const companyShort =
      dossier.company.shortName ||
      dossier.company.code ||
      dossier.company.legalName;
    const cycleKey = buildCycleKey(dossier.documentType.cycle, signDate);
    const poolKey = buildPoolKey(
      dossier.documentType.id,
      companyShort,
      cycleKey,
    );
    let slots = poolSerials.get(poolKey);
    if (!slots) {
      const rows = await getDb().documentRegistry.findMany({
        select: { serial: true, status: true },
        where: { poolKey, status: { in: ["ISSUED", "CANCELLED"] } },
      });
      slots = rows;
      poolSerials.set(poolKey, slots);
    }
    const companyRule = dossier.documentType.companyNumbering.find(
      (rule) => rule.companyId === dossier.companyId,
    );
    const start = effectiveDocumentStartIndex(
      dossier.documentType.startIndex,
      companyRule?.startIndex,
    );
    const ceiling = maxSerial(start, dossier.documentType.cycleLimit);
    const serial = nextDocumentSerial(start, ceiling, slots);
    if (serial == null) {
      throw new InboxRuntimeError(
        `Đã hết số khả dụng cho ${dossier.documentType.name}.`,
      );
    }
    slots.push({ serial, status: "ISSUED" });
    const previewNumber = renderNumber(
      tokensOf(dossier.documentType.formatTokens),
      serial,
      companyShort,
      signDate,
      text(
        itemPayload.customNumberingText ||
          itemPayload.counterpartyShortName ||
          itemPayload.shortPartnerName,
      ),
    );
    items.push({
      companyName:
        dossier.companyNameSnapshot ||
        dossier.company.shortName ||
        dossier.company.legalName,
      currentNumber: "",
      documentNumber: previewNumber,
      documentTypeName:
        dossier.documentTypeSnapshot || dossier.documentType.name,
      fileStatus: dossier.fileStatus,
      numberStatus: dossier.numberStatus,
      previewNumber,
      registryId: dossier.id,
      requestId: request.code,
      serial,
      takesNumberState: "Chờ cấp số",
    });
  }
  if (!items.length) {
    throw new InboxRuntimeError("Hồ sơ này không có mục nào cần cấp số.");
  }
  return { items, ok: true, requestId: request.code };
}

async function issueAndComplete(session: AppSession, requestId: string) {
  requireAdminProcess(session);
  if (!can(session, "documents.manage")) {
    throw new InboxRuntimeError("Tài khoản chưa có quyền cấp số văn bản.", 403);
  }
  const request = await requestByCode(requestId);
  if (request.serviceCode !== "document-seal") {
    throw new InboxRuntimeError("Đơn này không thuộc dịch vụ cấp số văn bản.");
  }
  try {
    assertElectronicSignatureCompletionReady(record(request.payload));
  } catch (error) {
    throw new InboxRuntimeError(
      error instanceof Error
        ? error.message
        : "Hồ sơ ký điện tử chưa có file Hành chính đã ký.",
    );
  }
  const rows = payloadItems(record(request.payload));
  const displayItems: JsonRecord[] = [];
  for (const [index, item] of request.items.entries()) {
    const dossier = item.legalDossier;
    if (!dossier) continue;
    let registry = dossier.documentRegistry;
    if (dossier.takesNumber && !registry) {
      if (!dossier.documentTypeId || !dossier.companyId) {
        throw new InboxRuntimeError(
          `Mục ${index + 1} thiếu cấu hình loại văn bản hoặc pháp nhân.`,
        );
      }
      const source = rows[index] || record(item.payload);
      const result = await issueDocumentNumber(getDb(), {
        companyId: dossier.companyId,
        createdById: session.userId,
        createdByName: session.displayName,
        documentTypeId: dossier.documentTypeId,
        note: text(source.partner || source.detail || request.title),
        partnerAbbr:
          text(
            source.customNumberingText ||
              source.counterpartyShortName ||
              source.shortPartnerName,
          ) || null,
        partnerName: text(source.partner || source.detail) || null,
        quantity: Number(source.qty || source.quantity || 1),
        sealTypes: list<string>(source.stamps || source.dau),
        signDate: signDateOf(source),
      });
      if (!result.ok) throw new InboxRuntimeError(result.error);
      registry = await getDb().documentRegistry.findUnique({
        where: { id: result.id },
      });
      await getDb().legalDossier.update({
        data: {
          documentRegistryId: result.id,
          numberStatus: "ISSUED",
          orderStatus: "Hoàn thành",
        },
        where: { id: dossier.id },
      });
      if (rows[index]) {
        rows[index] = {
          ...rows[index],
          documentNumber: result.documentNumber,
          issuedNumber: result.documentNumber,
          soVanBan: result.documentNumber,
          updatedAt: new Date().toISOString(),
        };
      }
    } else {
      await getDb().legalDossier.update({
        data: { orderStatus: "Hoàn thành" },
        where: { id: dossier.id },
      });
    }
    if (registry) {
      displayItems.push({
        companyName:
          dossier.companyNameSnapshot ||
          dossier.company?.shortName ||
          dossier.company?.legalName ||
          "",
        currentNumber: registry.documentNumber,
        documentNumber: registry.documentNumber,
        documentTypeName:
          dossier.documentTypeSnapshot || dossier.documentType?.name || item.title || "",
        fileStatus: dossier.fileStatus,
        numberStatus: "ISSUED",
        registryId: dossier.id,
        requestId: request.code,
        serial: registry.serial,
      });
    }
  }

  const now = new Date();
  const payload = {
    ...replacePayloadItems(record(request.payload), rows),
    documentRegistryIssuedAt: now.toISOString(),
    documentRegistryIssuedItems: displayItems,
    issuedDocumentNumbers: displayItems.map((item) => item.documentNumber),
    note: "Đã cấp số và hoàn thành hồ sơ.",
    stage: "Hoàn thành",
    updatedAt: now.toISOString(),
  };
  await getDb().$transaction(async (tx) => {
    await tx.request.update({
      data: {
        completedAt: now,
        note: "Đã cấp số và hoàn thành hồ sơ.",
        payload: inputJson(payload),
        status: "COMPLETED",
      },
      where: { id: request.id },
    });
    await tx.requestItem.updateMany({
      data: { status: "COMPLETED" },
      where: { requestId: request.id },
    });
    await tx.requestEvent.create({
      data: {
        actorId: session.userId,
        fromStatus: request.status,
        note: displayItems.length
          ? `Đã cấp số: ${displayItems
              .map((item) => text(item.documentNumber))
              .join(", ")}`
          : "Đã hoàn thành hồ sơ không lấy số.",
        requestId: request.id,
        toStatus: "COMPLETED",
        type: "COMPLETED",
      },
    });
  });
  await writeAudit(session, request.id, `Cấp số và hoàn thành ${request.code}.`, {
    documentNumbers: displayItems.map((item) => item.documentNumber),
  });
  return {
    displayItems,
    items: displayItems,
    json: payload,
    ok: true,
    stage: "Hoàn thành",
  };
}

function dateLabel(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function authorizationPrintFragment(context: JsonRecord) {
  const isAuthorization = normalize(context.type).includes("uy quyen");
  const title = isAuthorization ? "GIẤY ỦY QUYỀN" : "GIẤY GIỚI THIỆU";
  const side = isAuthorization ? "Ủy quyền" : "Giới thiệu";
  return `<article class="capgiay-print-fragment">
    <div class="capgiay-print-inner">
      <div class="capgiay-print-national">
        <div class="capgiay-print-national-title">CỘNG HÒA X\u00C3 HỘI CHỦ NGHĨA VIỆT NAM</div>
        <div class="capgiay-print-national-subtitle">Độc lập - Tự do - Hạnh phúc</div>
        <div class="capgiay-print-divider"></div>
      </div>
      <div class="capgiay-print-code">Số: <strong>${escapeHtml(context.number || context.requestId)}</strong></div>
      <h1 class="capgiay-print-title">${title}</h1>
      <p class="capgiay-print-date">${escapeHtml(context.issueSentence)}</p>
      <div class="capgiay-print-block">
        <p>- Căn cứ Bộ luật Dân sự nước Cộng hòa xã hội chủ nghĩa Việt Nam;</p>
        <p>- Căn cứ nhu cầu công việc và phạm vi xử lý hồ sơ hiện tại.</p>
      </div>
      <div class="capgiay-print-block">
        <p><strong>BÊN ${side.toLocaleUpperCase("vi")}:</strong></p>
        <p><strong>Tên công ty:</strong> ${escapeHtml(context.companyName)}</p>
        <p><strong>Mã số thuế:</strong> ${escapeHtml(context.taxCode)}</p>
        <p><strong>Địa chỉ:</strong> ${escapeHtml(context.address)}</p>
        <p><strong>Đại diện:</strong> ${escapeHtml(context.representativeName)}</p>
        <p><strong>Chức vụ:</strong> ${escapeHtml(context.representativeTitle || "Giám đốc")}</p>
        <p><strong>CCCD số:</strong> ${escapeHtml(context.representativeIdentityNumber)}</p>
        <p><strong>Cấp ngày:</strong> ${escapeHtml(context.representativeIdentityDate)}</p>
        <p><strong>Nơi cấp:</strong> ${escapeHtml(context.representativeIdentityPlace)}</p>
      </div>
      <div class="capgiay-print-block">
        <p><strong>Xin ${normalize(side) === "uy quyen" ? "ủy quyền" : "giới thiệu"} cho cá nhân dưới đây:</strong></p>
        <p><strong>Họ tên:</strong> ${escapeHtml(context.personName)}</p>
        <p><strong>Bộ phận:</strong> ${escapeHtml(context.personDepartment)}</p>
        <p><strong>Chức vụ:</strong> ${escapeHtml(context.personTitle)}</p>
        <p><strong>Ngày sinh:</strong> ${escapeHtml(context.personBirthDate)}</p>
        <p><strong>CCCD số:</strong> ${escapeHtml(context.personIdentityNumber)}</p>
        <p><strong>Cấp ngày:</strong> ${escapeHtml(context.personIdentityDate)}</p>
        <p><strong>Nơi cấp:</strong> ${escapeHtml(context.personIdentityPlace)}</p>
      </div>
      <div class="capgiay-print-block">
        <p><strong>${isAuthorization ? "Nội dung Ủy quyền" : "Mục đích"}:</strong> ${escapeHtml(context.reason)}</p>
        <p>Giấy này có hiệu lực từ ngày <strong>${escapeHtml(context.periodFrom)}</strong> đến ngày <strong>${escapeHtml(context.periodTo)}</strong>.</p>
        <p>Kính đề nghị các đơn vị liên quan hỗ trợ cá nhân nêu trên hoàn thành công việc được giao.</p>
      </div>
      <div class="capgiay-print-signatures">
        <div class="capgiay-print-signature">
          <div class="capgiay-print-signature-title">Bên được ${side}</div>
          <div class="capgiay-print-signature-name">${escapeHtml(context.personName)}</div>
        </div>
        <div class="capgiay-print-signature">
          <div class="capgiay-print-signature-title">Bên ${side}</div>
          <div class="capgiay-print-signature-name">${escapeHtml(context.representativeName)}</div>
        </div>
      </div>
    </div>
  </article>`;
}

async function capGiayPrintData(session: AppSession, input: JsonRecord) {
  const request = await requestByCode(text(input.requestId));
  const identity = await ownerIdentity(session);
  const admin = canAny(session, ["admin_requests.read", "admin_requests.process"]);
  if (!admin && !requestOwnedBy(request, identity)) {
    throw new InboxRuntimeError("Bạn không có quyền mở bản in này.", 403);
  }
  const payload = record(request.payload);
  const rows = payloadItems(payload);
  const companyNames = rows.map((row) => text(row.companyName || row.phapNhan)).filter(Boolean);
  const companies = await getDb().company.findMany({
    where: {
      OR: [
        { legalName: { in: companyNames, mode: "insensitive" } },
        { shortName: { in: companyNames, mode: "insensitive" } },
      ],
    },
  });
  const selectedIndex = Number.isFinite(Number(input.idx)) ? Number(input.idx) : null;
  const printable = selectedIndex == null ? rows : rows.filter((_, index) => index === selectedIndex);
  const items = [];
  for (const [index, row] of printable.entries()) {
    const companyName = text(row.companyName || row.phapNhan);
    const company =
      companies.find(
        (item) =>
          normalize(item.legalName) === normalize(companyName) ||
          normalize(item.shortName) === normalize(companyName),
      ) || null;
    const representative = company?.representative
      ? await getDb().employee.findFirst({
          where: {
            fullName: { equals: company.representative, mode: "insensitive" },
          },
        })
      : null;
    const person = record(row.personSnapshot);
    const issueDate = new Date(
      text(record(row.documentNumberMeta).assignedAt || request.createdAt),
    );
    const safeIssue = Number.isNaN(issueDate.getTime()) ? request.createdAt : issueDate;
    const context = {
      address: company?.address || "",
      companyName: company?.branchName || company?.legalName || companyName,
      issueSentence: `TP. Hồ Chí Minh, ngày ${String(safeIssue.getDate()).padStart(2, "0")} tháng ${String(safeIssue.getMonth() + 1).padStart(2, "0")} năm ${safeIssue.getFullYear()}`,
      number: text(row.soVanBan) || "CHƯA CẤP SỐ",
      periodFrom: dateLabel(row.fromDate),
      periodTo: dateLabel(row.toDate),
      personBirthDate: dateLabel(person.birthDate || row.nguoiNgaySinh),
      personDepartment: text(person.department || row.nguoiPhongBan),
      personIdentityDate: dateLabel(person.identityDate || row.nguoiNgayCap),
      personIdentityNumber: text(person.identityNumber || row.nguoiCCCD),
      personIdentityPlace: text(person.identityPlace || row.nguoiNoiCap),
      personName: text(person.name || row.nguoiTen || row.nguoi),
      personTitle: text(person.title || row.nguoiChucVu),
      reason: text(row.reason || row.lydo),
      representativeIdentityDate: dateLabel(representative?.identityDate),
      representativeIdentityNumber: representative?.identityNumber || "",
      representativeIdentityPlace: representative?.identityPlace || "",
      representativeName: representative?.fullName || company?.representative || "",
      representativeTitle: representative?.title || "Giám đốc",
      requestId: request.code,
      taxCode: company?.taxCode || "",
      type: text(row.type || row.loai || row.documentTypeName),
    };
    items.push({
      html: authorizationPrintFragment(context),
      index,
      title: text(row.documentTypeName || row.type || row.loai),
    });
  }
  if (!items.length) throw new InboxRuntimeError("Đơn này chưa có dữ liệu để in.");
  return { draft: false, items, ok: true, requestId: request.code };
}

function workshopPrintHtml(requestId: string, payload: JsonRecord, dayIndex: number) {
  const plan = record(payload.workshopPlan);
  const rows = payloadItems(payload);
  const dayOptions = list<JsonRecord>(plan.dayOptions);
  const day = dayOptions.find((item) => Number(item.index) === dayIndex) || {};
  const summary = rows[0] || {};
  return `<!doctype html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Đơn đăng ký NVL</title>
  <style>body{margin:0;background:#eef3f1;color:#111827;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}.bar{position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;padding:16px 22px;background:#fff;border-bottom:1px solid #dfe8e4}.btn{border:0;border-radius:999px;background:#d4196a;color:#fff;font-weight:800;padding:12px 20px}.sheet{width:210mm;min-height:297mm;margin:24px auto;background:#fff;padding:18mm;box-sizing:border-box;box-shadow:0 18px 34px #0002}.brand{color:#114c41;font-weight:900}.title{text-align:center;font-size:24px;margin:30px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.cell{padding:14px;border:1px solid #d8e2de;border-radius:10px}.label{font-size:12px;color:#60736d;font-weight:800;text-transform:uppercase}.value{margin-top:5px;font-weight:800}.note{margin-top:24px;padding:16px;border:1px dashed #d4196a;border-radius:10px}@media print{.bar{display:none}.sheet{margin:0;box-shadow:none;width:210mm;min-height:297mm}}@media(max-width:900px){.sheet{width:auto;min-height:0;margin:12px;padding:18px}.grid{grid-template-columns:1fr}}</style></head><body>
  <div class="bar"><div><div class="brand">THUẦN VIỆT · XƯỞNG</div><small>Mã đơn ${escapeHtml(requestId)}</small></div><button class="btn" onclick="window.print()">In phiếu</button></div>
  <main class="sheet"><div class="brand">CỔNG VẬN HÀNH THUẦN VIỆT</div><h1 class="title">ĐƠN ĐĂNG KÝ NGUYÊN VẬT LIỆU</h1>
  <div class="grid">
    <div class="cell"><div class="label">Tổ sản xuất</div><div class="value">${escapeHtml(plan.teamName || summary.teamName || "-")}</div></div>
    <div class="cell"><div class="label">Ngày kế hoạch</div><div class="value">${escapeHtml(day.fullLabel || day.label || day.key || "-")}</div></div>
    <div class="cell"><div class="label">Tuần</div><div class="value">${escapeHtml(plan.weekLabel || summary.weekLabel || "-")}</div></div>
    <div class="cell"><div class="label">Xưởng</div><div class="value">${escapeHtml(plan.workshopName || summary.workshopName || "Xưởng chính")}</div></div>
    <div class="cell"><div class="label">Tổng nhu cầu</div><div class="value">${escapeHtml(plan.totalDemand || summary.totalDemand || 0)}</div></div>
    <div class="cell"><div class="label">Tổng đã lên kế hoạch</div><div class="value">${escapeHtml(plan.totalPlanned || summary.totalPlanned || 0)}</div></div>
  </div><div class="note"><strong>Ghi chú:</strong> Bản in được dựng từ toàn bộ dữ liệu kế hoạch đã di dời sang PostgreSQL.</div></main></body></html>`;
}

export async function dispatchInboxRpc(
  session: AppSession,
  method: string,
  args: unknown[],
): Promise<unknown> {
  const payload = record(args[0]);
  switch (method) {
    case "getNotifierSharedWarmupData": {
      const methodName = text(payload.methodName);
      if (!methodName || methodName === "getNotifierSharedWarmupData") {
        return { ok: false };
      }
      const data = await dispatchInboxRpc(session, methodName, [record(payload.payload)]);
      return { data, ok: true };
    }
    case "getCurrentUserSession":
    case "getUserSession":
    case "getCurrentUserInfo":
    case "whoAmI": {
      const user = await currentUserProfile(session);
      return {
        ok: true,
        user: {
          dept: user.employee?.department || "",
          email: user.email,
          employeeCode: user.employee?.employeeCode || "",
          employeeId: user.employee?.employeeCode || "",
          id: user.employee?.employeeCode || user.id,
          name: user.displayName,
          title: user.employee?.title || "",
        },
      };
    }
    case "getServiceNameMap":
    case "getServiceDisplayMap":
    case "getServiceCatalogMap":
      return serviceNameMap();
    case "getInboxMeBootstrapData": {
      const [userResult, tickets] = await Promise.all([
        dispatchInboxRpc(session, "getCurrentUserSession", [payload]) as Promise<JsonRecord>,
        listTickets(session, true),
      ]);
      return {
        ok: true,
        serviceNameMap: serviceNameMap(),
        tickets,
        user: userResult.user,
      };
    }
    case "listMyTickets":
    case "listInboxTickets_Me":
    case "listMyInboxTickets":
    case "listMyOrders":
    case "listMyRequests":
      return { ok: true, tickets: await listTickets(session, true) };
    case "getInboxAdminBootstrapData":
    case "listAdminInboxRecords":
    case "listInboxTickets":
    case "listInboxTickets_Admin":
    case "listInboxTicketsV2": {
      requireAdminRead(session);
      const [documentTypes, total, tickets] = await Promise.all([
        getDb().documentType.findMany({
          orderBy: { name: "asc" },
          select: { name: true },
          where: { status: "ACTIVE" },
        }),
        getDb().request.count({ where: { archivedAt: null } }),
        listTickets(session, false),
      ]);
      return {
        dongDauDocumentTypes: documentTypes.map((item) => item.name),
        meta: { source: "postgresql", total },
        ok: true,
        serviceNameMap: serviceNameMap(),
        tickets,
      };
    }
    case "cancelMyTicket":
    case "userCancelTicket":
    case "cancelTicket":
      return cancelMine(session, text(args[0]), text(args[1]));
    case "confirmMyAllocationReceipt":
    case "confirmAllocationReceipt":
      return confirmMyAllocationReceipt(session, text(args[0]));
    case "reopenMySealTicketForReissue":
    case "requestMySealReissue":
    case "requestSealReissue":
      return reopenSeal(session, text(args[0]), text(args[1]));
    case "updateInboxTicketStage":
    case "setInboxTicketStage":
    case "updateTicketStage":
    case "updateOrderStage":
    case "adminUpdateOrderStage": {
      if (args[0] && typeof args[0] === "object") {
        const input = record(args[0]);
        return updateStage(
          session,
          text(input.requestId || input.maDonDv),
          text(input.stage || input.status),
          input.note === undefined ? undefined : text(input.note),
          input.stepCode === undefined ? undefined : text(input.stepCode) || null,
        );
      }
      return updateStage(
        session,
        text(args[0]),
        text(args[1]),
        args[2] === undefined ? undefined : text(args[2]),
        args[3] === undefined ? undefined : text(args[3]) || null,
      );
    }
    case "updateInboxTicketStep":
    case "setInboxTicketStep": {
      const input =
        args[0] && typeof args[0] === "object"
          ? record(args[0])
          : { requestId: args[0], stepCode: args[1] };
      const request = await requestByCode(text(input.requestId));
      const currentStage = stageFor(
        record(request.payload),
        request.status as RequestStatusKey,
      );
      return updateStage(
        session,
        request.code,
        ["Hoàn thành", "Hủy đơn"].includes(currentStage)
          ? currentStage
          : "Xử lý",
        undefined,
        text(input.stepCode) || null,
      );
    }
    case "updateInboxTicketDocumentName":
    case "setInboxTicketDocumentName":
    case "adminRenameInboxDocumentName":
      return renameRequest(session, text(args[0]), text(args[1]));
    case "updateInboxTicketPayloadItemDocumentName":
    case "updateInboxPayloadItemDocumentName":
    case "adminRenameInboxPayloadItemDocumentName":
      return renameItem(session, payload);
    case "updateInboxSealRequestItem":
    case "adminUpdateInboxSealRequestItem":
      return updateSealItem(session, payload);
    case "updateInboxArchiveRequestItem":
    case "adminUpdateInboxArchiveRequestItem":
    case "updateInboxTrichLucRequestItem":
    case "adminUpdateInboxTrichLucRequestItem":
      return updateArchiveItem(session, payload);
    case "getWorkflowConfig":
    case "getWorkflowConfigForService":
    case "getServiceWorkflowConfig": {
      const serviceCode = text(args[0] || payload.serviceCode).replace(
        /^(\d{2})_/,
        "$1",
      );
      return {
        ok: true,
        serviceCode,
        slaHours: serviceCode.startsWith("08") ? 48 : 24,
        steps: WORKFLOW_STEPS[serviceCode] || [],
      };
    }
    case "getAdminDocumentRegistryIssuePreview":
    case "getDocumentRegistryIssuePreview":
      return issuePreview(session, text(payload.requestId));
    case "issueAdminDocumentRegistryNumbersAndCompleteRequest":
    case "issueDocumentRegistryNumbersAndCompleteRequest":
      return issueAndComplete(session, text(payload.requestId));
    case "getCapGiayPrintData":
      return capGiayPrintData(session, payload);
    case "previewWorkshopPlanMaterialPrintHtml":
    case "buildWorkshopPlanMaterialPrintPreview":
    case "downloadWorkshopPlanMaterialPdf":
    case "createWorkshopPlanMaterialPdf": {
      const request = await requestByCode(text(payload.requestId));
      const identity = await ownerIdentity(session);
      if (
        !requestOwnedBy(request, identity) &&
        !canAny(session, ["admin_requests.read", "admin_requests.process"])
      ) {
        throw new InboxRuntimeError("Bạn không có quyền mở bản in này.", 403);
      }
      return {
        html: workshopPrintHtml(
          request.code,
          record(request.payload),
          Number(payload.dayIndex || 0),
        ),
        ok: true,
      };
    }
    case "getEvaluationAssignedInstances":
      return dispatchEvaluationRpc(session, method, payload);
    case "reportInboxClientError":
      console.error("[Inbox client error]", {
        message: text(payload.message).slice(0, 1000),
        requestId: text(payload.requestId).slice(0, 160),
        scope: text(payload.scope).slice(0, 80),
        stack: text(payload.stack).slice(0, 4000),
        userId: session.userId,
      });
      return { ok: true };
    default:
      throw new InboxRuntimeError(`Function not found: ${method}`, 404);
  }
}
