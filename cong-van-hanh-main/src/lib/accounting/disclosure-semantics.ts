import { cleanText, normalizeKey } from "@/lib/accounting/normalize";
import type {
  AccountingRecord,
  AccountingRecordType,
  JsonObject,
} from "@/lib/accounting/types";

export type DisclosureAutomationLevel = "AUTOMATIC" | "ASSISTED" | "MANUAL";

type DisclosureReportLink = {
  aggregationRole: "ADDITIVE" | "SUBSET_DETAIL" | "REFERENCE_ONLY";
  confidence: "HIGH" | "REVIEW";
  linkRole: "PRIMARY_NOTE_REFERENCE" | "RECONCILIATION_ONLY";
  reportKey: string;
  rowCodes: string[];
};

type DisclosureBlueprint = {
  automationLevel: DisclosureAutomationLevel;
  code: string;
  dimensions: string[];
  formulaPrinciple: string;
  ordinal?: number;
  periodBasis: string[];
  reconciliationMode: string;
  reportLinks: DisclosureReportLink[];
  requiredCanonicalFields: string[];
  reviewRequirements: string[];
  sectionCode: string;
  sourceDatasets: string[];
  sourceStrategy: string;
  title: string;
};

type ImportedDisclosureRecord = {
  payload: JsonObject;
  recordType: AccountingRecordType;
  sourceRow: number;
  sourceSheet: string;
};

const TB_FIELDS = [
  "account_code",
  "account_name",
  "opening_debit",
  "opening_credit",
  "closing_debit",
  "closing_credit",
];
const GL_FIELDS = [
  "posting_date",
  "debit_account",
  "credit_account",
  "amount",
];
const DETAIL_FIELDS = [
  "object_id",
  "object_type",
  "counterparty_id",
  "contract_id",
  "project_id",
  "due_date",
  "maturity_date",
  "current_flag",
];

function link(
  reportKey: string,
  rowCodes: string[],
  linkRole: DisclosureReportLink["linkRole"] = "PRIMARY_NOTE_REFERENCE",
  confidence: DisclosureReportLink["confidence"] = "HIGH",
  aggregationRole: DisclosureReportLink["aggregationRole"] =
    linkRole === "PRIMARY_NOTE_REFERENCE" ? "ADDITIVE" : "REFERENCE_ONLY",
): DisclosureReportLink {
  return { aggregationRole, confidence, linkRole, reportKey, rowCodes };
}

const BS = (rowCodes: string[]) =>
  link("BAO_CAO_TINH_HINH_TAI_CHINH", rowCodes);
const PL = (rowCodes: string[]) =>
  link("BAO_CAO_KET_QUA_KINH_DOANH", rowCodes);
const CF = (rowCodes: string[]) => [
  link(
    "LUU_CHUYEN_TIEN_TE_TRUC_TIEP",
    rowCodes,
    "RECONCILIATION_ONLY",
  ),
  link(
    "LUU_CHUYEN_TIEN_TE_GIAN_TIEP",
    rowCodes,
    "RECONCILIATION_ONLY",
  ),
];

function numericBlueprint(input: {
  automationLevel?: DisclosureAutomationLevel;
  code: string;
  dimensions?: string[];
  formulaPrinciple?: string;
  ordinal: number;
  periodBasis?: string[];
  reconciliationMode?: string;
  reportLinks?: DisclosureReportLink[];
  requiredCanonicalFields?: string[];
  reviewRequirements?: string[];
  sectionCode: "V" | "VI" | "VII";
  sourceDatasets?: string[];
  sourceStrategy?: string;
  title: string;
}): DisclosureBlueprint {
  const hasReportLink = Boolean(input.reportLinks?.length);
  return {
    automationLevel: input.automationLevel || "ASSISTED",
    code: input.code,
    dimensions: input.dimensions || ["ACCOUNT"],
    formulaPrinciple:
      input.formulaPrinciple ||
      (hasReportLink
        ? "Kế thừa công thức của dòng báo cáo liên kết, bung chi tiết theo chiều quản trị và cộng ngược về đúng số trên báo cáo chính."
        : "Lập từ dữ liệu chi tiết phù hợp; mọi tổng số phải có đường kiểm tra về sổ hoặc báo cáo nguồn."),
    ordinal: input.ordinal,
    periodBasis:
      input.periodBasis ||
      (input.sectionCode === "V"
        ? ["OPENING", "ENDING"]
        : ["CURRENT_PERIOD", "PREVIOUS_PERIOD"]),
    reconciliationMode:
      input.reconciliationMode ||
      (hasReportLink ? "TIE_TO_REPORT_LINES" : "DISCLOSURE_ONLY"),
    reportLinks: input.reportLinks || [],
    requiredCanonicalFields:
      input.requiredCanonicalFields ||
      (input.sectionCode === "V" ? TB_FIELDS : GL_FIELDS),
    reviewRequirements: input.reviewRequirements || [],
    sectionCode: input.sectionCode,
    sourceDatasets:
      input.sourceDatasets ||
      (input.sectionCode === "V"
        ? ["TRIAL_BALANCE", "GENERAL_LEDGER"]
        : ["GENERAL_LEDGER"]),
    sourceStrategy:
      input.sourceStrategy ||
      (hasReportLink ? "REPORT_LINE_DETAIL" : "TRANSACTION_DETAIL"),
    title: input.title,
  };
}

function narrativeBlueprint(input: {
  automationLevel?: DisclosureAutomationLevel;
  code: string;
  dimensions?: string[];
  formulaPrinciple: string;
  reviewRequirements: string[];
  sectionCode: string;
  sourceDatasets: string[];
  sourceStrategy: string;
  title: string;
}): DisclosureBlueprint {
  return {
    automationLevel: input.automationLevel || "MANUAL",
    code: input.code,
    dimensions: input.dimensions || [],
    formulaPrinciple: input.formulaPrinciple,
    periodBasis: ["REPORTING_PERIOD"],
    reconciliationMode: "DISCLOSURE_ONLY",
    reportLinks: [],
    requiredCanonicalFields: [],
    reviewRequirements: input.reviewRequirements,
    sectionCode: input.sectionCode,
    sourceDatasets: input.sourceDatasets,
    sourceStrategy: input.sourceStrategy,
    title: input.title,
  };
}

