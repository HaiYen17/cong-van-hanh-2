import { createHash } from "node:crypto";
import JSZip from "jszip";
import { deriveEvaluationJdTitle } from "./jd-policy";

export const JD_SYNC_ENGINE = "postgres-jd-v1";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
const DOC = "application/vnd.google-apps.document";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FILE_FIELDS = "id,name,mimeType,modifiedTime,size,driveId,webViewLink,resourceKey,trashed,shortcutDetails(targetId,targetMimeType,targetResourceKey)";

export type JdDriveFile = {
  id?: string; name?: string; mimeType?: string; modifiedTime?: string;
  size?: string; driveId?: string; webViewLink?: string; resourceKey?: string; trashed?: boolean;
  shortcutDetails?: { targetId?: string; targetMimeType?: string; targetResourceKey?: string };
};
export type JdDriveRequest = {
  url: string; params?: Record<string, unknown>; headers?: Record<string, string>;
  responseType?: "arraybuffer"; timeout?: number;
};
export type JdDriveRequester = <T>(options: JdDriveRequest) => Promise<{ data: T }>;
export type JdCandidate = JdDriveFile & {
  sourceEntryFileId: string; sourceShortcutId: string; folderPath: string; isArchivedJd: boolean;
};
const clean = (value: unknown) => String(value ?? "").trim();
const key = (value: unknown) => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const jdSourceHash = (value: string) => createHash("sha256").update(value).digest("hex");

export function parseJdDriveLocation(value: unknown) {
  const raw = clean(value);
  if (/^[A-Za-z0-9_-]+$/.test(raw)) return { id: raw, resourceKey: "" };
  try {
    const url = new URL(raw);
    if (!["drive.google.com", "docs.google.com"].includes(url.hostname)) throw new Error();
    const id = url.pathname.match(/\/(?:folders|d)\/([A-Za-z0-9_-]+)/)?.[1] || url.searchParams.get("id") || "";
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error();
    return { id, resourceKey: url.searchParams.get("resourcekey") || "" };
  } catch {
    throw new Error("ID hoặc liên kết Folder Drive không hợp lệ. Hãy dán link thư mục từ Google Drive.");
  }
}

export function jdDriveErrorMessage(error: unknown) {
  const value = error as { code?: number | string; message?: string; response?: { status?: number; data?: { error?: { message?: string; errors?: Array<{ reason?: string }> } } } };
  const status = Number(value?.response?.status || value?.code);
  const reason = value?.response?.data?.error?.errors?.[0]?.reason || "";
  if (status === 429 || /rateLimit|quota/i.test(reason)) return "Google Drive đang giới hạn lượt đọc. Vui lòng thử lại sau ít phút; dữ liệu đã lưu không bị xóa.";
  if (status === 404) return "Không tìm thấy thư mục/tài liệu Drive hoặc tài khoản dịch vụ V3 chưa được chia sẻ quyền đọc. Kiểm tra link và quyền chia sẻ của thư mục lẫn file đích shortcut.";
  if (status === 401 || status === 403) return "V3 chưa có quyền đọc thư mục/tài liệu này. Chia sẻ quyền Người xem cho tài khoản dịch vụ V3 và kiểm tra Google Drive API đã được bật.";
  if (/timeout|ETIMEDOUT|ECONNRESET|aborted/i.test(clean(value?.message) + clean(value?.code))) return "Kết nối Google Drive quá thời gian. Hãy thử lại; hệ thống không có tác vụ JD chạy nền sau thông báo này.";
  return clean(value?.message) || "Không đọc được Google Drive. Vui lòng thử lại.";
}

function resourceHeaders(id: string, resourceKey?: string) {
  return resourceKey ? { "X-Goog-Drive-Resource-Keys": `${id}/${resourceKey}` } : undefined;
}

