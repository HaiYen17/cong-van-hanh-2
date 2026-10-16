"use server";

import { revalidatePath } from "next/cache";

import { Prisma } from "@/generated/prisma/client";
import { requireCurrentSession } from "@/lib/auth/session";
import {
  ESHOP_BACKEND_SPREADSHEET_ID,
  ESHOP_ZERO_GUID,
  getGlobalConfigSnapshot,
  isGlobalConfigSuperAdmin,
  normalizeStringList,
  normalizeText,
  normalizeVtpUsername,
  statusForDb,
  type EshopAccountUi,
  type VtpAccountUi,
} from "@/lib/config/global-config";
import {
  openConfigSecret,
  sealConfigSecret,
} from "@/lib/config/secret-vault";
import { getDb } from "@/lib/db";
import { eshopOpenPlatformToken } from "@/lib/integrations/eshop";
import {
  vtpLongTokenFromShort,
  vtpShortToken,
  vtpTestOrders,
  vtpTestProvince,
  type VtpApiDiagnostic,
} from "@/lib/integrations/viettelpost";

const PATH = "/cau-hinh/tong";

export type ActionResult<T = undefined> =
  | { data: T; message: string; ok: true }
  | { data?: T; message: string; ok: false };

export type VtpTokenActionData = {
  diagnostics: VtpApiDiagnostic[];
  preview: string;
  token?: string;
};

export type VtpAccountInput = {
  accountName: string;
  clearDashboardToken?: boolean;
  clearPassword?: boolean;
  clearToken?: boolean;
  companyScope: string[];
  dashboardToken?: string;
  departmentScope: string[];
  env: "DEV" | "PROD";
  id?: string;
  note?: string;
  partnerAccountId?: string;
  password?: string;
  status: "Kích hoạt" | "Vô hiệu";
  testOrderCode?: string;
  token?: string;
  username: string;
};

export type EshopAccountInput = {
  accountName: string;
  apiAppId?: string;
  apiDomain?: string;
  apiSecret?: string;
  backendSpreadsheetId?: string;
  clearApiSecret?: boolean;
  clearWebBearer?: boolean;
  clearWebCookie?: boolean;
  companyScope: string[];
  departmentScope: string[];
  eshopCompanyKey?: string;
  eshopCompanyName?: string;
  id?: string;
  inventorySheetName?: string;
  note?: string;
  orderSheetName?: string;
  status: "Kích hoạt" | "Vô hiệu";
  webBaseUrl?: string;
  webBearer?: string;
  webBranchId?: string;
  webCompanyCode?: string;
  webCookie?: string;
  webLanguage?: string;
};

async function requireGlobalConfigAdmin() {
  const session = await requireCurrentSession();
  if (!isGlobalConfigSuperAdmin(session)) {
    throw new Error("Chỉ Super Admin được thao tác Cấu hình Tổng.");
  }
  return session;
}

function secretUpdate(
  currentValue: string | null,
  nextValue: unknown,
  clearValue: unknown,
) {
  const next = normalizeText(nextValue);
  if (next) return sealConfigSecret(next);
  if (clearValue === true) return null;
  return currentValue;
}

async function primaryCompanyId(companyScope: string[]) {
  const companyName = companyScope[0];
  if (!companyName) return null;
  const company = await getDb().company.findFirst({
    select: { id: true },
    where: {
      OR: [{ legalName: companyName }, { shortName: companyName }],
      status: "ACTIVE",
    },
  });
  return company?.id ?? null;
}

async function audit(
  actorId: string,
  action: "CREATE" | "UPDATE" | "DELETE" | "SYNC",
  targetType: string,
  targetId: string | null,
  summary: string,
  metadata?: Prisma.InputJsonObject,
) {
  await getDb().auditLog.create({
    data: {
      action,
      actorId,
      metadata: metadata ?? undefined,
      summary,
      targetId,
      targetType,
    },
  });
}

