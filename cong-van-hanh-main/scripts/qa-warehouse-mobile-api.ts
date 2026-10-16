import "dotenv/config";

import { getModuleConfigSecret } from "../src/lib/config/global-config";
import { getDb } from "../src/lib/db";

type JsonRecord = Record<string, unknown>;

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

async function readJson(response: Response) {
  return jsonRecord(await response.json());
}

async function main() {
  const db = getDb();
  const baseUrl =
    process.env.WAREHOUSE_QA_BASE_URL ||
    "https://thuanvietgroup.biz.vn";
  const apiKey = await getModuleConfigSecret("warehouseKts.androidApiKey");
  if (!apiKey) throw new Error("Chưa có warehouseKts.androidApiKey.");

  const candidates = await db.employee.findMany({
    include: {
      user: {
        include: { userRoles: { include: { role: true } } },
      },
    },
    orderBy: { updatedAt: "desc" },
    where: { status: "ACTIVE", user: { status: "ACTIVE" } },
  });
  const candidate = candidates.find(
    (employee) =>
      employee.user &&
      !employee.user.requiresPassword &&
      !employee.user.userRoles.some(
        ({ role }) => role.key === "super-admin" && role.status === "ACTIVE",
      ),
  );
  if (!candidate?.user) {
    throw new Error(
      "Không có tài khoản không yêu cầu mật khẩu để chạy QA đăng nhập an toàn.",
    );
  }
  const searchableTag = await db.warehouseRfidTag.findFirst({
    include: { product: true },
    orderBy: { updatedAt: "desc" },
    where: {
      issuanceStatus: "ACTIVE",
      product: { isNot: null },
    },
  });
  if (!searchableTag?.product) {
    throw new Error("Không có RFID đang kích hoạt để chạy QA Tìm kiếm.");
  }

  const appHeaders = { "X-API-Key": apiKey };
  const employeesResponse = await fetch(`${baseUrl}/api/mobile/auth/employees`, {
    headers: appHeaders,
  });
  const employeesJson = await readJson(employeesResponse);
  const employees = Array.isArray(employeesJson.employees)
    ? employeesJson.employees
    : [];
  if (
    !employeesResponse.ok ||
    employeesJson.ok !== true ||
    !employees.some(
      (employee) => jsonRecord(employee).employeeId === candidate.id,
    )
  ) {
    throw new Error(
      `QA employees thất bại: HTTP ${employeesResponse.status}`,
    );
  }

  const loginResponse = await fetch(`${baseUrl}/api/mobile/auth/login`, {
    body: JSON.stringify({ employeeId: candidate.id }),
    headers: {
      ...appHeaders,
      "Content-Type": "application/json",
      "User-Agent": "Codex-Warehouse-Mobile-QA/1.0",
    },
    method: "POST",
  });
  const loginJson = await readJson(loginResponse);
  const accessToken = String(loginJson.accessToken || "");
  if (!loginResponse.ok || loginJson.ok !== true || !accessToken) {
    throw new Error(`QA login thất bại: HTTP ${loginResponse.status}`);
  }

  const sessionHeaders = {
    ...appHeaders,
    Authorization: `Bearer ${accessToken}`,
  };
  let qaResult: JsonRecord = {};
  try {
    const meResponse = await fetch(`${baseUrl}/api/mobile/auth/me`, {
      headers: sessionHeaders,
    });
    const meJson = await readJson(meResponse);
    const profile = jsonRecord(meJson.profile);
    if (
      !meResponse.ok ||
      meJson.ok !== true ||
      profile.userId !== candidate.user.id
    ) {
      throw new Error(`QA /me thất bại: HTTP ${meResponse.status}`);
    }

    const catalogResponse = await fetch(
      `${baseUrl}/api/warehouse/catalog?limit=1&page=1`,
      { headers: appHeaders },
    );
    const catalogJson = await readJson(catalogResponse);
    const products = Array.isArray(catalogJson.products)
      ? catalogJson.products
      : [];
    const pagination = jsonRecord(catalogJson.pagination);
    if (
      !catalogResponse.ok ||
      catalogJson.ok !== true ||
      !products.length ||
      pagination.page !== 1 ||
      pagination.limit !== 1 ||
      typeof pagination.total !== "number" ||
      typeof pagination.totalPages !== "number" ||
      typeof pagination.hasMore !== "boolean"
    ) {
      throw new Error(`QA catalog GET thất bại: HTTP ${catalogResponse.status}`);
    }

    const product = jsonRecord(products[0]);
    const rfidResponse = await fetch(`${baseUrl}/api/warehouse/rfid`, {
      body: JSON.stringify({
        action: "warehouseCatalogLookup",
        limit: 1,
        sku: String(product.sku || ""),
      }),
      headers: { ...sessionHeaders, "Content-Type": "application/json" },
      method: "POST",
    });
    const rfidJson = await readJson(rfidResponse);
    if (!rfidResponse.ok || rfidJson.ok !== true) {
      throw new Error(
        `QA catalog POST có phiên đăng nhập thất bại: HTTP ${rfidResponse.status}`,
      );
    }

    const searchResponse = await fetch(`${baseUrl}/api/warehouse/rfid`, {
      body: JSON.stringify({
        action: "warehouseRfidSearch",
        limit: 100,
        query: searchableTag.product.sku,
      }),
      headers: { ...sessionHeaders, "Content-Type": "application/json" },
      method: "POST",
    });
    const searchJson = await readJson(searchResponse);
    const searchOptions = Array.isArray(searchJson.options)
      ? searchJson.options
      : [];
    if (
      !searchResponse.ok ||
      searchJson.ok !== true ||
      !searchOptions.some(
        (item) => jsonRecord(item).epc === searchableTag.epc,
      )
    ) {
      throw new Error(`QA RFID search thất bại: HTTP ${searchResponse.status}`);
    }

    qaResult = {
      catalogGet: catalogResponse.status,
      catalogPagination: true,
      catalogPostWithUserSession: rfidResponse.status,
      employeeDirectory: employeesResponse.status,
      login: loginResponse.status,
      me: meResponse.status,
      productResolved: Boolean(product.sku && product.name),
      rfidSearch: searchResponse.status,
      rfidSearchResolvedActiveEpc: true,
      userIdentityMatched: true,
    };
  } finally {
    const logoutResponse = await fetch(`${baseUrl}/api/mobile/auth/logout`, {
      headers: sessionHeaders,
      method: "POST",
    });
    if (!logoutResponse.ok) {
      throw new Error(`QA logout thất bại: HTTP ${logoutResponse.status}`);
    }
    qaResult.logout = logoutResponse.status;
  }
  console.log(JSON.stringify(qaResult, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
