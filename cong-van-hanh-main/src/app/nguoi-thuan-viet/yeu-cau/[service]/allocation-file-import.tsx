"use client";

import { useState } from "react";
import {
  ChevronDown,
  Download,
  FileSpreadsheet,
  Hash,
  ListOrdered,
  PackageSearch,
  Ruler,
  Tags,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui";
import { buttonStyles } from "@/components/ui/button";
import { FilePicker } from "@/components/ui/file-picker";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import type { AllocationCatalogItem } from "@/lib/assets/allocation-catalog";
import {
  ALLOCATION_IMPORT_MAX_ROWS,
  parseAllocationImport,
  type AllocationImportEmployee,
  type AllocationImportError,
  type AllocationImportItem,
  type AllocationImportResult,
} from "@/lib/assets/allocation-import";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const GUIDE_ITEMS = [
  {
    description:
      "Khuyến nghị dùng để khớp chính xác nhân sự. Có mã thì cột Họ và tên được phép để trống.",
    icon: Hash,
    title: "Mã nhân viên",
  },
  {
    description:
      "Dùng khi chưa có mã. Nếu hệ thống có người trùng tên, file phải bổ sung Mã nhân viên.",
    icon: UserRound,
    title: "Họ và tên",
  },
  {
    description:
      "Nhập một trong ba giá trị: CCDC/tài sản, Văn phòng phẩm hoặc Đồng phục.",
    icon: Tags,
    title: "Danh mục",
  },
  {
    description:
      "Tên phải có trong danh mục hiện hành của Setup tài sản để tránh cấp nhầm mặt hàng.",
    icon: PackageSearch,
    title: "Tên hàng hóa / CCDC",
  },
  {
    description:
      "Đồng phục ghi rõ giới tính và size bằng dấu _, ví dụ Nam_M. Văn phòng phẩm được tự lấy mô tả cấu hình.",
    icon: Ruler,
    title: "Mô tả / Size",
  },
  {
    description: "Chỉ nhận số nguyên lớn hơn 0. Mỗi dòng là một người và một mặt hàng.",
    icon: ListOrdered,
    title: "Số lượng",
  },
] as const;

type ImportFeedback = {
  errors: AllocationImportError[];
  fileName: string;
  importedCount: number;
};

function supportedFile(file: File) {
  return /\.(xlsx|xls|csv)$/i.test(file.name);
}

async function readAllocationWorkbook(
  file: File,
  catalog: AllocationCatalogItem[],
  employees: AllocationImportEmployee[],
) {
  const XLSX = await import("xlsx");
  const workbook = /\.csv$/i.test(file.name)
    ? XLSX.read((await file.text()).replace(/^\uFEFF/, ""), {
        cellDates: false,
        type: "string",
      })
    : XLSX.read(await file.arrayBuffer(), {
        cellDates: false,
        type: "array",
      });
  let fallback: AllocationImportResult | null = null;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      blankrows: false,
      defval: "",
      header: 1,
      raw: false,
    });
    const result = parseAllocationImport(matrix, catalog, employees);
    fallback ||= result;
    if (result.headerRow !== null) return result;
  }

  return (
    fallback ||
    parseAllocationImport([], catalog, employees)
  );
}