async function currentVtpAccounts(): Promise<VtpAccountUi[]> {
  return (await getGlobalConfigSnapshot()).vtpAccounts;
}

async function currentEshopAccounts(): Promise<EshopAccountUi[]> {
  return (await getGlobalConfigSnapshot()).eshopAccounts;
}

async function resolveVtpSecrets(input: VtpAccountInput) {
  const db = getDb();
  const existing = input.id
    ? await db.viettelPostAccount.findUnique({
        select: { dashboardToken: true, password: true, token: true },
        where: { id: input.id },
      })
    : null;
  return {
    dashboardToken:
      normalizeText(input.dashboardToken) ||
      openConfigSecret(existing?.dashboardToken),
    password:
      normalizeText(input.password) || openConfigSecret(existing?.password),
    token: normalizeText(input.token) || openConfigSecret(existing?.token),
  };
}

async function resolveVtpPartnerCredentials(
  input: VtpAccountInput,
  targetUsername: string,
  targetPassword: string,
) {
  const partnerAccountId = normalizeText(input.partnerAccountId);
  if (!partnerAccountId || partnerAccountId === normalizeText(input.id)) {
    return {
      accountName: normalizeText(input.accountName) || targetUsername,
      env: input.env,
      password: targetPassword,
      username: targetUsername,
    };
  }
  const partner = await getDb().viettelPostAccount.findUnique({
    select: {
      env: true,
      name: true,
      password: true,
      status: true,
      username: true,
    },
    where: { id: partnerAccountId },
  });
  if (!partner) {
    throw new Error("Không tìm thấy tài khoản Partner đã chọn.");
  }
  if (partner.status !== "ACTIVE") {
    throw new Error("Tài khoản Partner đã chọn đang bị vô hiệu.");
  }
  const partnerEnv = partner.env === "DEV" ? "DEV" : "PROD";
  if (partnerEnv !== input.env) {
    throw new Error(
      "Tài khoản Partner và tài khoản cần liên kết phải cùng môi trường.",
    );
  }
  const password = openConfigSecret(partner.password);
  if (!password) {
    throw new Error("Tài khoản Partner đã chọn chưa lưu mật khẩu.");
  }
  return {
    accountName: partner.name,
    env: partnerEnv,
    password,
    username: normalizeVtpUsername(partner.username),
  };
}

export async function saveVtpAccountAction(
  input: VtpAccountInput,
): Promise<ActionResult<{ accounts: VtpAccountUi[] }>> {
  try {
    const session = await requireGlobalConfigAdmin();
    const accountName = normalizeText(input.accountName);
    const username = normalizeVtpUsername(input.username);
    const companyScope = normalizeStringList(input.companyScope);
    const departmentScope = normalizeStringList(input.departmentScope);
    if (!accountName) throw new Error("Vui lòng nhập tên cấu hình.");
    if (!username) throw new Error("Vui lòng nhập tài khoản Viettel Post.");
    if (!companyScope.length) {
      throw new Error("Vui lòng chọn ít nhất một Công ty.");
    }
    if (!departmentScope.length) {
      throw new Error("Vui lòng chọn ít nhất một Phòng ban.");
    }

    const db = getDb();
    const existing = input.id
      ? await db.viettelPostAccount.findUnique({ where: { id: input.id } })
      : null;
    if (input.id && !existing) {
      throw new Error("Không tìm thấy cấu hình Viettel Post cần sửa.");
    }
    const companyId = await primaryCompanyId(companyScope);
    const data = {
      companyId,
      companyScope,
      dashboardToken: secretUpdate(
        existing?.dashboardToken ?? null,
        input.dashboardToken,
        input.clearDashboardToken,
      ),
      departmentScope,
      env: input.env === "DEV" ? "DEV" : "PROD",
      name: accountName,
      note: normalizeText(input.note) || null,
      password: secretUpdate(
        existing?.password ?? null,
        input.password,
        input.clearPassword,
      ),
      status: statusForDb(input.status),
      testOrderCode: normalizeText(input.testOrderCode) || null,
      token: secretUpdate(
        existing?.token ?? null,
        input.token,
        input.clearToken,
      ),
      username,
    };

    await db.$transaction(async (tx) => {
      const row = existing
        ? await tx.viettelPostAccount.update({
            data,
            select: { id: true },
            where: { id: existing.id },
          })
        : await tx.viettelPostAccount.create({
            data: { ...data, createdById: session.userId },
            select: { id: true },
          });
      await tx.auditLog.create({
        data: {
          action: existing ? "UPDATE" : "CREATE",
          actorId: session.userId,
          metadata: {
            clearedSecrets: [
              input.clearPassword ? "password" : "",
              input.clearToken ? "token" : "",
              input.clearDashboardToken ? "dashboardToken" : "",
            ].filter(Boolean),
            companyScope,
            departmentScope,
          },
          summary: `${existing ? "Cập nhật" : "Tạo"} cấu hình Viettel Post "${accountName}".`,
          targetId: row.id,
          targetType: "ViettelPostAccount",
        },
      });
      return row;
    });

    revalidatePath(PATH);
    return {
      data: { accounts: await currentVtpAccounts() },
      message: existing
        ? `Đã cập nhật "${accountName}".`
        : `Đã lưu "${accountName}".`,
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không lưu được cấu hình Viettel Post.",
      ok: false,
    };
  }
}

