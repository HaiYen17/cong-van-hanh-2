import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { createJdDriveReader, extractJdDocxText, jdDriveErrorMessage, jdStructureCode, mergeJdActivityContent, parseJdDriveLocation, parseJdSourceText, type JdDriveFile, type JdDriveRequest } from "./jd-source";

const folder = "application/vnd.google-apps.folder";
const doc = "application/vnd.google-apps.document";
const shortcut = "application/vnd.google-apps.shortcut";
function fakeDrive(files: Record<string, JdDriveFile>, pages: Record<string, { files: JdDriveFile[]; nextPageToken?: string; incompleteSearch?: boolean }>, binary?: Buffer) {
  const requests: JdDriveRequest[] = [];
  const reader = createJdDriveReader(async <T>(request: JdDriveRequest) => {
    requests.push(request);
    let data: unknown;
    if (request.responseType === "arraybuffer") data = binary;
    else if (request.url.endsWith("/files")) {
      const id = String(request.params?.q).match(/^'([^']+)'/)?.[1];
      data = pages[`${id}:${request.params?.pageToken || ""}`] || { files: [] };
    } else {
      const id = request.url.split("/").pop()!;
      data = files[id];
      if (!data) throw { response: { status: 404 } };
    }
    return { data: data as T };
  });
  return { reader, requests };
}

test("accepts plain ID, folder URLs, shortcut file URLs and resource keys, rejects other hosts", () => {
  assert.deepEqual(parseJdDriveLocation(" root_123 "), { id: "root_123", resourceKey: "" });
  assert.deepEqual(parseJdDriveLocation("https://drive.google.com/drive/u/0/folders/root?resourcekey=secret"), { id: "root", resourceKey: "secret" });
  assert.equal(parseJdDriveLocation("https://drive.google.com/file/d/shortcut/view").id, "shortcut");
  assert.equal(parseJdDriveLocation("https://drive.google.com/open?id=root").id, "root");
  assert.throws(() => parseJdDriveLocation("https://example.org/folders/root"), /không hợp lệ/);
  assert.throws(() => parseJdDriveLocation("bad' query"), /không hợp lệ/);
});

test("paginates past unsupported files and counts the limit against eligible documents only", async () => {
  const { reader, requests } = fakeDrive({ root: { id: "root", name: "JD", mimeType: folder } }, {
    "root:": { files: [{ id: "image", name: "logo.png", mimeType: "image/png" }, { id: "pdf", name: "JD.pdf" }], nextPageToken: "p2" },
    "root:p2": { files: [{ id: "a", name: "A", mimeType: doc }, { id: "b", name: "B.docx" }] },
  });
  const first = await reader.scan("root", 1);
  assert.equal(first.files[0].id, "a");
  assert.equal(first.eligibleScannedCount, 2);
  assert.equal(first.skippedPdfCount, 1);
  assert.equal(first.skippedUnsupportedCount, 1);
  assert.equal(first.hasMore, true);
  const second = await reader.scan("root", 1, first.nextOffset, first.manifestHash);
  assert.equal(second.files[0].id, "b");
  assert.equal(second.hasMore, false);
  assert.equal(requests.filter(request => request.params?.pageToken === "p2").length, 2);
});

test("shared-drive folders use drive corpus; root and folder shortcuts retain resource keys and avoid cycles", async () => {
  const { reader, requests } = fakeDrive({
    entry: { id: "entry", mimeType: shortcut, shortcutDetails: { targetId: "root", targetResourceKey: "rk" } },
    root: { id: "root", name: "JD", mimeType: folder, driveId: "shared" },
    a: { id: "a", name: "JD.docx" },
  }, { "root:": { files: [
    { id: "cycle", name: "Cycle", mimeType: shortcut, shortcutDetails: { targetId: "root" } },
    { id: "link", name: "Link", mimeType: shortcut, shortcutDetails: { targetId: "a", targetResourceKey: "file-key" } },
    { id: "a", name: "JD.docx" },
  ] } });
  const scan = await reader.scan("entry");
  assert.equal(scan.files.length, 1);
  assert.equal(scan.scannedFolderCount, 1);
  assert.equal(scan.duplicateTargetCount, 1);
  assert.equal(scan.files[0].resourceKey, "file-key");
  const list = requests.find(request => request.url.endsWith("/files"))!;
  assert.equal(list.params?.corpora, "drive");
  assert.equal(list.params?.driveId, "shared");
  assert.equal(list.headers?.["X-Goog-Drive-Resource-Keys"], "root/rk");
});

test("inaccessible shortcuts produce a visible warning instead of pretending the scan is clean", async () => {
  const { reader } = fakeDrive({ root: { id: "root", mimeType: folder } }, { "root:": { files: [
    { id: "broken", name: "Shortcut hỏng", mimeType: shortcut, shortcutDetails: { targetId: "missing" } },
  ] } });
  const scan = await reader.scan("root");
  assert.equal(scan.warnings.length, 1);
  assert.match(scan.warnings[0], /quyền đọc/);
});

test("changed manifests reset the cursor; archive folders remain marked as old JD", async () => {
  const { reader } = fakeDrive({ root: { id: "root", name: "Không khả dụng", mimeType: folder } }, {
    "root:": { files: [{ id: "a", name: "JD.docx", modifiedTime: "2026-09-01" }] },
  });
  const scan = await reader.scan("root", 1, 1, "old-manifest");
  assert.equal(scan.cursorReset, true);
  assert.equal(scan.offset, 0);
  assert.equal(scan.files[0].isArchivedJd, true);
});