export const STANDARD_DISCLOSURE_BLUEPRINTS: DisclosureBlueprint[] = [
  narrativeBlueprint({
    automationLevel: "ASSISTED",
    code: "MO_DAU",
    formulaPrinciple:
      "Lấy tên, địa chỉ, mã số thuế, kỳ báo cáo và đơn vị tiền tệ từ hồ sơ công ty; người lập xác nhận phần ký và ngày lập.",
    reviewRequirements: ["Xác nhận người ký", "Xác nhận ngày lập báo cáo"],
    sectionCode: "MO_DAU",
    sourceDatasets: ["MASTER_DATA", "MANUAL_INPUT"],
    sourceStrategy: "COMPANY_METADATA",
    title: "Thông tin chung và tiêu đề",
  }),
  narrativeBlueprint({
    automationLevel: "ASSISTED",
    code: "I",
    formulaPrinciple:
      "Gợi ý từ hồ sơ pháp lý và cấu hình công ty; kế toán duyệt lại đặc điểm hoạt động, ngành nghề, chu kỳ sản xuất và cấu trúc tập đoàn.",
    reviewRequirements: ["Đối chiếu hồ sơ pháp lý", "Xác nhận thay đổi trong năm"],
    sectionCode: "I",
    sourceDatasets: ["MASTER_DATA", "MANUAL_INPUT"],
    sourceStrategy: "COMPANY_PROFILE",
    title: "Đặc điểm hoạt động của doanh nghiệp",
  }),
  narrativeBlueprint({
    automationLevel: "ASSISTED",
    code: "II",
    formulaPrinciple:
      "Lấy ngày bắt đầu, ngày kết thúc kỳ và đơn vị tiền tệ từ phiên dữ liệu/cấu hình công ty; không suy đoán từ số mẫu.",
    reviewRequirements: ["Xác nhận kỳ kế toán", "Xác nhận đơn vị tiền tệ"],
    sectionCode: "II",
    sourceDatasets: ["MASTER_DATA", "SNAPSHOT_METADATA"],
    sourceStrategy: "REPORTING_METADATA",
    title: "Kỳ kế toán, đơn vị tiền tệ sử dụng trong kế toán",
  }),
  narrativeBlueprint({
    code: "III",
    formulaPrinciple:
      "Dùng nội dung chính sách đã được doanh nghiệp phê duyệt; hệ thống chỉ tái sử dụng phiên bản còn hiệu lực.",
    reviewRequirements: ["Phê duyệt tuyên bố tuân thủ", "Xác nhận chế độ kế toán áp dụng"],
    sectionCode: "III",
    sourceDatasets: ["ACCOUNTING_POLICY", "MANUAL_INPUT"],
    sourceStrategy: "POLICY_TEXT",
    title: "Chuẩn mực và chế độ kế toán áp dụng",
  }),
  narrativeBlueprint({
    code: "IV",
    formulaPrinciple:
      "Tái sử dụng thư viện chính sách kế toán theo phiên bản; kế toán phải xác nhận mọi thay đổi ước tính, phương pháp và ngoại lệ trong kỳ.",
    reviewRequirements: ["Xác nhận chính sách còn hiệu lực", "Nêu rõ thay đổi so với kỳ trước"],
    sectionCode: "IV",
    sourceDatasets: ["ACCOUNTING_POLICY", "MANUAL_INPUT"],
    sourceStrategy: "POLICY_TEXT",
    title: "Các chính sách kế toán áp dụng",
  }),

  numericBlueprint({
    automationLevel: "AUTOMATIC",
    code: "V.1",
    dimensions: ["ACCOUNT", "BANK_ACCOUNT", "CURRENCY"],
    ordinal: 1,
    reportLinks: [BS(["110"])],
    requiredCanonicalFields: [...TB_FIELDS, ...DETAIL_FIELDS.slice(0, 3)],
    reviewRequirements: ["Tách khoản bị phong tỏa sang VII.1 nếu có"],
    sectionCode: "V",
    sourceDatasets: ["TRIAL_BALANCE", "GENERAL_LEDGER", "MASTER_DATA"],
    title: "Tiền và các khoản tương đương tiền",
  }),
  numericBlueprint({
    code: "V.2",
    dimensions: ["INSTRUMENT", "COUNTERPARTY", "MATURITY", "CURRENT_FLAG"],
    ordinal: 2,
    reportLinks: [BS(["120", "260"])],
    requiredCanonicalFields: [...TB_FIELDS, ...DETAIL_FIELDS],
    reviewRequirements: ["Xác nhận giá trị hợp lý", "Xác nhận dự phòng tổn thất"],
    sectionCode: "V",
    title: "Các khoản đầu tư tài chính",
  }),
  numericBlueprint({
    automationLevel: "AUTOMATIC",
    code: "V.3",
    dimensions: ["CUSTOMER", "RELATED_PARTY", "CURRENT_FLAG", "MATURITY"],
    ordinal: 3,
    reportLinks: [BS(["131", "211"])],
    requiredCanonicalFields: [...TB_FIELDS, ...DETAIL_FIELDS],
    sectionCode: "V",
    title: "Phải thu của khách hàng",
  }),
  numericBlueprint({
    code: "V.4",
    dimensions: ["OBJECT", "RECEIVABLE_TYPE", "CURRENT_FLAG", "MATURITY"],
    ordinal: 4,
    reportLinks: [BS(["135", "215"])],
    requiredCanonicalFields: [...TB_FIELDS, ...DETAIL_FIELDS],
    reviewRequirements: ["Phân loại đúng bản chất khoản phải thu khác"],
    sectionCode: "V",
    title: "Phải thu khác",
  }),
  numericBlueprint({
    code: "V.5",
    dimensions: ["ASSET_TYPE", "RESPONSIBLE_OBJECT", "STATUS"],
    ordinal: 5,
    reportLinks: [BS(["137"])],
    reviewRequirements: ["Bổ sung nguyên nhân và hướng xử lý"],
    sectionCode: "V",
    title: "Tài sản thiếu chờ xử lý",
  }),
  numericBlueprint({
    code: "V.6",
    dimensions: ["DEBTOR", "OVERDUE_BUCKET", "RECOVERABLE_VALUE", "PROVISION"],
    ordinal: 6,
    reportLinks: [BS(["136", "216"])],
    requiredCanonicalFields: [...TB_FIELDS, ...DETAIL_FIELDS],
    reviewRequirements: ["Kế toán phê duyệt khả năng thu hồi", "Đối chiếu dự phòng đã trích"],
    sectionCode: "V",
    sourceStrategy: "BALANCE_WITH_ACCOUNTING_ESTIMATE",
    title: "Nợ xấu",
  }),
  numericBlueprint({
    code: "V.7",
    dimensions: ["INVENTORY_CATEGORY", "ITEM", "WAREHOUSE", "PROVISION"],
    ordinal: 7,
    reportLinks: [BS(["140"])],
    requiredCanonicalFields: [...TB_FIELDS, "object_id"],
    reviewRequirements: ["Đối chiếu sổ kho", "Xác nhận hàng cầm cố và dự phòng giảm giá"],
    sectionCode: "V",
    sourceDatasets: ["TRIAL_BALANCE", "GENERAL_LEDGER", "MASTER_DATA", "MANUAL_INPUT"],
    title: "Hàng tồn kho",
  }),
  numericBlueprint({
    code: "V.8",
    dimensions: ["PROJECT", "ASSET_IN_PROGRESS", "CAPITALIZATION_STATUS"],
    ordinal: 8,
    reportLinks: [BS(["250"])],
    requiredCanonicalFields: [...TB_FIELDS, "project_id", "contract_id"],
    reviewRequirements: ["Xác nhận dự án dừng hoặc chậm tiến độ", "Đánh giá tổn thất nếu có"],
    sectionCode: "V",
    title: "Tài sản dở dang dài hạn",
  }),
  numericBlueprint({
    code: "V.9",
    dimensions: ["ASSET_CLASS", "ASSET", "MOVEMENT_TYPE"],
    formulaPrinciple:
      "Lập bảng nguyên giá và hao mòn theo công thức đầu kỳ + tăng - giảm = cuối kỳ; giá trị còn lại cuối kỳ phải khớp dòng TSCĐ hữu hình.",
    ordinal: 9,
    reconciliationMode: "ROLL_FORWARD_AND_TIE",
    reportLinks: [BS(["221"])],
    requiredCanonicalFields: [...TB_FIELDS, ...GL_FIELDS, "object_id"],
    reviewRequirements: ["Xác nhận phân loại tăng/giảm", "Xác nhận thời gian khấu hao"],
    sectionCode: "V",
    sourceStrategy: "ASSET_ROLL_FORWARD",
    title: "Tăng, giảm tài sản cố định hữu hình",
  }),
  numericBlueprint({
    code: "V.10",
    dimensions: ["ASSET_CLASS", "ASSET", "MOVEMENT_TYPE"],
    formulaPrinciple:
      "Lập bảng nguyên giá và hao mòn theo công thức đầu kỳ + tăng - giảm = cuối kỳ; giá trị còn lại cuối kỳ phải khớp dòng TSCĐ vô hình.",
    ordinal: 10,
    reconciliationMode: "ROLL_FORWARD_AND_TIE",
    reportLinks: [BS(["227"])],
    requiredCanonicalFields: [...TB_FIELDS, ...GL_FIELDS, "object_id"],
    reviewRequirements: ["Xác nhận quyền kiểm soát và thời gian phân bổ"],
    sectionCode: "V",
    sourceStrategy: "ASSET_ROLL_FORWARD",
    title: "Tăng, giảm tài sản cố định vô hình",
  }),
  numericBlueprint({
    code: "V.11",
    dimensions: ["LEASE_CONTRACT", "ASSET_CLASS", "MOVEMENT_TYPE"],
    formulaPrinciple:
      "Lập bảng nguyên giá và hao mòn tài sản thuê tài chính; giá trị còn lại cuối kỳ phải khớp dòng tài sản thuê tài chính.",
    ordinal: 11,
    reconciliationMode: "ROLL_FORWARD_AND_TIE",
    reportLinks: [BS(["224"])],
    requiredCanonicalFields: [...TB_FIELDS, ...GL_FIELDS, "contract_id"],
    reviewRequirements: ["Xác nhận hợp đồng thuê tài chính"],
    sectionCode: "V",
    sourceStrategy: "ASSET_ROLL_FORWARD",
    title: "Tăng, giảm tài sản cố định thuê tài chính",
  }),
  numericBlueprint({
    code: "V.12",
    dimensions: ["BIOLOGICAL_CLASS", "MATURITY_STAGE", "MOVEMENT_TYPE"],
    ordinal: 12,
    reportLinks: [BS(["150", "230"])],
    requiredCanonicalFields: [...TB_FIELDS, ...GL_FIELDS, "object_id"],
    reviewRequirements: ["Xác nhận giai đoạn trưởng thành", "Xác nhận tổn thất"],
    sectionCode: "V",
    sourceStrategy: "BIOLOGICAL_ASSET_ROLL_FORWARD",
    title: "Tài sản sinh học",
  }),
  numericBlueprint({
    code: "V.13",
    dimensions: ["PROPERTY", "MOVEMENT_TYPE", "VALUATION_BASIS"],
    formulaPrinciple:
      "Lập bảng nguyên giá và hao mòn BĐSĐT theo biến động; giá trị còn lại cuối kỳ phải khớp dòng BĐSĐT.",
    ordinal: 13,
    reconciliationMode: "ROLL_FORWARD_AND_TIE",
    reportLinks: [BS(["240"])],
    requiredCanonicalFields: [...TB_FIELDS, ...GL_FIELDS, "object_id"],
    reviewRequirements: ["Xác nhận giá trị hợp lý nếu phải thuyết minh"],
    sectionCode: "V",
    sourceStrategy: "ASSET_ROLL_FORWARD",
    title: "Tăng, giảm bất động sản đầu tư",
  }),
  numericBlueprint({
    code: "V.14",
    dimensions: ["EXPENSE_TYPE", "CONTRACT", "CURRENT_FLAG"],
    ordinal: 14,
    reportLinks: [BS(["161", "271"])],
    requiredCanonicalFields: [...TB_FIELDS, "contract_id", "current_flag"],
    reviewRequirements: ["Xác nhận thời hạn phân bổ"],
    sectionCode: "V",
    title: "Chi phí chờ phân bổ",
  }),
  numericBlueprint({
    code: "V.15",
    dimensions: ["ASSET_TYPE", "CURRENT_FLAG"],
    ordinal: 15,
    reportLinks: [BS(["165", "274"])],
    reviewRequirements: ["Phân loại và giải trình khoản trọng yếu"],
    sectionCode: "V",
    title: "Tài sản khác",
  }),
  numericBlueprint({
    code: "V.16",
    dimensions: ["LENDER", "CONTRACT", "CURRENCY", "MATURITY", "SECURITY"],
    formulaPrinciple:
      "Đầu kỳ + vay mới - trả gốc +/− phân loại lại = cuối kỳ; số cuối kỳ ngắn hạn và dài hạn phải khớp các dòng vay trên báo cáo tình hình tài chính.",
    ordinal: 16,
    reconciliationMode: "ROLL_FORWARD_AND_TIE",
    reportLinks: [BS(["321", "339"])],
    requiredCanonicalFields: [...TB_FIELDS, ...GL_FIELDS, ...DETAIL_FIELDS],
    reviewRequirements: ["Xác nhận lãi suất, tài sản bảo đảm và điều khoản vi phạm"],
    sectionCode: "V",
    sourceStrategy: "DEBT_ROLL_FORWARD",
    title: "Vay và nợ thuê tài chính",
  }),
  numericBlueprint({
    automationLevel: "AUTOMATIC",
    code: "V.17",
    dimensions: ["SUPPLIER", "RELATED_PARTY", "CURRENT_FLAG", "MATURITY"],
    ordinal: 17,
    reportLinks: [BS(["311", "331"])],
    requiredCanonicalFields: [...TB_FIELDS, ...DETAIL_FIELDS],
    sectionCode: "V",
    title: "Phải trả người bán",
  }),
  numericBlueprint({
    code: "V.18",
    dimensions: ["OWNER", "DIVIDEND_DECISION", "DUE_DATE"],
    ordinal: 18,
    reportLinks: [BS(["313"])],
    reviewRequirements: ["Đối chiếu nghị quyết phân phối lợi nhuận"],
    sectionCode: "V",
    title: "Phải trả về cổ tức, lợi nhuận",
  }),
  numericBlueprint({
    code: "V.19",
    dimensions: ["TAX_TYPE", "CURRENT_FLAG", "TAX_AUTHORITY"],
    ordinal: 19,
    reportLinks: [BS(["314", "333"])],
    requiredCanonicalFields: [...TB_FIELDS, ...GL_FIELDS],
    reviewRequirements: ["Đối chiếu tờ khai và biên bản thuế"],
    sectionCode: "V",
    title: "Thuế và các khoản phải nộp nhà nước",
  }),
  numericBlueprint({
    code: "V.20",
    dimensions: ["EXPENSE_TYPE", "CONTRACT", "CURRENT_FLAG"],
    ordinal: 20,
    reportLinks: [BS(["316", "334"])],
    requiredCanonicalFields: [...TB_FIELDS, "contract_id", "current_flag"],
    reviewRequirements: ["Xác nhận cơ sở ước tính chi phí trích trước"],
    sectionCode: "V",
    title: "Chi phí phải trả",
  }),
  numericBlueprint({
    code: "V.21",
    dimensions: ["PAYABLE_TYPE", "OBJECT", "CURRENT_FLAG", "MATURITY"],
    ordinal: 21,
    reportLinks: [BS(["320", "338"])],
    requiredCanonicalFields: [...TB_FIELDS, ...DETAIL_FIELDS],
    reviewRequirements: ["Phân loại khoản trọng yếu và bên liên quan"],
    sectionCode: "V",
    title: "Phải trả khác",
  }),
  numericBlueprint({
    code: "V.22",
    dimensions: ["REVENUE_TYPE", "CONTRACT", "CURRENT_FLAG"],
    formulaPrinciple:
      "Đầu kỳ + nhận trước trong kỳ - doanh thu đã ghi nhận = cuối kỳ; số cuối kỳ phải khớp doanh thu chờ phân bổ ngắn hạn và dài hạn.",
    ordinal: 22,
    reconciliationMode: "ROLL_FORWARD_AND_TIE",
    reportLinks: [BS(["319", "337"])],
    requiredCanonicalFields: [...TB_FIELDS, ...GL_FIELDS, "contract_id", "current_flag"],
    reviewRequirements: ["Xác nhận tiến độ thực hiện nghĩa vụ"],
    sectionCode: "V",
    title: "Doanh thu chờ phân bổ",
  }),
  numericBlueprint({
    code: "V.23",
    dimensions: ["BOND", "CURRENCY", "INTEREST_RATE", "MATURITY", "CONVERSION_TERM"],
    ordinal: 23,
    reportLinks: [BS(["340"])],
    requiredCanonicalFields: [...TB_FIELDS, ...GL_FIELDS, "contract_id", "maturity_date"],
    reviewRequirements: ["Xác nhận điều khoản phát hành và chuyển đổi"],
    sectionCode: "V",
    sourceStrategy: "DEBT_ROLL_FORWARD",
    title: "Trái phiếu phát hành",
  }),
  numericBlueprint({
    code: "V.24",
    dimensions: ["SHARE_CLASS", "MATURITY", "REDEMPTION_TERM"],
    ordinal: 24,
    reportLinks: [BS(["341"])],
    reviewRequirements: ["Xác nhận tiêu chí phân loại là nợ phải trả"],
    sectionCode: "V",
    title: "Cổ phiếu ưu đãi phân loại là nợ phải trả",
  }),
  numericBlueprint({
    code: "V.25",
    dimensions: ["PROVISION_TYPE", "CURRENT_FLAG", "EXPECTED_TIMING"],
    formulaPrinciple:
      "Đầu kỳ + trích lập - sử dụng - hoàn nhập = cuối kỳ; số cuối kỳ phải khớp dự phòng ngắn hạn và dài hạn.",
    ordinal: 25,
    reconciliationMode: "ROLL_FORWARD_AND_TIE",
    reportLinks: [BS(["322", "343"])],
    reviewRequirements: ["Phê duyệt giả định và giá trị ước tính"],
    sectionCode: "V",
    sourceStrategy: "PROVISION_ROLL_FORWARD",
    title: "Dự phòng phải trả",
  }),
  numericBlueprint({
    code: "V.26",
    dimensions: ["TEMPORARY_DIFFERENCE", "TAX_RATE", "ASSET_LIABILITY"],
    ordinal: 26,
    reportLinks: [BS(["272", "342"])],
    requiredCanonicalFields: [...TB_FIELDS, "object_id"],
    reviewRequirements: ["Phê duyệt chênh lệch tạm thời và thuế suất", "Đối chiếu VI.11"],
    sectionCode: "V",
    sourceDatasets: ["TRIAL_BALANCE", "TAX_SCHEDULE", "MANUAL_INPUT"],
    sourceStrategy: "DEFERRED_TAX_SCHEDULE",
    title: "Tài sản thuế thu nhập hoãn lại và thuế thu nhập hoãn lại phải trả",
  }),
  numericBlueprint({
    code: "V.27",
    dimensions: ["EQUITY_COMPONENT", "OWNER", "SHARE_CLASS", "MOVEMENT_TYPE"],
    formulaPrinciple:
      "Đầu kỳ + tăng - giảm = cuối kỳ cho từng thành phần vốn; tổng cuối kỳ phải khớp vốn chủ sở hữu và lợi nhuận chưa phân phối phải nối với kết quả kinh doanh/phân phối lợi nhuận.",
    ordinal: 27,
    reconciliationMode: "ROLL_FORWARD_AND_TIE",
    reportLinks: [BS(["400"])],
    requiredCanonicalFields: [...TB_FIELDS, ...GL_FIELDS, "object_id"],
    reviewRequirements: ["Đối chiếu nghị quyết tăng vốn và phân phối lợi nhuận"],
    sectionCode: "V",
    sourceStrategy: "EQUITY_ROLL_FORWARD",
    title: "Vốn chủ sở hữu",
  }),
  numericBlueprint({
    code: "V.28",
    dimensions: ["ASSET", "VALUATION_EVENT", "MOVEMENT_TYPE"],
    ordinal: 28,
    reportLinks: [BS(["416"])],
    reviewRequirements: ["Đính kèm căn cứ đánh giá lại"],
    sectionCode: "V",
    title: "Chênh lệch đánh giá lại tài sản",
  }),
  numericBlueprint({
    code: "V.29",
    dimensions: ["CURRENCY", "SOURCE", "MOVEMENT_TYPE"],
    ordinal: 29,
    reportLinks: [BS(["417"])],
    requiredCanonicalFields: [...TB_FIELDS, ...GL_FIELDS, "currency", "exchange_rate"],
    reviewRequirements: ["Xác nhận tỷ giá và nguồn tỷ giá"],
    sectionCode: "V",
    title: "Chênh lệch tỷ giá",
  }),
  numericBlueprint({
    automationLevel: "ASSISTED",
    code: "V.30",
    dimensions: ["OFF_BALANCE_ITEM", "CURRENCY", "QUANTITY"],
    formulaPrinciple:
      "Tổng hợp từ tài khoản ngoài bảng và sổ theo dõi chi tiết; không cộng vào tổng tài sản hoặc nguồn vốn.",
    ordinal: 30,
    reviewRequirements: ["Xác nhận đầy đủ nghĩa vụ/tài sản ngoài bảng"],
    sectionCode: "V",
    sourceDatasets: ["GENERAL_LEDGER", "MASTER_DATA", "MANUAL_INPUT"],
    sourceStrategy: "OFF_BALANCE_DETAIL",
    title: "Các khoản mục ngoài Báo cáo tình hình tài chính",
  }),
  numericBlueprint({
    automationLevel: "MANUAL",
    code: "V.31",
    dimensions: ["RESTRICTED_ASSET", "OBLIGATION", "LEGAL_BASIS"],
    formulaPrinciple:
      "Kế toán khai báo tài sản bị giới hạn sử dụng và nghĩa vụ bị ràng buộc; hệ thống chỉ kiểm tra giá trị với các sổ/báo cáo liên quan.",
    ordinal: 31,
    reviewRequirements: ["Nêu rõ căn cứ pháp lý hoặc hợp đồng", "Xác nhận giá trị bị hạn chế"],
    sectionCode: "V",
    sourceDatasets: ["MANUAL_INPUT", "TRIAL_BALANCE", "GENERAL_LEDGER"],
    sourceStrategy: "MANUAL_WITH_RECONCILIATION",
    title: "Tài sản bị giới hạn sử dụng và nghĩa vụ thanh toán bị ràng buộc",
  }),
  numericBlueprint({
    automationLevel: "MANUAL",
    code: "V.32",
    dimensions: [],
    formulaPrinciple:
      "Người lập bổ sung thông tin trọng yếu chưa được bao phủ; mọi số được nhập phải chỉ rõ nguồn đối chiếu.",
    ordinal: 32,
    reviewRequirements: ["Đánh giá tính trọng yếu", "Ghi nguồn cho mọi số nhập tay"],
    sectionCode: "V",
    sourceDatasets: ["MANUAL_INPUT"],
    sourceStrategy: "MANUAL_NARRATIVE",
    title: "Các thông tin khác cần thuyết minh, giải trình thêm",
  }),

  numericBlueprint({
    automationLevel: "AUTOMATIC",
    code: "VI.1",
    dimensions: ["REVENUE_TYPE", "PRODUCT_SERVICE", "CUSTOMER", "MARKET"],
    ordinal: 1,
    reportLinks: [PL(["01"])],
    requiredCanonicalFields: [...GL_FIELDS, "object_id", "counterparty_id"],
    sectionCode: "VI",
    title: "Tổng doanh thu bán hàng và cung cấp dịch vụ",
  }),
  numericBlueprint({
    automationLevel: "AUTOMATIC",
    code: "VI.2",
    dimensions: ["DEDUCTION_TYPE", "PRODUCT_SERVICE", "CUSTOMER"],
    ordinal: 2,
    reportLinks: [PL(["02"])],
    sectionCode: "VI",
    title: "Các khoản giảm trừ doanh thu",
  }),
  numericBlueprint({
    automationLevel: "AUTOMATIC",
    code: "VI.3",
    dimensions: ["COST_TYPE", "PRODUCT_SERVICE", "ACTIVITY"],
    ordinal: 3,
    reportLinks: [PL(["11"])],
    sectionCode: "VI",
    title: "Giá vốn hàng bán",
  }),
  numericBlueprint({
    code: "VI.4",
    dimensions: ["PROPERTY", "TRANSACTION", "GAIN_LOSS"],
    ordinal: 4,
    reportLinks: [PL(["21"])],
    reviewRequirements: ["Đối chiếu giá trị còn lại của BĐSĐT thanh lý"],
    sectionCode: "VI",
    title: "Lãi/lỗ của hoạt động bán, thanh lý bất động sản đầu tư",
  }),
  numericBlueprint({
    automationLevel: "AUTOMATIC",
    code: "VI.5",
    dimensions: ["FINANCIAL_INCOME_TYPE", "COUNTERPARTY", "CURRENCY"],
    ordinal: 5,
    reportLinks: [PL(["22"])],
    sectionCode: "VI",
    title: "Doanh thu hoạt động tài chính",
  }),
  numericBlueprint({
    automationLevel: "AUTOMATIC",
    code: "VI.6",
    dimensions: ["FINANCE_COST_TYPE", "LENDER", "CURRENCY"],
    ordinal: 6,
    reportLinks: [
      PL(["23"]),
      link(
        "BAO_CAO_KET_QUA_KINH_DOANH",
        ["24"],
        "PRIMARY_NOTE_REFERENCE",
        "HIGH",
        "SUBSET_DETAIL",
      ),
    ],
    sectionCode: "VI",
    title: "Chi phí tài chính",
  }),
  numericBlueprint({
    automationLevel: "AUTOMATIC",
    code: "VI.7",
    dimensions: ["OTHER_INCOME_TYPE", "TRANSACTION", "COUNTERPARTY"],
    ordinal: 7,
    reportLinks: [PL(["31"])],
    sectionCode: "VI",
    title: "Thu nhập khác",
  }),
  numericBlueprint({
    automationLevel: "AUTOMATIC",
    code: "VI.8",
    dimensions: ["OTHER_COST_TYPE", "TRANSACTION", "COUNTERPARTY"],
    ordinal: 8,
    reportLinks: [PL(["32"])],
    sectionCode: "VI",
    title: "Chi phí khác",
  }),
  numericBlueprint({
    automationLevel: "AUTOMATIC",
    code: "VI.9",
    dimensions: ["EXPENSE_FUNCTION", "EXPENSE_TYPE", "DEPARTMENT"],
    ordinal: 9,
    reportLinks: [PL(["25", "26"])],
    requiredCanonicalFields: [...GL_FIELDS, "department_id", "project_id"],
    sectionCode: "VI",
    title: "Chi phí bán hàng và chi phí quản lý doanh nghiệp",
  }),
  numericBlueprint({
    code: "VI.10",
    dimensions: ["EXPENSE_NATURE", "DEPARTMENT", "PROJECT"],
    formulaPrinciple:
      "Phân loại phát sinh chi phí theo yếu tố; tổng phải đối chiếu với sổ chi phí sau khi loại các khoản không thuộc chi phí sản xuất kinh doanh trong kỳ.",
    ordinal: 10,
    reconciliationMode: "TIE_TO_GENERAL_LEDGER",
    requiredCanonicalFields: [...GL_FIELDS, "department_id", "project_id"],
    reviewRequirements: ["Rà soát phân loại theo yếu tố", "Loại trừ khoản vốn hóa và điều chỉnh nội bộ"],
    sectionCode: "VI",
    sourceStrategy: "EXPENSE_BY_NATURE",
    title: "Chi phí sản xuất kinh doanh theo yếu tố",
  }),
  numericBlueprint({
    code: "VI.11",
    dimensions: ["TAX_COMPONENT", "TEMPORARY_DIFFERENCE", "TAX_RATE"],
    formulaPrinciple:
      "Chi phí thuế hiện hành lấy từ dòng báo cáo; thuế hoãn lại lấy từ bảng chênh lệch tạm thời. Tổng phải khớp các dòng thuế TNDN và nối với V.26.",
    ordinal: 11,
    reconciliationMode: "CROSS_DISCLOSURE_AND_REPORT_TIE",
    reportLinks: [PL(["51", "52"])],
    requiredCanonicalFields: [...GL_FIELDS, "object_id"],
    reviewRequirements: ["Đối chiếu tờ khai quyết toán thuế", "Phê duyệt chênh lệch tạm thời"],
    sectionCode: "VI",
    sourceDatasets: ["GENERAL_LEDGER", "TAX_SCHEDULE", "MANUAL_INPUT"],
    sourceStrategy: "TAX_RECONCILIATION",
    title: "Chi phí thuế thu nhập doanh nghiệp",
  }),

  numericBlueprint({
    code: "VII.1",
    dimensions: ["ACCOUNT", "RESTRICTION_REASON", "LEGAL_BASIS"],
    formulaPrinciple:
      "Lọc phần tiền và tương đương tiền bị hạn chế sử dụng; tổng này nằm trong tiền cuối kỳ nhưng không được cộng thêm lần nữa.",
    ordinal: 1,
    reconciliationMode: "SUBSET_OF_REPORT_LINE",
    reportLinks: [
      link(
        "BAO_CAO_TINH_HINH_TAI_CHINH",
        ["110"],
        "RECONCILIATION_ONLY",
      ),
    ],
    reviewRequirements: ["Nêu lý do và căn cứ hạn chế sử dụng"],
    sectionCode: "VII",
    sourceDatasets: ["TRIAL_BALANCE", "MASTER_DATA", "MANUAL_INPUT"],
    sourceStrategy: "RESTRICTED_CASH_SUBSET",
    title: "Các khoản tiền do doanh nghiệp nắm giữ nhưng không được sử dụng",
  }),
  numericBlueprint({
    code: "VII.2",
    dimensions: ["NON_CASH_TRANSACTION_TYPE", "CONTRACT", "ASSET", "LIABILITY"],
    formulaPrinciple:
      "Nhận diện giao dịch có bút toán nhưng không qua tài khoản tiền; chỉ trình bày giao dịch ảnh hưởng dòng tiền tương lai và không đưa vào dòng tiền kỳ này.",
    ordinal: 2,
    reconciliationMode: "NON_CASH_EXCLUSION_CHECK",
    requiredCanonicalFields: [...GL_FIELDS, "contract_id", "object_id"],
    reviewRequirements: ["Xác nhận giao dịch không qua tiền", "Xác nhận ảnh hưởng dòng tiền tương lai"],
    sectionCode: "VII",
    sourceDatasets: ["GENERAL_LEDGER", "MANUAL_INPUT"],
    sourceStrategy: "NON_CASH_TRANSACTION_SCAN",
    title: "Các giao dịch không bằng tiền ảnh hưởng đến báo cáo lưu chuyển tiền tệ trong tương lai",
  }),
  numericBlueprint({
    automationLevel: "AUTOMATIC",
    code: "VII.3",
    dimensions: ["BORROWING_FORM", "LENDER", "CONTRACT", "CURRENCY"],
    formulaPrinciple:
      "Cộng các khoản tiền vay thực nhận theo hình thức vay; tổng phải khớp dòng Tiền thu từ đi vay trên cả hai phương pháp LCTT.",
    ordinal: 3,
    reconciliationMode: "TRANSACTION_TOTAL_AND_TIE",
    reportLinks: CF(["33"]),
    requiredCanonicalFields: [...GL_FIELDS, "contract_id", "counterparty_id", "cash_flow_code"],
    sectionCode: "VII",
    sourceStrategy: "CASH_TRANSACTION_DETAIL",
    title: "Số tiền đi vay thực thu trong kỳ",
  }),
  numericBlueprint({
    automationLevel: "AUTOMATIC",
    code: "VII.4",
    dimensions: ["BORROWING_FORM", "LENDER", "CONTRACT", "CURRENCY"],
    formulaPrinciple:
      "Cộng tiền thực trả gốc vay theo hình thức vay; tổng phải khớp dòng Tiền trả nợ gốc vay, không trộn chi phí đi vay hoặc nợ thuê tài chính.",
    ordinal: 4,
    reconciliationMode: "TRANSACTION_TOTAL_AND_TIE",
    reportLinks: CF(["34"]),
    requiredCanonicalFields: [...GL_FIELDS, "contract_id", "counterparty_id", "cash_flow_code"],
    sectionCode: "VII",
    sourceStrategy: "CASH_TRANSACTION_DETAIL",
    title: "Số tiền đã thực trả gốc vay trong kỳ",
  }),
  numericBlueprint({
    code: "VII.5",
    dimensions: ["SUBSIDIARY", "TRANSACTION_TYPE", "CONSIDERATION", "NET_CASH"],
    formulaPrinciple:
      "Trình bày giá mua/thanh lý, phần thanh toán bằng tiền, tiền nhận kèm và tài sản/nợ tiếp nhận; dòng tiền thuần phải đối chiếu với giao dịch đầu tư liên quan.",
    ordinal: 5,
    reconciliationMode: "ACQUISITION_DISPOSAL_BRIDGE",
    requiredCanonicalFields: [...GL_FIELDS, "object_id", "counterparty_id", "cash_flow_code"],
    reviewRequirements: ["Xác nhận phạm vi công ty con", "Đối chiếu hợp đồng và hồ sơ hợp nhất"],
    sectionCode: "VII",
    sourceDatasets: ["GENERAL_LEDGER", "MASTER_DATA", "MANUAL_INPUT"],
    sourceStrategy: "SUBSIDIARY_TRANSACTION_BRIDGE",
    title: "Mua và thanh lý công ty con trong kỳ báo cáo",
  }),

  narrativeBlueprint({
    code: "VIII",
    formulaPrinciple:
      "Người lập khai báo các cam kết, sự kiện sau ngày kết thúc kỳ, bên liên quan, báo cáo bộ phận và thông tin so sánh; số nào được nhập phải có nguồn kiểm tra.",
    reviewRequirements: ["Đánh giá tính trọng yếu", "Duyệt bởi kế toán trưởng", "Ghi nguồn cho số nhập tay"],
    sectionCode: "VIII",
    sourceDatasets: ["MANUAL_INPUT", "MASTER_DATA", "GENERAL_LEDGER"],
    sourceStrategy: "MANUAL_NARRATIVE_WITH_EVIDENCE",
    title: "Những thông tin khác",
  }),
  narrativeBlueprint({
    code: "IX",
    formulaPrinciple:
      "Giữ nguyên nội dung cam kết chuẩn và lấy người ký/ngày ký từ thông tin đã được phê duyệt.",
    reviewRequirements: ["Xác nhận người ký có thẩm quyền", "Khóa nội dung sau phê duyệt"],
    sectionCode: "IX",
    sourceDatasets: ["MASTER_DATA", "MANUAL_INPUT"],
    sourceStrategy: "SIGNATURE_AND_APPROVAL",
    title: "Cam kết và chữ ký",
  }),
];