export async function deleteVtpAccountAction(
  id: string,
): Promise<ActionResult<{ accounts: VtpAccountUi[] }>> {
  try {
    const session = await requireGlobalConfigAdmin();
    const db = getDb();
    const account = await db.viettelPostAccount.findUnique({
      select: { id: true, name: true },
      where: { id },
    });
    if (!account) throw new Error("Không tìm thấy cấu hình cần xóa.");
    await db.$transaction([
      db.viettelPostAccount.delete({ where: { id } }),
      db.auditLog.create({
        data: {
          action: "DELETE",
          actorId: session.userId,
          summary: `Xóa cấu hình Viettel Post "${account.name}".`,
          targetId: id,
          targetType: "ViettelPostAccount",
        },
      }),
    ]);
    revalidatePath(PATH);
    return {
      data: { accounts: await currentVtpAccounts() },
      message: "Đã xóa cấu hình Viettel Post.",
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không xóa được cấu hình Viettel Post.",
      ok: false,
    };
  }
}

export async function getVtpShortTokenAction(
  input: VtpAccountInput,
): Promise<ActionResult<VtpTokenActionData>> {
  try {
    const session = await requireGlobalConfigAdmin();
    const username = normalizeVtpUsername(input.username);
    const { password } = await resolveVtpSecrets(input);
    if (!username) throw new Error("Vui lòng nhập tài khoản Viettel Post.");
    if (!password) throw new Error("Vui lòng nhập mật khẩu Viettel Post.");
    const result = await vtpShortToken(input.env, username, password);
    if (!result.ok) {
      return {
        data: {
          diagnostics: [result.diagnostic],
          preview: "",
        },
        message: `${result.error} Mở phần phản hồi bên dưới để chụp gửi IT Viettel Post.`,
        ok: false,
      };
    }
    await audit(
      session.userId,
      "SYNC",
      "ViettelPostAccount",
      input.id ?? null,
      `Lấy token ngắn hạn Viettel Post cho "${input.accountName || username}".`,
    );
    return {
      data: {
        diagnostics: [result.diagnostic],
        preview: `${result.token.slice(0, 8)}...${result.token.slice(-4)}`,
      },
      message: "Tài khoản hiện tại đăng nhập được API Partner.",
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không lấy được token ngắn hạn Viettel Post.",
      ok: false,
    };
  }
}