export function AllocationFileImport({
  catalog,
  employees,
  onImport,
}: {
  catalog: AllocationCatalogItem[];
  employees: AllocationImportEmployee[];
  onImport: (items: AllocationImportItem[]) => void;
}) {
  const { toast } = useToast();
  const [feedback, setFeedback] = useState<ImportFeedback | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);

  const importFile = async (file?: File) => {
    if (!file) return;

    if (!supportedFile(file)) {
      const message = "Chỉ hỗ trợ file .xlsx, .xls hoặc .csv.";
      setFeedback({
        errors: [{ message, row: null }],
        fileName: file.name,
        importedCount: 0,
      });
      toast({ message, title: "File không hợp lệ", tone: "warning" });
      setPickerKey((value) => value + 1);
      return;
    }

    setImporting(true);
    setFeedback(null);
    try {
      const result = await readAllocationWorkbook(file, catalog, employees);

      if (result.errors.length) {
        setFeedback({
          errors: result.errors,
          fileName: file.name,
          importedCount: 0,
        });
        toast({
          duration: 7000,
          message: `Phát hiện ${result.errors.length} lỗi. Chưa có dòng nào được thêm để tránh tạo dữ liệu trùng.`,
          title: "Cần sửa file trước khi nạp",
          tone: "warning",
        });
        return;
      }

      onImport(result.items);
      setFeedback({
        errors: [],
        fileName: file.name,
        importedCount: result.items.length,
      });
      toast({
        message: `${result.items.length} dòng đã được đưa vào danh sách chờ nộp.`,
        title: "Nạp file thành công",
        tone: "success",
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? `Không đọc được file: ${error.message}`
          : "Không đọc được file bảng tính.";
      setFeedback({
        errors: [{ message, row: null }],
        fileName: file.name,
        importedCount: 0,
      });
      toast({ message, title: "Nạp file thất bại", tone: "error" });
    } finally {
      setImporting(false);
      setPickerKey((value) => value + 1);
    }
  };

  const visibleErrors = feedback?.errors.slice(0, 12) || [];
  const hiddenErrorCount = Math.max(
    0,
    (feedback?.errors.length || 0) - visibleErrors.length,
  );

  return (
    <section className="ui-module-panel p-5">
      <WriteLoadingOverlay
        message="Đang đọc và kiểm tra danh sách cấp phát..."
        show={importing}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <Badge tone="warning">Nạp danh sách cấp phát</Badge>
          <h2 className="mt-2 text-xl font-extrabold text-primary sm:text-2xl">
            Tạo nhanh danh sách từ bảng tính
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Giữ nguyên hàng tiêu đề, điền mỗi người trên một dòng rồi nạp file.
            Hệ thống đối chiếu nhân sự và danh mục PostgreSQL trước khi đưa dữ
            liệu vào danh sách chờ nộp.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            className={buttonStyles({ variant: "secondary" })}
            download
            href="/templates/mau-nap-danh-sach-cap-phat.xlsx"
            onClick={() => setGuideOpen(true)}
          >
            <Download aria-hidden size={18} />
            Tải tệp mẫu
          </a>
          <button
            aria-controls="allocation-file-import-guide"
            aria-expanded={guideOpen}
            className={buttonStyles({ variant: "ghost" })}
            onClick={() => setGuideOpen((value) => !value)}
            type="button"
          >
            <ChevronDown
              aria-hidden
              className={guideOpen ? "rotate-180 transition-transform" : "transition-transform"}
              size={18}
            />
            {guideOpen ? "Ẩn hướng dẫn" : "Xem hướng dẫn"}
          </button>
        </div>
      </div>

      {guideOpen ? (
        <div id="allocation-file-import-guide">
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {GUIDE_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <article
                  className="grid grid-cols-[44px_minmax(0,1fr)] gap-3 rounded-lg border border-border bg-surface px-4 py-3.5"
                  key={item.title}
                >
                  <span className="grid size-11 place-items-center rounded-lg bg-primary text-white">
                    <Icon aria-hidden size={21} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-extrabold text-primary">
                      {item.title}
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      {item.description}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-4 rounded-lg border-l-4 border-accent bg-[#fff4df] px-4 py-3 text-sm font-semibold leading-6 text-[#785126]">
            Chỉ nạp khi toàn bộ file hợp lệ, tối đa {ALLOCATION_IMPORT_MAX_ROWS}{" "}
            dòng mỗi lần. Nếu có lỗi, hệ thống ghi rõ số dòng và không thêm nửa
            chừng để tránh bị trùng khi ông sửa rồi nạp lại.
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <FilePicker
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          disabled={importing}
          emptyText="Chọn một file Excel hoặc CSV để tạo danh sách."
          key={pickerKey}
          maxFileSizeBytes={MAX_FILE_SIZE}
          maxFiles={1}
          onFilesChange={(files) => void importFile(files[0])}
          triggerLabel="Chọn file danh sách"
          triggerStyle="dashed"
        />
      </div>

      {feedback?.errors.length ? (
        <div
          className="mt-4 rounded-lg border border-danger/25 bg-danger/5 px-4 py-3"
          role="alert"
        >
          <div className="flex items-center gap-2 font-extrabold text-danger">
            <FileSpreadsheet aria-hidden size={18} />
            {feedback.fileName}: cần sửa {feedback.errors.length} lỗi
          </div>
          <ul className="mt-2 space-y-1.5 text-sm leading-5 text-danger">
            {visibleErrors.map((error, index) => (
              <li key={`${error.row || "file"}-${index}`}>
                {error.row ? `Dòng ${error.row}: ` : ""}
                {error.message}
              </li>
            ))}
          </ul>
          {hiddenErrorCount ? (
            <p className="mt-2 text-sm font-bold text-danger">
              Còn {hiddenErrorCount} lỗi khác trong file.
            </p>
          ) : null}
        </div>
      ) : feedback?.importedCount ? (
        <div
          className="mt-4 rounded-lg border border-success/25 bg-success/5 px-4 py-3 text-sm font-semibold text-success"
          role="status"
        >
          Đã nạp {feedback.importedCount} dòng từ {feedback.fileName}. Kiểm tra
          danh sách bên dưới trước khi nộp đăng ký.
        </div>
      ) : null}
    </section>
  );
}
