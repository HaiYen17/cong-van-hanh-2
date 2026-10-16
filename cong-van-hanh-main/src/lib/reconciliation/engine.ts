import {
  RECONCILIATION_COMPANIES,
  RECONCILIATION_COMPANY_META,
  type CompanyStat,
  type HrEntry,
  type RawReconciliationRow,
  type ReconciliationAccountMapping,
  type ReconciliationCompany,
  type ReconciliationDetailRow,
  type ReconciliationEngineResult,
  type ReconciliationIssueInput,
  type ReconciliationPeriod,
  type UserStat,
  type VoucherRow,
} from "@/lib/reconciliation/types";

type NormalizedUrboxRow = {
  brand: string;
  category: string;
  customerCode: string;
  exchangeTime: Date | null;
  exchangeTimeRaw: string;
  giftName: string;
  orderCode: string;
  program: string;
  quantity: number;
  raw: RawReconciliationRow;
  sourceRow: number;
  transactionCode: string;
  value: number;
};

type NormalizedBaseRewardRow = {
  employeeName: string;
  note: string;
  placedAt: Date | null;
  placedAtRaw: string;
  provider: string;
  raw: RawReconciliationRow;
  transactionCode: string;
  unitPrice: number;
  username: string;
};

type AccountIndex = {
  byAccountName: Map<string, ReconciliationAccountMapping[]>;
  byAccountNameAndUsername: Map<string, ReconciliationAccountMapping>;
  byUsername: Map<string, ReconciliationAccountMapping[]>;
};

function emptyCompanyRecord<T>(): Record<ReconciliationCompany, T[]> {
  return {
    "Thuần Việt Digital": [],
    "Thuần Việt Global": [],
    "Nệm Thành Công": [],
  };
}

export function safeText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function normalizeName(value: unknown) {
  return safeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("vi")
    .trim();
}

export function normalizeUsername(value: unknown) {
  return safeText(value).toLocaleLowerCase("vi");
}

export function decodeHtmlEntities(value: unknown) {
  return safeText(value)
    .replace(/&#33;/g, "!")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

export function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

export function parseFlexibleDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number" && value > 20_000 && value < 60_000) {
    return new Date(Math.round((value - 25_569) * 86_400_000));
  }

  const text = safeText(value);
  if (!text) return null;

  if (/^\d+(\.\d+)?$/.test(text)) {
    const number = Number(text);
    if (number > 20_000 && number < 60_000) {
      return new Date(Math.round((number - 25_569) * 86_400_000));
    }
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    const parsed = new Date(
      Date.UTC(
        Number(isoDate[1]),
        Number(isoDate[2]) - 1,
        Number(isoDate[3]),
      ),
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const timeDmy = text.match(
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  );
  if (timeDmy) {
    return new Date(
      Date.UTC(
        Number(timeDmy[6]),
        Number(timeDmy[5]) - 1,
        Number(timeDmy[4]),
        Number(timeDmy[1]),
        Number(timeDmy[2]),
        Number(timeDmy[3] || 0),
      ),
    );
  }

  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    return new Date(
      Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])),
    );
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildReconciliationPeriod(
  month: number,
  year: number,
): ReconciliationPeriod {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Tháng đối soát không hợp lệ.");
  }
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new Error("Năm đối soát không hợp lệ.");
  }
  const from = new Date(Date.UTC(year, month - 2, 26));
  const to = new Date(Date.UTC(year, month - 1, 25, 23, 59, 59, 999));
  const format = (date: Date) =>
    `${String(date.getUTCDate()).padStart(2, "0")}/${String(
      date.getUTCMonth() + 1,
    ).padStart(2, "0")}/${date.getUTCFullYear()}`;
  const tabName = `T${String(month).padStart(2, "0")}.${year}`;
  return {
    from,
    label: `${format(from)} - ${format(to)}`,
    month,
    periodKey: tabName,
    tabName,
    to,
    year,
  };
}