export function createJdDriveReader(request: JdDriveRequester) {
  const getFile = async (id: string, resourceKey = "") => (await request<JdDriveFile>({
    url: `${DRIVE}/${encodeURIComponent(id)}`, params: { fields: FILE_FIELDS, supportsAllDrives: true },
    headers: resourceHeaders(id, resourceKey), timeout: 30000,
  })).data;
  const resolve = async (entry: JdDriveFile) => {
    let file = entry;
    const seen = new Set<string>();
    while (file.mimeType === SHORTCUT) {
      const target = file.shortcutDetails;
      if (!target?.targetId || seen.has(target.targetId) || seen.size >= 8) throw new Error("Shortcut bị vòng lặp hoặc không có tài liệu đích.");
      seen.add(target.targetId);
      file = await getFile(target.targetId, target.targetResourceKey);
      file.resourceKey ||= target.targetResourceKey;
    }
    if (file.trashed) throw new Error("Tài liệu đích đã nằm trong thùng rác.");
    return file;
  };
  return {
    async scan(folderValue: unknown, limitValue: unknown = 80, offsetValue: unknown = 0, previousManifest = "") {
      const startedAt = Date.now();
      const location = parseJdDriveLocation(folderValue);
      const root = await resolve(await getFile(location.id, location.resourceKey));
      root.resourceKey ||= location.resourceKey;
      if (root.mimeType !== FOLDER || !root.id) throw new Error("Liên kết đã nhập không phải thư mục Drive. Hãy chọn thư mục chứa JD.");
      const queue = [{ file: root, path: clean(root.name), depth: 0 }];
      const visitedFolders = new Set<string>();
      const candidates = new Map<string, JdCandidate>();
      const summary = { scannedFolderCount: 0, scannedFileCount: 0, skippedPdfCount: 0, skippedUnsupportedCount: 0, shortcutCount: 0, resolvedShortcutCount: 0, duplicateTargetCount: 0, warnings: [] as string[] };
      while (queue.length) {
        if (Date.now() - startedAt > 45000) throw new Error("Quét kho JD vượt 45 giây. Chọn thư mục con chứa JD để đồng bộ; chưa có dữ liệu nào được ghi từ lượt quét này.");
        const current = queue.shift()!;
        const id = current.file.id!;
        if (visitedFolders.has(id)) continue;
        if (current.depth > 10 || visitedFolders.size >= 500) throw new Error("Kho JD vượt giới hạn 500 thư mục hoặc 10 cấp. Chọn thư mục con cụ thể để đồng bộ.");
        visitedFolders.add(id);
        summary.scannedFolderCount++;
        let pageToken = "";
        const pageTokens = new Set<string>();
        do {
          if (Date.now() - startedAt > 45000) throw new Error("Quét kho JD vượt 45 giây. Chọn thư mục con chứa JD để đồng bộ; chưa có dữ liệu nào được ghi từ lượt quét này.");
          const result = (await request<{ files?: JdDriveFile[]; nextPageToken?: string; incompleteSearch?: boolean }>({
            url: DRIVE, headers: resourceHeaders(id, current.file.resourceKey), timeout: 30000,
            params: { q: `'${id}' in parents and trashed = false`, fields: `nextPageToken,incompleteSearch,files(${FILE_FIELDS})`,
              corpora: current.file.driveId ? "drive" : "user", driveId: current.file.driveId || undefined,
              includeItemsFromAllDrives: true, supportsAllDrives: true, pageSize: 100, pageToken: pageToken || undefined, orderBy: "name" },
          })).data;
          if (result.incompleteSearch) throw new Error("Google Drive chưa trả đủ nội dung thư mục. Hãy thử lại với thư mục con cụ thể.");
          for (const entry of result.files || []) {
            summary.scannedFileCount++;
            if (summary.scannedFileCount > 10000) throw new Error("Kho nguồn vượt 10.000 mục. Chọn thư mục con chứa JD để đồng bộ.");
            const shortcut = entry.mimeType === SHORTCUT;
            if (shortcut) summary.shortcutCount++;
            let file: JdDriveFile;
            try { file = await resolve(entry); }
            catch (error) {
              summary.skippedUnsupportedCount++;
              if (summary.warnings.length < 10) summary.warnings.push(`${clean(entry.name)}: ${jdDriveErrorMessage(error)}`);
              continue;
            }
            if (shortcut) summary.resolvedShortcutCount++;
            if (!file.id) continue;
            if (file.mimeType === FOLDER) {
              queue.push({ file, path: `${current.path} / ${clean(entry.name || file.name)}`, depth: current.depth + 1 });
            } else if (file.mimeType === "application/pdf" || /\.pdf$/i.test(clean(file.name))) {
              summary.skippedPdfCount++;
            } else if (file.mimeType === DOC || file.mimeType === DOCX || /\.docx$/i.test(clean(file.name))) {
              const candidate: JdCandidate = { ...file, sourceEntryFileId: clean(entry.id), sourceShortcutId: shortcut ? clean(entry.id) : "", folderPath: current.path, isArchivedJd: /khong kha dung|unavailable|inactive/.test(key(current.path)) || /^\s*\[BC\]/i.test(clean(file.name)) };
              const previous = candidates.get(file.id);
              if (previous) summary.duplicateTargetCount++;
              if (!previous || (previous.isArchivedJd && !candidate.isArchivedJd)) candidates.set(file.id, candidate);
            } else summary.skippedUnsupportedCount++;
          }
          pageToken = result.nextPageToken || "";
          if (pageToken && pageTokens.has(pageToken)) throw new Error("Google Drive trả lại trang dữ liệu bị lặp. Vui lòng thử lại.");
          pageTokens.add(pageToken);
        } while (pageToken);
      }
      const all = [...candidates.values()].sort((a, b) => Number(a.isArchivedJd) - Number(b.isArchivedJd) || `${a.folderPath}/${a.name}/${a.id}`.localeCompare(`${b.folderPath}/${b.name}/${b.id}`));
      const manifestHash = jdSourceHash(all.map(file => `${file.id}:${file.modifiedTime}:${file.folderPath}`).join("\n"));
      const limit = Math.max(1, Math.min(250, Math.floor(Number(limitValue) || 80)));
      const cursorReset = Boolean(previousManifest && previousManifest !== manifestHash);
      const offset = cursorReset ? 0 : Math.min(all.length, Math.max(0, Math.floor(Number(offsetValue) || 0)));
      const files = all.slice(offset, offset + limit);
      return { ...summary, files, rootFolderId: root.id, requestedFolderId: location.id, rootFolderName: clean(root.name), manifestHash, cursorReset, offset, nextOffset: offset + files.length, hasMore: offset + files.length < all.length, eligibleScannedCount: all.length };
    },
    async readDocument(file: JdDriveFile) {
      if (Number(file.size || 0) > 20 * 1024 * 1024) throw new Error("JD lớn hơn 20 MB; giảm dung lượng hoặc chuyển sang Google Docs rồi thử lại.");
      const exported = file.mimeType === DOC;
      const result = await request<ArrayBuffer>({ url: `${DRIVE}/${encodeURIComponent(clean(file.id))}${exported ? "/export" : ""}`,
        params: exported ? { mimeType: DOCX } : { alt: "media", supportsAllDrives: true },
        headers: resourceHeaders(clean(file.id), file.resourceKey), responseType: "arraybuffer", timeout: 30000 });
      const buffer = Buffer.from(result.data);
      if (buffer.length > 20 * 1024 * 1024) throw new Error("JD vượt giới hạn đọc 20 MB.");
      return extractJdDocxText(buffer);
    },
  };
}

