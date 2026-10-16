import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";

type JsonObject = Record<string, unknown>;

type PrintItem = {
  companyId: string;
  companyName: string;
  documentNumber: string;
  fromDate: string;
  html: string;
  index: number;
  personName: string;
  toDate: string;
  typeLabel: string;
};

function objectOf(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi-VN");
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dateLabel(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T00:00:00.000Z`)
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).format(date);
}

function issueSentence(value: unknown) {
  const raw = text(value);
  const date = raw ? new Date(raw) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  })
    .format(safe)
    .split("/");
  return `TP. Hồ Chí Minh, ngày ${parts[0]} tháng ${parts[1]} năm ${parts[2]}`;
}

function adjustedTitle(
  person: JsonObject,
  companyId: string,
  fallback: unknown,
) {
  const source = text(person.source);
  const personCompanyId = text(person.companyId);
  if (
    (source === "self" || source === "system") &&
    personCompanyId &&
    companyId &&
    personCompanyId !== companyId
  ) {
    return "Nhân viên";
  }
  return text(person.title || fallback);
}

function renderFragment(input: {
  company: {
    address: string | null;
    id: string;
    legalName: string;
    representative: string | null;
    shortName: string | null;
    taxCode: string | null;
    branchName: string | null;
  };
  issueDate: unknown;
  number: string;
  person: JsonObject;
  reason: string;
  representative: {
    fullName: string;
    identityDate: string | null;
    identityNumber: string | null;
    identityPlace: string | null;
    title: string | null;
  } | null;
  row: JsonObject;
  typeLabel: string;
}) {
  const isAuthorization = normalize(input.typeLabel).includes("uy quyen");
  const title = isAuthorization ? "GIẤY ỦY QUYỀN" : "GIẤY GIỚI THIỆU";
  const side = isAuthorization ? "Ủy quyền" : "Giới thiệu";
  const company = input.company;
  const person = input.person;
  const representativeName =
    input.representative?.fullName || company.representative || "";
  const representativeTitle =
    input.representative?.title || "Giám đốc";

  return `<article class="capgiay-print-fragment">
    <div class="capgiay-print-inner">
      <div class="capgiay-print-national">
        <div class="capgiay-print-national-title">CỘNG HÒA X\u00C3 HỘI CHỦ NGHĨA VIỆT NAM</div>
        <div class="capgiay-print-national-subtitle">Độc lập - Tự do - Hạnh phúc</div>
        <div class="capgiay-print-divider"></div>
      </div>
      <div class="capgiay-print-code">Số: <strong>${escapeHtml(input.number)}</strong></div>
      <h1 class="capgiay-print-title">${title}</h1>
      <p class="capgiay-print-date">${escapeHtml(issueSentence(input.issueDate))}</p>
      <div class="capgiay-print-block">
        <p>- Căn cứ Bộ luật Dân sự nước Cộng hòa xã hội chủ nghĩa Việt Nam;</p>
        <p>- Căn cứ nhu cầu công việc và phạm vi xử lý hồ sơ hiện tại.</p>
      </div>
      <div class="capgiay-print-block">
        <p><strong>BÊN ${side.toLocaleUpperCase("vi-VN")}:</strong></p>
        <p><strong>Tên công ty:</strong> ${escapeHtml(company.branchName || company.legalName)}</p>
        <p><strong>Mã số thuế:</strong> ${escapeHtml(company.taxCode)}</p>
        <p><strong>Địa chỉ:</strong> ${escapeHtml(company.address)}</p>
        <p><strong>Đại diện:</strong> ${escapeHtml(representativeName)}</p>
        <p><strong>Chức vụ:</strong> ${escapeHtml(representativeTitle)}</p>
        <p><strong>CCCD số:</strong> ${escapeHtml(input.representative?.identityNumber)}</p>
        <p><strong>Cấp ngày:</strong> ${escapeHtml(dateLabel(input.representative?.identityDate))}</p>
        <p><strong>Nơi cấp:</strong> ${escapeHtml(input.representative?.identityPlace)}</p>
      </div>
      <div class="capgiay-print-block">
        <p><strong>Xin ${isAuthorization ? "ủy quyền" : "giới thiệu"} cho cá nhân dưới đây:</strong></p>
        <p><strong>Họ tên:</strong> ${escapeHtml(person.name || input.row.nguoiTen)}</p>
        <p><strong>Bộ phận:</strong> ${escapeHtml(person.department || input.row.nguoiPhongBan)}</p>
        <p><strong>Chức vụ:</strong> ${escapeHtml(adjustedTitle(person, company.id, input.row.nguoiChucVu))}</p>
        <p><strong>Ngày sinh:</strong> ${escapeHtml(dateLabel(person.birthDate || input.row.nguoiNgaySinh))}</p>
        <p><strong>CCCD số:</strong> ${escapeHtml(person.identityNumber || input.row.nguoiCCCD)}</p>
        <p><strong>Cấp ngày:</strong> ${escapeHtml(dateLabel(person.identityDate || input.row.nguoiNgayCap))}</p>
        <p><strong>Nơi cấp:</strong> ${escapeHtml(person.identityPlace || input.row.nguoiNoiCap)}</p>
      </div>
      <div class="capgiay-print-block">
        <p><strong>${isAuthorization ? "Nội dung Ủy quyền" : "Mục đích"}:</strong> ${escapeHtml(input.reason)}</p>
        <p>Giấy này có hiệu lực từ ngày <strong>${escapeHtml(dateLabel(input.row.fromDate))}</strong> đến ngày <strong>${escapeHtml(dateLabel(input.row.toDate))}</strong>.</p>
        <p>Kính đề nghị các đơn vị liên quan hỗ trợ cá nhân nêu trên hoàn thành công việc được giao.</p>
      </div>
      <div class="capgiay-print-signatures">
        <div class="capgiay-print-signature">
          <div class="capgiay-print-signature-title">Bên được ${side}</div>
          <div class="capgiay-print-signature-name">${escapeHtml(person.name || input.row.nguoiTen)}</div>
        </div>
        <div class="capgiay-print-signature">
          <div class="capgiay-print-signature-title">Bên ${side}</div>
          <div class="capgiay-print-signature-name">${escapeHtml(representativeName)}</div>
        </div>
      </div>
    </div>
  </article>`;
}

export async function buildAuthorizationPrintItems(
  db: PrismaClient,
  rawRows: unknown[],
  options: { draft?: boolean; issueDate?: unknown } = {},
): Promise<PrintItem[]> {
  const rows = rawRows.map(objectOf);
  const companyIds = [
    ...new Set(rows.map((row) => text(row.companyId)).filter(Boolean)),
  ];
  const companies = await db.company.findMany({
    where: { id: { in: companyIds }, status: "ACTIVE" },
  });
  const representatives = await db.employee.findMany({
    select: {
      fullName: true,
      identityDate: true,
      identityNumber: true,
      identityPlace: true,
      title: true,
    },
    where: {
      fullName: {
        in: companies
          .map((company) => text(company.representative))
          .filter(Boolean),
        mode: "insensitive",
      },
    },
  });

  return rows.map((row, index) => {
    const companyId = text(row.companyId);
    const company = companies.find((item) => item.id === companyId);
    if (!company) {
      throw new Error(`Không tìm thấy pháp nhân ở bản in số ${index + 1}.`);
    }
    const representative =
      representatives.find(
        (item) =>
          normalize(item.fullName) === normalize(company.representative),
      ) || null;
    const person = objectOf(row.personSnapshot);
    const typeLabel = text(
      row.typeLabel || row.type || row.loai || row.documentTypeName,
    );
    const number = options.draft
      ? "CHƯA CẤP SỐ"
      : text(row.soVanBan || row.issuedNumber || row.documentNumber);
    const reason = text(row.reason || row.lydo);
    return {
      companyId,
      companyName: company.legalName,
      documentNumber: number,
      fromDate: text(row.fromDate),
      html: renderFragment({
        company,
        issueDate:
          objectOf(row.documentNumberMeta).assignedAt ||
          options.issueDate ||
          new Date().toISOString(),
        number: number || "CHƯA CẤP SỐ",
        person,
        reason,
        representative,
        row,
        typeLabel,
      }),
      index,
      personName: text(person.name || row.nguoiTen),
      toDate: text(row.toDate),
      typeLabel,
    };
  });
}

export function buildAuthorizationPrintDocument(input: {
  draft: boolean;
  items: PrintItem[];
  requestCode?: string;
}) {
  const title = input.draft ? "Bản nháp cấp giấy" : "Bản in cấp giấy";
  const meta = input.draft
    ? `Bản xem trước chưa cấp số • ${input.items.length} bản`
    : `Mã đơn: ${escapeHtml(input.requestCode || "-")} • ${input.items.length} bản`;
  const pages = input.items
    .map(
      (item) => `<section class="capgiay-print-page">
        ${input.draft ? '<div class="capgiay-print-watermark">BẢN NHÁP</div>' : ""}
        <div class="capgiay-print-sheet">${item.html}</div>
      </section>`,
    )
    .join("");

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#eef1eb;color:#1b2d28;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .print-toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 22px;background:rgba(248,250,246,.96);backdrop-filter:blur(10px);border-bottom:1px solid rgba(17,76,65,.08)}
    .print-toolbar-title{font-weight:800;color:#114c41}.print-toolbar-meta{font-size:13px;color:#5f746f;margin-top:4px}.print-toolbar-actions{display:flex;gap:10px;flex-wrap:wrap}
    .print-btn{min-height:42px;padding:0 18px;border:0;border-radius:999px;background:rgba(17,76,65,.1);color:#114c41;font-weight:700;cursor:pointer}
    .print-btn.primary{background:linear-gradient(135deg,#e01a6f,#bd1659);color:#fff;box-shadow:0 14px 30px rgba(212,25,106,.22)}
    .print-pages{padding:18px 20px 40px}.capgiay-print-page{position:relative;width:210mm;min-height:297mm;margin:24px auto;padding:16mm 15mm;background:#fff;box-shadow:0 18px 34px rgba(0,0,0,.1);overflow:hidden}
    .capgiay-print-watermark{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:58pt;font-weight:800;letter-spacing:.12em;color:rgba(212,25,106,.12);transform:rotate(-28deg);pointer-events:none;user-select:none}
    .capgiay-print-fragment,.capgiay-print-inner{width:100%}.capgiay-print-inner{position:relative;z-index:1;font-family:"Times New Roman",serif;font-size:12pt;line-height:1.6;color:#000}
    .capgiay-print-national{text-align:center}.capgiay-print-national-title{font-weight:700;font-size:13pt}.capgiay-print-national-subtitle{font-style:italic}.capgiay-print-divider{width:82px;margin:8px auto 0;border-top:1px dashed #000}
    .capgiay-print-code{text-align:right;font-size:10pt;margin-top:10px}.capgiay-print-title{text-align:center;font-size:15pt;font-weight:700;margin:20px 0}.capgiay-print-date{margin:0 0 12px;font-style:italic}
    .capgiay-print-block{margin-top:10px}.capgiay-print-block p{margin:0 0 4px}.capgiay-print-signatures{margin-top:34px;display:flex;justify-content:space-between;gap:32px}
    .capgiay-print-signature{width:45%;text-align:center}.capgiay-print-signature-title{font-weight:700}.capgiay-print-signature-name{margin-top:72px;text-transform:uppercase}
    @media(max-width:900px){.print-toolbar{padding:14px}.print-pages{padding:14px 12px 24px}.capgiay-print-page{width:100%;min-height:auto;margin:14px 0;padding:14px;border-radius:18px;box-shadow:none}.capgiay-print-watermark{font-size:44pt}}
    @media print{body{background:#fff}.print-toolbar{display:none!important}.print-pages{padding:0!important}.capgiay-print-page{width:210mm;min-height:297mm;margin:0!important;padding:16mm 15mm!important;box-shadow:none!important;page-break-after:always;break-after:page}.capgiay-print-page:last-child{page-break-after:auto;break-after:auto}}
  </style>
</head>
<body>
  <div class="print-toolbar">
    <div><div class="print-toolbar-title">${title}</div><div class="print-toolbar-meta">${meta}</div></div>
    <div class="print-toolbar-actions"><button class="print-btn" onclick="window.close()" type="button">Đóng</button><button class="print-btn primary" onclick="window.print()" type="button">${input.draft ? "In bản nháp" : "In giấy"}</button></div>
  </div>
  <main class="print-pages">${pages}</main>
</body>
</html>`;
}

export function buildAuthorizationPrintError(message: unknown) {
  return `<!doctype html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Không mở được bản in</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef3f1;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#173f35}.card{width:min(560px,calc(100vw - 32px));padding:28px;border-radius:24px;background:#fff;box-shadow:0 20px 60px #0f172a1f}h1{margin:0 0 10px;font-size:24px}.msg{color:#5f746f;line-height:1.6}.btn{margin-top:18px;min-height:42px;padding:0 18px;border:0;border-radius:999px;background:#114c41;color:#fff;font-weight:800;cursor:pointer}</style></head><body><section class="card"><h1>Không mở được bản in</h1><div class="msg">${escapeHtml(message)}</div><button class="btn" onclick="window.close()" type="button">Đóng</button></section></body></html>`;
}
