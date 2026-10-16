import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { cleanText } from "@/lib/accounting/normalize";
import { AccountingRpcError, type JsonObject } from "@/lib/accounting/types";

const execFileAsync = promisify(execFile);
const PDF_HEADER = Buffer.from("%PDF-");

function workbookBuffer(result: JsonObject) {
  const encoded = typeof result.base64 === "string" ? result.base64 : "";
  const content = encoded ? Buffer.from(encoded, "base64") : Buffer.alloc(0);
  if (!content.length) {
    throw new AccountingRpcError(
      "File Excel B09 vừa tạo đang rỗng nên chưa thể chuyển sang PDF.",
      502,
    );
  }
  return content;
}

function pdfFileName(value: unknown) {
  const cleaned = cleanText(value)
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .replace(/\.xlsx$/i, "")
    .slice(0, 170);
  return `${cleaned || "B09-DN - Bản thuyết minh Báo cáo tài chính"}.pdf`;
}

function libreOfficeBinary() {
  const configured = cleanText(process.env.LIBREOFFICE_BIN);
  if (configured) return configured;
  return process.platform === "win32" ? "soffice.exe" : "libreoffice";
}

export async function renderAccountingDisclosurePdfFromWorkbook(
  workbookResult: JsonObject,
) {
  const workbook = workbookBuffer(workbookResult);
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "accounting-b09-pdf-"),
  );
  const profileDirectory = path.join(
    temporaryDirectory,
    `libreoffice-profile-${randomUUID()}`,
  );
  const workbookPath = path.join(temporaryDirectory, "B09-DN.xlsx");
  const outputPath = path.join(temporaryDirectory, "B09-DN.pdf");

  try {
    await writeFile(workbookPath, workbook);
    await execFileAsync(
      libreOfficeBinary(),
      [
        "--headless",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--nofirststartwizard",
        `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
        "--convert-to",
        "pdf:calc_pdf_Export",
        "--outdir",
        temporaryDirectory,
        workbookPath,
      ],
      {
        maxBuffer: 2_000_000,
        timeout: 120_000,
        windowsHide: true,
      },
    );
    const content = await readFile(outputPath);
    if (!content.length || !content.subarray(0, PDF_HEADER.length).equals(PDF_HEADER)) {
      throw new Error("LibreOffice không tạo được nội dung PDF hợp lệ.");
    }
    const fileName = pdfFileName(workbookResult.fileName);
    return {
      base64: content.toString("base64"),
      byteSize: content.length,
      fileName,
      mimeType: "application/pdf",
      rowCount: Number(workbookResult.rowCount || 0),
      sha256: createHash("sha256").update(content).digest("hex"),
      warningCount: Number(workbookResult.warningCount || 0),
    } satisfies JsonObject;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? cleanText((error as { code?: unknown }).code)
        : "";
    if (code === "ENOENT") {
      throw new AccountingRpcError(
        "Máy chủ chưa có bộ chuyển Excel sang PDF cho B09. Hệ thống đã giữ nguyên file Excel và dừng tạo PDF để tránh trả file sai.",
        503,
      );
    }
    throw new AccountingRpcError(
      `Không chuyển được khuôn Excel B09 sang PDF: ${
        error instanceof Error ? error.message : String(error)
      }`,
      502,
    );
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true }).catch(
      () => undefined,
    );
  }
}

export const disclosurePdfTestUtils = {
  pdfFileName,
  workbookBuffer,
};