function normalizeSearch(value: unknown) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

function rowTexts(cells: JsonObject[]) {
  const byRow = new Map<number, string[]>();
  for (const cell of cells) {
    const text = cleanText(cell.text);
    if (!text) continue;
    const row = Number(cell.row || 0);
    if (!row) continue;
    const values = byRow.get(row) || [];
    if (values.at(-1) !== text) values.push(text);
    byRow.set(row, values);
  }
  return new Map(
    [...byRow].map(([row, values]) => [row, cleanText(values.join(" "))]),
  );
}

function detectNumericBlueprintRows(
  blueprints: DisclosureBlueprint[],
  sectionPayload: JsonObject,
) {
  const texts = rowTexts(
    Array.isArray(sectionPayload.cells)
      ? (sectionPayload.cells as JsonObject[])
      : [],
  );
  const startRow = Number(sectionPayload.startRow || 1);
  const endRow = Number(sectionPayload.endRow || startRow);
  let cursor = startRow;
  return blueprints.map((blueprint) => {
    let matchedRow = 0;
    let matchedTitle = "";
    for (const [row, text] of texts) {
      if (row < cursor || row > endRow) continue;
      const match = text.match(/^\s*(\d+)[.)]\s*(.+)/);
      if (!match || Number(match[1]) !== blueprint.ordinal) continue;
      const expectedWords = normalizeSearch(blueprint.title)
        .split(/\s+/)
        .filter((word) => word.length > 3);
      const actual = normalizeSearch(match[2]);
      const overlap = expectedWords.filter((word) => actual.includes(word)).length;
      if (expectedWords.length && overlap < Math.min(2, expectedWords.length)) {
        continue;
      }
      matchedRow = row;
      matchedTitle = cleanText(match[2]);
      break;
    }
    if (matchedRow) cursor = matchedRow + 1;
    return {
      blueprint,
      detectedTitle: matchedTitle,
      startRow: matchedRow,
    };
  });
}