test("rejects a file used as root and incomplete Drive searches", async () => {
  const nonFolder = fakeDrive({ root: { id: "root", mimeType: doc } }, {});
  await assert.rejects(nonFolder.reader.scan("root"), /không phải thư mục/);
  const incomplete = fakeDrive({ root: { id: "root", mimeType: folder } }, { "root:": { files: [], incompleteSearch: true } });
  await assert.rejects(incomplete.reader.scan("root"), /chưa trả đủ/);
});

const syntheticText = [
  "Chức danh\tChuyên viên nhân sự", "Mã chức danh\tHR01", "Phòng ban: Nhân sự", "Cấp bậc vị trí\tP2", "Ngày hiệu lực 01/09/2026",
  "MỤC ĐÍCH VỊ TRÍ", "Hỗ trợ nghiệp vụ nhân sự", "NỘI DUNG CÔNG VIỆC CHÍNH",
  "STT\tNhóm công việc\tHoạt động chính\tKết quả đầu ra",
  "1\tTuyển dụng\tLập kế hoạch tuyển dụng\tKế hoạch đã duyệt",
  "\t\tTheo dõi ứng viên\tDanh sách cập nhật",
  "2\tĐào tạo\tTổ chức đào tạo\tBiên bản đào tạo",
  "YÊU CẦU TUYỂN DỤNG", "Có kinh nghiệm", "YÊU CẦU NĂNG LỰC", "Giao tiếp",
].join("\n");

test("parses the Thuận Việt JD headings and table, including merged-cell continuation rows", () => {
  const parsed = parseJdSourceText(syntheticText, "JD_HR.docx");
  assert.equal(parsed.jobTitleName, "Chuyên viên nhân sự");
  assert.equal(parsed.departmentName, "Nhân sự");
  assert.equal(parsed.effectiveDate, "2026-09-01");
  assert.equal(parsed.positionLevelCode, "P2");
  assert.equal(parsed.workGroups.length, 2);
  assert.equal(parsed.workGroups[0].activities.length, 2);
  assert.equal(parsed.workGroups[0].activities[1].activityText, "Theo dõi ứng viên");
  assert.equal(parsed.recruitmentRequirementsText, "Có kinh nghiệm");
});

test("paragraph-layout legacy parser still recognizes numbered groups; no structural match is not success", () => {
  const parsed = parseJdSourceText("Chức danh\nChữ ký\nNỘI DUNG CÔNG VIỆC CHÍNH\n1. Vận hành\nTheo dõi tiến độ\nBáo cáo đúng hạn\nYÊU CẦU TUYỂN DỤNG", "JD_Chuyên viên.docx");
  assert.equal(parsed.jobTitleName, "Chuyên viên");
  assert.equal(parsed.workGroups[0].activities[0].expectedOutputText, "Báo cáo đúng hạn");
  assert.equal(parseJdSourceText("Văn bản không phải mẫu JD", "test.docx").workGroups.length, 0);
});

test("DOCX extraction preserves table cell boundaries and escaped Vietnamese text; Docs uses DOCX export", async () => {
  const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const tableRow = (cells: string[]) => `<w:tr>${cells.map(cell => `<w:tc>${paragraph(cell)}</w:tc>`).join("")}</w:tr>`;
  const zip = new JSZip();
  zip.file("word/document.xml", `<w:document><w:body>${paragraph("NỘI DUNG CÔNG VIỆC CHÍNH")}<w:tbl>${tableRow(["1", "Chăm sóc", "Hỗ trợ A &amp; B", "Đã hỗ trợ"])}</w:tbl>${paragraph("YÊU CẦU TUYỂN DỤNG")}</w:body></w:document>`);
  const binary = await zip.generateAsync({ type: "nodebuffer" });
  const extracted = await extractJdDocxText(binary);
  const parsed = parseJdSourceText(extracted, "JD.docx");
  assert.equal(parsed.workGroups[0].activities[0].activityText, "Hỗ trợ A & B");
  const { reader, requests } = fakeDrive({}, {}, binary);
  assert.equal(await reader.readDocument({ id: "a", mimeType: doc }), extracted);
  assert.match(requests[0].url, /\/a\/export$/);
  assert.equal(requests[0].params?.mimeType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
});

test("stable structure keys and merge retain manual classification, exclusion, weights and criteria overrides", () => {
  assert.equal(jdStructureCode("JDGRP", "file", " Nhóm công việc "), jdStructureCode("JDGRP", "file", "nhóm  công việc"));
  assert.notEqual(jdStructureCode("JDACT", "file", "Nhóm 1", "Báo cáo"), jdStructureCode("JDACT", "file", "Nhóm 2", "Báo cáo"));
  assert.notEqual(jdStructureCode("JDACT", "file", "A B", "C"), jdStructureCode("JDACT", "file", "A", "B C"));
  const merged = mergeJdActivityContent({ activityType: "excluded", frequency: "monthly", weightPercent: 17, criteriaSetOverrideId: "manual-set", evaluationWorkGroupId: "explicit-group", isIncluded: false }, { activityText: "Nội dung cập nhật", jdWorkGroupId: "parsed-group" });
  assert.equal(merged.activityType, "excluded");
  assert.equal(merged.frequency, "monthly");
  assert.equal(merged.weightPercent, 17);
  assert.equal(merged.criteriaSetOverrideId, "manual-set");
  assert.equal(merged.evaluationWorkGroupId, "explicit-group");
  assert.equal(merged.isIncluded, false);
});

test("Drive errors have actionable Vietnamese messages", () => {
  assert.match(jdDriveErrorMessage({ response: { status: 403 } }), /Người xem/);
  assert.match(jdDriveErrorMessage({ response: { status: 404 } }), /file đích shortcut/);
  assert.match(jdDriveErrorMessage({ response: { status: 429 } }), /giới hạn lượt đọc/);
});