function xmlText(xml: string) {
  return xml.replace(/<w:tab\b[^>]*\/>/g, "\t").replace(/<w:br\b[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export async function extractJdDocxText(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const parts = ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"].map(name => zip.file(name)).filter(Boolean);
  if (!zip.file("word/document.xml")) throw new Error("File DOCX không có word/document.xml; hãy kiểm tra hoặc lưu lại file Word.");
  const textParts: string[] = [];
  for (const part of parts) {
    const xml = await part!.async("string");
    if (xml.length > 4 * 1024 * 1024) throw new Error("Nội dung JD quá lớn để phân tích an toàn.");
    // Keep a Word table row on one line, including multiline paragraphs inside each cell.
    const rows: string[] = [];
    const prepared = xml.replace(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g, row => {
      const cells = [...row.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map(match => xmlText(match[1]).replace(/\s+/g, " ").trim());
      rows.push(cells.join("\t"));
      return `\nJD_TABLE_ROW_${rows.length - 1}\n`;
    });
    textParts.push(xmlText(prepared).replace(/JD_TABLE_ROW_(\d+)/g, (_, n) => rows[Number(n)]));
  }
  return textParts.join("\n").replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export type ParsedJdGroup = { groupName: string; activities: Array<{ activityText: string; expectedOutputText: string }> };
const lineText = (value: string) => value.replace(/[ \t]+/g, " ").trim();
function section(lines: string[], starts: string[], ends: string[]) {
  const start = lines.findIndex(line => starts.some(label => key(line).includes(key(label))));
  if (start < 0) return [];
  const after = lines.slice(start + 1);
  const end = after.findIndex(line => ends.some(label => key(line).includes(key(label))));
  return end < 0 ? after : after.slice(0, end);
}
function readLabel(lines: string[], label: string) {
  const labelKey = key(label);
  for (let index = 0; index < lines.length; index++) {
    const cells = lines[index].split(/\t+/).map(clean).filter(Boolean);
    if (cells.length > 1 && key(cells[0]) === labelKey) return cells.slice(1).join(" ");
    const current = lineText(lines[index]);
    if (key(current) === labelKey) return lineText(lines[index + 1] || "");
    const colon = current.search(/[:：]/);
    if (colon > 0 && key(current.slice(0, colon)) === labelKey) return current.slice(colon + 1).trim();
  }
  return "";
}

/** Same Thuần Việt headings/table contract as the GAS thuan_viet_jd_v1 parser. */
export function parseJdSourceText(rawText: string, fileName: string) {
  const lines = rawText.split(/\r?\n/).map(line => line.replace(/\u00a0/g, " ").trim()).filter(Boolean);
  const workGroups: ParsedJdGroup[] = [];
  let current: ParsedJdGroup | undefined;
  let buffer: string[] = [];
  const flush = () => { if (current && buffer.length) current.activities.push({ activityText: buffer[0], expectedOutputText: buffer.slice(1).join("\n") }); buffer = []; };
  const startGroup = (name: string) => {
    flush();
    const groupName = name.replace(/^\d+[.)]\s*/, "").replace(/^[-–—]\s*/, "").trim();
    current = workGroups.find(group => key(group.groupName) === key(groupName));
    if (!current) { current = { groupName, activities: [] }; workGroups.push(current); }
  };
  for (const line of section(lines, ["NỘI DUNG CÔNG VIỆC CHÍNH"], ["YÊU CẦU TUYỂN DỤNG", "YÊU CẦU NĂNG LỰC"])) {
    const cells = line.split("\t").map(clean);
    if (/^(stt|nhom cong viec|hoat dong chinh|ket qua dau ra)$/.test(key(line)) || (key(line).includes("nhom cong viec") && key(line).includes("hoat dong chinh"))) continue;
    if (cells.length >= 3) {
      const groupIndex = cells.length >= 4 && /^\d*$/.test(cells[0]) ? 1 : 0;
      if (cells[groupIndex]) startGroup(cells[groupIndex]);
      if (current && cells[groupIndex + 1]) current.activities.push({ activityText: cells[groupIndex + 1], expectedOutputText: cells.slice(groupIndex + 2).join("\n") });
    } else if (cells.length === 2 && current) {
      flush(); current.activities.push({ activityText: cells[0], expectedOutputText: cells[1] });
    } else if (/^\d+[.)]\s+/.test(line)) startGroup(line);
    else if (current) { buffer.push(lineText(line)); if (buffer.length >= 2) flush(); }
  }
  flush();
  for (const group of workGroups) group.activities = [...new Map(group.activities.filter(activity => activity.activityText).map(activity => [key(activity.activityText), activity])).values()];
  const title = readLabel(lines, "Chức danh");
  const levelName = readLabel(lines, "Cấp bậc vị trí");
  const levelMatch = (readLabel(lines, "Mã cấp bậc vị trí") || levelName || fileName).match(/\b([PMC])\s*0?(\d{1,2})\b/i);
  const date = rawText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return {
    fileName, jobTitleName: title && !/^(chu ky|ho va ten|chuc danh|ky ten)$/.test(key(title)) ? title : deriveEvaluationJdTitle(fileName),
    jobTitleCode: readLabel(lines, "Mã chức danh"), employmentType: readLabel(lines, "Loại hình công việc"), divisionName: readLabel(lines, "Khối"),
    departmentName: readLabel(lines, "Phòng ban"), teamName: readLabel(lines, "Bộ phận / Nhóm"), careerFamily: readLabel(lines, "Họ nghề"),
    workLocation: readLabel(lines, "Địa điểm làm việc"), positionLevelName: levelName, positionLevelCode: levelMatch ? `${levelMatch[1].toUpperCase()}${Number(levelMatch[2])}` : "",
    reportsTo: readLabel(lines, "Báo cáo cho"), directManager: readLabel(lines, "Quản lý trực tiếp"), effectiveDate: date ? `${date[3]}-${date[2]}-${date[1]}` : "",
    purposeText: section(lines, ["MỤC ĐÍCH VỊ TRÍ"], ["SƠ ĐỒ TỔ CHỨC", "NỘI DUNG CÔNG VIỆC CHÍNH"]).join("\n"),
    recruitmentRequirementsText: section(lines, ["YÊU CẦU TUYỂN DỤNG"], ["YÊU CẦU NĂNG LỰC"]).join("\n"),
    competencyRequirementsText: section(lines, ["YÊU CẦU NĂNG LỰC"], []).join("\n"), workGroups: workGroups.filter(group => group.activities.length),
  };
}

export function jdStructureCode(prefix: "JDGRP" | "JDACT", fileId: string, ...contents: string[]) {
  return `${prefix}_${jdSourceHash(JSON.stringify([fileId, ...contents.map(key)])).slice(0, 20).toUpperCase()}`;
}

export function mergeJdActivityContent(existing: Record<string, unknown>, fields: Record<string, unknown>): Record<string, unknown> {
  return { ...existing, ...fields, activityType: existing.activityType || "unclassified", frequency: existing.frequency || "",
    weightPercent: existing.weightPercent ?? 0, isIncluded: existing.isIncluded !== false && existing.activityType !== "excluded" };
}