export async function getVtpLongTokenAction(
  input: VtpAccountInput,
): Promise<ActionResult<VtpTokenActionData>> {
  try {
    const session = await requireGlobalConfigAdmin();
    const username = normalizeVtpUsername(input.username);
    const { password } = await resolveVtpSecrets(input);
    if (!username || !password) {
      throw new Error("Thiếu tài khoản hoặc mật khẩu Viettel Post.");
    }
    const partner = await resolveVtpPartnerCredentials(
      input,
      username,
      password,
    );
    const partnerLogin = await vtpShortToken(
      partner.env,
      partner.username,
      partner.password,
    );
    const diagnostics = [partnerLogin.diagnostic];
    if (!partnerLogin.ok) {
      return {
        data: { diagnostics, preview: "" },
        message: `Tài khoản Partner "${partner.accountName}" không lấy được token ngắn hạn: ${partnerLogin.error}`,
        ok: false,
      };
    }
    const result = await vtpLongTokenFromShort(
      input.env,
      username,
      password,
      partnerLogin.token,
    );
    diagnostics.push(result.diagnostic);
    if (!result.ok) {
      return {
        data: { diagnostics, preview: "" },
        message: `Đăng nhập Partner thành công nhưng Viettel Post chưa cấp token cho tài khoản ${username}: ${result.error}`,
        ok: false,
      };
    }
    await audit(
      session.userId,
      "SYNC",
      "ViettelPostAccount",
      input.id ?? null,
      `Lấy token dài hạn Viettel Post cho "${input.accountName || username}".`,
    );
    return {
      data: {
        diagnostics,
        preview: `${result.token.slice(0, 8)}...${result.token.slice(-4)}`,
        token: result.token,
      },
      message:
        "Đã liên kết và lấy token API. Bấm Lưu cấu hình để Module Gửi thư sử dụng.",
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không lấy được token dài hạn Viettel Post.",
      ok: false,
    };
  }
}

export async function testVtpProvinceAction(
  input: VtpAccountInput,
): Promise<ActionResult<{ count: number; sample: string }>> {
  try {
    const session = await requireGlobalConfigAdmin();
    const { token } = await resolveVtpSecrets(input);
    const result = await vtpTestProvince(input.env, token);
    if (!result.ok) throw new Error(result.error);
    await audit(
      session.userId,
      "SYNC",
      "ViettelPostAccount",
      input.id ?? null,
      `Kiểm tra API tỉnh/thành Viettel Post: ${result.count} bản ghi.`,
    );
    return {
      data: { count: result.count, sample: result.sample },
      message: `Viettel Post API OK: đọc được ${result.count} tỉnh/thành.${result.sample ? ` Mẫu: ${result.sample}.` : ""}`,
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không test được API tỉnh/thành Viettel Post.",
      ok: false,
    };
  }
}

export async function testVtpOrdersAction(
  input: VtpAccountInput,
): Promise<ActionResult<{ mode: string; returned: number; total: number }>> {
  try {
    const session = await requireGlobalConfigAdmin();
    const { dashboardToken, token } = await resolveVtpSecrets(input);
    if (!token && !dashboardToken) {
      throw new Error(
        "Thiếu API token dài hạn Viettel Post. Vui lòng lấy hoặc dán token rồi thử lại.",
      );
    }
    const result = await vtpTestOrders({
      dashboardToken,
      env: input.env,
      orderCode: normalizeText(input.testOrderCode),
      token,
    });
    if (!result.ok) throw new Error(result.error);
    await audit(
      session.userId,
      "SYNC",
      "ViettelPostAccount",
      input.id ?? null,
      `Kiểm tra dữ liệu đơn Viettel Post: ${result.returned} dòng.`,
    );
    return {
      data: {
        mode: result.mode,
        returned: result.returned,
        total: result.total,
      },
      message:
        result.mode === "detail"
          ? `Viettel Post lấy dữ liệu đơn OK: đọc được mã ${result.sample || input.testOrderCode}.`
          : `Viettel Post lấy dữ liệu đơn OK: thấy ${result.total} đơn, đọc thử ${result.returned} dòng.${result.sample ? ` Mẫu: ${result.sample}.` : ""}`,
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không test được API lấy dữ liệu đơn Viettel Post.",
      ok: false,
    };
  }
}