function dateKey(date: Date) {
  return (
    date.getUTCFullYear() * 10_000 +
    (date.getUTCMonth() + 1) * 100 +
    date.getUTCDate()
  );
}

export function isDateInPeriod(
  value: unknown,
  period: ReconciliationPeriod,
) {
  const raw = safeText(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (iso) {
    const key = Number(`${iso[1]}${iso[2]}${iso[3]}`);
    return key >= dateKey(period.from) && key <= dateKey(period.to);
  }
  const parsed = parseFlexibleDate(value);
  if (!parsed) return false;
  const key = dateKey(parsed);
  return key >= dateKey(period.from) && key <= dateKey(period.to);
}

function normalizeUrboxRows(rows: RawReconciliationRow[]) {
  return rows
    .map<NormalizedUrboxRow>((row, index) => {
      const exchangeTimeValue = row["Thời gian đổi quà"] ?? row.exchangeTime;
      return {
        brand: decodeHtmlEntities(row["Thương hiệu"] ?? row.brand),
        category: safeText(row["Danh mục"] ?? row.category),
        customerCode: safeText(row["Mã KH"] ?? row.customerCode),
        exchangeTime: parseFlexibleDate(exchangeTimeValue),
        exchangeTimeRaw: safeText(exchangeTimeValue),
        giftName: decodeHtmlEntities(row["Tên quà"] ?? row.giftName),
        orderCode: safeText(row["Mã đơn hàng"] ?? row.orderCode),
        program: safeText(row["Chương trình"] ?? row.program),
        quantity: toNumber(row["Số lượng"] ?? row.quantity),
        raw: row,
        sourceRow: Number(row.__sourceRow || index + 3),
        transactionCode: safeText(
          row["Mã giao dịch"] ?? row.transactionCode,
        ),
        value: toNumber(row["Giá trị"] ?? row.value),
      };
    })
    .filter((row) => row.transactionCode && row.giftName);
}

function normalizeBaseRewardRows(rows: RawReconciliationRow[]) {
  return rows
    .map<NormalizedBaseRewardRow>((row) => {
      const placedAtValue = row["Ngày đặt quà"] ?? row.placedAt;
      return {
        employeeName: safeText(row["Tên"] ?? row.employeeName),
        note: safeText(row["Ghi chú"] ?? row.note),
        placedAt: parseFlexibleDate(placedAtValue),
        placedAtRaw: safeText(placedAtValue),
        provider: safeText(row.Provider ?? row.provider),
        raw: row,
        transactionCode: safeText(
          row["Mã giao dịch"] ?? row.transactionCode,
        ),
        unitPrice: toNumber(row["Giá (điểm)"] ?? row.unitPrice),
        username: safeText(row.Username ?? row.username),
      };
    })
    .filter((row) => row.transactionCode);
}

function addIndexEntry(
  map: Map<string, ReconciliationAccountMapping[]>,
  key: string,
  item: ReconciliationAccountMapping,
) {
  if (!key) return;
  const current = map.get(key) ?? [];
  current.push(item);
  map.set(key, current);
}

function buildAccountIndex(
  hrEntries: HrEntry[],
  mappings: ReconciliationAccountMapping[],
): AccountIndex {
  const index: AccountIndex = {
    byAccountName: new Map(),
    byAccountNameAndUsername: new Map(),
    byUsername: new Map(),
  };
  const candidates: ReconciliationAccountMapping[] = [
    ...mappings,
    ...hrEntries.flatMap((entry) =>
      (entry.accountNames.length ? entry.accountNames : [""]).flatMap(
        (accountName) => {
          const usernames = [
            ...new Set(
              [entry.username, ...(entry.usernames ?? [])]
                .map(safeText)
                .filter(Boolean),
            ),
          ];
          return (usernames.length ? usernames : [""]).map((username) => ({
            accountName,
            employeeName: entry.employeeName,
            username,
          }));
        },
      ),
    ),
  ];
  for (const entry of candidates) {
    const usernameKey = normalizeUsername(entry.username);
    const accountName = safeText(entry.accountName);
    const accountKey = normalizeName(accountName);
    if (accountKey) {
      addIndexEntry(index.byAccountName, accountKey, entry);
      if (usernameKey) {
        const compositeKey = `${accountKey}||${usernameKey}`;
        if (!index.byAccountNameAndUsername.has(compositeKey)) {
          index.byAccountNameAndUsername.set(compositeKey, entry);
        }
      }
    }
    if (usernameKey) {
      addIndexEntry(index.byUsername, usernameKey, entry);
    }
  }
  return index;
}

function findAccountMatch(
  accountName: string,
  username: string,
  index: AccountIndex,
) {
  const accountKey = normalizeName(accountName);
  const usernameKey = normalizeUsername(username);
  if (!accountKey && !usernameKey) return null;

  if (accountKey && usernameKey) {
    const exact = index.byAccountNameAndUsername.get(
      `${accountKey}||${usernameKey}`,
    );
    if (exact) return exact;
  }

  const accountMatches = accountKey
    ? index.byAccountName.get(accountKey) ?? []
    : [];
  if (accountMatches.length === 1) return accountMatches[0];
  if (accountMatches.length > 1 && usernameKey) {
    const narrowed = accountMatches.filter(
      (item) => normalizeUsername(item.username) === usernameKey,
    );
    if (narrowed.length === 1) return narrowed[0];
  }

  if (usernameKey) {
    const usernameMatches = index.byUsername.get(usernameKey) ?? [];
    if (usernameMatches.length === 1) return usernameMatches[0];
  }
  return null;
}

function resolveEmployee(
  rawEmployeeName: string,
  username: string,
  hrByName: Map<string, HrEntry>,
  accountIndex: AccountIndex,
) {
  const cleaned = safeText(rawEmployeeName);
  if (!cleaned) {
    return {
      accountMatched: false,
      accountNameSource: "",
      accountUsernameSource: "",
      employeeName: "",
      hr: null as HrEntry | null,
    };
  }
  const direct = hrByName.get(normalizeName(cleaned)) ?? null;
  if (direct) {
    return {
      accountMatched: false,
      accountNameSource: "",
      accountUsernameSource: "",
      employeeName: direct.employeeName,
      hr: direct,
    };
  }
  const accountMatch = findAccountMatch(cleaned, username, accountIndex);
  if (accountMatch) {
    const matchedHr =
      hrByName.get(normalizeName(accountMatch.employeeName)) ?? null;
    return {
      accountMatched: true,
      accountNameSource: cleaned,
      accountUsernameSource: username,
      employeeName: matchedHr?.employeeName ?? accountMatch.employeeName,
      hr: matchedHr,
    };
  }
  return {
    accountMatched: false,
    accountNameSource: "",
    accountUsernameSource: "",
    employeeName: cleaned,
    hr: null as HrEntry | null,
  };
}

function buildCompanyStats(details: ReconciliationDetailRow[]) {
  const result = emptyCompanyRecord<CompanyStat>();
  for (const company of RECONCILIATION_COMPANIES) {
    const grouped = new Map<string, CompanyStat>();
    for (const row of details.filter((item) => item.company === company)) {
      const key = `${row.giftName} || ${row.category} || ${row.value}`;
      const current = grouped.get(key) ?? {
        category: row.category,
        giftName: row.giftName,
        quantity: 0,
        total: 0,
        value: row.value,
      };
      current.quantity += Number(row.quantity) || 0;
      current.total +=
        (Number(row.value) || 0) * (Number(row.quantity) || 0);
      grouped.set(key, current);
    }
    result[company] = [...grouped.values()].sort((a, b) =>
      a.giftName.localeCompare(b.giftName, "vi"),
    );
  }
  return result;
}

function buildUserStats(
  details: ReconciliationDetailRow[],
  hrByName: Map<string, HrEntry>,
) {
  const result = emptyCompanyRecord<UserStat>();
  for (const company of RECONCILIATION_COMPANIES) {
    const grouped = new Map<string, UserStat>();
    for (const row of details.filter(
      (item) => item.company === company && item.employeeName,
    )) {
      const key = normalizeName(row.employeeName);
      const hr = hrByName.get(key) ?? null;
      const current = grouped.get(key) ?? {
        employeeCode: hr?.employeeCode ?? "",
        employeeName: row.employeeName,
        total: 0,
      };
      // Bám công thức GAS cũ: theo người cộng giá trị từng dòng,
      // không nhân số lượng như thống kê theo công ty.
      current.total += Number(row.value) || 0;
      grouped.set(key, current);
    }
    result[company] = [...grouped.values()].sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName, "vi"),
    );
  }
  return result;
}

