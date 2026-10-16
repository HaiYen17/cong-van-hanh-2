import "server-only";

import { randomUUID } from "node:crypto";

import ExcelJS from "exceljs";

import { Prisma } from "@/generated/prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

type JsonRecord = Record<string, unknown>;
type WorkshopMethod = keyof typeof METHOD_MODULE;
type WeekDay = { date: string; key: string; label: string };
type WeekOption = {
  dayLabels: WeekDay[];
  endDate: string;
  label: string;
  startDate: string;
  weekKey: string;
  weekNumber: number;
  [key: string]: unknown;
};

const DEFAULT_TEAMS = [
  { key: "dat-hang-tv", label: "Đơn đặt hàng Thuần Việt", sortOrder: 10 },
  { key: "mut", label: "Tổ Mút", sortOrder: 20 },
  { key: "cao-su", label: "Tổ Cao su", sortOrder: 30 },
  { key: "may", label: "Tổ May", sortOrder: 40 },
  { key: "goi", label: "Tổ Gối", sortOrder: 50 },
] as const;

const WARRANTY_TYPES = [
  "Bảo hành thường",
  "Bảo hành sửa chữa",
  "Bảo hành đổi mới",
] as const;

const METHOD_MODULE = {
  acceptWorkshopOrder: "workshop-allocation",
  getWorkshopAllocationData: "workshop-allocation",
  getWorkshopAllocationSewingPlanData: "workshop-allocation",
  getWorkshopConfigData: "workshop-config",
  getWorkshopOrderPlanData: "workshop-order",
  getWorkshopOrderSourcePlanData: "workshop-plan",
  getWorkshopPlanApprovalData: "workshop-plan-approval",
  getWorkshopPlanApprovalSewingDependencyData: "workshop-plan-approval",
  getWorkshopPlanData: "workshop-plan",
  getWorkshopPlanSewingDependencyData: "workshop-plan",
  getWorkshopProposalData: "workshop-proposal",
  getWorkshopReportData: "workshop-report",
  importWorkshopMaterialsFromExcel: "workshop-config",
  previewWorkshopAllocationMaterialWeekPrintHtml: "workshop-allocation",
  reviewWorkshopPlan: "workshop-plan-approval",
  saveWorkshopReport: "workshop-report",
  submitWorkshopAllocationPlan: "workshop-allocation",
  submitWorkshopOrderPlan: "workshop-order",
  submitWorkshopPlan: "workshop-plan",
  submitWorkshopProposal: "workshop-proposal",
  updateWorkshopOrderPlan: "workshop-order",
} as const;

const MATERIAL_ALIASES = {
  materialCode: ["Mã NVL", "Mã nguyên vật liệu", "Material Code", "Mã NVL (*)"],
  materialName: ["Tên NVL", "Tên nguyên vật liệu", "Material Name"],
  materialQuantity: ["Số lượng NVL", "Định mức NVL", "Material Quantity"],
  materialUnit: ["Đơn vị tính NVL", "ĐVT NVL", "Unit"],
  sku: ["SKU", "Mã SKU", "SKU Code", "Mã hàng hóa", "Mã sản phẩm (*)"],
  skuName: ["Tên SKU", "Tên hàng hóa", "Tên thành phẩm", "InventoryItemName", "Tên BOM (*)"],
  skuQuantity: ["Số lượng", "Số lượng SKU", "Định mức SKU", "Quantity"],
} as const;

