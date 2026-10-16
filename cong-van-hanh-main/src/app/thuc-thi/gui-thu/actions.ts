"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentSession } from "@/lib/auth/session";
import { sessionUserIds } from "@/lib/auth/session-identity";
import { openConfigSecret } from "@/lib/config/secret-vault";
import { getDb } from "@/lib/db";
import {
  vtpCreateOrder,
  vtpGetPrintLinks,
  vtpGetPriceAll,
  vtpQueryTracking,
  type VtpDistrict,
  type VtpProvince,
  type VtpService,
  type VtpWard,
} from "@/lib/integrations/viettelpost-mail";
import {
  resolveAccessibleVtpAccount,
} from "@/lib/send-mail/account-access";
import {
  getSendMailDistricts,
  getSendMailProvinces,
  getSendMailWards,
  type SendMailAddressMode,
} from "@/lib/send-mail/location-cache";

const PATH = "/thuc-thi/gui-thu";

export type MailActionState = {
  error?: string;
  printUrl?: string;
  success?: string;
  trackingCode?: string;
  warning?: string;
};

function num(v: FormDataEntryValue | null): number {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function text(formData: FormData, name: string) {
  return String(formData.get(name) || "").trim();
}

// Chuẩn hoá SĐT — bám normalizeSendMailPhone_.
function normalizePhone(value: string): string {
  let v = String(value || "").replace(/[^\d+]/g, "");
  if (v.startsWith("+84")) v = "0" + v.slice(3);
  else if (v.startsWith("84") && v.length >= 10) v = "0" + v.slice(2);
  if (v && !v.startsWith("0")) v = "0" + v;
  return v;
}

// ---- Danh mục (combobox) ----
export async function mailListProvinces(
  env: string,
  addressMode: SendMailAddressMode = "new",
): Promise<{
  error?: string;
  provinces: VtpProvince[];
  source?: string;
  syncedAt?: string;
}> {
  await requireCurrentSession();
  return getSendMailProvinces(env || "PROD", addressMode);
}

export async function mailListDistricts(
  env: string,
  provinceId: number,
): Promise<{
  districts: VtpDistrict[];
  error?: string;
  source?: string;
  syncedAt?: string;
}> {
  await requireCurrentSession();
  if (!provinceId) return { districts: [] };
  return getSendMailDistricts(env || "PROD", provinceId);
}

export async function mailListWards(
  env: string,
  input: {
    addressMode: SendMailAddressMode;
    districtId?: number;
    provinceId?: number;
  },
): Promise<{
  error?: string;
  source?: string;
  syncedAt?: string;
  wards: VtpWard[];
}> {
  await requireCurrentSession();
  return getSendMailWards(env || "PROD", input);
}

// ---- Tính cước / danh sách dịch vụ ----
export type ServicesInput = {
  accountId: string;
  moneyCollection: number;
  productHeight: number;
  productLength: number;
  productPrice: number;
  productType: string;
  productWeight: number;
  productWidth: number;
  receiverDistrict: number;
  receiverProvince: number;
  receiverWard: number;
  receiverAddressMode: SendMailAddressMode;
  senderDistrict: number;
  senderProvince: number;
  senderWard: number;
  senderAddressMode: SendMailAddressMode;
};

export async function mailGetServices(input: ServicesInput): Promise<{ error?: string; services: VtpService[] }> {
  const session = await requireCurrentSession();
  const securedAccount = await resolveAccessibleVtpAccount(
    session,
    input.accountId,
  );
  if (!securedAccount) {
    return {
      error: "Tài khoản Viettel Post không thuộc phạm vi được cấp cho bạn.",
      services: [],
    };
  }
  const acc = { ...securedAccount, token: openConfigSecret(securedAccount.token) };
  if (!acc.token) return { error: "Tài khoản chưa có token — vào Cấu hình Tổng lấy token trước.", services: [] };
  if (!input.senderProvince || !input.senderWard || !input.receiverProvince || !input.receiverWard) {
    return { error: "Cần đủ tỉnh/phường người gửi và người nhận để tính cước.", services: [] };
  }
  if (
    (input.senderAddressMode === "old" && !input.senderDistrict) ||
    (input.receiverAddressMode === "old" && !input.receiverDistrict)
  ) {
    return {
      error: "Địa chỉ cũ cần chọn đủ tỉnh/thành, quận/huyện và phường/xã.",
      services: [],
    };
  }
  const r = await vtpGetPriceAll(acc.env, acc.token, {
    moneyCollection: input.moneyCollection,
    productHeight: input.productHeight,
    productLength: input.productLength,
    productPrice: input.productPrice,
    productType: input.productType,
    productWeight: input.productWeight,
    productWidth: input.productWidth,
    receiverDistrict: input.receiverDistrict,
    receiverProvince: input.receiverProvince,
    receiverWard: input.receiverWard,
    senderDistrict: input.senderDistrict,
    senderProvince: input.senderProvince,
    senderWard: input.senderWard,
  });
  return r.ok ? { services: r.services } : { error: r.error, services: [] };
}

// ---- Tạo đơn ----
export async function createMailOrderAction(_state: MailActionState, formData: FormData): Promise<MailActionState> {
  const session = await requireCurrentSession();
  const db = getDb();

  const accountId = text(formData, "accountId");
  const securedAccount = accountId
    ? await resolveAccessibleVtpAccount(session, accountId)
    : null;
  if (!securedAccount) {
    return {
      error: "Tài khoản Viettel Post không tồn tại hoặc không thuộc phạm vi được cấp cho bạn.",
    };
  }
  const acc = { ...securedAccount, token: openConfigSecret(securedAccount.token) };
  if (!acc.token) return { error: "Tài khoản chưa có token — lấy token ở Cấu hình Tổng trước." };

  const productType = text(formData, "productType") === "HH" ? "HH" : "TH";
  const isTH = productType === "TH";
  const senderAddressMode: SendMailAddressMode =
    text(formData, "senderAddressMode") === "old" ? "old" : "new";
  const receiverAddressMode: SendMailAddressMode =
    text(formData, "receiverAddressMode") === "old" ? "old" : "new";

  const senderName = text(formData, "senderName");
  const senderPhone = normalizePhone(text(formData, "senderPhone"));
  const senderAddress = text(formData, "senderAddress");
  const senderProvince = num(formData.get("senderProvince"));
  const senderDistrict = num(formData.get("senderDistrict"));
  const senderWard = num(formData.get("senderWard"));

  const receiverName = text(formData, "receiverName");
  const receiverPhone = normalizePhone(text(formData, "receiverPhone"));
  const receiverAddress = text(formData, "receiverAddress");
  const receiverProvince = num(formData.get("receiverProvince"));
  const receiverDistrict = num(formData.get("receiverDistrict"));
  const receiverWard = num(formData.get("receiverWard"));

  const orderService = text(formData, "orderService");
  const orderServiceAdd = text(formData, "orderServiceAdd");
  const serviceName = text(formData, "serviceName");

  // Validate bắt buộc — bám validateBeforeApi.
  const missing: string[] = [];
  if (!senderName) missing.push("tên người gửi");
  if (!senderPhone) missing.push("SĐT người gửi");
  if (!senderAddress) missing.push("địa chỉ gửi");
  if (!senderProvince || !senderWard) missing.push("tỉnh/phường gửi");
  if (senderAddressMode === "old" && !senderDistrict) {
    missing.push("quận/huyện gửi (địa chỉ cũ)");
  }
  if (!receiverName) missing.push("tên người nhận");
  if (!receiverPhone) missing.push("SĐT người nhận");
  if (!receiverAddress) missing.push("địa chỉ nhận");
  if (!receiverProvince || !receiverWard) missing.push("tỉnh/phường nhận");
  if (receiverAddressMode === "old" && !receiverDistrict) {
    missing.push("quận/huyện nhận (địa chỉ cũ)");
  }
  if (!orderService) missing.push("dịch vụ (bấm Kiểm tra cước rồi chọn)");
  if (missing.length) return { error: `Thiếu: ${missing.join(", ")}.` };

  // TH (thư): ép giá trị cố định như app cũ.
  const productName = isTH ? "Thư/hồ sơ" : text(formData, "productName") || "Hàng hóa";
  const quantity = isTH ? 1 : Math.max(1, num(formData.get("quantity")));
  const weight = isTH ? 50 : Math.max(1, num(formData.get("weight")));
  const productPrice = isTH ? 0 : num(formData.get("productPrice"));
  const moneyCollection = isTH ? 0 : num(formData.get("moneyCollection"));
  const productLength = isTH ? 0 : num(formData.get("productLength"));
  const productWidth = isTH ? 0 : num(formData.get("productWidth"));
  const productHeight = isTH ? 0 : num(formData.get("productHeight"));
  let orderPayment = num(formData.get("orderPayment")) || 1;
  if (isTH) orderPayment = 1;
  else if (moneyCollection > 0 && orderPayment === 1) orderPayment = 3;

  const orderNumber = text(formData, "orderNumber");
  const note = text(formData, "note");

  const r = await vtpCreateOrder(acc.env, acc.token, {
    checkUnique: true,
    moneyCollection,
    note,
    orderNumber,
    orderPayment,
    orderService,
    orderServiceAdd,
    productHeight,
    productLength,
    productName,
    productPrice,
    productQuantity: quantity,
    productType,
    productWeight: weight,
    productWidth,
    receiverAddress,
    receiverDistrict,
    receiverFullname: receiverName,
    receiverPhone,
    receiverProvince,
    receiverWard,
    senderAddress,
    senderDistrict,
    senderFullname: senderName,
    senderPhone,
    senderProvince,
    senderWard,
  });
  if (!r.ok) return { error: r.error };

  const printResult = await vtpGetPrintLinks(
    acc.env,
    acc.token,
    [r.orderNumber],
    1,
  );

  try {
    await db.mailOrder.create({
      data: {
        companyId: acc.companyId,
        createdById: session.userId,
        createdByName: session.displayName,
        fee: r.fee,
        moneyCollection,
        note: note || null,
        orderNumber: orderNumber || null,
        orderPayment,
        productName,
        productPrice,
        productType,
        quantity,
        rawResponse: r.raw as object,
        receiverAddress,
        receiverDistrict: receiverDistrict || null,
        receiverName,
        receiverPhone,
        receiverProvince: receiverProvince || null,
        receiverWard: receiverWard || null,
        senderAddress,
        senderDistrict: senderDistrict || null,
        senderName,
        senderPhone,
        senderProvince: senderProvince || null,
        senderWard: senderWard || null,
        service: orderService || null,
        serviceName: serviceName || null,
        status: "Đang theo dõi",
        trackingCode: r.orderNumber,
        vtpAccountId: acc.id,
        vtpStatus: "Đã tạo vận đơn",
        weight,
      },
    });
  } catch {
    return { error: `Đã tạo vận đơn ${r.orderNumber} trên VTP nhưng lưu sổ thất bại — kiểm tra Quản lý đơn.` };
  }

  revalidatePath(PATH);
  const a5 = printResult.ok
    ? printResult.links.find((link) => link.type === "1") ||
      printResult.links[0]
    : null;
  return {
    printUrl: a5?.url,
    success: `Đã tạo vận đơn ${r.orderNumber}.`,
    trackingCode: r.orderNumber,
    warning: printResult.ok ? undefined : printResult.error,
  };
}

export async function mailGetPrintLink(orderId: string): Promise<{
  error?: string;
  printUrl?: string;
}> {
  const session = await requireCurrentSession();
  const identityUserIds = sessionUserIds(session);
  const order = await getDb().mailOrder.findFirst({
    select: { trackingCode: true, vtpAccountId: true },
    where: { createdById: { in: identityUserIds }, id: orderId },
  });
  if (!order?.trackingCode || !order.vtpAccountId) {
    return { error: "Đơn chưa có đủ mã vận đơn hoặc tài khoản gửi." };
  }
  const securedAccount = await resolveAccessibleVtpAccount(
    session,
    order.vtpAccountId,
  );
  const token = securedAccount ? openConfigSecret(securedAccount.token) : "";
  if (!securedAccount || !token) {
    return { error: "Tài khoản gửi không còn sẵn sàng để lấy link in." };
  }
  const result = await vtpGetPrintLinks(
    securedAccount.env,
    token,
    [order.trackingCode],
    1,
  );
  if (!result.ok) return { error: result.error };
  const a5 =
    result.links.find((link) => link.type === "1") || result.links[0];
  return a5?.url
    ? { printUrl: a5.url }
    : { error: "Viettel Post chưa trả link in A5." };
}

export async function refreshMyMailStatuses(): Promise<{
  checked: number;
  changed: number;
  errors: number;
  message?: string;
}> {
  const session = await requireCurrentSession();
  const identityUserIds = sessionUserIds(session);
  const db = getDb();
  const orders = await db.mailOrder.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      trackingCode: true,
      vtpAccountId: true,
      vtpStatus: true,
    },
    take: 50,
    where: {
      createdById: { in: identityUserIds },
      trackingCode: { not: null },
    },
  });
  let checked = 0;
  let changed = 0;
  let errors = 0;

  for (const order of orders) {
    if (!order.trackingCode || !order.vtpAccountId) continue;
    const account = await resolveAccessibleVtpAccount(
      session,
      order.vtpAccountId,
    );
    const token = account ? openConfigSecret(account.token) : "";
    if (!account || !token) {
      errors += 1;
      continue;
    }
    const result = await vtpQueryTracking(
      account.env,
      token,
      order.trackingCode,
    );
    if (!result.ok) {
      errors += 1;
      continue;
    }
    checked += 1;
    const nextStatus = result.tracking.delivered
      ? "Đã giao thành công"
      : "Đang theo dõi";
    if (
      order.vtpStatus !== result.tracking.statusLabel ||
      order.status !== nextStatus
    ) {
      changed += 1;
      await db.mailOrder.update({
        data: {
          status: nextStatus,
          vtpStatus: result.tracking.statusLabel,
        },
        where: { id: order.id },
      });
    }
  }
  revalidatePath(PATH);
  return {
    changed,
    checked,
    errors,
    message: orders.length
      ? undefined
      : "Chưa có vận đơn nào để dò trạng thái.",
  };
}
