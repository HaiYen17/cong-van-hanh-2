export type ConfigType =
  | "text"
  | "url"
  | "secret"
  | "folder"
  | "spreadsheet";

export type ConfigDef = {
  fallbackKeys?: string[];
  fallbackValue?: string;
  help: string;
  key: string;
  label: string;
  optional?: boolean;
  tag:
    | "Kho KTS / RFID"
    | "AI"
    | "Recall.ai"
    | "MISA eSign"
    | "Folder Lưu trữ"
    | "Kế toán";
  type: ConfigType;
};

export type ConfigSection = {
  description: string;
  items: ConfigDef[];
  key: string;
  kicker: string;
  title: string;
};

export const moduleConfigDefinitions: ConfigDef[] = [
  {
    help: "Base URL Open API MISA eSign của môi trường đang dùng, ví dụ môi trường test do MISA cấp. Không nhập kèm /esign/v1.",
    key: "esign.baseUrl",
    label: "MISA eSign Base URL",
    optional: true,
    tag: "MISA eSign",
    type: "url",
  },
  {
    help: "ClientID dùng trong header xác thực MISA eSign. Giá trị được mã hóa trước khi lưu PostgreSQL.",
    key: "esign.clientId",
    label: "MISA eSign ClientID",
    optional: true,
    tag: "MISA eSign",
    type: "secret",
  },
  {
    help: "ClientSecret dùng trong header xác thực MISA eSign.",
    key: "esign.clientSecret",
    label: "MISA eSign ClientSecret",
    optional: true,
    tag: "MISA eSign",
    type: "secret",
  },
  {
    help: "Tài khoản API Remote Signing dùng để lấy token và danh sách chứng thư số.",
    key: "esign.userName",
    label: "Tài khoản MISA eSign",
    optional: true,
    tag: "MISA eSign",
    type: "text",
  },
  {
    help: "Mật khẩu tài khoản API Remote Signing. Hệ thống chỉ giải mã phía server khi bắt đầu phiên ký.",
    key: "esign.password",
    label: "Mật khẩu MISA eSign",
    optional: true,
    tag: "MISA eSign",
    type: "secret",
  },
  {
    fallbackKeys: ["warehouseKts.apiKey"],
    help: "Key bí mật app Android gửi kèm khi gọi API Kho KTS/RFID. Dán giá trị này vào androidRfidApiKey trong local.properties.",
    key: "warehouseKts.androidApiKey",
    label: "Android RFID API key",
    optional: true,
    tag: "Kho KTS / RFID",
    type: "secret",
  },
  {
    help: "Endpoint worker Python dùng chung cho các tác vụ AI/xử lý ảnh.",
    key: "assetSetup.backgroundWorkerUrl",
    label: "URL worker Python xử lý nền",
    optional: true,
    tag: "AI",
    type: "url",
  },
  {
    help: "Bearer/secret gửi kèm khi gọi worker Python.",
    key: "assetSetup.backgroundWorkerSecret",
    label: "Secret worker Python",
    optional: true,
    tag: "AI",
    type: "secret",
  },
  {
    help: "Endpoint Cloud Run nhận job phân tích đơn hàng Eshop và trả JSON snapshot.",
    key: "warehouseReport.workerUrl",
    label: "URL worker Python Báo cáo Kho",
    optional: true,
    tag: "AI",
    type: "url",
  },
  {
    fallbackKeys: ["assetSetup.backgroundWorkerSecret"],
    help: "Bearer/secret gửi kèm khi gọi worker Python Báo cáo Kho.",
    key: "warehouseReport.workerSecret",
    label: "Secret worker Báo cáo Kho",
    optional: true,
    tag: "AI",
    type: "secret",
  },
  {
    fallbackValue: "gemini-3.1-flash-lite",
    help: "Model Gemini dùng để tóm tắt insight sau khi báo cáo đã có số liệu.",
    key: "warehouseReport.geminiModel",
    label: "Gemini model Báo cáo Kho",
    optional: true,
    tag: "AI",
    type: "text",
  },
  {
    help: "Key Gemini dùng chung cho toàn bộ module AI.",
    key: "ai.geminiApiKey",
    label: "Gemini API key",
    optional: true,
    tag: "AI",
    type: "secret",
  },
  {
    help: "API key của workspace Recall.ai dùng chung cho bot tham gia và ghi nhận các cuộc họp. Nên tạo key riêng tên Lịch họp V3.",
    key: "meetings.recallApiKey",
    label: "Recall.ai API key",
    optional: true,
    tag: "Recall.ai",
    type: "secret",
  },
  {
    help: "Workspace Verification Secret bắt đầu bằng whsec_, dùng để xác minh webhook thực sự được gửi từ Recall.ai.",
    key: "meetings.recallVerificationSecret",
    label: "Recall.ai Verification Secret",
    optional: true,
    tag: "Recall.ai",
    type: "secret",
  },
  {
    fallbackValue: "gemini-3.1-flash-lite",
    help: "Model Gemini dùng chung cho toàn bộ module AI.",
    key: "ai.geminiModel",
    label: "Gemini model",
    tag: "AI",
    type: "text",
  },
  {
    fallbackValue: "1o_fLObqaf2P3Yp9It9g3irABjaQuYfQv",
    help: "Thư mục lưu hình nền/motivational dashboard.",
    key: "config.motivationImageFolderId",
    label: "Folder hình nền dashboard",
    tag: "Folder Lưu trữ",
    type: "folder",
  },
  {
    fallbackValue: "1aXJvSVK7DZGZF0qu7murIsKPoXQ08KMA",
    help: "Thư mục gốc lưu logo, hướng dẫn và file tải của Công cụ hỗ trợ.",
    key: "appSetup.supportToolDriveFolderId",
    label: "Folder kho ứng dụng",
    tag: "Folder Lưu trữ",
    type: "folder",
  },
  {
    help: "Folder gốc dùng chung cho raw đơn hàng và snapshot báo cáo của mọi công ty Eshop.",
    key: "eshopDataLake.rootFolderId",
    label: "Eshop - Folder tổng dữ liệu",
    optional: true,
    tag: "Folder Lưu trữ",
    type: "folder",
  },
  {
    help: "Nếu bỏ trống, hệ thống tự tạo raw/orders bên trong folder tổng khi đồng bộ đơn.",
    key: "eshopDataLake.rawOrdersFolderId",
    label: "Eshop - Folder raw đơn hàng",
    optional: true,
    tag: "Folder Lưu trữ",
    type: "folder",
  },
  {
    help: "Nếu bỏ trống, hệ thống tự tạo snapshots/warehouse-report bên trong folder tổng khi chạy báo cáo.",
    key: "eshopDataLake.snapshotFolderId",
    label: "Eshop - Folder snapshot báo cáo",
    optional: true,
    tag: "Folder Lưu trữ",
    type: "folder",
  },
  {
    fallbackValue: "1MgMj2EDPQOanIv-C0ziYZrq0YzFsFNrcR0txLnhILCM",
    help: "Spreadsheet backend chính của khu vực Phân xưởng, dùng cho Cấu hình Xưởng, Kế hoạch, Báo cáo và Kiểm kê.",
    key: "workshop.backendSpreadsheetId",
    label: "Backend Phân Xưởng",
    tag: "Folder Lưu trữ",
    type: "spreadsheet",
  },
  {
    fallbackValue: "13YQ3-pb9KBNIBvw-6nF_V9u2Ge_oGuQx",
    help: "Thư mục lưu file làm việc và file xuất ra từ module Biểu mẫu.",
    key: "template.templateDriveFolderId",
    label: "Folder Biểu mẫu",
    tag: "Folder Lưu trữ",
    type: "folder",
  },
  {
    fallbackValue: "1OofWQmQGQIFfFXs-tn1zEtX0SX_RCxiD",
    help: "Thư mục gốc của Setup tài sản.",
    key: "assetSetup.rootFolderId",
    label: "Folder lưu trữ tài sản",
    tag: "Folder Lưu trữ",
    type: "folder",
  },
  {
    fallbackValue: "1AfisZ1aUBkf3aUhSlx5u8errWsiRf63x",
    help: "Thư mục lưu hình CCDC/tài sản.",
    key: "assetSetup.imageFolderId",
    label: "Folder hình CCDC/tài sản",
    tag: "Folder Lưu trữ",
    type: "folder",
  },
  {
    help: "Thư mục lưu hình văn phòng phẩm.",
    key: "assetSetup.stationeryFolderId",
    label: "Folder Văn phòng phẩm",
    optional: true,
    tag: "Folder Lưu trữ",
    type: "folder",
  },
  {
    help: "Thư mục lưu hình đồng phục.",
    key: "assetSetup.uniformFolderId",
    label: "Folder Đồng phục",
    optional: true,
    tag: "Folder Lưu trữ",
    type: "folder",
  },
  {
    help: "Thư mục lưu file tách text và kết quả Review hợp đồng.",
    key: "ai.reviewContractFolderId",
    label: "Folder Review hợp đồng AI",
    optional: true,
    tag: "Folder Lưu trữ",
    type: "folder",
  },
  {
    fallbackValue: "13QbdtXSOByd4tySXmippz-CDL1HRU3-5",
    help: "Thư mục gốc chứa hồ sơ pháp lý theo từng công ty.",
    key: "legal.companyStorageRootFolderId",
    label: "Folder gốc hồ sơ công ty",
    tag: "Folder Lưu trữ",
    type: "folder",
  },
  {
    fallbackValue: "1knzrSE1fL9TCOfm0PjoyVLQMVRb10sw2qskPdFq3Zco",
    help: "Spreadsheet chứa mapping tên account/chức danh BaseReward sang nhân sự.",
    key: "reconcile.accountTitleSpreadsheetId",
    label: "Spreadsheet Account chức danh",
    tag: "Folder Lưu trữ",
    type: "spreadsheet",
  },
  {
    fallbackValue: "Account chức danh",
    help: "Tên tab mapping account/chức danh dùng khi khớp nhân sự Đối soát.",
    key: "reconcile.accountTitleSheetName",
    label: "Tab Account chức danh",
    tag: "Folder Lưu trữ",
    type: "text",
  },
  {
    fallbackValue: "1NyB7WpdXsmjSbf1BX2jXpZD21Tr9LhCkLzRQjhzX0Tw",
    help: "Spreadsheet chứa tab mẫu tổng hợp và các tab kỳ TMM.YYYY của module Đối soát.",
    key: "reconcile.primaryTemplateSpreadsheetId",
    label: "Spreadsheet tổng hợp Đối soát",
    tag: "Folder Lưu trữ",
    type: "spreadsheet",
  },
  {
    fallbackValue: "T02.2026",
    help: "Tên tab mẫu dùng để nhân bản bảng tổng hợp cho kỳ mới.",
    key: "reconcile.primaryTemplateSheetName",
    label: "Tab mẫu tổng hợp Đối soát",
    tag: "Folder Lưu trữ",
    type: "text",
  },
  {
    fallbackValue: "1PhGyE4asJu6Y75JVafvw8a3cEeBbVn8WlBa_iIqIDxY",
    help: "Spreadsheet chứa tab mẫu bảng kê BaseReward.",
    key: "reconcile.secondaryTemplateSpreadsheetId",
    label: "Spreadsheet mẫu BaseReward",
    tag: "Folder Lưu trữ",
    type: "spreadsheet",
  },
  {
    fallbackValue: "BR T02.26 - GLOBAL",
    help: "Tên tab mẫu dùng để tạo ba bảng kê Global, Digital và Thành Công.",
    key: "reconcile.secondaryTemplateSheetName",
    label: "Tab mẫu BaseReward",
    tag: "Folder Lưu trữ",
    type: "text",
  },
  {
    fallbackValue: "1f_E4b1V26fgdvqwuwjrAnvFwU6N2Vi-z",
    help: "Thư mục lưu bảng kê BaseReward sinh ra từ module Đối soát.",
    key: "reconcile.secondaryOutputFolderId",
    label: "Folder output bảng kê Đối soát",
    tag: "Folder Lưu trữ",
    type: "folder",
  },
  {
    help: "Địa chỉ bộ xử lý đồng bộ AMIS, ghi PostgreSQL và lưu lịch sử điều chỉnh số liệu.",
    key: "accountingData.workerUrl",
    label: "Địa chỉ bộ xử lý dữ liệu Kế toán",
    optional: true,
    tag: "Kế toán",
    type: "url",
  },
  {
    help: "Mã bí mật dùng riêng khi Cổng vận hành gọi bộ xử lý dữ liệu Kế toán.",
    key: "accountingData.workerSecret",
    label: "Mã bảo vệ bộ xử lý dữ liệu Kế toán",
    optional: true,
    tag: "Kế toán",
    type: "secret",
  },
];