export class WorkshopError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "WorkshopError";
    this.status = status;
  }
}

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function list(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function normalizedKey(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("vi")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, value) : 0;
  const parsed = Number(text(value).replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function signedNumber(value: unknown) {
  const parsed = Number(text(value).replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 10_000) / 10_000 : 0;
}

function roundQuantity(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function dayNumbers(value: unknown) {
  const source = list(value);
  return Array.from({ length: 7 }, (_, index) => numberValue(source[index]));
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateOnly(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T00:00:00.000Z`)
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function mondayFor(date: Date) {
  const normalized = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = normalized.getUTCDay();
  normalized.setUTCDate(normalized.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return normalized;
}

function isoWeekNumber(date: Date) {
  const target = new Date(date.getTime());
  target.setUTCDate(target.getUTCDate() + 3 - ((target.getUTCDay() + 6) % 7));
  const weekOne = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  return (
    1 +
    Math.round(
      ((target.getTime() - weekOne.getTime()) / 86_400_000 -
        3 +
        ((weekOne.getUTCDay() + 6) % 7)) /
        7,
    )
  );
}

function shortDate(date: Date, includeYear = false) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return includeYear
    ? `${day}/${month}/${String(date.getUTCFullYear()).slice(-2)}`
    : `${day}/${month}`;
}

function buildWeek(startValue: Date): WeekOption {
  const start = mondayFor(startValue);
  const end = addDays(start, 6);
  const weekNumber = isoWeekNumber(start);
  const padded = String(weekNumber).padStart(2, "0");
  const keys = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
  return {
    dayLabels: keys.map((key, index) => {
      const date = addDays(start, index);
      return { date: isoDate(date), key, label: `${key} - ${shortDate(date)}` };
    }),
    endDate: isoDate(end),
    label: `Tuần ${padded}: T2 ${shortDate(start, true)} - CN ${shortDate(end, true)}`,
    startDate: isoDate(start),
    weekKey: `${start.getUTCFullYear()}-W${padded}`,
    weekNumber,
  };
}

function weekOptions() {
  const start = mondayFor(new Date());
  return [buildWeek(start), buildWeek(addDays(start, 7))];
}

function operationalWeek(week: WeekOption) {
  const start = dateOnly(week.startDate) ?? mondayFor(new Date());
  const displayStart = addDays(start, -2);
  const displayEnd = addDays(start, 6);
  const specs = [
    ["T7", -2],
    ["CN", -1],
    ["T2", 0],
    ["T3", 1],
    ["T4", 2],
    ["T5", 3],
    ["T6", 4],
    ["T7", 5],
    ["CN", 6],
  ] as const;
  return {
    ...week,
    operationalDayLabels: specs.map(([key, offset]) => {
      const date = addDays(start, offset);
      return { date: isoDate(date), key, label: `${key} - ${shortDate(date)}` };
    }),
    operationalEndDate: isoDate(displayEnd),
    operationalLabel: `Vận hành: T7 ${shortDate(displayStart, true)} - CN ${shortDate(displayEnd, true)}`,
    operationalStartDate: isoDate(displayStart),
  };
}

function sewingWeek(week: WeekOption) {
  const start = dateOnly(week.startDate) ?? mondayFor(new Date());
  const specs = [
    ["T7", -2],
    ["CN", -1],
    ["T2", 0],
    ["T3", 1],
    ["T4", 2],
    ["T5", 3],
    ["T6", 4],
  ] as const;
  return {
    ...week,
    dayLabels: specs.map(([key, offset]) => {
      const date = addDays(start, offset);
      return { date: isoDate(date), key, label: `${key} - ${shortDate(date)}` };
    }),
    displayEndDate: isoDate(addDays(start, 4)),
    displayLabel: `Tổ May: T7 ${shortDate(addDays(start, -2), true)} - T6 ${shortDate(addDays(start, 4), true)}`,
    displayStartDate: isoDate(addDays(start, -2)),
  };
}

function formatTimestamp(date: Date | null | undefined) {
  if (!date) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).format(date);
}

function randomCode(prefix: string) {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

function isOrderTeam(key: unknown, label?: unknown) {
  const normalized = normalizedKey(`${text(key)} ${text(label)}`);
  return normalized.includes("dat-hang-tv") || normalized.includes("don-dat-hang");
}

function isSewingTeam(key: unknown, label?: unknown) {
  const normalized = normalizedKey(`${text(key)} ${text(label)}`);
  return normalized === "may" || normalized.includes("to-may");
}

function reviewedStatus(value: unknown) {
  const key = normalizedKey(value);
  return (
    key === "da-duyet" ||
    key === "yeu-cau-dieu-chinh" ||
    key === "tu-choi"
  );
}

export function canAccessWorkshop(session: AppSession, moduleKey?: string) {
  return (
    session.fullAccess ||
    session.moduleGroups.includes("workshop") ||
    (!!moduleKey && session.modules.includes(moduleKey))
  );
}

function assertAccess(session: AppSession, moduleKey: string) {
  if (!canAccessWorkshop(session, moduleKey)) {
    throw new WorkshopError("Ông chưa có quyền thao tác module Phân Xưởng này.", 403);
  }
}

async function actorFor(session: AppSession) {
  const user = await getDb().user.findUnique({
    include: { employee: true },
    where: { id: session.userId },
  });
  if (!user) throw new WorkshopError("Không tìm thấy tài khoản đang thao tác.", 401);
  return {
    email: user.email,
    employeeId: user.employee?.employeeCode ?? "",
    id: user.id,
    name: user.displayName,
  };
}

async function ensureTeams() {
  const db = getDb();
  await db.$transaction(
    DEFAULT_TEAMS.map((team) =>
      db.workshopTeam.upsert({
        create: { ...team, note: "Tổ mặc định của Phân xưởng." },
        update: { label: team.label, sortOrder: team.sortOrder },
        where: { key: team.key },
      }),
    ),
  );
}

async function teamDtos() {
  await ensureTeams();
  const teams = await getDb().workshopTeam.findMany({
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    where: { status: { notIn: ["INACTIVE", "ARCHIVED", "Đã xóa"] } },
  });
  return teams.map((team) => ({
    key: team.key,
    label: team.label,
    manager: team.manager ?? "",
    note: team.note ?? "",
    order: team.sortOrder,
    status: team.status,
  }));
}

function parseSkuDescriptor(raw: unknown) {
  const skuName = text(raw).replace(/\s+/g, " ");
  if (!skuName) return { productName: "", size: "", skuName, thickness: "" };
  const parenthetical = skuName.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  const source = parenthetical ? parenthetical[2] : skuName;
  const dimension = source.match(
    /(?:(\d+(?:[.,]\d+)?)\s*cm\s*[-/]\s*)?((?:\d+(?:[.,]\d+)?\s*(?:cm|m)?\s*[*x×]\s*)+\d+(?:[.,]\d+)?\s*(?:cm|m)?)/i,
  );
  if (dimension) {
    const productName = text(parenthetical ? parenthetical[1] : skuName.slice(0, dimension.index));
    return {
      productName: productName || skuName,
      size: text(dimension[2]).replace(/\s+/g, ""),
      skuName,
      thickness: dimension[1] ? `${text(dimension[1]).replace(".", ",")}cm` : "",
    };
  }
  const slash = skuName.match(/^(.*?)\s+(\d+(?:[.,]\d+)?\s*cm?)\s*[-/]\s*(.+)$/i);
  if (slash) {
    return {
      productName: text(slash[1]),
      size: text(slash[3]),
      skuName,
      thickness: text(slash[2]),
    };
  }
  return { productName: skuName, size: "", skuName, thickness: "" };
}

async function productCatalog() {
  const db = getDb();
  const materials = await db.workshopMaterial.findMany({
    distinct: ["sku"],
    orderBy: [{ skuName: "asc" }, { sku: "asc" }],
  });
  const fallback = materials.length
    ? []
    : await db.warehouseProduct.findMany({
        orderBy: [{ name: "asc" }, { sku: "asc" }],
        select: { name: true, size: true, sku: true },
        where: { status: { notIn: ["INACTIVE", "ARCHIVED"] } },
      });
  const entries = materials.map((item) => ({ sku: item.sku, skuName: item.skuName }));
  entries.push(
    ...fallback.map((item) => ({
      sku: item.sku,
      skuName: item.size ? `${item.name} ${item.size}` : item.name,
    })),
  );
  const productMap = new Map<
    string,
    {
      productKey: string;
      productName: string;
      thicknesses: Map<string, { sizes: Map<string, JsonRecord>; thickness: string; thicknessKey: string }>;
    }
  >();
  for (const entry of entries) {
    const parsed = parseSkuDescriptor(entry.skuName);
    const productKey = normalizedKey(parsed.productName);
    if (!productKey || !entry.sku) continue;
    let product = productMap.get(productKey);
    if (!product) {
      product = { productKey, productName: parsed.productName, thicknesses: new Map() };
      productMap.set(productKey, product);
    }
    const thicknessKey = normalizedKey(parsed.thickness || "Khác");
    let thickness = product.thicknesses.get(thicknessKey);
    if (!thickness) {
      thickness = {
        sizes: new Map(),
        thickness: parsed.thickness,
        thicknessKey,
      };
      product.thicknesses.set(thicknessKey, thickness);
    }
    const sizeKey = normalizedKey(parsed.size || "Khác");
    if (!thickness.sizes.has(sizeKey)) {
      thickness.sizes.set(sizeKey, {
        size: parsed.size,
        sizeKey,
        sku: entry.sku,
        skuName: entry.skuName,
      });
    }
  }
  const products = [...productMap.values()]
    .map((product) => ({
      productKey: product.productKey,
      productName: product.productName,
      thicknesses: [...product.thicknesses.values()].map((thickness) => ({
        sizes: [...thickness.sizes.values()],
        thickness: thickness.thickness,
        thicknessKey: thickness.thicknessKey,
      })),
    }))
    .sort((left, right) => left.productName.localeCompare(right.productName, "vi"));
  return {
    productNames: products.map((item) => item.productName),
    products,
    skuCount: entries.length,
  };
}

type PlanWithLines = Prisma.WorkshopPlanGetPayload<{ include: { lines: true } }>;

function lineDto(line: PlanWithLines["lines"][number]) {
  const days = dayNumbers(line.days);
  return {
    days,
    demand: Number(line.demand),
    lineId: line.lineCode,
    note: line.note ?? "",
    orderQty: Number(line.orderQty),
    plannedTotal: Number(line.plannedTotal),
    productName: line.productName,
    receivedQty: Number(line.receivedQty),
    size: line.size ?? "",
    sku: line.sku ?? "",
    thickness: line.thickness ?? "",
    type: line.type,
    warrantyType: line.warrantyType ?? "",
  };
}

function planDto(plan: PlanWithLines, includeLines = true) {
  const week = operationalWeek(
    buildWeek(plan.weekStart ?? dateOnly(plan.weekKey) ?? mondayFor(new Date())),
  );
  return {
    allocationPlanIds: [] as string[],
    allocationPlans: [] as JsonRecord[],
    approvalStatus: plan.approvalStatus,
    canEdit: !plan.weekEnd || isoDate(new Date()) <= isoDate(plan.weekEnd),
    createdAt: formatTimestamp(plan.createdAt),
    creatorEmail: plan.creatorEmail ?? "",
    creatorEmployeeId: plan.creatorEmployeeId ?? "",
    creatorName: plan.creatorName,
    lineCount: plan.lineCount,
    lines: includeLines ? plan.lines.map(lineDto) : [],
    operationalEndDate: week.operationalEndDate,
    operationalLabel: week.operationalLabel,
    operationalStartDate: week.operationalStartDate,
    planId: plan.planCode,
    status: plan.status,
    teamKey: plan.teamKey,
    teamName: plan.teamName,
    totalDemand: Number(plan.totalDemand),
    totalPlanned: Number(plan.totalPlanned),
    version: plan.version,
    weekEnd: plan.weekEnd ? isoDate(plan.weekEnd) : "",
    weekKey: plan.weekKey,
    weekLabel: plan.weekLabel,
    weekStart: plan.weekStart ? isoDate(plan.weekStart) : "",
    workshopName: plan.workshopName,
  };
}

async function planByCode(planCode: unknown) {
  const code = text(planCode);
  const plan = await getDb().workshopPlan.findFirst({
    include: { lines: { orderBy: { lineIndex: "asc" } } },
    where: { archivedAt: null, OR: [{ id: code }, { planCode: code }] },
  });
  if (!plan) throw new WorkshopError("Không tìm thấy kế hoạch xưởng cần xử lý.");
  return plan;
}

function normalizeLine(rawValue: unknown, type: string, index: number) {
  const raw = record(rawValue);
  const productName = text(raw.productName);
  if (!productName) throw new WorkshopError(`Thiếu tên hàng hóa dòng ${index + 1}.`);
  const days = dayNumbers(raw.dayPlans ?? raw.days ?? raw.planDays);
  const order = numberValue(raw.orderQty);
  const received = numberValue(raw.receivedQty);
  const demand = type === "warranty" ? received || order : order;
  const plannedTotal = type === "order" ? demand : roundQuantity(days.reduce((sum, item) => sum + item, 0));
  return {
    days,
    demand,
    note: text(raw.note),
    orderQty: order,
    plannedTotal,
    productName,
    raw,
    receivedQty: received,
    size: text(raw.size),
    sku: text(raw.sku),
    thickness: text(raw.thickness),
    type,
    warrantyType: text(raw.warrantyType),
  };
}

function submittedLines(payload: JsonRecord, orderMode: boolean) {
  const result: ReturnType<typeof normalizeLine>[] = [];
  list(payload.productionRows).forEach((row, index) => {
    if (!text(record(row).productName)) return;
    const line = normalizeLine(row, orderMode ? "order" : "production", index);
    if (line.demand > 0 || line.plannedTotal > 0) result.push(line);
  });
  if (!orderMode) {
    list(payload.warrantyRows).forEach((row, index) => {
      if (!text(record(row).productName)) return;
      const line = normalizeLine(row, "warranty", index);
      if (line.demand > 0 || line.plannedTotal > 0) result.push(line);
    });
  }
  if (!result.length) throw new WorkshopError("Vui lòng thêm ít nhất một dòng kế hoạch trước khi nộp.");
  for (const line of result) {
    if (!orderMode && line.plannedTotal <= 0) {
      throw new WorkshopError(`Dòng "${line.productName}" chưa có kế hoạch theo ngày.`);
    }
    if (!orderMode && line.demand > line.plannedTotal) {
      throw new WorkshopError(
        `Dòng "${line.productName}" có tổng đơn lớn hơn tổng kế hoạch.`,
      );
    }
  }
  return result;
}

async function nextPlanVersion(weekKey: string, teamKey: string, kind: string) {
  const aggregate = await getDb().workshopPlan.aggregate({
    _max: { version: true },
    where: { kind, teamKey, weekKey },
  });
  return (aggregate._max.version ?? 0) + 1;
}

function requestPayload(plan: PlanWithLines, kind: "order" | "approved", stage: string) {
  const isOrder = kind === "order";
  const title = isOrder
    ? ["Đặt hàng Xưởng", plan.weekLabel, `v${plan.version}`].join(" - ")
    : ["KH xưởng đã duyệt", plan.teamName, plan.weekLabel, `v${plan.version}`].join(" - ");
  const item = {
    actionLabel: isOrder ? "Theo dõi đơn đặt Xưởng" : "In đơn đăng ký NVL theo ngày",
    documentName: title,
    lineCount: plan.lines.length,
    name: title,
    planId: plan.planCode,
    stage,
    teamKey: plan.teamKey,
    teamName: plan.teamName,
    title,
    totalDemand: Number(plan.totalDemand),
    totalPlanned: Number(plan.totalPlanned),
    type: isOrder ? "Đặt hàng Xưởng" : "Kế hoạch xưởng",
    version: plan.version,
    weekEnd: plan.weekEnd ? isoDate(plan.weekEnd) : "",
    weekKey: plan.weekKey,
    weekLabel: plan.weekLabel,
    weekStart: plan.weekStart ? isoDate(plan.weekStart) : "",
    workshopName: plan.workshopName,
  };
  return {
    actions: isOrder
      ? []
      : [{ key: "workshop-material-pdf", label: "In đơn đăng ký NVL theo ngày", type: "download" }],
    displayDocumentName: title,
    documentName: title,
    employeeId: plan.creatorEmployeeId ?? "",
    employeeName: plan.creatorName,
    email: plan.creatorEmail ?? "",
    items: [item],
    meta: {
      source: isOrder ? "workshop-order" : "workshop-plan-approval",
      weekKey: plan.weekKey,
      weekLabel: plan.weekLabel,
      workshopPlanId: plan.planCode,
      workshopTeamKey: plan.teamKey,
      workshopTeamName: plan.teamName,
    },
    requesterEmployeeId: plan.creatorEmployeeId ?? "",
    requesterEmail: plan.creatorEmail ?? "",
    requesterName: plan.creatorName,
    serviceCode: isOrder ? "18DAT_HANG_XUONG" : "17KE_HOACH_XUONG_DA_DUYET",
    serviceName: isOrder ? "Đặt hàng Xưởng" : "Kế hoạch xưởng đã duyệt",
    stage,
    ...(isOrder ? { workshopOrder: item } : { workshopPlan: item }),
  };
}

async function upsertPlanRequest(
  planId: string,
  kind: "order" | "approved",
  stage: string,
  status: "APPROVED" | "COMPLETED" | "IN_PROGRESS" | "SUBMITTED",
  actorId: string,
) {
  const db = getDb();
  const plan = await db.workshopPlan.findUnique({
    include: { lines: { orderBy: { lineIndex: "asc" } } },
    where: { id: planId },
  });
  if (!plan) throw new WorkshopError("Không tìm thấy kế hoạch để đồng bộ Đơn hàng.");
  const code = `${kind === "order" ? "WORDER" : "WPLAN"}-${plan.planCode.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const payload = requestPayload(plan, kind, stage);
  const existing = await db.request.findUnique({ where: { code } });
  const request = existing
    ? await db.request.update({
        data: {
          completedAt: status === "COMPLETED" ? new Date() : null,
          payload: asJson(payload),
          status,
          title: text(payload.documentName),
        },
        where: { id: existing.id },
      })
    : await db.request.create({
        data: {
          code,
          createdById: plan.creatorId,
          payload: asJson(payload),
          serviceCode: kind === "order" ? "workshop-order" : "workshop-plan",
          status,
          title: text(payload.documentName),
        },
      });
  if (!existing) {
    await db.requestEvent.create({
      data: {
        actorId,
        requestId: request.id,
        toStatus: status,
        type: status === "APPROVED" ? "APPROVED" : "SUBMITTED",
      },
    });
  }
  await db.workshopPlan.update({ data: { requestId: request.id }, where: { id: plan.id } });
  return { documentName: request.title, requestId: request.code, stage };
}

async function createPlan(
  session: AppSession,
  payload: JsonRecord,
  options: {
    approved?: boolean;
    kind?: string;
    orderMode?: boolean;
    sourceOrderPlanId?: string;
    teamKey?: string;
    teamName?: string;
  } = {},
) {
  const actor = await actorFor(session);
  const weeks = weekOptions();
  const weekValue = record(payload.week);
  const weekKey = text(payload.weekKey ?? weekValue.weekKey);
  const selectedWeek = weeks.find((week) => week.weekKey === weekKey);
  if (!weekKey) throw new WorkshopError("Vui lòng chọn tuần kế hoạch.");
  const weekLabel = text(payload.weekLabel ?? weekValue.label ?? selectedWeek?.label);
  if (!weekLabel) throw new WorkshopError("Thiếu nhãn tuần kế hoạch.");
  const teamKey = normalizedKey(options.teamKey ?? payload.teamKey ?? payload.teamName);
  const teamName = text(options.teamName ?? payload.teamName ?? payload.teamKey);
  if (!teamKey || !teamName) throw new WorkshopError("Vui lòng chọn tổ sản xuất.");
  const orderMode = options.orderMode === true || isOrderTeam(teamKey, teamName);
  const kind = options.kind ?? (orderMode ? "ORDER" : "TEAM_PLAN");
  const lines = submittedLines(payload, orderMode);
  const totalDemand = roundQuantity(lines.reduce((sum, line) => sum + line.demand, 0));
  const totalPlanned = roundQuantity(lines.reduce((sum, line) => sum + line.plannedTotal, 0));
  const version = await nextPlanVersion(weekKey, teamKey, kind);
  const planCode = randomCode("wplan");
  const approved = options.approved === true;
  const status = orderMode ? "Chờ tiếp nhận" : approved ? "Đã duyệt" : "Chờ duyệt";
  const plan = await getDb().workshopPlan.create({
    data: {
      approvalStatus: status,
      creatorEmail: actor.email,
      creatorEmployeeId: actor.employeeId,
      creatorId: actor.id,
      creatorName: actor.name,
      kind,
      lineCount: lines.length,
      lines: {
        create: lines.map((line, index) => ({
          days: asJson(line.days),
          demand: line.demand,
          lineCode: randomCode("wline"),
          lineIndex: index,
          note: line.note || undefined,
          orderQty: line.orderQty,
          plannedTotal: line.plannedTotal,
          productName: line.productName,
          rawSource: asJson(line.raw),
          receivedQty: line.receivedQty,
          size: line.size || undefined,
          sku: line.sku || undefined,
          thickness: line.thickness || undefined,
          type: line.type,
          warrantyType: line.warrantyType || undefined,
        })),
      },
      note: text(payload.note) || undefined,
      payload: asJson(payload),
      planCode,
      sourceOrderPlanId: options.sourceOrderPlanId,
      status,
      teamKey,
      teamName,
      totalDemand,
      totalPlanned,
      version,
      weekEnd: dateOnly(payload.weekEnd ?? weekValue.endDate ?? selectedWeek?.endDate),
      weekKey,
      weekLabel,
      weekStart: dateOnly(payload.weekStart ?? weekValue.startDate ?? selectedWeek?.startDate),
      workshopName: text(payload.workshopName ?? payload.workshop) || "Xưởng chính",
      audits: {
        create: {
          action: approved ? "Sinh kế hoạch từ phân bổ Xưởng" : orderMode ? "Nộp đơn đặt hàng Xưởng" : "Nộp kế hoạch",
          actorId: actor.id,
          actorName: actor.name,
          change: asJson({ lineCount: lines.length, teamKey, totalDemand, totalPlanned, weekKey }),
          newStatus: status,
        },
      },
    },
    include: { lines: true },
  });
  const ticket = orderMode
    ? await upsertPlanRequest(plan.id, "order", "Chờ tiếp nhận", "SUBMITTED", actor.id)
    : approved
      ? await upsertPlanRequest(plan.id, "approved", "KH được duyệt", "APPROVED", actor.id)
      : null;
  return { plan, ticket };
}

async function configData(payload: JsonRecord) {
  const includeMaterials = payload.includeMaterials !== false && payload.summaryOnly !== true;
  const limit = Math.min(Math.max(numberValue(payload.materialLimit) || 500, 1), 2_000);
  const db = getDb();
  const [materials, materialRows, skuGroups, materialGroups, last] = await Promise.all([
    includeMaterials
      ? db.workshopMaterial.findMany({ orderBy: [{ updatedAt: "desc" }], take: limit })
      : Promise.resolve([]),
    db.workshopMaterial.count(),
    db.workshopMaterial.groupBy({ by: ["sku"] }),
    db.workshopMaterial.groupBy({ by: ["materialCode"] }),
    db.workshopMaterial.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
  ]);
  return {
    backendSpreadsheetId: "POSTGRESQL",
    materialLimit: materials.length,
    materialSheetName: "WorkshopMaterial",
    materials: materials.map((item, index) => ({
      createdAt: formatTimestamp(item.createdAt),
      materialCode: item.materialCode,
      materialName: item.materialName,
      materialQuantity: Number(item.materialQuantity),
      materialUnit: item.materialUnit ?? "",
      note: item.note ?? "",
      rowIndex: index + 1,
      sku: item.sku,
      skuName: item.skuName,
      skuQuantity: Number(item.skuQuantity),
      source: item.source ?? "PostgreSQL",
      updatedAt: formatTimestamp(item.updatedAt),
      updatedBy: "",
    })),
    materialsDeferred: !includeMaterials,
    personnel: {
      records: [],
      summary: { configuredGroups: 0, lastUpdatedAt: "", totalEmployees: 0 },
    },
    summary: {
      lastUpdatedAt: last ? formatTimestamp(last.updatedAt) : "",
      materialCount: materialGroups.length,
      materialRows,
      skuCount: skuGroups.length,
    },
  };
}

function headerKey(value: unknown) {
  return normalizedKey(value).replace(/-/g, " ");
}

function headerIndex(headers: string[], aliases: readonly string[]) {
  const aliasSet = new Set(aliases.map(headerKey));
  return headers.findIndex((header) => aliasSet.has(headerKey(header)));
}

function worksheetRows(sheet: ExcelJS.Worksheet) {
  const result: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    for (let index = 1; index <= Math.max(row.cellCount, row.actualCellCount); index += 1) {
      values.push(text(row.getCell(index).text));
    }
    result.push(values);
  });
  return result;
}

async function importMaterials(payload: JsonRecord) {
  const file = record(payload.file);
  const rawBase64 = text(file.base64Data ?? file.base64 ?? file.contentBase64 ?? file.dataUrl);
  const base64 = rawBase64.includes(",") ? rawBase64.slice(rawBase64.indexOf(",") + 1) : rawBase64;
  if (!base64) throw new WorkshopError("Không đọc được nội dung file Excel Nguyên vật liệu.");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(base64, "base64") as never);
  const materialNames = new Map<string, string>();
  for (const sheet of workbook.worksheets) {
    const rows = worksheetRows(sheet);
    for (let headerRow = 0; headerRow < Math.min(rows.length, 20); headerRow += 1) {
      const codeIndex = headerIndex(rows[headerRow], ["Mã VTHH (*)", "Mã VTHH"]);
      const nameIndex = headerIndex(rows[headerRow], ["Tên VTHH (*)", "Tên VTHH"]);
      if (codeIndex < 0 || nameIndex < 0) continue;
      rows.slice(headerRow + 1).forEach((row) => {
        const code = text(row[codeIndex]);
        const name = text(row[nameIndex]);
        if (code && name) materialNames.set(normalizedKey(code), name);
      });
    }
  }
  let sourceSheetName = "";
  let headerRowNumber = 0;
  let parsedRows: JsonRecord[] = [];
  for (const sheet of workbook.worksheets) {
    const rows = worksheetRows(sheet);
    for (let headerRow = 0; headerRow < Math.min(rows.length, 20); headerRow += 1) {
      const headers = rows[headerRow];
      const indexes = Object.fromEntries(
        Object.entries(MATERIAL_ALIASES).map(([field, aliases]) => [field, headerIndex(headers, aliases)]),
      ) as Record<keyof typeof MATERIAL_ALIASES, number>;
      if (indexes.sku < 0 || indexes.materialCode < 0 || indexes.materialQuantity < 0) continue;
      sourceSheetName = sheet.name;
      headerRowNumber = headerRow + 1;
      parsedRows = rows
        .slice(headerRow + 1)
        .flatMap((row): JsonRecord[] => {
          const sku = text(row[indexes.sku]);
          const materialCode = text(row[indexes.materialCode]);
          if (!sku || !materialCode) return [];
          const skuName = text(row[indexes.skuName]) || sku;
          const item = {
            materialCode,
            materialName:
              text(row[indexes.materialName]) || materialNames.get(normalizedKey(materialCode)) || materialCode,
            materialQuantity: numberValue(row[indexes.materialQuantity]),
            materialUnit: text(row[indexes.materialUnit]),
            sku,
            skuName,
            skuQuantity: numberValue(row[indexes.skuQuantity]) || 1,
          };
          return numberValue(item.materialQuantity) > 0 ? [item] : [];
        })
        ;
      if (parsedRows.length) break;
    }
    if (parsedRows.length) break;
  }
  if (!parsedRows.length) {
    throw new WorkshopError("Không tìm thấy bảng SKU/NVL hợp lệ trong file Excel.");
  }
  const db = getDb();
  let createdCount = 0;
  let updatedCount = 0;
  for (const item of parsedRows) {
    const sku = text(item.sku);
    const materialCode = text(item.materialCode);
    const existing = await db.workshopMaterial.findUnique({
      where: { sku_materialCode: { materialCode, sku } },
    });
    await db.workshopMaterial.upsert({
      create: {
        materialCode,
        materialName: text(item.materialName),
        materialQuantity: numberValue(item.materialQuantity),
        materialUnit: text(item.materialUnit) || undefined,
        rawSource: asJson(item),
        sku,
        skuName: text(item.skuName),
        skuQuantity: numberValue(item.skuQuantity) || 1,
        source: text(payload.fileName ?? file.name) || "Excel",
      },
      update: {
        materialName: text(item.materialName),
        materialQuantity: numberValue(item.materialQuantity),
        materialUnit: text(item.materialUnit) || undefined,
        rawSource: asJson(item),
        skuName: text(item.skuName),
        skuQuantity: numberValue(item.skuQuantity) || 1,
        source: text(payload.fileName ?? file.name) || "Excel",
      },
      where: { sku_materialCode: { materialCode, sku } },
    });
    if (existing) updatedCount += 1;
    else createdCount += 1;
  }
  const data = await configData({ includeMaterials: true });
  const importResult = {
    createdCount,
    errorCount: 0,
    errors: [],
    fileName: text(payload.fileName ?? file.name),
    headerRowNumber,
    importedCount: parsedRows.length,
    skippedUnchangedCount: 0,
    sourceSheetName,
    sourceType: materialNames.size ? "AMIS_BOM" : "STANDARD",
    updatedCount,
  };
  return {
    data: { ...data, importResult },
    importResult,
    message: "Đã nạp Nguyên vật liệu vào Backend Phân Xưởng.",
    ok: true,
  };
}

async function orderPlanData(payload: JsonRecord) {
  const weeks = weekOptions().map(operationalWeek);
  const selectedWeekKey = text(payload.weekKey) || weeks[0]?.weekKey || "";
  const plans = await getDb().workshopPlan.findMany({
    include: { lines: { orderBy: { lineIndex: "asc" } } },
    orderBy: [{ createdAt: "desc" }],
    where: { archivedAt: null, kind: "ORDER", weekKey: { in: weeks.map((item) => item.weekKey) } },
  });
  const metadataOnly = payload.metadataOnly === true || payload.includeCatalog === false;
  return {
    catalog: metadataOnly ? undefined : await productCatalog(),
    catalogDeferred: metadataOnly,
    defaultWorkshopName: "Xưởng chính",
    existingOrders: plans.map((plan) => planDto(plan, plan.weekKey === selectedWeekKey)),
    orderMode: true,
    orderTeam: { key: "dat-hang-tv", label: "Đơn đặt hàng Thuần Việt" },
    planSheetName: "WorkshopPlan",
    selectedWeekKey,
    weeks,
  };
}

async function submitOrder(session: AppSession, payload: JsonRecord) {
  const week = record(payload.week);
  const weekKey = text(payload.weekKey ?? week.weekKey);
  const weekEnd = dateOnly(payload.weekEnd ?? week.endDate ?? week.operationalEndDate);
  if (weekEnd && isoDate(new Date()) > isoDate(weekEnd)) {
    throw new WorkshopError("Tuần đã chọn đã qua nên không thể lập Đặt hàng Xưởng.");
  }
  const existing = await getDb().workshopPlan.findFirst({
    where: { archivedAt: null, kind: "ORDER", weekKey },
  });
  if (existing) {
    throw new WorkshopError("Tuần này đã có Đặt hàng Xưởng. Vui lòng chỉnh sửa đơn hiện có.");
  }
  const result = await createPlan(
    session,
    { ...payload, teamKey: "dat-hang-tv", teamName: "Đơn đặt hàng Thuần Việt", warrantyRows: [] },
    { kind: "ORDER", orderMode: true, teamKey: "dat-hang-tv", teamName: "Đơn đặt hàng Thuần Việt" },
  );
  return {
    data: {
      orderMode: true,
      orderTicket: result.ticket,
      planId: result.plan.planCode,
      savedRows: result.plan.lineCount,
      teamKey: result.plan.teamKey,
      teamName: result.plan.teamName,
      totalDemand: Number(result.plan.totalDemand),
      totalPlanned: Number(result.plan.totalPlanned),
      version: result.plan.version,
    },
    message: "Đã nộp đơn đặt hàng Xưởng.",
    ok: true,
    planId: result.plan.planCode,
  };
}

function lineKey(value: JsonRecord) {
  return [value.productName, value.thickness, value.size, value.sku].map(normalizedKey).join("|");
}

async function updateOrder(session: AppSession, payload: JsonRecord) {
  const actor = await actorFor(session);
  const current = await planByCode(payload.planId ?? payload.orderPlanId);
  if (current.kind !== "ORDER") throw new WorkshopError("Kế hoạch được chọn không phải Đặt hàng Xưởng.");
  if (current.weekEnd && isoDate(new Date()) > isoDate(current.weekEnd)) {
    throw new WorkshopError("Tuần này đã qua nên đơn chỉ được xem.");
  }
  const incoming = list(payload.productionRows).map(record);
  const oldById = new Map(current.lines.map((line) => [line.lineCode, line]));
  const oldByKey = new Map(
    current.lines.map((line) => [lineKey(lineDto(line) as JsonRecord), line]),
  );
  const represented = new Set<string>();
  let changed = 0;
  for (const row of incoming) {
    const old = oldById.get(text(row.lineId)) ?? oldByKey.get(lineKey(row));
    if (old) represented.add(old.id);
    const isChanged = !old || numberValue(row.orderQty) !== Number(old.orderQty);
    if (isChanged) {
      changed += 1;
      if (!text(row.editReason ?? row.reason ?? row.changeReason)) {
        throw new WorkshopError(`Dòng "${text(row.productName)} - ${text(row.size)}" đã thay đổi nhưng chưa có lý do sửa.`);
      }
    }
  }
  const deleted = list(payload.deletedRows).map(record);
  for (const old of current.lines) {
    if (represented.has(old.id)) continue;
    const deletion = deleted.find(
      (row) => text(row.lineId) === old.lineCode || lineKey(row) === lineKey(lineDto(old) as JsonRecord),
    );
    if (!deletion || !text(deletion.editReason ?? deletion.deleteReason ?? deletion.reason)) {
      throw new WorkshopError(`Dòng "${old.productName} - ${old.size ?? ""}" đã bị xóa nhưng chưa có lý do sửa.`);
    }
    changed += 1;
  }
  if (!changed) throw new WorkshopError("Chưa có thay đổi nào để lưu.");
  const lines = submittedLines({ productionRows: incoming }, true);
  const total = roundQuantity(lines.reduce((sum, line) => sum + line.demand, 0));
  await getDb().$transaction(async (tx) => {
    await tx.workshopPlanLine.deleteMany({ where: { planId: current.id } });
    await tx.workshopPlanLine.createMany({
      data: lines.map((line, index) => ({
        days: asJson(line.days),
        demand: line.demand,
        lineCode: randomCode("wline"),
        lineIndex: index,
        note: text(incoming[index]?.editReason) || undefined,
        orderQty: line.orderQty,
        planId: current.id,
        plannedTotal: line.plannedTotal,
        productName: line.productName,
        rawSource: asJson(line.raw),
        receivedQty: line.receivedQty,
        size: line.size || undefined,
        sku: line.sku || undefined,
        thickness: line.thickness || undefined,
        type: "order",
      })),
    });
    await tx.workshopPlan.update({
      data: {
        lineCount: lines.length,
        payload: asJson(payload),
        totalDemand: total,
        totalPlanned: total,
      },
      where: { id: current.id },
    });
    await tx.workshopPlanAudit.create({
      data: {
        action: "Cập nhật đơn đặt hàng Xưởng",
        actorId: actor.id,
        actorName: actor.name,
        change: asJson({ deletedRows: deleted, productionRows: incoming }),
        newStatus: current.status,
        note: "Cập nhật đơn đặt Xưởng có lý do tại từng dòng thay đổi.",
        oldStatus: current.status,
        planId: current.id,
      },
    });
  });
  const ticket = await upsertPlanRequest(current.id, "order", current.status, current.status === "Hoàn thành" ? "COMPLETED" : current.status.includes("Xử lý") ? "IN_PROGRESS" : "SUBMITTED", actor.id);
  return {
    data: { orderTicket: ticket, planId: current.planCode, savedRows: lines.length, totalDemand: total, totalPlanned: total },
    message: "Đã cập nhật Đặt hàng Xưởng.",
    ok: true,
  };
}

async function planData(payload: JsonRecord) {
  const metadataOnly = payload.metadataOnly === true || payload.includeCatalog === false;
  return {
    catalog: metadataOnly ? undefined : await productCatalog(),
    catalogDeferred: metadataOnly,
    defaultWorkshopName: "Xưởng chính",
    planSheetName: "WorkshopPlan",
    warrantyTypes: [...WARRANTY_TYPES],
    weeks: weekOptions(),
    workshopTeams: await teamDtos(),
  };
}

async function submitPlan(session: AppSession, payload: JsonRecord) {
  const result = await createPlan(session, payload);
  return {
    data: {
      orderMode: result.plan.kind === "ORDER",
      planAuditSheetName: "WorkshopPlanAudit",
      planHeaderSheetName: "WorkshopPlan",
      planId: result.plan.planCode,
      planLineSheetName: "WorkshopPlanLine",
      savedRows: result.plan.lineCount,
      teamKey: result.plan.teamKey,
      teamName: result.plan.teamName,
      totalDemand: Number(result.plan.totalDemand),
      totalPlanned: Number(result.plan.totalPlanned),
      version: result.plan.version,
    },
    message: "Đã nộp kế hoạch xưởng.",
    ok: true,
    planId: result.plan.planCode,
  };
}

async function allocationData(payload: JsonRecord) {
  const weeks = weekOptions().map(operationalWeek);
  const selectedWeekKey = text(payload.weekKey) || weeks[0]?.weekKey || "";
  const orders = await getDb().workshopPlan.findMany({
    include: {
      allocationPlans: { include: { lines: true }, orderBy: { createdAt: "asc" } },
      lines: { orderBy: { lineIndex: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    where: { archivedAt: null, kind: "ORDER", weekKey: selectedWeekKey },
  });
  const orderDtos = orders.map((order) => {
    const dto = planDto(order, payload.includeLines !== false);
    dto.allocationPlanIds = order.allocationPlans.map((item) => item.planCode);
    dto.allocationPlans = order.allocationPlans.map((item) => ({
      lineCount: item.lineCount,
      planId: item.planCode,
      teamKey: item.teamKey,
      teamName: item.teamName,
      totalDemand: Number(item.totalDemand),
      totalPlanned: Number(item.totalPlanned),
    }));
    return dto;
  });
  return {
    catalog: payload.includeCatalog === true ? await productCatalog() : undefined,
    catalogDeferred: payload.includeCatalog !== true,
    orders: orderDtos,
    selectedWeekKey,
    summary: {
      orderCount: orderDtos.length,
      totalDemand: orderDtos.reduce((sum, item) => sum + Number(item.totalDemand), 0),
      totalLines: orderDtos.reduce((sum, item) => sum + Number(item.lineCount), 0),
    },
    weeks,
  };
}

async function acceptOrder(session: AppSession, payload: JsonRecord) {
  const actor = await actorFor(session);
  const plan = await planByCode(payload.planId ?? payload.orderPlanId);
  if (plan.kind !== "ORDER") throw new WorkshopError("Đơn được chọn không phải Đặt hàng Xưởng.");
  const note = text(payload.note) || `Phân xưởng tiếp nhận lúc ${formatTimestamp(new Date())}`;
  await getDb().$transaction([
    getDb().workshopPlan.update({
      data: { approvalStatus: "Đang Xử lý", note, status: "Đang Xử lý" },
      where: { id: plan.id },
    }),
    getDb().workshopPlanAudit.create({
      data: {
        action: "Tiếp nhận đơn đặt Xưởng",
        actorId: actor.id,
        actorName: actor.name,
        change: asJson({ stage: "Đang Xử lý" }),
        newStatus: "Đang Xử lý",
        note,
        oldStatus: plan.status,
        planId: plan.id,
      },
    }),
  ]);
  const inboxTicket = await upsertPlanRequest(plan.id, "order", "Đang Xử lý", "IN_PROGRESS", actor.id);
  return {
    data: await allocationData({ ...payload, includeLines: payload.includeLines !== false }),
    inboxTicket,
    message: "Đã tiếp nhận đơn đặt Xưởng.",
    ok: true,
  };
}

async function sewingRowsFromSource(sourceValue: unknown) {
  const sourceRows = list(sourceValue).map(record);
  const skus = [...new Set(sourceRows.map((row) => text(row.sku)).filter(Boolean))];
  const materials = skus.length
    ? await getDb().workshopMaterial.findMany({ where: { sku: { in: skus } } })
    : [];
  const bySku = new Map<string, typeof materials>();
  materials.forEach((item) => {
    const current = bySku.get(item.sku) ?? [];
    current.push(item);
    bySku.set(item.sku, current);
  });
  const aggregate = new Map<string, JsonRecord>();
  const missing = new Set<string>();
  for (const row of sourceRows) {
    const sku = text(row.sku);
    const bom = bySku.get(sku) ?? [];
    if (!bom.length && sku) missing.add(sku);
    for (const material of bom) {
      const ratio = Number(material.materialQuantity) / Math.max(Number(material.skuQuantity), 1);
      const sourceDays = dayNumbers(row.dayPlans ?? row.days);
      const requiredDays = sourceDays.map((value) => roundQuantity(value * ratio));
      const key = material.materialCode;
      const current = aggregate.get(key) ?? {
        dayPlans: [0, 0, 0, 0, 0, 0, 0],
        productName: parseSkuDescriptor(material.materialName).productName || material.materialName,
        requiredDays: [0, 0, 0, 0, 0, 0, 0],
        size: parseSkuDescriptor(material.materialName).size,
        sku: material.materialCode,
        skuName: material.materialName,
        teamKey: "may",
        teamName: "Tổ May",
        thickness: parseSkuDescriptor(material.materialName).thickness,
      };
      const accumulated = dayNumbers(current.requiredDays).map((value, index) =>
        roundQuantity(value + requiredDays[index]),
      );
      current.dayPlans = accumulated;
      current.requiredDays = accumulated;
      current.orderQty = roundQuantity(accumulated.reduce((sum, item) => sum + item, 0));
      current.demand = current.orderQty;
      current.requiredTotal = current.orderQty;
      current.productKey = normalizedKey(current.productName);
      current.thicknessKey = normalizedKey(current.thickness || "Khác");
      current.sizeKey = normalizedKey(current.size || "Khác");
      aggregate.set(key, current);
    }
  }
  const rows = [...aggregate.values()].sort((left, right) =>
    text(left.productName).localeCompare(text(right.productName), "vi"),
  );
  return {
    missingBomSkus: [...missing].sort(),
    rows,
    totalRequired: rows.reduce((sum, row) => sum + numberValue(row.requiredTotal), 0),
  };
}

async function sewingDependency(weekKeyValue: unknown) {
  const weeks = weekOptions();
  const weekKey = text(weekKeyValue) || weeks[0]?.weekKey || "";
  const plans = await getDb().workshopPlan.findMany({
    include: { lines: { orderBy: { lineIndex: "asc" } } },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    where: { archivedAt: null, kind: { not: "ORDER" }, weekKey },
  });
  const latest = new Map<string, PlanWithLines>();
  plans.forEach((plan) => {
    if (!latest.has(plan.teamKey)) latest.set(plan.teamKey, plan);
  });
  const mayPlan = latest.get("may") ?? null;
  const sourcePlans = [...latest.values()].filter((plan) => plan.teamKey !== "may");
  const sourceRows = sourcePlans.flatMap((plan) =>
    plan.lines.map((line) => ({ dayPlans: dayNumbers(line.days), sku: line.sku })),
  );
  const demand = await sewingRowsFromSource(sourceRows);
  const plannedBySku = new Map(
    (mayPlan?.lines ?? []).map((line) => [text(line.sku), line]),
  );
  const rows = demand.rows.map((row) => {
    const planned = plannedBySku.get(text(row.sku));
    const requiredDays = dayNumbers(row.requiredDays);
    const plannedDays = dayNumbers(planned?.days);
    const balanceDays = requiredDays.map((value, index) => roundQuantity(plannedDays[index] - value));
    const requiredTotal = roundQuantity(requiredDays.reduce((sum, item) => sum + item, 0));
    const plannedTotal = roundQuantity(plannedDays.reduce((sum, item) => sum + item, 0));
    return { ...row, balanceDays, balanceTotal: plannedTotal - requiredTotal, plannedDays, plannedTotal, requiredDays, requiredTotal };
  });
  const totals = rows.reduce(
    (result, row) => ({
      balanceTotal: result.balanceTotal + numberValue(row.balanceTotal),
      plannedTotal: result.plannedTotal + numberValue(row.plannedTotal),
      requiredTotal: result.requiredTotal + numberValue(row.requiredTotal),
    }),
    { balanceTotal: 0, plannedTotal: 0, requiredTotal: 0 },
  );
  const status = !mayPlan ? "missing" : totals.balanceTotal < 0 ? "short" : totals.balanceTotal > 0 ? "over" : "balanced";
  return {
    dayLabels: sewingWeek(weeks.find((item) => item.weekKey === weekKey) ?? weeks[0]).dayLabels,
    mayPlan: mayPlan ? planDto(mayPlan, false) : null,
    message: !mayPlan
      ? "Chưa có kế hoạch Tổ May cho tuần này."
      : status === "short"
        ? "Tổ May đang thiếu so với nhu cầu áo/vỏ phát sinh."
        : status === "over"
          ? "Tổ May đang lập cao hơn nhu cầu phát sinh."
          : "Kế hoạch Tổ May đang cân bằng với nhu cầu.",
    missingBomSkus: demand.missingBomSkus,
    rows,
    sourcePlans: sourcePlans.map((plan) => planDto(plan, false)),
    status,
    totals,
    weekKey,
  };
}

async function approvalPayload(payload: JsonRecord, includeSewing: boolean) {
  const weeks = weekOptions();
  const weekKey = text(payload.weekKey) || weeks[0]?.weekKey || "";
  const plans = await getDb().workshopPlan.findMany({
    include: { lines: { orderBy: { lineIndex: "asc" } } },
    orderBy: [{ teamName: "asc" }, { version: "desc" }, { createdAt: "desc" }],
    where: { archivedAt: null, weekKey },
  });
  const dtos = plans.map((plan) => planDto(plan));
  const summary = dtos.reduce(
    (result, plan) => {
      result.planCount += 1;
      result.totalDemand += numberValue(plan.totalDemand);
      result.totalPlanned += numberValue(plan.totalPlanned);
      const status = normalizedKey(plan.approvalStatus || plan.status);
      if (status === "da-duyet") result.approved += 1;
      else if (status === "tu-choi") result.rejected += 1;
      else if (status === "yeu-cau-dieu-chinh") result.adjust += 1;
      else result.pending += 1;
      return result;
    },
    { adjust: 0, approved: 0, pending: 0, planCount: 0, rejected: 0, totalDemand: 0, totalPlanned: 0 },
  );
  return {
    planAuditSheetName: "WorkshopPlanAudit",
    planHeaderSheetName: "WorkshopPlan",
    planLineSheetName: "WorkshopPlanLine",
    plans: dtos,
    selectedWeekKey: weekKey,
    sewingDependency: includeSewing ? await sewingDependency(weekKey) : null,
    sewingDependencyDeferred: !includeSewing,
    summary,
    teams: await teamDtos(),
    weeks,
  };
}

async function orderSource(payload: JsonRecord) {
  const weekKey = text(payload.weekKey) || weekOptions()[0]?.weekKey || "";
  const plan = await getDb().workshopPlan.findFirst({
    include: { lines: { orderBy: { lineIndex: "asc" } } },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    where: { archivedAt: null, kind: "ORDER", weekKey },
  });
  const rows = (plan?.lines ?? []).map((line) => ({
    dayPlans: dayNumbers(line.days),
    days: dayNumbers(line.days),
    demand: Number(line.demand),
    orderQty: Number(line.orderQty),
    plannedTotal: Number(line.plannedTotal),
    productKey: normalizedKey(line.productName),
    productName: line.productName,
    size: line.size ?? "",
    sizeKey: normalizedKey(line.size ?? "Khác"),
    sku: line.sku ?? "",
    skuName: line.productName,
    thickness: line.thickness ?? "",
    thicknessKey: normalizedKey(line.thickness ?? "Khác"),
  }));
  return {
    rows,
    selectedWeekKey: weekKey,
    sourcePlan: plan ? planDto(plan, false) : null,
    summary: {
      rowCount: rows.length,
      totalDemand: rows.reduce((sum, row) => sum + row.demand, 0),
      totalPlanned: rows.reduce((sum, row) => sum + row.plannedTotal, 0),
    },
    weeks: weekOptions(),
  };
}

async function submitAllocation(session: AppSession, payload: JsonRecord) {
  const actor = await actorFor(session);
  const order = await planByCode(payload.orderPlanId ?? payload.planId);
  if (order.kind !== "ORDER") throw new WorkshopError("Đơn được chọn không phải Đặt hàng Xưởng.");
  const grouped: Record<string, unknown[]> = {
    "cao-su": [],
    goi: list(payload.pillowRows),
    may: list(payload.sewingRows),
    mut: [],
  };
  list(payload.sourceRows).forEach((rowValue) => {
    const row = record(rowValue);
    const key = normalizedKey(row.teamKey) === "cao-su" ? "cao-su" : "mut";
    grouped[key].push({ ...row, teamKey: key });
  });
  const created: JsonRecord[] = [];
  for (const team of DEFAULT_TEAMS.filter((item) => ["mut", "cao-su", "may", "goi"].includes(item.key))) {
    if (!grouped[team.key].length) continue;
    const result = await createPlan(
      session,
      {
        ...payload,
        productionRows: grouped[team.key],
        teamKey: team.key,
        teamName: team.label,
        warrantyRows: [],
        weekEnd: payload.weekEnd ?? (order.weekEnd ? isoDate(order.weekEnd) : ""),
        weekKey: payload.weekKey ?? order.weekKey,
        weekLabel: payload.weekLabel ?? order.weekLabel,
        weekStart: payload.weekStart ?? (order.weekStart ? isoDate(order.weekStart) : ""),
      },
      {
        approved: true,
        kind: "ALLOCATION_TEAM",
        sourceOrderPlanId: order.id,
        teamKey: team.key,
        teamName: team.label,
      },
    );
    created.push({
      lineCount: result.plan.lineCount,
      planId: result.plan.planCode,
      teamKey: result.plan.teamKey,
      teamName: result.plan.teamName,
      totalDemand: Number(result.plan.totalDemand),
      totalPlanned: Number(result.plan.totalPlanned),
    });
  }
  if (!created.length) throw new WorkshopError("Chưa có dòng phân bổ nào để hoàn thành kế hoạch Xưởng.");
  const note = `Đã sinh ${created.length} kế hoạch tổ.`;
  await getDb().$transaction([
    getDb().workshopPlan.update({
      data: { approvalStatus: "Hoàn thành", note, status: "Hoàn thành" },
      where: { id: order.id },
    }),
    getDb().workshopPlanAudit.create({
      data: {
        action: "Hoàn thành phân bổ kế hoạch Xưởng",
        actorId: actor.id,
        actorName: actor.name,
        change: asJson({ plans: created }),
        newStatus: "Hoàn thành",
        note,
        oldStatus: order.status,
        planId: order.id,
      },
    }),
  ]);
  const inboxTicket = await upsertPlanRequest(order.id, "order", "Hoàn thành", "COMPLETED", actor.id);
  return {
    allocation: {
      completedAt: formatTimestamp(new Date()),
      completedBy: actor.name,
      orderPlanId: order.planCode,
      planIds: created.map((item) => item.planId),
      plans: created,
    },
    data: await allocationData({ ...payload, includeLines: true }),
    inboxTicket,
    message: "Đã hoàn thành phân bổ kế hoạch Xưởng.",
    ok: true,
  };
}

function escapeHtml(value: unknown) {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function allocationPrint(payload: JsonRecord) {
  const order = await planByCode(payload.orderPlanId);
  const requested = list(payload.planIds).map(text).filter(Boolean);
  const plans = await getDb().workshopPlan.findMany({
    include: { lines: { orderBy: { lineIndex: "asc" } } },
    orderBy: { teamName: "asc" },
    where: {
      sourceOrderPlanId: order.id,
      ...(requested.length ? { planCode: { in: requested } } : {}),
    },
  });
  const materialMap = new Map<string, { code: string; name: string; qty: number; unit: string }>();
  const skus = [...new Set(plans.flatMap((plan) => plan.lines.map((line) => line.sku).filter(Boolean)))].map(String);
  const materials = await getDb().workshopMaterial.findMany({ where: { sku: { in: skus } } });
  const totalsBySku = new Map<string, number>();
  plans.forEach((plan) => plan.lines.forEach((line) => totalsBySku.set(text(line.sku), (totalsBySku.get(text(line.sku)) ?? 0) + Number(line.plannedTotal))));
  materials.forEach((item) => {
    const qty = roundQuantity((totalsBySku.get(item.sku) ?? 0) * Number(item.materialQuantity) / Math.max(Number(item.skuQuantity), 1));
    const current = materialMap.get(item.materialCode);
    materialMap.set(item.materialCode, {
      code: item.materialCode,
      name: item.materialName,
      qty: roundQuantity((current?.qty ?? 0) + qty),
      unit: item.materialUnit ?? "",
    });
  });
  const rows = [...materialMap.values()];
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Kế hoạch phân bổ NVL</title><style>body{font-family:Arial,sans-serif;color:#17352f;padding:28px}h1{font-size:22px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #b7c8c3;padding:8px;text-align:left}th{background:#edf4f1}.num{text-align:right}</style></head><body><h1>Kế hoạch phân bổ NVL theo tuần</h1><p>${escapeHtml(order.weekLabel)} · ${escapeHtml(order.workshopName)}</p><table><thead><tr><th>Mã NVL</th><th>Tên NVL</th><th>ĐVT</th><th class="num">Số lượng</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.code)}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.unit)}</td><td class="num">${row.qty.toLocaleString("vi-VN")}</td></tr>`).join("") || '<tr><td colspan="4">Chưa có BOM nguyên vật liệu phù hợp.</td></tr>'}</tbody></table></body></html>`;
  return { data: { html }, html, message: "Đã dựng bản in NVL tuần.", ok: true };
}

async function reviewPlan(session: AppSession, payload: JsonRecord) {
  const actor = await actorFor(session);
  const plan = await planByCode(payload.planId);
  if (reviewedStatus(plan.approvalStatus || plan.status)) {
    throw new WorkshopError(`Kế hoạch này đã được xử lý ở trạng thái "${plan.approvalStatus}".`);
  }
  const action = normalizedKey(payload.action ?? payload.status);
  const review = action.includes("adjust") || action.includes("dieu-chinh")
    ? { actionLabel: "Yêu cầu điều chỉnh", status: "Yêu cầu điều chỉnh" }
    : action.includes("reject") || action.includes("tu-choi")
      ? { actionLabel: "Từ chối kế hoạch", status: "Từ chối" }
      : { actionLabel: "Duyệt kế hoạch", status: "Đã duyệt" };
  const note = text(payload.note ?? payload.reason);
  if (review.status !== "Đã duyệt" && !note) {
    throw new WorkshopError("Vui lòng nhập ghi chú khi yêu cầu điều chỉnh hoặc từ chối kế hoạch.");
  }
  await getDb().$transaction([
    getDb().workshopPlan.update({
      data: {
        approvalStatus: review.status,
        note: note || undefined,
        reviewedAt: new Date(),
        reviewerEmail: actor.email,
        reviewerEmployeeId: actor.employeeId,
        reviewerId: actor.id,
        reviewerName: actor.name,
        status: review.status,
      },
      where: { id: plan.id },
    }),
    getDb().workshopPlanAudit.create({
      data: {
        action: review.actionLabel,
        actorId: actor.id,
        actorName: actor.name,
        change: asJson({ action: payload.action, approvalStatus: review.status }),
        newStatus: review.status,
        note: note || undefined,
        oldStatus: plan.approvalStatus,
        planId: plan.id,
      },
    }),
  ]);
  const inboxTicket = review.status === "Đã duyệt"
    ? await upsertPlanRequest(plan.id, "approved", "KH được duyệt", "APPROVED", actor.id)
    : null;
  return {
    data: await approvalPayload(payload, false),
    inboxTicket,
    message: `${review.actionLabel} thành công.`,
    ok: true,
  };
}

function resolveTeam(teams: Awaited<ReturnType<typeof teamDtos>>, value: unknown) {
  const key = normalizedKey(value);
  return teams.find((team) => normalizedKey(team.key) === key || normalizedKey(team.label) === key) ?? teams[0];
}

async function reportPayload(payload: JsonRecord) {
  const teams = (await teamDtos()).filter((team) => !isOrderTeam(team.key, team.label));
  const selectedTeam = resolveTeam(teams, payload.teamKey ?? payload.selectedTeamKey ?? payload.teamName);
  const baseWeeks = weekOptions();
  const weeks = isSewingTeam(selectedTeam?.key, selectedTeam?.label) ? baseWeeks.map(sewingWeek) : baseWeeks;
  const selectedWeek = weeks.find((week) => week.weekKey === text(payload.weekKey)) ?? weeks[0];
  const rawDate = text(payload.reportDate ?? payload.dayDate ?? payload.date);
  const rawDay = text(payload.dayKey ?? payload.day);
  const selectedDay = selectedWeek.dayLabels.find((day) => (rawDate && day.date === rawDate) || (rawDay && day.key === rawDay)) ?? selectedWeek.dayLabels[0];
  if (payload.summaryOnly === true || payload.metadataOnly === true || payload.includeRows === false) {
    return {
      plans: [],
      reportSheetName: "WorkshopReport",
      rows: [],
      rowsDeferred: true,
      selectedDay: { ...selectedDay, index: 0 },
      selectedDayDate: selectedDay.date,
      selectedTeamKey: selectedTeam?.key ?? "",
      selectedWeekKey: selectedWeek.weekKey,
      summary: emptyReportSummary(0),
      teams,
      weeks,
    };
  }
  const plans = await getDb().workshopPlan.findMany({
    include: { lines: { orderBy: { lineIndex: "asc" } } },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    where: {
      approvalStatus: "Đã duyệt",
      archivedAt: null,
      kind: { not: "ORDER" },
      teamKey: selectedTeam?.key,
      weekKey: selectedWeek.weekKey,
    },
  });
  const latestPlan = plans[0];
  const dayIndex = Math.max(0, selectedWeek.dayLabels.findIndex((day) => day.date === selectedDay.date));
  const reportDate = dateOnly(selectedDay.date) ?? new Date();
  const existing = latestPlan
    ? await getDb().workshopReport.findMany({ where: { planId: latestPlan.id, reportDate } })
    : [];
  const existingByLine = new Map(existing.map((item) => [item.lineId, item]));
  const rows = (latestPlan?.lines ?? []).map((line) => {
    const report = existingByLine.get(line.id);
    const days = dayNumbers(line.days);
    return {
      actualQty: report ? Number(report.actualQty) : "",
      approvalStatus: latestPlan?.approvalStatus ?? "",
      dayIndex,
      dayKey: selectedDay.key,
      dayLabel: selectedDay.label,
      days,
      defectHeavyQty: report ? Number(report.defectHeavyQty) : "",
      defectLightQty: report ? Number(report.defectLightQty) : "",
      defectMediumQty: report ? Number(report.defectMediumQty) : "",
      demand: Number(line.demand),
      lineId: line.lineCode,
      note: report?.note ?? "",
      orderQty: Number(line.orderQty),
      planId: latestPlan?.planCode ?? "",
      plannedToday: days[dayIndex] ?? 0,
      plannedTotal: Number(line.plannedTotal),
      productName: line.productName,
      receivedQty: Number(line.receivedQty),
      reportDate: selectedDay.date,
      reportId: report?.reportCode ?? "",
      reportKey: `${latestPlan?.planCode ?? ""}::${line.lineCode}::${selectedDay.date}`,
      reportedAt: report ? formatTimestamp(report.reportedAt) : "",
      reporterName: report?.reporterName ?? "",
      size: line.size ?? "",
      sku: line.sku ?? "",
      teamKey: latestPlan?.teamKey ?? "",
      teamName: latestPlan?.teamName ?? "",
      thickness: line.thickness ?? "",
      type: line.type,
      updatedAt: report ? formatTimestamp(report.updatedAt) : "",
      version: latestPlan?.version ?? 0,
      warrantyType: line.warrantyType ?? "",
      weekEnd: latestPlan?.weekEnd ? isoDate(latestPlan.weekEnd) : "",
      weekKey: latestPlan?.weekKey ?? "",
      weekLabel: latestPlan?.weekLabel ?? "",
      weekStart: latestPlan?.weekStart ? isoDate(latestPlan.weekStart) : "",
      workshopName: latestPlan?.workshopName ?? "",
    };
  });
  return {
    plans: latestPlan
      ? [{ approvalStatus: latestPlan.approvalStatus, planId: latestPlan.planCode, teamKey: latestPlan.teamKey, teamName: latestPlan.teamName, version: latestPlan.version, weekKey: latestPlan.weekKey, weekLabel: latestPlan.weekLabel }]
      : [],
    reportSheetName: "WorkshopReport",
    rows,
    selectedDay: { ...selectedDay, index: dayIndex },
    selectedDayDate: selectedDay.date,
    selectedTeamKey: selectedTeam?.key ?? "",
    selectedWeekKey: selectedWeek.weekKey,
    summary: reportSummary(rows),
    teams,
    weeks,
  };
}

function emptyReportSummary(approvedPlanCount: number) {
  return {
    actualTotal: 0,
    approvedPlanCount,
    defectHeavyTotal: 0,
    defectLightTotal: 0,
    defectMediumTotal: 0,
    defectTotal: 0,
    lineCount: 0,
    plannedToday: 0,
    plannedTotal: 0,
    reportedLineCount: 0,
  };
}

function reportSummary(rows: JsonRecord[]) {
  const summary = emptyReportSummary(rows.length ? 1 : 0);
  rows.forEach((row) => {
    summary.lineCount += 1;
    summary.reportedLineCount += text(row.reportId) ? 1 : 0;
    summary.plannedToday += numberValue(row.plannedToday);
    summary.plannedTotal += numberValue(row.plannedTotal);
    summary.actualTotal += numberValue(row.actualQty);
    summary.defectLightTotal += numberValue(row.defectLightQty);
    summary.defectMediumTotal += numberValue(row.defectMediumQty);
    summary.defectHeavyTotal += numberValue(row.defectHeavyQty);
  });
  summary.defectTotal = summary.defectLightTotal + summary.defectMediumTotal + summary.defectHeavyTotal;
  return summary;
}

async function saveReport(session: AppSession, payload: JsonRecord) {
  const actor = await actorFor(session);
  const data = await reportPayload(payload);
  if (!data.selectedTeamKey) throw new WorkshopError("Vui lòng chọn tổ sản xuất trước khi nộp báo cáo.");
  const sourceByKey = new Map<string, JsonRecord>();
  data.rows.forEach((row) => {
    sourceByKey.set(text(row.reportKey), row);
    sourceByKey.set(text(row.lineId), row);
  });
  let savedRows = 0;
  let createdRows = 0;
  let updatedRows = 0;
  for (const inputValue of list(payload.rows)) {
    const input = record(inputValue);
    const source = sourceByKey.get(text(input.reportKey)) ?? sourceByKey.get(text(input.lineId));
    if (!source) continue;
    const hasContent = ["actualQty", "defectLightQty", "defectMediumQty", "defectHeavyQty"].some((field) => text(input[field]) !== "") || !!text(input.note) || !!text(input.reportId);
    if (!hasContent) continue;
    const plan = await planByCode(source.planId);
    const line = plan.lines.find((item) => item.lineCode === text(source.lineId));
    if (!line) continue;
    const reportDate = dateOnly(source.reportDate);
    if (!reportDate) continue;
    const existing = await getDb().workshopReport.findUnique({
      where: { lineId_reportDate: { lineId: line.id, reportDate } },
    });
    await getDb().workshopReport.upsert({
      create: {
        actualQty: numberValue(input.actualQty),
        dayKey: text(source.dayKey),
        defectHeavyQty: numberValue(input.defectHeavyQty),
        defectLightQty: numberValue(input.defectLightQty),
        defectMediumQty: numberValue(input.defectMediumQty),
        lineId: line.id,
        note: text(input.note) || undefined,
        planId: plan.id,
        plannedToday: numberValue(source.plannedToday),
        reportCode: randomCode("wreport"),
        reportDate,
        reporterEmail: actor.email,
        reporterEmployeeId: actor.employeeId,
        reporterId: actor.id,
        reporterName: actor.name,
        reportKey: text(source.reportKey),
        snapshot: asJson(source),
      },
      update: {
        actualQty: numberValue(input.actualQty),
        defectHeavyQty: numberValue(input.defectHeavyQty),
        defectLightQty: numberValue(input.defectLightQty),
        defectMediumQty: numberValue(input.defectMediumQty),
        note: text(input.note) || undefined,
        reporterEmail: actor.email,
        reporterEmployeeId: actor.employeeId,
        reporterId: actor.id,
        reporterName: actor.name,
        snapshot: asJson(source),
      },
      where: { lineId_reportDate: { lineId: line.id, reportDate } },
    });
    savedRows += 1;
    if (existing) updatedRows += 1;
    else createdRows += 1;
  }
  if (!savedRows) throw new WorkshopError("Chưa có số liệu SX thực tế, lỗi hoặc ghi chú để lưu.");
  const refreshed = await reportPayload(payload);
  return {
    data: { ...refreshed, saveSummary: { createdRows, savedRows, updatedRows } },
    message: "Đã nộp báo cáo sản xuất.",
    ok: true,
  };
}

function proposalTypes() {
  return [
    { key: "swap_day", label: "Đảo kế hoạch sản xuất với ngày khác" },
    { key: "replace_goods", label: "Sản xuất thay thế hàng hóa khác" },
  ];
}

async function proposalPayload(payload: JsonRecord) {
  const report = await reportPayload({
    ...payload,
    reportDate: payload.proposalDate ?? payload.reportDate ?? payload.dayDate ?? payload.date,
    summaryOnly: payload.metadataOnly === true,
  });
  const selectedWeek = report.weeks.find((week) => week.weekKey === report.selectedWeekKey) ?? report.weeks[0];
  const selectedDay = report.selectedDay;
  const recent = await getDb().workshopProposal.findMany({
    orderBy: { createdAt: "desc" },
    take: payload.metadataOnly === true ? 10 : 20,
    where: {
      proposalDate: dateOnly(report.selectedDayDate) ?? undefined,
      teamKey: report.selectedTeamKey || undefined,
      weekKey: report.selectedWeekKey || undefined,
    },
  });
  return {
    catalog: payload.includeCatalog === true && payload.metadataOnly !== true ? await productCatalog() : undefined,
    catalogDeferred: !(payload.includeCatalog === true && payload.metadataOnly !== true),
    plans: report.plans,
    proposalSheetName: "WorkshopProposal",
    proposalTypes: proposalTypes(),
    recentProposals: recent.map((item) => ({
      affectedTeams: item.affectedTeams,
      affectedTeamsText: list(item.affectedTeams).map((team) => text(record(team).label ?? record(team).key)).join(", "),
      createdAt: formatTimestamp(item.createdAt),
      creatorEmail: item.creatorEmail ?? "",
      creatorEmployeeId: item.creatorEmployeeId ?? "",
      creatorName: item.creatorName,
      dayKey: item.dayKey ?? "",
      lineCount: item.lineCount,
      lines: item.lines,
      proposalDate: isoDate(item.proposalDate),
      proposalId: item.proposalCode,
      proposalKind: item.proposalKind,
      status: item.status,
      summary: item.summary ?? "",
      tag: item.tag,
      teamKey: item.teamKey,
      teamName: item.teamName,
      totalChange: Number(item.totalChange),
      weekKey: item.weekKey,
      weekLabel: item.weekLabel,
    })),
    rows: report.rows,
    selectedDay,
    selectedDayDate: report.selectedDayDate,
    selectedTeamKey: report.selectedTeamKey,
    selectedWeek,
    selectedWeekKey: report.selectedWeekKey,
    summary: report.summary,
    targetDayOptions: selectedWeek.dayLabels.filter((day) => day.date !== report.selectedDayDate),
    teams: report.teams,
    weeks: report.weeks,
  };
}

function proposalType(value: unknown) {
  const key = normalizedKey(value);
  if (key === "swap-day" || key.includes("dao") || key.includes("ngay-khac")) return "swap_day";
  if (key === "replace-goods" || key.includes("thay-the") || key.includes("hang-hoa-khac")) return "replace_goods";
  return "";
}

async function submitProposal(session: AppSession, payload: JsonRecord) {
  const actor = await actorFor(session);
  const data = await proposalPayload({ ...payload, includeCatalog: false });
  if (!data.selectedWeekKey || !data.selectedDayDate || !data.selectedTeamKey) {
    throw new WorkshopError("Vui lòng chọn đủ tuần, ngày và tổ trước khi gửi đề xuất.");
  }
  const sourceMap = new Map<string, JsonRecord>();
  data.rows.forEach((row) => {
    sourceMap.set(text(row.reportKey), row);
    sourceMap.set(text(row.lineId), row);
  });
  const teams = data.teams;
  const lines: JsonRecord[] = [];
  for (const inputValue of list(payload.rows)) {
    const input = record(inputValue);
    const source = sourceMap.get(text(input.reportKey ?? input.sourceKey ?? input.lineId));
    if (!source) throw new WorkshopError("Dòng đề xuất không còn khớp với kế hoạch đã duyệt. Vui lòng làm mới.");
    const type = proposalType(input.proposalType ?? input.typeChoice);
    const replacement = record(input.replacement);
    const reason = text(input.reason ?? input.note);
    const targetDayDate = text(input.targetDayDate ?? input.targetDate);
    const hasContent = input.enabled === true || text(input.changeQty) || reason || type || targetDayDate || Object.values(replacement).some(text);
    if (!hasContent) continue;
    if (!reason) throw new WorkshopError(`Dòng "${text(source.productName)}" cần nhập lý do thay đổi.`);
    if (!type) throw new WorkshopError(`Dòng "${text(source.productName)}" cần chọn hướng đề xuất.`);
    if (type === "swap_day" && (!targetDayDate || targetDayDate === data.selectedDayDate)) {
      throw new WorkshopError(`Dòng "${text(source.productName)}" cần chọn ngày đảo kế hoạch khác ngày hiện tại.`);
    }
    if (type === "replace_goods" && !Object.values(replacement).some(text)) {
      throw new WorkshopError(`Dòng "${text(source.productName)}" cần chọn hàng hóa thay thế.`);
    }
    const affectedKeys = new Set(list(input.affectedTeams).map((team) => normalizedKey(record(team).key ?? record(team).label ?? team)));
    affectedKeys.add(normalizedKey(source.teamKey ?? data.selectedTeamKey));
    if (affectedKeys.has("mut") || affectedKeys.has("cao-su")) affectedKeys.add("may");
    const affectedTeams = teams
      .filter((team) => affectedKeys.has(normalizedKey(team.key)))
      .map((team) => ({ key: team.key, label: team.label }));
    lines.push({
      ...source,
      affectedTeams,
      changeQty: signedNumber(input.changeQty),
      proposalType: type,
      proposalTypeLabel: proposalTypes().find((item) => item.key === type)?.label ?? "",
      reason,
      replacement: type === "replace_goods" ? replacement : {},
      targetDayDate: type === "swap_day" ? targetDayDate : "",
      targetDayLabel: type === "swap_day" ? data.targetDayOptions.find((day) => day.date === targetDayDate)?.label ?? targetDayDate : "",
    });
  }
  if (!lines.length) throw new WorkshopError("Vui lòng nhập thay đổi cho ít nhất một dòng.");
  const affectedMap = new Map<string, JsonRecord>();
  lines.forEach((line) => list(line.affectedTeams).forEach((team) => affectedMap.set(text(record(team).key), record(team))));
  const planIds = [...new Set(lines.map((line) => text(line.planId)).filter(Boolean))];
  const versions = [...new Set(lines.map((line) => numberValue(line.version)).filter(Boolean))];
  const totalChange = roundQuantity(lines.reduce((sum, line) => sum + signedNumber(line.changeQty), 0));
  const proposalCode = randomCode("wprop");
  const summary = lines
    .slice(0, 3)
    .map((line) => `${text(line.productName)} - ${text(line.proposalTypeLabel)}${signedNumber(line.changeQty) ? ` (${signedNumber(line.changeQty) > 0 ? "+" : ""}${signedNumber(line.changeQty)})` : ""}`)
    .join("; ");
  await getDb().workshopProposal.create({
    data: {
      affectedTeams: asJson([...affectedMap.values()]),
      creatorEmail: actor.email,
      creatorEmployeeId: actor.employeeId,
      creatorId: actor.id,
      creatorName: actor.name,
      dayKey: text(data.selectedDay.key),
      lineCount: lines.length,
      lines: asJson(lines),
      note: text(payload.note) || undefined,
      planIds: asJson(planIds),
      proposalCode,
      proposalDate: dateOnly(data.selectedDayDate) ?? new Date(),
      sourceLineCount: data.rows.length,
      sourceVersions: asJson(versions),
      summary,
      teamKey: data.selectedTeamKey,
      teamName: resolveTeam(data.teams, data.selectedTeamKey)?.label ?? data.selectedTeamKey,
      totalChange,
      weekKey: data.selectedWeekKey,
      weekLabel: data.selectedWeek.label,
    },
  });
  const refreshed = await proposalPayload(payload);
  return {
    data: { ...refreshed, saveSummary: { affectedTeamCount: affectedMap.size, lineCount: lines.length, proposalId: proposalCode, status: "Chờ duyệt" } },
    message: "Đã gửi đề xuất cập nhật kế hoạch tuần.",
    ok: true,
    proposalId: proposalCode,
  };
}

export async function dispatchWorkshopRpc(
  session: AppSession,
  methodValue: string,
  payloadValue: unknown,
) {
  const method = methodValue as WorkshopMethod;
  const moduleKey = METHOD_MODULE[method];
  if (!moduleKey) throw new WorkshopError("Phương thức Phân Xưởng không được hỗ trợ.", 404);
  assertAccess(session, moduleKey);
  const payload = record(payloadValue);
  switch (method) {
    case "getWorkshopConfigData":
      return { data: await configData(payload), ok: true };
    case "importWorkshopMaterialsFromExcel":
      return importMaterials(payload);
    case "getWorkshopOrderPlanData":
      return { data: await orderPlanData(payload), ok: true };
    case "submitWorkshopOrderPlan":
      return submitOrder(session, payload);
    case "updateWorkshopOrderPlan":
      return updateOrder(session, payload);
    case "getWorkshopPlanData":
      return { data: await planData(payload), ok: true };
    case "submitWorkshopPlan":
      return submitPlan(session, payload);
    case "getWorkshopPlanSewingDependencyData":
      return { data: { selectedWeekKey: text(payload.weekKey), sewingDependency: await sewingDependency(payload.weekKey), weeks: weekOptions() }, ok: true };
    case "getWorkshopOrderSourcePlanData":
      return { data: await orderSource(payload), ok: true };
    case "getWorkshopAllocationData":
      return { data: await allocationData(payload), ok: true };
    case "acceptWorkshopOrder":
      return acceptOrder(session, payload);
    case "getWorkshopAllocationSewingPlanData":
      return { data: await sewingRowsFromSource(payload.sourceRows), ok: true };
    case "submitWorkshopAllocationPlan":
      return submitAllocation(session, payload);
    case "previewWorkshopAllocationMaterialWeekPrintHtml":
      return allocationPrint(payload);
    case "getWorkshopPlanApprovalData":
      return { data: await approvalPayload(payload, payload.includeSewingDependency !== false && payload.deferSewingDependency !== true), ok: true };
    case "getWorkshopPlanApprovalSewingDependencyData":
      return { data: { selectedWeekKey: text(payload.weekKey), sewingDependency: await sewingDependency(payload.weekKey), sewingDependencyDeferred: false, weeks: weekOptions() }, ok: true };
    case "reviewWorkshopPlan":
      return reviewPlan(session, payload);
    case "getWorkshopReportData":
      return { data: await reportPayload(payload), ok: true };
    case "saveWorkshopReport":
      return saveReport(session, payload);
    case "getWorkshopProposalData":
      return { data: await proposalPayload(payload), ok: true };
    case "submitWorkshopProposal":
      return submitProposal(session, payload);
  }
}

export const workshopRuntimeTest = {
  buildWeek,
  normalizedKey,
  operationalWeek,
  parseSkuDescriptor,
  sewingWeek,
};