function itemKey(templateKey: string, noteCode: string) {
  return `${normalizeKey(templateKey)}:${normalizeKey(noteCode)}`;
}

function linkKey(
  templateKey: string,
  noteCode: string,
  reportKey: string,
  rowCode: string,
) {
  return [templateKey, noteCode, reportKey, rowCode].map(normalizeKey).join(":");
}

export function buildAccountingDisclosureSemanticRecords(
  layoutRecords: ImportedDisclosureRecord[],
  currentRecords: AccountingRecord[] = [],
) {
  const templateRecord = layoutRecords.find(
    (record) => record.recordType === "DISCLOSURE_TEMPLATE",
  );
  if (!templateRecord) {
    return {
      records: [] as ImportedDisclosureRecord[],
      stats: {
        automaticCount: 0,
        assistedCount: 0,
        itemCount: 0,
        linkedReportRowCount: 0,
        manualCount: 0,
        unresolvedLinkCount: 0,
      },
      warnings: ["Chưa có bản ghi gốc của mẫu thuyết minh để lập bản đồ nghiệp vụ."],
    };
  }
  const templateKey = cleanText(templateRecord.payload.templateKey) || "B09_DN_TT99";
  const sections = layoutRecords.filter(
    (record) => record.recordType === "DISCLOSURE_SECTION",
  );
  const reportRows = new Map(
    currentRecords
      .filter((record) => record.recordType === "REPORT_ROW")
      .map((record) => {
        const payload = record.payload || {};
        const key = `${normalizeKey(payload.reportKey)}:${cleanText(payload.rowCode).toUpperCase()}`;
        return [key, record] as const;
      }),
  );
  const records: ImportedDisclosureRecord[] = [];
  const warnings: string[] = [];
  let linkedReportRowCount = 0;
  let unresolvedLinkCount = 0;

  for (const sectionRecord of sections) {
    const sectionCode = cleanText(sectionRecord.payload.sectionCode).toUpperCase();
    const blueprints = STANDARD_DISCLOSURE_BLUEPRINTS.filter(
      (blueprint) => blueprint.sectionCode === sectionCode,
    );
    if (!blueprints.length) continue;
    const numeric = blueprints.filter((blueprint) => blueprint.ordinal);
    const detected = numeric.length
      ? detectNumericBlueprintRows(numeric, sectionRecord.payload)
      : [];
    const sectionStart = Number(sectionRecord.payload.startRow || 1);
    const sectionEnd = Number(sectionRecord.payload.endRow || sectionStart);
    const placements = blueprints.map((blueprint) => {
      const numericPlacement = detected.find(
        (item) => item.blueprint.code === blueprint.code,
      );
      return {
        blueprint,
        detectedTitle: numericPlacement?.detectedTitle || "",
        startRow: blueprint.ordinal ? Number(numericPlacement?.startRow || 0) : sectionStart,
      };
    });

    placements.forEach((placement, index) => {
      const { blueprint } = placement;
      if (!placement.startRow) {
        warnings.push(
          `Không nhận ra khoản mục ${blueprint.code} · ${blueprint.title} trong phần ${sectionCode}.`,
        );
        return;
      }
      const nextStart = placements
        .slice(index + 1)
        .map((item) => item.startRow)
        .find((row) => row > placement.startRow);
      const endRow = nextStart ? nextStart - 1 : sectionEnd;
      const sectionCells = Array.isArray(sectionRecord.payload.cells)
        ? (sectionRecord.payload.cells as JsonObject[])
        : [];
      const sampleNumberCount = sectionCells.filter((cell) => {
        const row = Number(cell.row || 0);
        return (
          row >= placement.startRow &&
          row <= endRow &&
          ["REFERENCE_VALUE", "REFERENCE_FORMULA"].includes(cleanText(cell.role))
        );
      }).length;
      const itemEntityKey = itemKey(templateKey, blueprint.code);
      const flatLinks = blueprint.reportLinks.flatMap((reportLink) =>
        reportLink.rowCodes.map((rowCode) => ({ ...reportLink, rowCode })),
      );
      records.push({
        payload: {
          automationLevel: blueprint.automationLevel,
          confidence:
            blueprint.automationLevel === "AUTOMATIC" ? "HIGH" : "REVIEW",
          detectedTitle: placement.detectedTitle,
          dimensions: blueprint.dimensions,
          endRow,
          formulaPrinciple: blueprint.formulaPrinciple,
          itemKey: itemEntityKey,
          noteCode: blueprint.code,
          noteOrdinal: blueprint.ordinal || 0,
          noteTitle: placement.detectedTitle || blueprint.title,
          periodBasis: blueprint.periodBasis,
          reconciliationMode: blueprint.reconciliationMode,
          reportLinkCount: flatLinks.length,
          requiredCanonicalFields: blueprint.requiredCanonicalFields,
          reviewRequirements: blueprint.reviewRequirements,
          sampleNumberCount,
          sectionKey: normalizeKey(sectionRecord.payload.sectionKey || sectionCode),
          sourceDatasets: blueprint.sourceDatasets,
          sourceRef: `${sectionRecord.sourceSheet}!${placement.startRow}:${endRow}`,
          sourceStrategy: blueprint.sourceStrategy,
          standardCode: "TT99/2025/TT-BTC",
          startRow: placement.startRow,
          status: "ACTIVE",
          templateKey,
        },
        recordType: "DISCLOSURE_ITEM",
        sourceRow: placement.startRow,
        sourceSheet: sectionRecord.sourceSheet,
      });

      for (const reportLink of flatLinks) {
        const rowKey = `${normalizeKey(reportLink.reportKey)}:${cleanText(reportLink.rowCode).toUpperCase()}`;
        const resolved = reportRows.get(rowKey);
        if (resolved) linkedReportRowCount += 1;
        else unresolvedLinkCount += 1;
        records.push({
          payload: {
            confidence: reportLink.confidence,
            aggregationRole: reportLink.aggregationRole,
            disclosureItemKey: itemEntityKey,
            linkKey: linkKey(
              templateKey,
              blueprint.code,
              reportLink.reportKey,
              reportLink.rowCode,
            ),
            linkRole: reportLink.linkRole,
            noteCode: blueprint.code,
            reconciliationMode: blueprint.reconciliationMode,
            reportKey: normalizeKey(reportLink.reportKey),
            reportRowCode: cleanText(reportLink.rowCode),
            reportRowLabel: resolved?.displayName || "",
            reportRowRecordId: resolved?.recordId || "",
            resolutionStatus: resolved ? "RESOLVED" : "MISSING_REPORT_ROW",
            status: "ACTIVE",
            templateKey,
          },
          recordType: "DISCLOSURE_LINK",
          sourceRow: placement.startRow,
          sourceSheet: sectionRecord.sourceSheet,
        });
      }
    });
  }

  const items = records.filter((record) => record.recordType === "DISCLOSURE_ITEM");
  return {
    records,
    stats: {
      automaticCount: items.filter(
        (record) => record.payload.automationLevel === "AUTOMATIC",
      ).length,
      assistedCount: items.filter(
        (record) => record.payload.automationLevel === "ASSISTED",
      ).length,
      itemCount: items.length,
      linkedReportRowCount,
      manualCount: items.filter(
        (record) => record.payload.automationLevel === "MANUAL",
      ).length,
      unresolvedLinkCount,
    },
    warnings,
  };
}

export const disclosureSemanticTestUtils = {
  detectNumericBlueprintRows,
  itemKey,
  linkKey,
};
