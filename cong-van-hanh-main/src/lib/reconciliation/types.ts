export const RECONCILIATION_COMPANIES = [
  "Thuần Việt Global",
  "Thuần Việt Digital",
  "Nệm Thành Công",
] as const;

export type ReconciliationCompany =
  (typeof RECONCILIATION_COMPANIES)[number];

export const RECONCILIATION_COMPANY_META: Record<
  ReconciliationCompany,
  {
    primaryCompanyStartColumn: number;
    primaryCompanyTotalCell: string;
    primaryUserStartColumn: number;
    primaryUserTotalCell: string;
    primaryUserWidth: number;
    sheetLabel: string;
    shortLabel: string;
    titleLabel: string;
  }
> = {
  "Thuần Việt Global": {
    primaryCompanyStartColumn: 19,
    primaryCompanyTotalCell: "W3",
    primaryUserStartColumn: 38,
    primaryUserTotalCell: "AN3",
    primaryUserWidth: 3,
    sheetLabel: "GLOBAL",
    shortLabel: "Global",
    titleLabel: "GLOBAL",
  },
  "Thuần Việt Digital": {
    primaryCompanyStartColumn: 25,
    primaryCompanyTotalCell: "AC3",
    primaryUserStartColumn: 42,
    primaryUserTotalCell: "AR3",
    primaryUserWidth: 3,
    sheetLabel: "Digital",
    shortLabel: "Digital",
    titleLabel: "DIGITAL",
  },
  "Nệm Thành Công": {
    primaryCompanyStartColumn: 31,
    primaryCompanyTotalCell: "AI3",
    primaryUserStartColumn: 46,
    primaryUserTotalCell: "AU3",
    primaryUserWidth: 2,
    sheetLabel: "Thành Công",
    shortLabel: "Thành Công",
    titleLabel: "THÀNH CÔNG",
  },
};

export const SECONDARY_HEADERS = [
  "Tên",
  "Phòng ban",
  "Username",
  "Ngày đặt quà",
  "Provider",
  "Quà",
  "Giá (điểm)",
  "Số lượng",
  "Tổng tiền",
  "Mã giao dịch",
  "Ghi chú",
  "Mã đơn hàng",
  "Thuộc bảng kê",
  "Hình ảnh",
] as const;

export type WorkbookKind = "URBOX" | "BASE_REWARD";

export type RawReconciliationRow = Record<string, unknown> & {
  __sourceRow?: number;
};

export type ParsedWorkbook = {
  fileName: string;
  kind: WorkbookKind;
  rows: RawReconciliationRow[];
  sheetName: string;
};

export type ReconciliationPeriod = {
  from: Date;
  label: string;
  month: number;
  periodKey: string;
  tabName: string;
  to: Date;
  year: number;
};

export type HrEntry = {
  accountNames: string[];
  aliases?: string[];
  company: ReconciliationCompany;
  department: string;
  employeeCode: string;
  employeeName: string;
  username: string;
  usernames?: string[];
};

export type ReconciliationAccountMapping = {
  accountName: string;
  employeeName: string;
  username: string;
};

export type ReconciliationDetailRow = {
  accountMatched: boolean;
  accountNameSource: string;
  accountUsernameSource: string;
  brand: string;
  category: string;
  company: ReconciliationCompany;
  companyShortLabel: string;
  customerCode: string;
  department: string;
  employeeCode: string;
  employeeName: string;
  exchangeTime: Date | null;
  exchangeTimeRaw: string;
  giftName: string;
  hrMatched: boolean;
  note: string;
  occurrence: number;
  orderCode: string;
  orderDate: Date | null;
  orderDateRaw: string;
  program: string;
  provider: string;
  quantity: number;
  rawBaseReward: RawReconciliationRow;
  rawEmployeeName: string;
  rawUrbox: RawReconciliationRow;
  sourceRow: number;
  transactionCode: string;
  username: string;
  value: number;
};

export type CompanyStat = {
  category: string;
  giftName: string;
  quantity: number;
  total: number;
  value: number;
};

export type UserStat = {
  employeeCode: string;
  employeeName: string;
  total: number;
};

export type VoucherRow = {
  department: string;
  employeeName: string;
  giftName: string;
  imageFormula: string;
  listLabel: string;
  note: string;
  orderCode: string;
  orderDate: Date | null;
  orderDateRaw: string;
  provider: string;
  quantity: number;
  totalAmount: number;
  transactionCodeText: string;
  unitPrice: number;
  username: string;
};

export type ReconciliationIssueInput = {
  code: string;
  message: string;
  metadata?: Record<string, unknown>;
  severity?: "INFO" | "WARNING" | "ERROR";
  sourceRow?: number;
  transactionCode?: string;
};

export type ReconciliationEngineResult = {
  accountResolvedCount: number;
  companyStats: Record<ReconciliationCompany, CompanyStat[]>;
  details: ReconciliationDetailRow[];
  fallbackCompanyCount: number;
  issues: ReconciliationIssueInput[];
  matchedTransactions: number;
  rowsInPeriod: number;
  totalAmount: number;
  userStats: Record<ReconciliationCompany, UserStat[]>;
  voucherRowsByCompany: Record<ReconciliationCompany, VoucherRow[]>;
};

export type ReconciliationHistoryItem = {
  kind: "PRIMARY" | "SECONDARY";
  link: string;
  name: string;
  periodCode: string;
  status: string;
  updatedLabel: string;
};

export type ReconciliationConfigStatus = {
  missing: string[];
  primaryConfigured: boolean;
  secondaryConfigured: boolean;
  storageConfigured: boolean;
};

export type ReconciliationWorkspaceData = {
  canCancel: boolean;
  config: ReconciliationConfigStatus;
  primary: ReconciliationHistoryItem | null;
  primaryError: string;
  secondary: ReconciliationHistoryItem[];
  secondaryError: string;
};

export type ReconciliationCancelResult = {
  message: string;
  ok: boolean;
  periodCode: string;
  primaryDeleted: boolean;
  secondaryDeleted: number;
  workspace?: ReconciliationWorkspaceData;
};

export type ReconciliationRunResult = {
  message: string;
  ok: boolean;
  primaryCreated?: boolean;
  primaryLink?: string;
  runId?: string;
  secondaryCreated?: boolean;
  secondaryLink?: string;
  summary?: {
    accountResolvedCount: number;
    baseRewardRows: number;
    fallbackCompanyCount: number;
    matchedTransactions: number;
    missingConfig: string[];
    rowsInPeriod: number;
    totalAmount: number;
    urboxRows: number;
    voucherRowCounts: Record<string, number>;
  };
  workspace?: ReconciliationWorkspaceData;
};