function compareVoucherRows(a: VoucherRow, b: VoucherRow) {
  const aTime = a.orderDate?.getTime() ?? 0;
  const bTime = b.orderDate?.getTime() ?? 0;
  if (aTime !== bTime) return aTime - bTime;
  const name = a.employeeName.localeCompare(b.employeeName, "vi");
  if (name !== 0) return name;
  const order = a.orderCode.localeCompare(b.orderCode, "vi");
  return order !== 0 ? order : a.giftName.localeCompare(b.giftName, "vi");
}

function buildVoucherRowsByCompany(details: ReconciliationDetailRow[]) {
  const result = emptyCompanyRecord<VoucherRow>();
  for (const company of RECONCILIATION_COMPANIES) {
    const grouped = new Map<
      string,
      VoucherRow & { transactionCodes: Set<string> }
    >();
    for (const row of details.filter((item) => item.company === company)) {
      const employee =
        row.employeeName || row.rawEmployeeName || "(Chưa xác định)";
      const key = [
        row.orderCode,
        normalizeName(employee),
        normalizeName(row.giftName),
        Number(row.value || 0),
      ].join("||");
      const current = grouped.get(key) ?? {
        department: row.department,
        employeeName: employee,
        giftName: row.giftName,
        imageFormula: "",
        listLabel: row.companyShortLabel,
        note: row.note,
        orderCode: row.orderCode,
        orderDate: row.orderDate,
        orderDateRaw: row.orderDateRaw,
        provider: row.provider,
        quantity: 0,
        totalAmount: 0,
        transactionCodes: new Set<string>(),
        transactionCodeText: "",
        unitPrice: Number(row.value) || 0,
        username: row.username,
      };
      current.quantity += 1;
      current.totalAmount = current.unitPrice * current.quantity;
      if (row.transactionCode) current.transactionCodes.add(row.transactionCode);
      if (!current.username && row.username) current.username = row.username;
      if (!current.department && row.department) {
        current.department = row.department;
      }
      if (!current.provider && row.provider) current.provider = row.provider;
      if (!current.note && row.note) current.note = row.note;
      if (!current.orderDate && row.orderDate) current.orderDate = row.orderDate;
      grouped.set(key, current);
    }
    result[company] = [...grouped.values()]
      .map((item) => ({
        ...item,
        transactionCodeText: [...item.transactionCodes].join("\n"),
      }))
      .sort(compareVoucherRows);
  }
  return result;
}