function inferEshopCode(baseUrl: string) {
  return (
    baseUrl.match(/^https?:\/\/([^.]+)\.mshopkeeper\.vn/i)?.[1]?.trim() ?? ""
  );
}

function normalizeEshopDomain(value: string) {
  const text = value.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!text) return "";
  return text.includes(".") ? text : `${text}.mshopkeeper.vn`;
}

async function resolveEshopSecrets(input: EshopAccountInput) {
  const existing = input.id
    ? await getDb().eshopAccount.findUnique({
        select: { apiSecret: true, webBearer: true, webCookie: true },
        where: { id: input.id },
      })
    : null;
  return {
    apiSecret:
      normalizeText(input.apiSecret) || openConfigSecret(existing?.apiSecret),
    webBearer:
      normalizeText(input.webBearer) || openConfigSecret(existing?.webBearer),
    webCookie:
      normalizeText(input.webCookie) || openConfigSecret(existing?.webCookie),
  };
}

export async function saveEshopAccountAction(
  input: EshopAccountInput,
): Promise<ActionResult<{ accounts: EshopAccountUi[] }>> {
  try {
    const session = await requireGlobalConfigAdmin();
    const accountName = normalizeText(input.accountName);
    const companyScope = normalizeStringList(input.companyScope);
    const departmentScope = normalizeStringList(input.departmentScope);
    if (!accountName) throw new Error("Vui lòng nhập tên cấu hình Eshop.");
    if (!companyScope.length) {
      throw new Error("Vui lòng chọn ít nhất một Công ty cho Eshop.");
    }
    if (!departmentScope.length) {
      throw new Error("Vui lòng chọn ít nhất một Phòng ban cho Eshop.");
    }

    const db = getDb();
    const existing = input.id
      ? await db.eshopAccount.findUnique({ where: { id: input.id } })
      : null;
    if (input.id && !existing) {
      throw new Error("Không tìm thấy cấu hình Eshop cần sửa.");
    }
    const companyId = await primaryCompanyId(companyScope);
    const webCompanyCode =
      normalizeText(input.webCompanyCode) ||
      inferEshopCode(normalizeText(input.webBaseUrl));
    const webBaseUrl =
      normalizeText(input.webBaseUrl).replace(/\/+$/, "") ||
      (webCompanyCode
        ? `https://${webCompanyCode}.mshopkeeper.vn`
        : "");
    const companyKey =
      normalizeText(input.eshopCompanyKey).toUpperCase() ||
      webCompanyCode.toUpperCase() ||
      "ESHOP";
    const data = {
      apiAppId: normalizeText(input.apiAppId) || null,
      apiDomain:
        normalizeEshopDomain(
          normalizeText(input.apiDomain) || webCompanyCode,
        ) || null,
      apiSecret: secretUpdate(
        existing?.apiSecret ?? null,
        input.apiSecret,
        input.clearApiSecret,
      ),
      backendSpreadsheetId:
        normalizeText(input.backendSpreadsheetId) ||
        ESHOP_BACKEND_SPREADSHEET_ID,
      branchId: normalizeText(input.webBranchId) || ESHOP_ZERO_GUID,
      companyId,
      companyKey,
      companyName:
        normalizeText(input.eshopCompanyName) || companyScope[0] || companyKey,
      companyScope,
      departmentScope,
      inventorySheetName:
        normalizeText(input.inventorySheetName) ||
        `Dữ liệu kho ${companyKey}`,
      language: normalizeText(input.webLanguage) || "vi-VN",
      name: accountName,
      note: normalizeText(input.note) || null,
      orderSheetName:
        normalizeText(input.orderSheetName) ||
        `Dữ liệu đơn ${companyKey}`,
      status: statusForDb(input.status),
      webBaseUrl: webBaseUrl || null,
      webBearer: secretUpdate(
        existing?.webBearer ?? null,
        input.webBearer,
        input.clearWebBearer,
      ),
      webCompanyCode: webCompanyCode || null,
      webCookie: secretUpdate(
        existing?.webCookie ?? null,
        input.webCookie,
        input.clearWebCookie,
      ),
    };

    await db.$transaction(async (tx) => {
      const row = existing
        ? await tx.eshopAccount.update({
            data,
            select: { id: true },
            where: { id: existing.id },
          })
        : await tx.eshopAccount.create({
            data: { ...data, createdById: session.userId },
            select: { id: true },
          });
      await tx.auditLog.create({
        data: {
          action: existing ? "UPDATE" : "CREATE",
          actorId: session.userId,
          metadata: {
            clearedSecrets: [
              input.clearWebBearer ? "webBearer" : "",
              input.clearWebCookie ? "webCookie" : "",
              input.clearApiSecret ? "apiSecret" : "",
            ].filter(Boolean),
            companyScope,
            departmentScope,
          },
          summary: `${existing ? "Cập nhật" : "Tạo"} cấu hình Eshop "${accountName}".`,
          targetId: row.id,
          targetType: "EshopAccount",
        },
      });
      return row;
    });

    revalidatePath(PATH);
    return {
      data: { accounts: await currentEshopAccounts() },
      message: existing
        ? `Đã cập nhật "${accountName}".`
        : `Đã lưu "${accountName}".`,
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không lưu được cấu hình Eshop.",
      ok: false,
    };
  }
}