export const configSections: ConfigSection[] = [
  {
    description:
      "Điều chỉnh màu thương hiệu và nội dung header dùng chung cho toàn bộ Cổng vận hành.",
    items: [],
    key: "brand-theme",
    kicker: "Nhận diện hệ thống",
    title: "Thương hiệu",
  },
  {
    description:
      "Mỗi cụm tài khoản có thể áp dụng cho nhiều công ty và nhiều phòng ban.",
    items: [],
    key: "viettel-post",
    kicker: "Tài khoản kết nối",
    title: "Viettel Post",
  },
  {
    description:
      "Lưu kết nối OpenPlatform, App ID/API Secret và thông tin sheet xuất dữ liệu cho từng cụm.",
    items: [],
    key: "eshop",
    kicker: "MShopKeeper / Eshop",
    title: "Eshop",
  },
  {
    description:
      "Key bí mật để app máy quét gọi các API Kho KTS/RFID. Sau khi lưu, dán cùng giá trị này vào androidRfidApiKey trong local.properties của Android.",
    items: moduleConfigDefinitions.filter((item) => item.tag === "Kho KTS / RFID"),
    key: "warehouse-kts-rfid",
    kicker: "Kho KTS / RFID",
    title: "Kho KTS / RFID",
  },
  {
    description:
      "Gemini dùng chung cho toàn bộ module AI; worker Python dùng cho các tác vụ xử lý nền/xử lý ảnh.",
    items: moduleConfigDefinitions.filter((item) => item.tag === "AI"),
    key: "ai",
    kicker: "AI",
    title: "AI",
  },
  {
    description:
      "Lưu tập trung API key và Verification Secret của workspace Recall.ai dùng chung cho Module Lịch họp.",
    items: moduleConfigDefinitions.filter((item) => item.tag === "Recall.ai"),
    key: "recall-ai",
    kicker: "Lịch họp",
    title: "Recall.ai",
  },
  {
    description:
      "Cấu hình kết nối Remote Signing và ánh xạ chứng thư số của từng pháp nhân. Secret chỉ được giải mã phía server khi Admin duyệt ký.",
    items: moduleConfigDefinitions.filter((item) => item.tag === "MISA eSign"),
    key: "misa-esign",
    kicker: "Đóng dấu và Ký số",
    title: "MISA eSign",
  },
  {
    description:
      "Quản lý tập trung các folder Drive và link backend: dashboard, kho ứng dụng, dữ liệu Eshop, Phân xưởng, tài sản, biểu mẫu, đối soát, hồ sơ pháp lý và review AI.",
    items: moduleConfigDefinitions.filter((item) => item.tag === "Folder Lưu trữ"),
    key: "storage-folders",
    kicker: "Folder lưu trữ",
    title: "Folder Lưu trữ",
  },
];

const defByKey = new Map(moduleConfigDefinitions.map((item) => [item.key, item]));

export function getConfigSection(key: string) {
  return configSections.find((section) => section.key === key) ?? null;
}

export function getConfigDefinition(key: string) {
  return defByKey.get(key) ?? null;
}

export function isSecretKey(key: string) {
  return defByKey.get(key)?.type === "secret";
}

export const allConfigKeys = [...defByKey.keys()];