export function runReconciliationEngine(input: {
  accountMappings?: ReconciliationAccountMapping[];
  baseRewardRows: RawReconciliationRow[];
  hrEntries: HrEntry[];
  period: ReconciliationPeriod;
  urboxRows: RawReconciliationRow[];
}): ReconciliationEngineResult {
  const normalizedUrbox = normalizeUrboxRows(input.urboxRows);
  const filteredUrbox = normalizedUrbox.filter((row) =>
    isDateInPeriod(row.exchangeTimeRaw || row.exchangeTime, input.period),
  );
  const normalizedBaseReward = normalizeBaseRewardRows(input.baseRewardRows);
  const baseIndex = new Map<string, NormalizedBaseRewardRow[]>();
  for (const row of normalizedBaseReward) {
    const current = baseIndex.get(row.transactionCode) ?? [];
    current.push(row);
    baseIndex.set(row.transactionCode, current);
  }

  const hrByName = new Map<string, HrEntry>();
  for (const entry of input.hrEntries) {
    for (const value of [entry.employeeName, ...(entry.aliases ?? [])]) {
      const key = normalizeName(value);
      if (key && !hrByName.has(key)) hrByName.set(key, entry);
    }
  }
  const accountIndex = buildAccountIndex(
    input.hrEntries,
    input.accountMappings ?? [],
  );
  const occurrences = new Map<string, number>();
  const issues: ReconciliationIssueInput[] = [];

  const details = filteredUrbox.map<ReconciliationDetailRow>((row) => {
    const occurrence = (occurrences.get(row.transactionCode) ?? 0) + 1;
    occurrences.set(row.transactionCode, occurrence);
    const matches = baseIndex.get(row.transactionCode) ?? [];
    // Bám GAS cũ: lần xuất hiện dư dùng lại dòng BaseReward cuối.
    const reward = matches.length
      ? matches[Math.min(occurrence - 1, matches.length - 1)]
      : null;
    const rawEmployeeName = reward?.employeeName ?? "";
    const username = reward?.username ?? "";
    const resolved = resolveEmployee(
      rawEmployeeName,
      username,
      hrByName,
      accountIndex,
    );
    const hr = resolved.hr;
    const company = hr?.company ?? "Nệm Thành Công";

    if (!reward) {
      issues.push({
        code: "BASE_REWARD_NOT_FOUND",
        message: `Không tìm thấy giao dịch ${row.transactionCode} trong BaseReward.`,
        severity: "WARNING",
        sourceRow: row.sourceRow,
        transactionCode: row.transactionCode,
      });
    } else if (!hr) {
      issues.push({
        code: "HR_NOT_FOUND",
        message: `Chưa khớp nhân sự “${rawEmployeeName || "(trống)"}”; tạm xếp Nệm Thành Công.`,
        metadata: { username },
        severity: "WARNING",
        sourceRow: row.sourceRow,
        transactionCode: row.transactionCode,
      });
    }

    return {
      accountMatched: resolved.accountMatched,
      accountNameSource: resolved.accountNameSource,
      accountUsernameSource: resolved.accountUsernameSource,
      brand: row.brand,
      category: row.category,
      company,
      companyShortLabel: RECONCILIATION_COMPANY_META[company].shortLabel,
      customerCode: row.customerCode,
      department: hr?.department ?? "",
      employeeCode: hr?.employeeCode ?? "",
      employeeName: resolved.employeeName,
      exchangeTime: row.exchangeTime,
      exchangeTimeRaw: row.exchangeTimeRaw,
      giftName: row.giftName,
      hrMatched: Boolean(hr),
      note: reward?.note ?? "",
      occurrence,
      orderCode: row.orderCode,
      orderDate: reward?.placedAt ?? null,
      orderDateRaw: reward?.placedAtRaw ?? "",
      program: row.program,
      provider: reward?.provider ?? "",
      quantity: row.quantity || 1,
      rawBaseReward: reward?.raw ?? {},
      rawEmployeeName,
      rawUrbox: row.raw,
      sourceRow: row.sourceRow,
      transactionCode: row.transactionCode,
      username,
      value: row.value || reward?.unitPrice || 0,
    };
  });

  const companyStats = buildCompanyStats(details);
  const userStats = buildUserStats(details, hrByName);
  const voucherRowsByCompany = buildVoucherRowsByCompany(details);

  return {
    accountResolvedCount: details.filter((row) => row.accountMatched).length,
    companyStats,
    details,
    fallbackCompanyCount: details.filter(
      (row) => row.company === "Nệm Thành Công" && !row.hrMatched,
    ).length,
    issues,
    matchedTransactions: details.filter((row) => row.employeeName).length,
    rowsInPeriod: filteredUrbox.length,
    totalAmount: details.reduce((sum, row) => sum + (Number(row.value) || 0), 0),
    userStats,
    voucherRowsByCompany,
  };
}