export async function deleteEshopAccountAction(
  id: string,
): Promise<ActionResult<{ accounts: EshopAccountUi[] }>> {
  try {
    const session = await requireGlobalConfigAdmin();
    const db = getDb();
    const account = await db.eshopAccount.findUnique({
      select: { id: true, name: true },
      where: { id },
    });
    if (!account) throw new Error("Không tìm thấy cấu hình cần xóa.");
    await db.$transaction([
      db.eshopAccount.delete({ where: { id } }),
      db.auditLog.create({
        data: {
          action: "DELETE",
          actorId: session.userId,
          summary: `Xóa cấu hình Eshop "${account.name}".`,
          targetId: id,
          targetType: "EshopAccount",
        },
      }),
    ]);
    revalidatePath(PATH);
    return {
      data: { accounts: await currentEshopAccounts() },
      message: "Đã xóa cấu hình Eshop.",
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không xóa được cấu hình Eshop.",
      ok: false,
    };
  }
}

export async function testEshopOpenPlatformAction(
  input: EshopAccountInput,
): Promise<ActionResult<{ preview: string }>> {
  try {
    const session = await requireGlobalConfigAdmin();
    const apiDomain = normalizeEshopDomain(
      normalizeText(input.apiDomain) ||
        normalizeText(input.webCompanyCode) ||
        inferEshopCode(normalizeText(input.webBaseUrl)),
    );
    const apiAppId = normalizeText(input.apiAppId);
    const { apiSecret } = await resolveEshopSecrets(input);
    if (!apiDomain) throw new Error("Vui lòng nhập API Domain Eshop.");
    if (!apiAppId) throw new Error("Vui lòng nhập API App ID Eshop.");
    if (!apiSecret) throw new Error("Vui lòng nhập hoặc lưu API Secret Eshop.");
    const result = await eshopOpenPlatformToken(
      apiDomain,
      apiAppId,
      apiSecret,
    );
    if (!result.ok) throw new Error(result.error);
    const preview = `${result.token.slice(0, 8)}...${result.token.slice(-4)}`;
    await audit(
      session.userId,
      "SYNC",
      "EshopAccount",
      input.id ?? null,
      `Kiểm tra OpenPlatform cho "${input.accountName || apiDomain}".`,
      { tokenPreview: preview },
    );
    return {
      data: { preview },
      message: `OpenPlatform phản hồi OK: ${preview}. Token này không ghi đè Web Bearer lấy đơn.`,
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không kiểm tra được Eshop OpenPlatform.",
      ok: false,
    };
  }
}
