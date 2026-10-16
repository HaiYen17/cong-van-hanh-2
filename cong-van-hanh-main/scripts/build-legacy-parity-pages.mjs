import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { transformEvaluationCustomWorkgroups } from "./evaluation-custom-workgroups-transform.mjs";
import { transformEvaluationAutomation } from "./evaluation-automation-transform.mjs";
import { transformReconciliationCancellation } from "./reconciliation-cancellation-transform.mjs";
import { transformAccountingNotes } from "./accounting-notes-transform.mjs";
import { transformAccountingFormulaStandard } from "./accounting-formula-standard-transform.mjs";
import { transformEvaluationWorkflowDecision } from "./evaluation-workflow-decision-transform.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const legacyRoot =
  process.env.LEGACY_GAS_ROOT ||
  path.resolve(projectRoot, "..", "Hành chính");
const legacyArchiveRoot =
  process.env.LEGACY_ARCHIVE_ROOT ||
  path.resolve(projectRoot, "..", "Hành chính - Module lưu trữ");
const publicRoot = process.env.LEGACY_PARITY_OUTPUT_ROOT
  ? path.resolve(projectRoot, process.env.LEGACY_PARITY_OUTPUT_ROOT)
  : path.join(projectRoot, "public", "legacy");
const evaluationV3SourcePath = path.join(
  projectRoot,
  "scripts",
  "v3-parity",
  "evaluation-config.html",
);
const v3StandaloneModuleSources = new Map([
  ["CandidateManagementModal.html", "recruitment-management.html"],
  ["CandidateAssessmentModal.html", "recruitment-assessment.html"],
  ["CandidateResultsModal.html", "recruitment-results.html"],
]);
const buildScope = String(process.env.LEGACY_PARITY_SCOPE || "all")
  .trim()
  .toLowerCase();

function readLegacy(fileName) {
  const filePath = path.join(legacyRoot, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Không tìm thấy nguồn GAS: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function readModuleSource(moduleDefinition) {
  if (!moduleDefinition.archiveArea) {
    return readLegacy(moduleDefinition.file);
  }
  const filePath = path.join(
    legacyArchiveRoot,
    moduleDefinition.archiveArea,
    moduleDefinition.file,
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(`Không tìm thấy nguồn module lưu trữ: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function repairKnownLegacyEncoding(source) {
  const corruptedBootMessage = Buffer.from(
    "S2jDg8K0bmcga2jDocK7xbhpIHTDocK6wqFvIMOE4oCYw4bCsMOhwrvCo2MgbW9kdWxlIGPDocK6wqV1IGjDg8Ksbmggw4TigJjDg8KhbmggZ2nDg8KhLg==",
    "base64",
  ).toString("utf8");
  const corruptedAdminPermissionLine = Buffer.from(
    "ICAgICAgX3Nob3dHdWFyZF8oJ8Oi4oC64oCdIFTDg8KgaSBraG/DocK6wqNuIG7Dg8KgeSBjaMOGwrBhIMOE4oCYw4bCsMOhwrvCo2MgY8OhwrrCpXAgcXV5w6HCu8KBbiBRdcOhwrrCo24gbMODwr0gw4TigJjDhsKhbiBow4PCoG5nLicpOw==",
    "base64",
  ).toString("utf8");
  return source
    .replace(
      corruptedBootMessage,
      "Không khởi tạo được module cấu hình đánh giá.",
    )
    .replace(
      "instanceId: numValue($('evaluationSelectedInstanceId').value),",
      "instanceId: String($('evaluationSelectedInstanceId').value || ''),",
    )
    .replace(
      corruptedAdminPermissionLine,
      "      _showGuard_('⛔ Tài khoản này chưa được cấp quyền Quản lý Đơn hàng.');",
    );
}

function transformModuleSource(source, moduleDefinition) {
  if (moduleDefinition.file === "WorkshopAllocationModal.html") {
    const lazyFallback = `    if (!(window.App && App.lazyModules && typeof App.lazyModules.ensureLoaded === 'function')) {
      showPopup('Chưa mở được Đặt hàng Xưởng', 'Module Đặt hàng Xưởng chưa sẵn sàng để mở.', true);
      return;
    }`;
    const routeFallback = `    if (!(window.App && App.lazyModules && typeof App.lazyModules.ensureLoaded === 'function')) {
      var query = new URLSearchParams({
        weekKey: state.selectedWeekKey || '',
        selectedWeekKey: state.selectedWeekKey || '',
        startInOrderFocus: 'true',
        forceRefresh: 'true'
      });
      window.parent.location.assign('/phan-xuong/dat-hang?' + query.toString());
      return;
    }`;
    if (!source.includes(lazyFallback)) {
      throw new Error(
        "Không tìm thấy fallback mở Đặt hàng Xưởng trong WorkshopAllocationModal.html.",
      );
    }
    source = source.replace(lazyFallback, routeFallback);
  }
  if (moduleDefinition.file === "AccountingConfigModal.html") {
    source = transformAccountingNotes(source);
    source = transformAccountingFormulaStandard(source);
    const styleMarker = "</style>";
    const workerFormMarker =
      '<form id="accountingDataWorkerForm" class="accounting-form">';
    const runtimeConfigMarker =
      "    var config = runtime.config || {};";
    const successfulCallMarker =
      "    return App.gas(methodName, payload || {}).then(function (response) {";
    const historyToolbarMarker =
      '              <div class="accounting-history-toolbar">';
    const renderChangesMarker =
      "  function renderAccountingChanges() {";
    for (const [marker, label] of [
      [styleMarker, "style Kế toán"],
      [workerFormMarker, "form worker Kế toán"],
      [runtimeConfigMarker, "trạng thái worker Kế toán"],
    ]) {
      if (!source.includes(marker)) {
        throw new Error(
          `Không tìm thấy điểm gắn ${label} trong AccountingConfigModal.html.`,
        );
      }
    }
    if (!source.includes(successfulCallMarker)) {
      throw new Error(
        "Không tìm thấy điểm gắn trạng thái thao tác Kế toán trong AccountingConfigModal.html.",
      );
    }
    if (
      !source.includes(historyToolbarMarker) ||
      !source.includes(renderChangesMarker)
    ) {
      throw new Error(
        "Không tìm thấy điểm gắn nhật ký đồng bộ trong AccountingConfigModal.html.",
      );
    }
    const managedWorkerStyles = `
  #accountingConfigModal .accounting-worker-managed-note{display:none;padding:11px 13px;border:1px solid rgba(17,76,65,.12);border-radius:8px;background:rgba(239,248,243,.92);color:var(--accent-deep);font-size:.78rem;font-weight:800;line-height:1.5}
  #accountingConfigModal[data-accounting-worker-managed="true"] .accounting-worker-managed-note{display:block}
  #accountingConfigModal[data-accounting-worker-managed="true"] #accountingDataWorkerForm>.accounting-form-grid,
  #accountingConfigModal[data-accounting-worker-managed="true"] #accountingDataWorkerForm>.accounting-data-secret-note,
  #accountingConfigModal[data-accounting-worker-managed="true"] #accountingDataWorkerSave,
  #accountingConfigModal[data-accounting-worker-managed="true"] #accountingDataWorkerTest,
  #accountingConfigModal[data-accounting-worker-managed="true"] #accountingDataSchemaInit{display:none!important}
  #accountingConfigModal[data-accounting-worker-managed="true"] #accountingDataWorkerForm>.accounting-runtime-actions{justify-content:flex-end}
  #accountingConfigModal .accounting-history-sync-panel{display:grid;gap:12px;margin-bottom:18px;padding-bottom:18px;border-bottom:1px solid rgba(17,76,65,.12)}
  #accountingConfigModal .accounting-history-sync-panel .accounting-run-list{margin-top:0}
`;
    const managedWorkerNote =
      '<div class="accounting-worker-managed-note">Kết nối này đã được quản trị an toàn trên Google Cloud. Kế toán không cần nhập địa chỉ hoặc mã bảo vệ; chỉ dùng nút làm mới để kiểm tra trạng thái.</div>';
    const syncHistoryPanel = `
              <div class="accounting-history-sync-panel">
                <div><p class="accounting-kicker">Nhật ký đồng bộ</p><h4 class="accounting-title">Các lần lấy dữ liệu</h4><p class="accounting-note">Mỗi lần cập nhật đều được giữ lại thời gian chạy, kỳ dữ liệu, số trang và số dòng thêm, sửa, xóa.</p></div>
                <div id="accountingHistoryRuns" class="accounting-run-list"><div class="accounting-empty">Chưa có lần cập nhật dữ liệu.</div></div>
                <div class="accounting-issue">Lần đồng bộ đầu tiên được dùng làm mốc gốc. Các dòng sửa hoặc xóa sẽ xuất hiện ở phần bên dưới từ lần đồng bộ kế tiếp.</div>
              </div>
`;
    const mirrorSyncHistory =
      "  function renderAccountingChanges() {\n" +
      "    var historyRuns = $('accountingHistoryRuns');\n" +
      "    if (historyRuns && $('accountingDataRuns')) historyRuns.innerHTML = $('accountingDataRuns').innerHTML;\n";
    return source
      .replace(styleMarker, managedWorkerStyles + styleMarker)
      .replace(workerFormMarker, workerFormMarker + managedWorkerNote)
      .replace(historyToolbarMarker, syncHistoryPanel + historyToolbarMarker)
      .replace(
        runtimeConfigMarker,
        runtimeConfigMarker +
          "\n    root.dataset.accountingWorkerManaged = config.configured ? 'true' : 'false';",
      )
      .replace(
        successfulCallMarker,
        successfulCallMarker + "\n      setStatus('', 'default');",
      )
      .replace(
        renderChangesMarker,
        mirrorSyncHistory,
      );
  }
  if (moduleDefinition.file === "EvaluationModal.html") {
    source = transformEvaluationWorkflowDecision(source);
    const replacements = [
      [
        `#evaluationModal .evaluation-dialog{max-width:none;width:min(1500px,calc(100vw - 24px));height:min(94vh,calc(100vh - 24px))}`,
        `#evaluationModal .evaluation-dialog{max-width:none;width:min(1740px,calc(100vw - 24px));height:min(94vh,calc(100vh - 24px))}`,
        "chiều rộng màn Đánh giá nhân sự",
      ],
      [
        `#evaluationModal .evaluation-shell{position:relative;display:grid;grid-template-columns:minmax(260px,.34fr) minmax(760px,1.66fr);gap:16px;align-items:start;min-height:0}`,
        `#evaluationModal .evaluation-shell{position:relative;display:grid;grid-template-columns:minmax(400px,.52fr) minmax(720px,1.48fr);gap:16px;align-items:start;min-height:0}`,
        "cột danh sách phiếu rộng",
      ],
      [
        `    if (role === 'colleague' || role === 'coworker' || role === 'dong nghiep') return 'peer';\n    return role;`,
        `    if (role === 'colleague' || role === 'coworker' || role === 'dong nghiep') return 'peer';\n    if (role === 'board' || role === 'board of directors' || role === 'm3' || role === 'manager 3' || role === 'ceo' || role === 'ban giam doc') return 'bod';\n    return role;`,
        "chuẩn hóa BOD tại màn chấm điểm",
      ],
      [
        `    if (!viewerCode || !instance) return [];`,
        `    if (!instance) return [];`,
        "quyền BOD không phụ thuộc mã nhân sự",
      ],
      [
        `    var candidates = [];\n    if (normalize(instance.employeeCode || instance.employeeId) === viewerCode) candidates.push('self');`,
        `    var candidates = [];\n    var assignedRoles = Array.isArray(instance.availableRoles) ? instance.availableRoles.map(normalizeRole).filter(Boolean) : roleTokens(instance.availableRoles);\n    assignedRoles.forEach(function (role) { if (candidates.indexOf(role) === -1) candidates.push(role); });\n    if (normalize(instance.employeeCode || instance.employeeId) === viewerCode && candidates.indexOf('self') === -1) candidates.push('self');`,
        "vai trò được backend phân công",
      ],
      [
        `    if (normalized === 'hr') return 'Nhân sự đánh giá';\n    if (normalized === 'final_approval') return 'Duyệt cuối';`,
        `    if (normalized === 'hr') return 'Nhân sự đánh giá';\n    if (normalized === 'bod') return 'Ban giám đốc duyệt';\n    if (normalized === 'final_approval') return 'Duyệt cuối';`,
        "nhãn BOD tại màn chấm điểm",
      ],
    ];
    for (const [needle, replacement, label] of replacements) {
      if (!source.includes(needle)) {
        throw new Error(`Không tìm thấy điểm gắn ${label} trong EvaluationModal.html.`);
      }
      source = source.replace(needle, replacement);
    }
    const scoreSectionStyleMarker =
      "  #evaluationModal .evaluation-score-list{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}";
    const scoreSectionFunctionMarker =
      "  function renderJdScores(scores, role) {";
    const scoreDetailFunctionMarker =
      "  function renderScoreInputRow(score, role, options) {";
    const scoreDetailMarkupMarker = `      '</div></div>' +
      reflectionHtml +`;
    const scoreDetailUpdateMarker =
      "    if (display) display.textContent = isEmpty ? '--' : formatScoreValueForUi(value);";
    const scoreRenderMarker = `    node.innerHTML =
      (staticScores.length ? staticScores.map(function (score) { return renderScoreInputRow(score, role); }).join('') : '') +
      (jdScores.length ? renderJdScores(jdScores, role) : '');`;
    for (const [marker, label] of [
      [scoreSectionStyleMarker, "style phân khối phiếu chấm"],
      [scoreSectionFunctionMarker, "hàm dựng nhóm JD"],
      [scoreRenderMarker, "luồng dựng điểm Văn hóa và Chuyên môn"],
      [scoreDetailFunctionMarker, "hàm chi tiết mức điểm"],
      [scoreDetailMarkupMarker, "vị trí hiển thị chi tiết mức điểm"],
      [scoreDetailUpdateMarker, "luồng cập nhật chi tiết mức điểm"],
    ]) {
      if (!source.includes(marker)) {
        throw new Error(`Không tìm thấy ${label} trong EvaluationModal.html.`);
      }
    }
    const scoreSectionStyles = `
  #evaluationModal .evaluation-score-section{grid-column:1/-1;display:grid;gap:12px;padding:0;border:1px solid rgba(17,76,65,.13);border-radius:8px;background:rgba(255,255,255,.76);box-shadow:0 14px 28px rgba(17,45,39,.055);overflow:hidden}
  #evaluationModal .evaluation-score-section+.evaluation-score-section{margin-top:12px}
  #evaluationModal .evaluation-score-section-head{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;padding:16px 18px;border-bottom:1px solid rgba(17,76,65,.1);background:linear-gradient(135deg,#fff7f1,#fff 66%)}
  #evaluationModal .evaluation-score-section-index{display:grid;place-items:center;width:38px;height:38px;border-radius:8px;background:var(--accent);color:#fff;font-size:.82rem;font-weight:950;box-shadow:0 9px 18px rgba(234,108,45,.2)}
  #evaluationModal .evaluation-score-section-copy{min-width:0}
  #evaluationModal .evaluation-score-section-kicker{margin:0 0 3px;color:#b85b22;font-size:.62rem;font-weight:950;letter-spacing:.06em;text-transform:uppercase}
  #evaluationModal .evaluation-score-section-title{margin:0;color:var(--accent-deep);font-size:1.18rem;font-weight:950;line-height:1.25}
  #evaluationModal .evaluation-score-section-note{margin:4px 0 0;color:var(--muted-strong);font-size:.74rem;line-height:1.45}
  #evaluationModal .evaluation-score-section-count{display:inline-flex;align-items:center;min-height:30px;padding:0 11px;border:1px solid rgba(17,76,65,.1);border-radius:999px;background:#fff;color:var(--accent-deep);font-size:.68rem;font-weight:950;white-space:nowrap}
  #evaluationModal .evaluation-score-section-body{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:12px}
  #evaluationModal .evaluation-score-section--technical{border-color:rgba(17,76,65,.18)}
  #evaluationModal .evaluation-score-section--technical .evaluation-score-section-head{background:linear-gradient(135deg,#123f36,#1b5d4f 66%,#235d4f)}
  #evaluationModal .evaluation-score-section--technical .evaluation-score-section-index{background:#fff8f2;color:#a64e14;box-shadow:none}
  #evaluationModal .evaluation-score-section--technical .evaluation-score-section-kicker{color:#f5b58e}
  #evaluationModal .evaluation-score-section--technical .evaluation-score-section-title{color:#fff}
  #evaluationModal .evaluation-score-section--technical .evaluation-score-section-note{color:rgba(255,255,255,.76)}
  #evaluationModal .evaluation-score-section--technical .evaluation-score-section-count{border-color:rgba(255,255,255,.2);background:rgba(255,255,255,.13);color:#fff}
  #evaluationModal .evaluation-score-section--technical .evaluation-score-section-body{grid-template-columns:1fr;padding:12px;background:rgba(239,244,242,.66)}
  #evaluationModal .evaluation-score-section--technical .evaluation-jd-score-groups{grid-column:auto}
  #evaluationModal .evaluation-score-section .evaluation-score-section-body{grid-template-columns:repeat(2,minmax(0,1fr))}
  #evaluationModal .evaluation-score-section--technical .evaluation-score-section-body{grid-template-columns:1fr}
  #evaluationModal .evaluation-score-section .evaluation-jd-rubric-list{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:10px}
  #evaluationModal .evaluation-score-section .evaluation-score-row{grid-template-columns:minmax(0,1fr) auto auto;grid-template-areas:"copy copy copy" "range value comment" "detail detail detail" "panel panel panel";gap:10px 12px;align-content:start;padding:14px 16px}
  #evaluationModal .evaluation-score-section .evaluation-score-row.has-reflection{grid-template-areas:"copy copy copy" "range value comment" "detail detail detail" "mirror mirror mirror" "reflect reflect reflect" "panel panel panel"}
  #evaluationModal .evaluation-score-section .evaluation-score-copy{min-width:0}
  #evaluationModal .evaluation-score-section .evaluation-score-title{display:block;-webkit-line-clamp:unset;overflow:visible;margin:0;white-space:normal;text-overflow:clip;overflow-wrap:anywhere;color:var(--accent-deep);font-size:.82rem;font-weight:900;line-height:1.45}
  #evaluationModal .evaluation-score-section .evaluation-score-control{width:100%;min-width:0}
  #evaluationModal .evaluation-score-section .evaluation-score-range-wrap{width:100%;min-height:30px}
  #evaluationModal .evaluation-score-section .evaluation-score-range{display:block;width:100%;min-width:180px;height:30px}
  #evaluationModal .evaluation-score-section .evaluation-score-range::-webkit-slider-runnable-track{height:7px}
  #evaluationModal .evaluation-score-section .evaluation-score-range::-webkit-slider-thumb{width:20px;height:20px;margin-top:-6.5px}
  #evaluationModal .evaluation-score-section .evaluation-score-range::-moz-range-track,#evaluationModal .evaluation-score-section .evaluation-score-range::-moz-range-progress{height:7px}
  #evaluationModal .evaluation-score-section .evaluation-score-range::-moz-range-thumb{width:12px;height:12px}
  #evaluationModal .evaluation-score-section .evaluation-score-value{min-width:52px;height:34px;padding:0 9px;border:1px solid rgba(17,76,65,.1);background:rgba(17,76,65,.06);font-size:.86rem}
  #evaluationModal .evaluation-score-section .evaluation-score-comment-toggle{width:34px;height:34px}
  #evaluationModal .evaluation-score-detail{grid-area:detail;display:flex;align-items:flex-start;gap:7px;min-height:30px;padding:7px 9px;border:1px solid rgba(17,76,65,.09);border-radius:7px;background:rgba(240,246,243,.9);color:var(--muted-strong);font-size:.68rem;font-weight:760;line-height:1.45}
  #evaluationModal .evaluation-score-detail::before{content:'i';display:grid;place-items:center;flex:0 0 auto;width:18px;height:18px;border-radius:999px;background:rgba(17,76,65,.11);color:var(--accent-deep);font-size:.62rem;font-weight:950}
  #evaluationModal .evaluation-score-row.is-empty .evaluation-score-detail{border-style:dashed;background:rgba(247,248,247,.82);color:#7a8985}
  @media (orientation:portrait),(max-width:1180px){#evaluationModal .evaluation-score-section .evaluation-score-section-body,#evaluationModal .evaluation-score-section .evaluation-jd-rubric-list{grid-template-columns:1fr}#evaluationModal .evaluation-score-section-head{grid-template-columns:auto minmax(0,1fr)}#evaluationModal .evaluation-score-section-count{grid-column:2;justify-self:start}}
  @media (max-width:640px){#evaluationModal .evaluation-score-section .evaluation-score-row{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"copy copy" "range value" "detail detail" "comment comment" "panel panel";padding:13px}#evaluationModal .evaluation-score-section .evaluation-score-row.has-reflection{grid-template-areas:"copy copy" "range value" "detail detail" "comment comment" "mirror mirror" "reflect reflect" "panel panel"}#evaluationModal .evaluation-score-section .evaluation-score-comment-toggle{justify-self:end}}
`;
    const scoreDetailFunctions = `  function evaluationScoreLevelDescription(score, value) {
    if (!score || score.scoreLevelDescriptionsEnabled !== true) return '';
    var descriptions = score.scoreLevelDescriptions;
    if (!descriptions || typeof descriptions !== 'object' || Array.isArray(descriptions)) return '';
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) return '';
    return trim(descriptions[String(Math.round(numeric))]);
  }
  function evaluationScoreFallbackDescription(value, max) {
    var numeric = Number(value);
    var maximum = Number(max) || 10;
    if (!Number.isFinite(numeric)) return '';
    var ratio = maximum ? numeric / maximum : 0;
    if (ratio <= 0) return 'Chưa thể hiện';
    if (ratio < .4) return 'Cần cải thiện';
    if (ratio < .6) return 'Đạt một phần';
    if (ratio < .8) return 'Đạt yêu cầu';
    if (ratio < 1) return 'Thể hiện tốt';
    return 'Thể hiện xuất sắc';
  }
  function evaluationScoreDetailText(score, value, max, isEmpty) {
    if (isEmpty) return 'Kéo thanh điểm để xem mức đánh giá và mô tả chi tiết.';
    var detail = evaluationScoreLevelDescription(score, value) || evaluationScoreFallbackDescription(value, max);
    var suffix = Number(max) === 100 ? '%' : '/' + (Number(max) || 10);
    return 'Mức ' + formatScoreValueForUi(value) + suffix + (detail ? ' · ' + detail : '');
  }

`;
    const scoreSectionFunctions = `  function evaluationSectionKey(score) {
    var mode = text(score && score.contentMode).toLowerCase();
    return text(score && (score.sectionCode || score.scoreGroupCode || score.sectionName || score.scoreGroupName)) ||
      (mode === 'jd_dynamic' ? 'technical' : text(score && (score.criteriaSetCode || score.criteriaSetName)) || 'evaluation-content');
  }
  function evaluationSectionName(score) {
    var mode = text(score && score.contentMode).toLowerCase();
    var name = text(score && (score.sectionName || score.scoreGroupName));
    if (!name) name = mode === 'jd_dynamic' ? 'Chuyên môn' : text(score && score.criteriaSetName) || 'Nội dung đánh giá';
    name = name.replace(/^Đánh giá\\s+/i, '');
    return name ? name.charAt(0).toLocaleUpperCase('vi') + name.slice(1) : 'Nội dung đánh giá';
  }
  function evaluationSectionTone(name, mode) {
    var normalized = normalize(name);
    if (mode === 'jd_dynamic' || normalized.indexOf('chuyen mon') >= 0) return 'technical';
    if (normalized.indexOf('van hoa') >= 0) return 'culture';
    if (normalized.indexOf('kpi') >= 0 || normalized.indexOf('ket qua') >= 0) return 'kpi';
    return 'custom';
  }
  function evaluationSectionRoman(index) {
    var values = ['I','II','III','IV','V','VI','VII','VIII','IX','X'];
    return values[index] || String(index + 1);
  }
  function evaluationConfiguredSections(scores) {
    var sections = [];
    var byKey = {};
    (scores || []).forEach(function (score, index) {
      var mode = text(score && score.contentMode).toLowerCase();
      var sectionKey = evaluationSectionKey(score);
      if (!byKey[sectionKey]) {
        var configuredSortOrder = Number(score && score.sectionSortOrder);
        byKey[sectionKey] = {
          bodyMode: mode === 'jd_dynamic' ? 'jd' : 'criteria',
          insertionOrder: index,
          key: sectionKey,
          name: evaluationSectionName(score),
          priority: mode === 'jd_dynamic' ? 0 : 1,
          scores: [],
          sortOrder: Number.isFinite(configuredSortOrder) ? configuredSortOrder : Number.MAX_SAFE_INTEGER
        };
        sections.push(byKey[sectionKey]);
      }
      byKey[sectionKey].scores.push(score);
    });
    return sections.sort(function (left, right) {
      return left.sortOrder - right.sortOrder || left.priority - right.priority || left.insertionOrder - right.insertionOrder;
    });
  }
  function evaluationScoreSectionMarkup(options) {
    options = options || {};
    var count = Number(options.count || 0);
    return '<section class="evaluation-score-section evaluation-score-section--' + escapeHtml(options.tone || 'culture') + '">' +
      '<div class="evaluation-score-section-head"><span class="evaluation-score-section-index">' + escapeHtml(options.index || '') + '</span>' +
        '<div class="evaluation-score-section-copy"><p class="evaluation-score-section-kicker">' + escapeHtml(options.kicker || 'Nội dung đánh giá') + '</p>' +
          '<h3 class="evaluation-score-section-title">' + escapeHtml(options.title || '') + '</h3><p class="evaluation-score-section-note">' + escapeHtml(options.note || '') + '</p></div>' +
        '<span class="evaluation-score-section-count">' + escapeHtml(count + ' tiêu chí') + '</span></div>' +
      '<div class="evaluation-score-section-body">' + (options.body || '') + '</div></section>';
  }

`;
    const scoreRenderReplacement = `    var scoreSections = evaluationConfiguredSections(scores).map(function (section, sectionIndex) {
      var tone = evaluationSectionTone(section.name, section.bodyMode === 'jd' ? 'jd_dynamic' : 'criteria_set');
      var isJd = section.bodyMode === 'jd';
      return evaluationScoreSectionMarkup({
        index: evaluationSectionRoman(sectionIndex),
        kicker: isJd ? 'Năng lực và kết quả công việc' : (tone === 'culture' ? 'Phẩm chất và hành vi' : tone === 'kpi' ? 'Mục tiêu và kết quả' : 'Khối đánh giá đã cấu hình'),
        title: 'Đánh giá ' + section.name,
        note: isJd ? 'Các nhóm công việc, hoạt động và bộ tiêu chí được phân bổ theo JD hiện hành.' : 'Tiêu chí thuộc riêng khối ' + section.name + ' theo cấu hình của loại đánh giá.',
        tone: tone,
        count: section.scores.length,
        body: isJd ? renderJdScores(section.scores, role) : section.scores.map(function (score) { return renderScoreInputRow(score, role); }).join('')
      });
    });
    node.innerHTML = (typeof bodReadOnlyHtml === 'string' ? bodReadOnlyHtml : '') + scoreSections.join('');`;
    return source
      .replace(
        scoreSectionStyleMarker,
        scoreSectionStyleMarker + scoreSectionStyles,
      )
      .replace(
        scoreSectionFunctionMarker,
        scoreSectionFunctions + scoreSectionFunctionMarker,
      )
      .replace(
        scoreDetailFunctionMarker,
        scoreDetailFunctions + scoreDetailFunctionMarker,
      )
      .replace(
        scoreDetailMarkupMarker,
        `      '</div></div>' +
      '<div class="evaluation-score-detail" data-score-detail>' + escapeHtml(evaluationScoreDetailText(score, numericValue, inputMeta.max, isEmpty)) + '</div>' +
      reflectionHtml +`,
      )
      .replace(
        scoreDetailUpdateMarker,
        scoreDetailUpdateMarker + `
    var detail = row.querySelector('[data-score-detail]');
    var score = byId(list('criteriaScores'), row.getAttribute('data-score-id')) || {};
    if (detail) detail.textContent = evaluationScoreDetailText(score, value, input.max, isEmpty);`,
      )
      .replace(scoreRenderMarker, scoreRenderReplacement);
  }
  if (moduleDefinition.file === "EvaluationConfigModal.html") {
    source = transformEvaluationCustomWorkgroups(source);
    source = transformEvaluationAutomation(source);
    const monitorChartsMarker =
      "monitorHero.insertAdjacentHTML('afterend', renderMonitorWorkTypeRadarCharts(instance));";
    const monitorFunctionsMarker =
      "  function renderMonitorWorkTypeRadarCharts(instance) {";
    if (
      !source.includes(monitorChartsMarker) ||
      !source.includes(monitorFunctionsMarker)
    ) {
      throw new Error(
        "Không tìm thấy điểm gắn biểu đồ theo dõi trong EvaluationConfigModal.html.",
      );
    }
    const rankingStyles = `
  #evaluationConfigModal .evaluation-activity-ranking{display:grid;gap:12px;margin-top:14px;padding:14px;border:1px solid rgba(17,76,65,.1);border-radius:8px;background:rgba(255,255,255,.86)}
  #evaluationConfigModal .evaluation-activity-ranking-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}
  #evaluationConfigModal .evaluation-activity-ranking-title{margin:0;color:var(--accent-deep);font-size:.94rem;font-weight:950;line-height:1.4}
  #evaluationConfigModal .evaluation-activity-ranking-note{margin:2px 0 0;color:var(--muted-strong);font-size:.72rem;font-weight:750;line-height:1.45}
  #evaluationConfigModal .evaluation-activity-ranking-list{display:grid;gap:7px}
  #evaluationConfigModal .evaluation-activity-ranking-row{display:grid;grid-template-columns:30px minmax(180px,1.15fr) minmax(160px,1fr) 52px;gap:10px;align-items:center;padding:9px 10px;border:1px solid rgba(17,76,65,.075);border-radius:8px;background:#fff}
  #evaluationConfigModal .evaluation-activity-ranking-index{display:grid;place-items:center;width:26px;height:26px;border-radius:999px;background:rgba(17,76,65,.08);color:var(--accent-deep);font-size:.68rem;font-weight:950}
  #evaluationConfigModal .evaluation-activity-ranking-copy{min-width:0}
  #evaluationConfigModal .evaluation-activity-ranking-copy strong{display:block;overflow:hidden;color:var(--accent-deep);font-size:.76rem;font-weight:900;line-height:1.4;text-overflow:ellipsis;white-space:nowrap}
  #evaluationConfigModal .evaluation-activity-ranking-copy span{display:block;overflow:hidden;margin-top:2px;color:var(--muted-strong);font-size:.64rem;font-weight:750;text-overflow:ellipsis;white-space:nowrap}
  #evaluationConfigModal .evaluation-activity-ranking-track{height:8px;overflow:hidden;border-radius:999px;background:rgba(17,76,65,.09)}
  #evaluationConfigModal .evaluation-activity-ranking-bar{display:block;height:100%;min-width:3px;border-radius:999px;background:#d06b2a}
  #evaluationConfigModal .evaluation-activity-ranking-row[data-tone="mid"] .evaluation-activity-ranking-bar{background:#d99a32}
  #evaluationConfigModal .evaluation-activity-ranking-row[data-tone="high"] .evaluation-activity-ranking-bar{background:#228162}
  #evaluationConfigModal .evaluation-activity-ranking-score{text-align:right;color:var(--accent-deep);font-size:.78rem;font-weight:950}
  @media(max-width:760px){#evaluationConfigModal .evaluation-activity-ranking-row{grid-template-columns:28px minmax(0,1fr) 46px}#evaluationConfigModal .evaluation-activity-ranking-track{grid-column:2/-1}.evaluation-activity-ranking-copy strong{white-space:normal}}
`;
    const rankingFunctions = `  function renderMonitorActivityRankingChart(instance) {
    var items = monitorActivitySummaryItems(instance).slice().sort(function (left, right) {
      return (Number(left.percent) || 0) - (Number(right.percent) || 0) ||
        text(left.label).localeCompare(text(right.label), 'vi');
    });
    var body = items.length ? items.map(function (item, index) {
      var percent = Math.max(0, Math.min(100, Number(item.percent) || 0));
      var tone = percent >= 80 ? 'high' : percent >= 60 ? 'mid' : 'low';
      return '<div class="evaluation-activity-ranking-row" data-tone="' + tone + '">' +
        '<span class="evaluation-activity-ranking-index">' + escapeHtml(index + 1) + '</span>' +
        '<div class="evaluation-activity-ranking-copy"><strong title="' + escapeHtml(item.label || '') + '">' + escapeHtml(item.label || ('Đầu việc ' + (index + 1))) + '</strong><span>' + escapeHtml(item.workGroupName || (item.count + ' tiêu chí đã gộp')) + '</span></div>' +
        '<div class="evaluation-activity-ranking-track" aria-hidden="true"><span class="evaluation-activity-ranking-bar" style="width:' + escapeHtml(percent) + '%"></span></div>' +
        '<strong class="evaluation-activity-ranking-score">' + escapeHtml(Math.round(percent) + '%') + '</strong>' +
      '</div>';
    }).join('') : '<div class="evaluation-monitor-radar-empty">Chưa có đầu công việc theo JD đã được chấm để xếp hạng.</div>';
    return '<section class="evaluation-activity-ranking"><div class="evaluation-activity-ranking-head"><div><p class="evaluation-config-kicker">Xếp hạng đầu công việc</p><h4 class="evaluation-activity-ranking-title">Từ điểm cần ưu tiên cải thiện đến điểm mạnh</h4><p class="evaluation-activity-ranking-note">Sắp xếp thấp → cao theo điểm tổng hợp các vai trò và trọng số của Loại đánh giá.</p></div><span class="evaluation-config-pill">' + escapeHtml(items.length + ' đầu việc') + '</span></div><div class="evaluation-activity-ranking-list">' + body + '</div></section>';
  }

`;
    return source
      .replace("</style>", rankingStyles + "</style>")
      .replace(monitorFunctionsMarker, rankingFunctions + monitorFunctionsMarker)
      .replace(
        monitorChartsMarker,
        `monitorHero.insertAdjacentHTML('afterend',
        '<section class="evaluation-monitor-worktype-section evaluation-monitor-overall-section">' +
          '<p class="evaluation-config-label">Tổng hợp năng lực theo tiêu chí</p>' +
          renderMonitorOverallRadarChart(instance) +
        '</section>' +
        renderMonitorWorkTypeRadarCharts(instance) +
        renderMonitorActivityRankingChart(instance));`,
      );
  }
  if (moduleDefinition.file === "ReconciliationModal.html") {
    source = transformReconciliationCancellation(source);
    const runFunctionStart = source.indexOf("  async function runReconcile() {");
    const payloadStart = source.indexOf("      const payload = {", runFunctionStart);
    const resultHandlerStart = source.indexOf(
      "      handleRunResult(response);",
      payloadStart,
    );
    if (
      runFunctionStart < 0 ||
      payloadStart < 0 ||
      resultHandlerStart < 0
    ) {
      throw new Error(
        "Không tìm thấy luồng tạo đối soát trong ReconciliationModal.html.",
      );
    }
    const multipartRun = `      const formData = new FormData();
      formData.append('month', String(Number($('reconciliationMonth').value)));
      formData.append('year', String(Number($('reconciliationYear').value)));
      state.stagedFiles.forEach(function(entry) {
        formData.append('files', entry.file, entry.file.name);
      });
      const response = await fetch('/api/reconciliation/run', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData
      }).then(async function(httpResponse) {
        const body = await httpResponse.json().catch(function() { return {}; });
        if (!httpResponse.ok) {
          throw new Error(body.message || 'Không xử lý được yêu cầu đối soát.');
        }
        return body;
      });
`;
    return (
      source.slice(0, payloadStart) +
      multipartRun +
      source.slice(resultHandlerStart)
    );
  }
  if (moduleDefinition.file !== "AppSetupModal.html") return source;
  const start = source.indexOf("  function uploadDriveFile(");
  const end = source.indexOf("  function hasNativeUpload(", start);
  if (start < 0 || end < 0) {
    throw new Error(
      "Không tìm thấy hàm uploadDriveFile trong AppSetupModal.html.",
    );
  }
  const gcsUpload = `  function uploadDriveFile(file, folderId, fileName, token) {
    if (!file || !folderId || !token) return Promise.resolve(null);
    const form = new FormData();
    form.append('file', file, sanitizeDriveFileName(fileName || file.name));
    form.append('folderId', folderId);
    form.append('fileName', sanitizeDriveFileName(fileName || file.name));
    return fetch('/api/support-tools/upload', {
      method: 'POST',
      credentials: 'same-origin',
      body: form
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || 'Không tải được file vào GCS.');
      }
      return data;
    });
  }
`;
  return (source.slice(0, start) + gcsUpload + source.slice(end))
    .replaceAll("Drive", "GCS")
    .replaceAll(
      "Tag lưu chung trong sheet 08_Bộ Tag",
      "Tag lưu chung trong bảng shared-tag của PostgreSQL",
    )
    .replaceAll(
      "backend chỉ lưu ID",
      "PostgreSQL chỉ lưu metadata và ID",
    );
}

function styleBlocks(source) {
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => `<style>${match[1]}</style>`)
    .join("\n");
}

const sharedStyles = [
  styleBlocks(readLegacy("AppStyles.html")),
  styleBlocks(readLegacy("UiSharedPrimitives.html")),
  styleBlocks(readLegacy("UiSharedControls.html")),
  styleBlocks(readLegacy("ServiceRuntime.html")),
].join("\n");

const runtime = String.raw`
(function () {
  "use strict";

  var registry = {};
  var activeKey = "";
  var loadingRoot = document.getElementById("legacyParityLoading");
  var loadingText = document.getElementById("legacyParityLoadingText");
  var dialogRoot = document.getElementById("legacyParityDialog");
  var dialogTitle = document.getElementById("legacyParityDialogTitle");
  var dialogMessage = document.getElementById("legacyParityDialogMessage");
  var dialogInput = document.getElementById("legacyParityDialogInput");
  var dialogCancel = document.getElementById("legacyParityDialogCancel");
  var dialogOk = document.getElementById("legacyParityDialogOk");
  var pendingDialog = null;

  function closeDialog(value) {
    if (!pendingDialog) return;
    var resolve = pendingDialog.resolve;
    var mode = pendingDialog.mode;
    pendingDialog = null;
    dialogRoot.classList.remove("is-open");
    dialogRoot.setAttribute("aria-hidden", "true");
    resolve(mode === "prompt" && value === true ? dialogInput.value : value);
  }

  function showDialog(mode, message, options) {
    options = options || {};
    if (pendingDialog) closeDialog(false);
    dialogTitle.textContent = options.title || "Thông báo";
    dialogMessage.textContent = String(message || "");
    dialogInput.hidden = mode !== "prompt";
    dialogInput.value = options.defaultValue || "";
    dialogCancel.hidden = mode === "alert";
    dialogCancel.textContent = options.cancelLabel || "Hủy";
    dialogOk.textContent = options.okLabel || (mode === "alert" ? "Đã hiểu" : "Đồng ý");
    dialogRoot.classList.add("is-open");
    dialogRoot.setAttribute("aria-hidden", "false");
    return new Promise(function (resolve) {
      pendingDialog = { mode: mode, resolve: resolve };
      window.setTimeout(function () {
        (mode === "prompt" ? dialogInput : dialogOk).focus();
      }, 0);
    });
  }

  dialogCancel.addEventListener("click", function () { closeDialog(false); });
  dialogOk.addEventListener("click", function () { closeDialog(true); });
  dialogRoot.addEventListener("click", function (event) {
    if (event.target === dialogRoot && pendingDialog && pendingDialog.mode !== "alert") {
      closeDialog(false);
    }
  });

  window.App = window.App || {};
  App.gas = function (method, payload) {
    return fetch(document.documentElement.dataset.rpcEndpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: method, payload: payload || {} })
    }).then(async function (response) {
      var body = await response.json().catch(function () { return {}; });
      if (!response.ok || !body.ok) {
        throw new Error(body.message || "Không xử lý được yêu cầu.");
      }
      return body.result;
    });
  };
  function createGoogleScriptRunner(successHandler, failureHandler) {
    return new Proxy({}, {
      get: function (_target, property) {
        if (property === "withSuccessHandler") {
          return function (handler) {
            return createGoogleScriptRunner(handler, failureHandler);
          };
        }
        if (property === "withFailureHandler") {
          return function (handler) {
            return createGoogleScriptRunner(successHandler, handler);
          };
        }
        if (property === "withUserObject") {
          return function () {
            return createGoogleScriptRunner(successHandler, failureHandler);
          };
        }
        if (property === "then") return undefined;
        return function () {
          var args = Array.prototype.slice.call(arguments);
          fetch(document.documentElement.dataset.rpcEndpoint, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ method: String(property), args: args })
          })
            .then(async function (response) {
              var body = await response.json().catch(function () { return {}; });
              if (!response.ok || !body.ok) {
                throw new Error(body.message || "Không xử lý được yêu cầu.");
              }
              if (typeof successHandler === "function") successHandler(body.result);
              return body.result;
            })
            .catch(function (error) {
              if (typeof failureHandler === "function") {
                failureHandler(error);
                return;
              }
              console.error("[google.script.run]", property, error);
            });
        };
      }
    });
  }
  window.google = window.google || {};
  google.script = google.script || {};
  google.script.run = createGoogleScriptRunner(null, null);
  App.ui = {
    alert: function (message, options) { return showDialog("alert", message, options); },
    confirm: function (message, options) { return showDialog("confirm", message, options); },
    prompt: function (message, options) { return showDialog("prompt", message, options); },
    showLoading: function (message) {
      loadingText.textContent = message || "Đang xử lý...";
      loadingRoot.classList.add("is-open");
      loadingRoot.setAttribute("aria-hidden", "false");
    },
    showModuleLoading: function (moduleName) {
      this.showLoading("Đang mở " + String(moduleName || "module") + "...");
    },
    showWriteLoading: function (message) {
      this.showLoading(message || "Dữ liệu đang được ghi vào Hệ thống...");
    },
    hideLoading: function () {
      loadingRoot.classList.remove("is-open");
      loadingRoot.setAttribute("aria-hidden", "true");
    }
  };
  App.modals = {
    register: function (key, config) {
      registry[String(key)] = config;
      if (config && config.root) config.root.setAttribute("aria-hidden", "true");
    },
    open: function (key, options) {
      var config = registry[String(key)];
      if (!config || !config.root) return false;
      activeKey = String(key);
      config.root.classList.add("is-open");
      config.root.setAttribute("aria-hidden", "false");
      document.body.classList.add("service-modal-open");
      if (typeof config.onOpen === "function") config.onOpen(options || {});
      return true;
    },
    close: function (key, reason) {
      var modalKey = String(key || activeKey);
      var config = registry[modalKey];
      if (!config || !config.root) return false;
      if (typeof config.canClose === "function" && config.canClose(reason) === false) return false;
      config.root.classList.remove("is-open");
      config.root.setAttribute("aria-hidden", "true");
      document.body.classList.remove("service-modal-open");
      if (typeof config.onClose === "function") config.onClose(reason || "programmatic");
      activeKey = "";
      if (reason !== "switch" && window.parent && window.parent !== window) {
        window.parent.location.assign("/");
      }
      return true;
    },
    closeAll: function (reason) { return this.close(activeKey, reason || "close-all"); },
    isOpen: function (key) { return String(key || "") === activeKey; },
    activeKey: function () { return activeKey; },
    registerDirtyChecker: function () {}
  };
  document.addEventListener("click", function (event) {
    var closeControl = event.target && event.target.closest
      ? event.target.closest("[data-close-service-modal]")
      : null;
    if (!closeControl) return;
    var modalKey = closeControl.getAttribute("data-close-service-modal") || activeKey;
    if (modalKey) App.modals.close(modalKey, "close-control");
  });
  App.lazy = {
    ensureLoaded: function (key) {
      if (key === "candidate-assessment") return Promise.resolve(true);
      if (key === "candidate-results") return Promise.resolve(true);
      return Promise.resolve(true);
    }
  };
  App.storage = {
    list: function () { return Promise.resolve({ data: { drafts: [] } }); },
    clearMany: function () { return Promise.resolve({ ok: true }); }
  };
  App.clientStorage = {
    list: function () {
      var entries = [];
      [["local", window.localStorage], ["session", window.sessionStorage]].forEach(function (pair) {
        var storageName = pair[0];
        var storage = pair[1];
        for (var index = 0; index < storage.length; index += 1) {
          var key = storage.key(index);
          if (!key || !/draft|cache|form|request/i.test(key)) continue;
          var value = storage.getItem(key) || "";
          entries.push({
            bytes: new Blob([value]).size,
            key: key,
            preview: value.slice(0, 120),
            storage: storageName,
            title: key
          });
        }
      });
      return entries;
    },
    clear: function (storageName, key) {
      var storage = storageName === "session" ? window.sessionStorage : window.localStorage;
      storage.removeItem(key);
    }
  };

  window.hcAlert = function (message, options) { return App.ui.alert(message, options); };
  window.hcConfirm = function (message, options) { return App.ui.confirm(message, options); };
  window.openCandidateAssessmentModal = function (options) {
    var params = new URLSearchParams();
    if (options && options.applicationId) params.set("applicationId", options.applicationId);
    if (options && options.roundKey) params.set("roundKey", options.roundKey);
    window.parent.location.href = "/tuyen-dung/danh-gia" + (params.toString() ? "?" + params : "");
  };
  window.openCandidateResultsModal = function () {
    window.parent.location.href = "/tuyen-dung/ket-qua";
  };
})();
`;

const standaloneStyles = `
<style>
  html, body { width: 100%; min-height: 100%; margin: 0; overflow: hidden; background: #f2f1ec; }
  body { font-family: "Be Vietnam Pro", Arial, sans-serif; }
  .legacy-parity-loading,
  .legacy-parity-dialog {
    position: fixed;
    inset: 0;
    z-index: 20050;
    display: none;
    place-items: center;
    padding: 20px;
    background: rgba(8, 30, 26, .52);
    backdrop-filter: blur(5px);
  }
  .legacy-parity-loading.is-open,
  .legacy-parity-dialog.is-open { display: grid; }
  .legacy-parity-loading-card,
  .legacy-parity-dialog-card {
    width: min(430px, calc(100vw - 32px));
    border: 1px solid rgba(17, 76, 65, .13);
    border-radius: 10px;
    background: #fff;
    color: #173f37;
    box-shadow: 0 24px 70px rgba(8, 30, 26, .28);
  }
  .legacy-parity-loading-card {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 12px;
    align-items: center;
    padding: 18px 20px;
    font-size: .82rem;
  }
  .legacy-parity-spinner {
    width: 28px;
    height: 28px;
    border: 3px solid rgba(234, 108, 45, .22);
    border-top-color: #ea6c2d;
    border-radius: 50%;
    animation: legacy-parity-spin .75s linear infinite;
  }
  .legacy-parity-dialog-card { padding: 20px; }
  .legacy-parity-dialog-card h3 { margin: 0; font-size: 1rem; }
  .legacy-parity-dialog-card p {
    margin: 9px 0 0;
    color: #5e746e;
    font-size: .82rem;
    line-height: 1.55;
    white-space: pre-line;
  }
  .legacy-parity-dialog-card input {
    width: 100%;
    min-height: 42px;
    margin-top: 14px;
    padding: 0 11px;
    border: 1px solid rgba(17, 76, 65, .18);
    border-radius: 8px;
    font: inherit;
  }
  .legacy-parity-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
  .legacy-parity-dialog-actions button {
    min-height: 40px;
    padding: 0 15px;
    border: 1px solid rgba(17, 76, 65, .15);
    border-radius: 8px;
    background: #fff;
    color: #114c41;
    font: 800 .78rem/1 "Be Vietnam Pro", Arial, sans-serif;
    cursor: pointer;
  }
  .legacy-parity-dialog-actions .is-primary {
    border-color: #ea6c2d;
    background: #ea6c2d;
    color: #fff;
  }
  [data-rhm-view="offers"],
  [data-preset="offer"],
  [data-preset="hired"] { opacity: .48; }
  @keyframes legacy-parity-spin { to { transform: rotate(360deg); } }
</style>`;

const inboxStandaloneStyles = `
<style>
  html, body {
    width: 100%;
    min-height: 100%;
    margin: 0;
    overflow: auto;
    background: #f2f1ec;
    font-family: "Be Vietnam Pro", Arial, sans-serif;
  }
  :is(#pg-inbox-me, #pg-inbox) .modal-head > div:first-child {
    min-width: 0;
  }
  :is(#pg-inbox-me, #pg-inbox) .modal-sub {
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  body { padding: 8px 0 28px; }
  .inbox-parity-back {
    position: fixed;
    top: 14px;
    right: 16px;
    z-index: 80;
    display: inline-grid;
    width: 42px;
    height: 42px;
    place-items: center;
    border: 1px solid rgba(17, 76, 65, .14);
    border-radius: 999px;
    background: rgba(255, 255, 255, .96);
    color: #114c41;
    box-shadow: 0 12px 30px rgba(8, 30, 26, .14);
    font: 900 21px/1 Arial, sans-serif;
    cursor: pointer;
  }
  .inbox-parity-back:hover {
    border-color: rgba(234, 108, 45, .34);
    color: #ea6c2d;
  }
  #pg-inbox-me.workspace-mounted,
  #pg-inbox.workspace-mounted {
    min-height: calc(100vh - 36px);
  }
  :is(#pg-inbox-me, #pg-inbox) .ticketDocumentSummary {
    display: grid;
    gap: 8px;
    margin-top: 2px;
    padding: 11px 13px;
    border: 1px solid rgba(17, 76, 65, .1);
    border-radius: 12px;
    background: rgba(241, 247, 244, .82);
  }
  :is(#pg-inbox-me, #pg-inbox) .ticketDocumentCount {
    color: #114c41;
    font-size: 13px;
    font-weight: 750;
  }
  :is(#pg-inbox-me, #pg-inbox) .ticketDocumentCount strong {
    color: #ea6c2d;
    font-size: 16px;
    font-weight: 950;
  }
  :is(#pg-inbox-me, #pg-inbox) .ticketDocumentSummary ul {
    display: grid;
    gap: 5px;
    margin: 0;
    padding-left: 21px;
    color: rgba(17, 76, 65, .88);
    font-size: 12.5px;
    line-height: 1.45;
  }
  :is(#pg-inbox-me, #pg-inbox) .ticketDocumentSummary li {
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  :is(#pg-inbox-me, #pg-inbox) .ticketDocumentMore {
    color: rgba(17, 76, 65, .68);
    font-style: italic;
  }
  @media (max-width: 720px) {
    body { padding-top: 2px; }
    .inbox-parity-back {
      top: 10px;
      right: 10px;
      width: 38px;
      height: 38px;
    }
  }
</style>`;

const modules = [
  {
    file: "AccountingConfigModal.html",
    output: "accounting-config.html",
    title: "Cấu hình Báo cáo Kế toán",
    endpoint: "/api/accounting/rpc",
    open: "openAccountingConfigModal",
  },
  {
    file: "CandidateManagementModal.html",
    output: "recruitment-management.html",
    title: "Quản lý Ứng viên",
    endpoint: "/api/recruitment/rpc",
    open: "openCandidateManagementModal",
    recruitmentLock: true,
  },
  {
    file: "CandidateAssessmentModal.html",
    output: "recruitment-assessment.html",
    title: "Đánh giá Ứng viên",
    endpoint: "/api/recruitment/rpc",
    open: "openCandidateAssessmentModal",
  },
  {
    file: "CandidateResultsModal.html",
    output: "recruitment-results.html",
    title: "Kết quả Ứng viên",
    endpoint: "/api/recruitment/rpc",
    open: "openCandidateResultsModal",
  },
  {
    file: "EvaluationConfigModal.html",
    output: "evaluation-config.html",
    title: "Cấu hình Đánh giá",
    endpoint: "/api/evaluation/rpc",
    open: "openEvaluationConfigModal",
  },
  {
    file: "EvaluationModal.html",
    output: "evaluation.html",
    title: "Đánh giá Nhân sự",
    endpoint: "/api/evaluation/rpc",
    open: "openEvaluationModal",
  },
  {
    file: "AppSetupModal.html",
    output: "app-setup.html",
    title: "Setup ứng dụng",
    endpoint: "/api/support-tools/rpc",
    open: "openAppSetupModal",
  },
  {
    file: "SupportToolsModal.html",
    output: "support-tools.html",
    title: "Công cụ hỗ trợ",
    endpoint: "/api/support-tools/rpc",
    open: "openSupportToolsModal",
  },
  {
    file: "AssetSetupModal.html",
    output: "asset-setup.html",
    title: "Setup tài sản",
    endpoint: "/api/assets/rpc",
    open: "openAssetSetupModal",
  },
  {
    file: "ReconciliationModal.html",
    output: "reconciliation.html",
    title: "Đối soát",
    endpoint: "/api/reconciliation/rpc",
    open: "openReconciliationModal",
  },
  {
    archiveArea: "Phan-xuong",
    endpoint: "/api/workshop/rpc",
    file: "WorkshopConfigModal.html",
    open: "openWorkshopConfigModal",
    output: "workshop-config.html",
    title: "Cấu hình Xưởng",
  },
  {
    archiveArea: "Admin-Kho",
    endpoint: "/api/workshop/rpc",
    file: "WorkshopOrderModal.html",
    open: "openWorkshopOrderModal",
    output: "workshop-order.html",
    title: "Đặt hàng Xưởng",
  },
  {
    archiveArea: "Phan-xuong",
    endpoint: "/api/workshop/rpc",
    file: "WorkshopAllocationModal.html",
    open: "openWorkshopAllocationModal",
    output: "workshop-allocation.html",
    title: "Kế hoạch Xưởng",
  },
  {
    archiveArea: "Phan-xuong",
    endpoint: "/api/workshop/rpc",
    file: "WorkshopPlanModal.html",
    open: "openWorkshopPlanModal",
    output: "workshop-plan.html",
    title: "Phân bổ thủ công",
  },
  {
    archiveArea: "Phan-xuong",
    endpoint: "/api/workshop/rpc",
    file: "WorkshopPlanApprovalModal.html",
    open: "openWorkshopPlanApprovalModal",
    output: "workshop-plan-approval.html",
    title: "Duyệt KH Xưởng",
  },
  {
    archiveArea: "Phan-xuong",
    endpoint: "/api/workshop/rpc",
    file: "WorkshopProposalModal.html",
    open: "openWorkshopProposalModal",
    output: "workshop-proposal.html",
    title: "Đề xuất Xưởng",
  },
  {
    archiveArea: "Phan-xuong",
    endpoint: "/api/workshop/rpc",
    file: "WorkshopReportModal.html",
    open: "openWorkshopReportModal",
    output: "workshop-report.html",
    title: "Báo cáo Xưởng",
  },
  {
    archiveArea: "Phan-xuong",
    endpoint: "/api/workshop/rpc",
    file: "WorkshopInventoryModal.html",
    open: "openWorkshopInventoryModal",
    output: "workshop-inventory.html",
    title: "Kiểm kê Xưởng",
  },
];

function lockRecruitmentOffer() {
  return `
  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest
      ? event.target.closest('[data-rhm-view="offers"], [data-preset="offer"], [data-preset="hired"], [data-action*="offer"]')
      : null;
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    App.ui.alert("Luồng Offer và nhận việc đang tạm khóa theo yêu cầu. Các phần Tuyển dụng còn lại vẫn hoạt động bình thường.", {
      title: "Chức năng đang tạm khóa"
    });
  }, true);`;
}

function pageFor(moduleDefinition) {
  const moduleSource = transformModuleSource(
    repairKnownLegacyEncoding(readModuleSource(moduleDefinition)),
    moduleDefinition,
  );
  return `<!doctype html>
<html lang="vi" data-rpc-endpoint="${moduleDefinition.endpoint}">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#114c41">
    <title>${moduleDefinition.title} · Thuận Việt</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&family=Montserrat:wght@600;700;800&display=swap" rel="stylesheet">
    ${sharedStyles}
    ${standaloneStyles}
  </head>
  <body>
    <div id="legacyParityLoading" class="legacy-parity-loading" aria-hidden="true">
      <div class="legacy-parity-loading-card" role="status">
        <span class="legacy-parity-spinner" aria-hidden="true"></span>
        <strong id="legacyParityLoadingText">Đang xử lý...</strong>
      </div>
    </div>
    <div id="legacyParityDialog" class="legacy-parity-dialog" aria-hidden="true">
      <section class="legacy-parity-dialog-card" role="alertdialog" aria-modal="true" aria-labelledby="legacyParityDialogTitle">
        <h3 id="legacyParityDialogTitle">Thông báo</h3>
        <p id="legacyParityDialogMessage"></p>
        <input id="legacyParityDialogInput" type="text" hidden>
        <div class="legacy-parity-dialog-actions">
          <button id="legacyParityDialogCancel" type="button">Hủy</button>
          <button id="legacyParityDialogOk" class="is-primary" type="button">Đồng ý</button>
        </div>
      </section>
    </div>
    <script>${runtime}</script>
    ${moduleSource}
    <script>
      ${moduleDefinition.recruitmentLock ? lockRecruitmentOffer() : ""}
      window.addEventListener("DOMContentLoaded", function () {
        var params = Object.fromEntries(new URLSearchParams(window.location.search));
        if (typeof window.${moduleDefinition.open} === "function") window.${moduleDefinition.open}(params);
      });
    </script>
  </body>
</html>`;
}

function hardenInboxDetailOpen(moduleSource, definition) {
  const admin = definition.rootId === "pg-inbox";
  const functionName = admin ? "openDetailById(maDonDv)" : "openDetailById(id)";
  const lookupValue = admin ? "maDonDv" : "id";
  const modalId = admin ? "detailModal" : "detailModalMe";
  const titleId = admin ? "detailTitle" : "detailTitleMe";
  const subId = admin ? "detailSub" : "detailSubMe";
  const creatorId = admin ? "d_creator" : "d_creatorMe";
  const createdId = admin ? "d_created" : "d_createdMe";
  const stageId = admin ? "d_stage" : "d_stageMe";
  const dueId = admin ? "d_due" : "d_dueMe";
  const tagsId = admin ? "detailTags" : "detailTagsMe";
  const scope = admin ? "InboxAdmin" : "InboxMe";
  const pattern = admin
    ? /function openDetailById\(maDonDv\)\{[\s\S]*?\r?\n  \}\r?\n\r?\n  function getTicketByRequestId/
    : /function openDetailById\(id\)\{[\s\S]*?\r?\n  \}\r?\n\r?\nfunction loadServiceNameMap/;
  const nextMarker = admin
    ? "  function getTicketByRequestId"
    : "function loadServiceNameMap";
  const replacement = `function ${functionName}{
    const t = state.byId.get(${lookupValue});
    if(!t) return;
    try {
      ensureTicketJson(t);
      setDetail(t);
      openModal('${modalId}');
    } catch (error) {
      console.error('[${scope}] detail render failed:', error);
      try {
        state.current = t;
        const json = ensureTicketJson(t);
        const emp = json && typeof json.employee === 'object' ? json.employee : {};
        const rid = t.maDonDv || json.requestId || '';
        const setText = function(elementId, value){
          const element = $(elementId);
          if (element) element.textContent = String(value || '-');
        };
        setText('${titleId}', getTicketDocumentName(t) || t.title || 'Chi tiết đơn');
        setText('${subId}', rid ? ('#' + rid) : '-');
        setText('${creatorId}', t.nguoiTao || emp.name || '-');
        setText('${createdId}', t.ngayTao || t.createdAt || json.createdAt || '-');
        setText('${stageId}', t.trangThai || json.stage || '-');
        setText('${dueId}', t.dueAt || json.dueAt || '-');
        const detailTags = $('${tagsId}');
        if (detailTags) {
          detailTags.innerHTML =
            '<div class="detailTag detailTag--stamp">' +
              '<div class="detailTagLabel">Dữ liệu hồ sơ</div>' +
              '<div class="detailTagValue">Đã mở chế độ an toàn. Bấm “Xem JSON” để xem toàn bộ dữ liệu gốc.</div>' +
            '</div>';
        }
        openModal('${modalId}');
      } catch (fallbackError) {
        console.error('[${scope}] safe detail fallback failed:', fallbackError);
        hcAlert('Không dựng được chi tiết đơn này. Tải lại trang rồi thử lại giúp tui nha ông.', {
          title: 'Lỗi mở chi tiết đơn'
        });
      }
      try {
        if (window.App && typeof App.gas === 'function') {
          App.gas('reportInboxClientError', {
            message: error && error.message ? String(error.message) : String(error || ''),
            requestId: t && t.maDonDv ? String(t.maDonDv) : '',
            scope: '${scope}',
            stack: error && error.stack ? String(error.stack).slice(0, 4000) : ''
          }).catch(function(){});
        }
      } catch (_) {}
    }
  }

${nextMarker}`;
  const hardened = moduleSource.replace(pattern, replacement);
  if (hardened === moduleSource) {
    throw new Error(`Không gắn được lớp bảo vệ chi tiết cho ${definition.file}.`);
  }
  return hardened;
}

function hardenInboxSearchAutofill(moduleSource, definition) {
  const admin = definition.rootId === "pg-inbox";
  const inputId = admin ? "txtSearch" : "txtSearchMe";
  const inputPattern = new RegExp(`<input\\s+id="${inputId}"([^>]*)>`);
  const hardened = moduleSource.replace(
    inputPattern,
    function (_match, attributes) {
      const normalizedAttributes = String(attributes || "").replace(
        /\s*\/\s*$/,
        "",
      );
      return `<input id="${inputId}"${normalizedAttributes} type="search" name="thuan-viet-${admin ? "admin" : "my"}-orders-search" autocomplete="one-time-code" autocapitalize="off" autocorrect="off" spellcheck="false" readonly aria-autocomplete="none" data-form-type="other" data-lpignore="true" data-1p-ignore="true" data-bwignore="true">`;
    },
  );
  if (hardened === moduleSource) {
    throw new Error(
      `Không gắn được lớp chống autofill cho ô ${inputId} trong ${definition.file}.`,
    );
  }
  return hardened;
}

function transformInboxElectronicSignatureUpload(moduleSource, definition) {
  if (definition.rootId !== "pg-inbox") return moduleSource;
  const startMarker =
    "    Promise.all(selected.filter((selection)=> !!selection.file).map((selection)=>";
  const endMarker = "      .then((response)=>{";
  const start = moduleSource.indexOf(startMarker);
  const end = moduleSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(
      "Không tìm thấy luồng upload file hoàn thành ký điện tử trong inboxAdmin.html.",
    );
  }
  const multipartUpload = `    selected.filter((selection)=> !!selection.file).reduce((chain, selection)=>
      chain.then(async (aggregate)=>{
        const form = new FormData();
        form.append('requestId', completion.requestId);
        form.append('itemIndex', String(selection.entry.itemIndex));
        form.append('kind', 'output');
        form.append('file', selection.file, selection.file.name);
        const httpResponse = await fetch('/api/requests/electronic-signature', {
          method: 'POST',
          credentials: 'same-origin',
          body: form
        });
        const response = await httpResponse.json().catch(()=> ({}));
        if (!httpResponse.ok || !response.ok) {
          throw new Error(response.message || 'Không đính được file Hành chính đã ký.');
        }
        return {
          ticketPayload: response.ticketPayload || aggregate.ticketPayload,
          deleteWarnings: (aggregate.deleteWarnings || []).concat(response.cleanupWarnings || [])
        };
      }),
      Promise.resolve({
        ticketPayload: completion.ticket && completion.ticket.json ? completion.ticket.json : {},
        deleteWarnings: []
      })
    )
`;
  return (
    moduleSource.slice(0, start) +
    multipartUpload +
    moduleSource.slice(end)
  );
}

function transformInboxMultiItemCards(moduleSource, definition) {
  const oldPayloadReader = `    function getInboxTicketPayloadItems(ticket, json){
      json = json || ensureTicketJson(ticket);
      var raw = json.payload;
      if (raw == null) raw = json.rows;
      if (raw == null) raw = json.items;
      if (raw == null) raw = ticket && ticket.payload;
      return normalizePayloadItems(raw);
    }`;
  const newPayloadReader = `    function getInboxTicketPayloadItems(ticket, json){
      json = json || ensureTicketJson(ticket);

      function visit(value, depth){
        if (depth > 4 || value == null) return [];
        if (typeof value === 'string'){
          try{ return visit(JSON.parse(value), depth + 1); }catch(_){ return []; }
        }
        if (Array.isArray(value)) return value.filter(isPlainObject);
        if (!isPlainObject(value)) return [];

        var keys = ['items', 'rows', 'payload', 'payload0'];
        for (var index = 0; index < keys.length; index++){
          var key = keys[index];
          if (!(key in value)) continue;
          var nested = visit(value[key], depth + 1);
          if (nested.length) return nested;
          if (Array.isArray(value[key])) return [];
        }
        return depth > 0 ? [value] : [];
      }

      var items = visit(json, 0);
      if (!items.length && ticket && ticket.payload != null){
        items = visit(ticket.payload, 0);
      }
      return items.length ? items : (isPlainObject(json) ? [json] : []);
    }`;
  let transformed = moduleSource;
  if (definition.rootId === "shared") {
    transformed = transformed.replace(oldPayloadReader, newPayloadReader);
    if (transformed === moduleSource) {
      throw new Error(
        `Không nâng được bộ đọc hồ sơ nhiều dòng cho ${definition.file}.`,
      );
    }

    transformed = transformed.replace(
      "var rows = normalizePayloadItems(payload && (payload.payload || payload.rows));",
      "var rows = getInboxTicketPayloadItems(t, payload);",
    );

    const payloadTitleMarker =
      "        var title = pick(it, ['documentTypeName','loai','type','types','title','name']) || ('Dòng ' + (idx + 1));";
    const payloadTitleReplacement = `        var mappedDocumentTitle = Array.isArray(options.documentNames)
          ? compactNameText(options.documentNames[idx])
          : '';
        var title = mappedDocumentTitle ||
          pick(it, ['documentTypeName','loai','type','types','title','name']) ||
          (isAssetAllocationService(serviceCode)
            ? buildAssetAllocationInboxName(it, options.ticket || null, options.ticketJson || {})
            : '') ||
          ('Dòng ' + (idx + 1));`;
    if (!transformed.includes(payloadTitleMarker)) {
      throw new Error(
        `Không tìm thấy tiêu đề dòng chi tiết để ánh xạ hồ sơ cho ${definition.file}.`,
      );
    }
    transformed = transformed.replace(
      payloadTitleMarker,
      payloadTitleReplacement,
    );

    // `isS13` appears in more than one shared helper. Anchor the insertion to
    // `renderPayloadList` by including its next declaration; otherwise a plain
    // String.replace() patches the earlier document-name helper and leaves the
    // detail renderer with an undefined `isAssetAllocation` variable.
    const allocationReceiptSetupMarker = `      var isS13 = isSendMailService(serviceCode);
      var compactSealReviewRequested = !!options.compactSealReview;`;
    const allocationReceiptSetupReplacement = `      var isS13 = isSendMailService(serviceCode);
      var isAssetAllocation = isAssetAllocationService(serviceCode);
      var compactSealReviewRequested = !!options.compactSealReview;`;
    if (!transformed.includes(allocationReceiptSetupMarker)) {
      throw new Error(
        `Không tìm thấy điểm gắn trạng thái nhận cấp phát cho ${definition.file}.`,
      );
    }
    transformed = transformed.replace(
      allocationReceiptSetupMarker,
      allocationReceiptSetupReplacement,
    );

    const allocationReceiptChipMarker = "        var heroChips = [];";
    const allocationReceiptChipReplacement = `${allocationReceiptChipMarker}
        var recipientReceipt = (it.recipientReceipt && typeof it.recipientReceipt === 'object') ? it.recipientReceipt : {};
        var recipientReceiptStatus = String(recipientReceipt.status || it.recipientReceiptStatus || '').trim().toUpperCase();
        var recipientHasReceived = recipientReceiptStatus === 'RECEIVED' || recipientReceiptStatus === 'CONFIRMED';`;
    if (!transformed.includes(allocationReceiptChipMarker)) {
      throw new Error(
        `Không tìm thấy chip chi tiết để gắn trạng thái nhận cấp phát cho ${definition.file}.`,
      );
    }
    transformed = transformed.replace(
      allocationReceiptChipMarker,
      allocationReceiptChipReplacement,
    );

    const allocationReceiptHeroMarker =
      "          if (urgent) heroChips.push('<span class=\"chip chip-urgent\">Khẩn</span>');";
    const allocationReceiptHeroReplacement = `${allocationReceiptHeroMarker}
          if (isAssetAllocation) {
            heroChips.push('<span class="chip ' + (recipientHasReceived ? 'chip-done' : 'chip-pending') + '">' + (recipientHasReceived ? '✓ Người nhận đã nhận' : 'Chờ người nhận xác nhận') + '</span>');
          }`;
    if (!transformed.includes(allocationReceiptHeroMarker)) {
      throw new Error(
        `Không tìm thấy danh sách chip để hiển thị trạng thái nhận cấp phát cho ${definition.file}.`,
      );
    }
    transformed = transformed.replace(
      allocationReceiptHeroMarker,
      allocationReceiptHeroReplacement,
    );

    const allocationReceiptFactMarker =
      "          makeFactItem('Người', person),";
    const allocationReceiptFactReplacement = `${allocationReceiptFactMarker}
          isAssetAllocation && recipientHasReceived ? makeFactItem('Người xác nhận', recipientReceipt.confirmedByName || it.recipientReceivedBy) : '',
          isAssetAllocation && recipientHasReceived ? makeFactItem('Đã nhận lúc', fmtISO(recipientReceipt.confirmedAt || it.recipientReceivedAt)) : '',`;
    if (!transformed.includes(allocationReceiptFactMarker)) {
      throw new Error(
        `Không tìm thấy thuộc tính người nhận để gắn lịch sử cấp phát cho ${definition.file}.`,
      );
    }
    transformed = transformed.replace(
      allocationReceiptFactMarker,
      allocationReceiptFactReplacement,
    );

  const listMarker = "    function isLegacyPayload(items){";
  const listHelper = `    function getInboxDocumentList(ticket, opts){
      opts = opts || {};
      ticket = ticket || {};
      var json = ensureTicketJson(ticket);
      var serviceCode = opts.serviceCode || ticket.maHeThong || ticket.serviceCode || (json && json.serviceCode) || '';
      var requestId = compactNameText(opts.requestId || ticket.maDonDv || ticket.maDon || ticket.id || (json && json.requestId));
      var items = getInboxTicketPayloadItems(ticket, json);
      if (!items.length){
        var fallback = getInboxDocumentName(ticket, opts);
        return fallback ? [fallback] : [];
      }

      return items.map(function(row, index){
        row = row || {};
        var name = pickName(row, [
          'storageGeneratedName','generatedName','tenHoSoGoiY','documentName','tenHoSo','hoso','hoSo','name','title'
        ]);
        if (!name && isDongDauService(serviceCode)) {
          name = buildSealInboxName(row);
        } else if (!name && isArchiveService(serviceCode)) {
          name = buildArchiveStyleInboxName(row);
        } else if (!name && isCapGiayService(serviceCode)) {
          name = buildCapGiayInboxName(row, ticket, json);
        } else if (!name && isAssetAllocationService(serviceCode)) {
          name = buildAssetAllocationInboxName(row, ticket, json);
        } else if (!name && isRepairService(serviceCode)) {
          name = buildRepairInboxName(row, ticket, json);
        } else if (!name && isBusinessTripService(serviceCode)) {
          name = buildTripInboxName(row, ticket, json);
        } else if (!name && isSupportService(serviceCode)) {
          name = buildSupportInboxName(row, ticket, json);
        }
        return compactNameText(name) || ('Hồ sơ ' + String(index + 1) + (requestId ? (' · ' + requestId) : ''));
      });
    }

`;
    if (!transformed.includes(listMarker)) {
      throw new Error(`Không tìm thấy vị trí gắn danh sách hồ sơ cho ${definition.file}.`);
    }
    transformed = transformed.replace(listMarker, listHelper + listMarker);

    const listExportMarker = "      getInboxDocumentName: getInboxDocumentName,";
    if (!transformed.includes(listExportMarker)) {
      throw new Error(
        `Không tìm thấy vị trí công khai danh sách hồ sơ cho ${definition.file}.`,
      );
    }
    return transformed.replace(
      listExportMarker,
      `${listExportMarker}\n      getInboxDocumentList: getInboxDocumentList,`,
    );
  }

  if (definition.rootId === "pg-inbox") {
    const assetDetailSetupMarker =
      "  const isArchive = isArchiveService(serviceCode);";
    const assetDetailSetupReplacement = `${assetDetailSetupMarker}
  const isAssetAllocation = String(serviceCode || '').toUpperCase().includes('CAP_PHAT');`;
    if (!transformed.includes(assetDetailSetupMarker)) {
      throw new Error(
        `Không tìm thấy điểm nhận diện chi tiết cấp phát trong ${definition.file}.`,
      );
    }
    transformed = transformed.replace(
      assetDetailSetupMarker,
      assetDetailSetupReplacement,
    );
    transformed = transformed.replace(
      "  const useRichDetail = isSeal || isArchive || items.length > 1;",
      "  const useRichDetail = isSeal || isArchive || isAssetAllocation || items.length > 1;",
    );
    transformed = transformed.replace(
      "    hint.textContent = isSeal ? 'Tên hồ sơ và thông tin duyệt chính' : (useRichDetail ? 'Chi tiết từng mục của hồ sơ' : 'Các tag chính của hồ sơ');",
      "    hint.textContent = isSeal ? 'Tên hồ sơ và thông tin duyệt chính' : (isAssetAllocation ? 'Danh sách nhân sự và hạng mục đăng ký' : (useRichDetail ? 'Chi tiết từng mục của hồ sơ' : 'Các tag chính của hồ sơ'));",
    );
    const assetDetailOptionsMarker =
      "      archiveFulfillmentDisabled: syncDisabled";
    const assetDetailOptionsReplacement = `${assetDetailOptionsMarker},
      documentNames: InboxSharedUtil.getInboxDocumentList
        ? InboxSharedUtil.getInboxDocumentList(state.current || { json: json }, { serviceCode: serviceCode, requestId: requestId })
        : [],
      ticket: state.current || null,
      ticketJson: json`;
    if (!transformed.includes(assetDetailOptionsMarker)) {
      throw new Error(
        `Không tìm thấy tùy chọn render chi tiết để gắn tên hồ sơ cho ${definition.file}.`,
      );
    }
    transformed = transformed.replace(
      assetDetailOptionsMarker,
      assetDetailOptionsReplacement,
    );
  }

  const cardsStart = transformed.indexOf("      const cardsHtml = arr.map(t=>{");
  const cardsEnd = transformed.indexOf("      }).join('');", cardsStart);
  if (cardsStart < 0 || cardsEnd < 0) {
    throw new Error(`Không tìm thấy khối thẻ đơn hàng trong ${definition.file}.`);
  }
  let cards = transformed.slice(cardsStart, cardsEnd + "      }).join('');".length);
  cards = cards.replace(
    "        const documentName = getTicketDocumentName(t);",
    `        const documentName = getTicketDocumentName(t);
        const documentNames = InboxSharedUtil.getInboxDocumentList
          ? InboxSharedUtil.getInboxDocumentList(t, { serviceCode: svc, requestId: id })
          : (documentName ? [documentName] : []);
        const documentCount = documentNames.length || 1;
        const documentPreviewNames = documentNames.slice(0, 6);`,
  );

  if (definition.rootId === "pg-inbox") {
    cards = cards.replace(
      '<div class="ticketCardId">${esc(documentName)}</div>',
      '<div class="ticketCardId">${esc(creator)} - ${esc(InboxSharedUtil.formatInboxDateOnly ? InboxSharedUtil.formatInboxDateOnly(created) : fmtISO(created))}</div>',
    );
    cards = cards.replace(
      '                <span>Người tạo: ${esc(creator)}</span>\n',
      "",
    );
    cards = cards.replace(
      '                <span>Ngày tạo: ${esc(fmtISO(created))}</span>\n',
      "",
    );
  }

  const summaryHtml = `              <div class="ticketDocumentSummary">
                <div class="ticketDocumentCount"><strong>\${documentCount}</strong> hồ sơ đăng ký</div>
                <ul>
                  \${documentPreviewNames.map(function(name){ return '<li>' + esc(name) + '</li>'; }).join('')}
                  \${documentCount > documentPreviewNames.length ? ('<li class="ticketDocumentMore">Còn ' + String(documentCount - documentPreviewNames.length) + ' hồ sơ khác · mở chi tiết để xem</li>') : ''}
                </ul>
              </div>
`;
  const asideMarker = /            <\/div>\r?\n            <div class="ticketAside">/;
  if (!asideMarker.test(cards)) {
    throw new Error(`Không tìm thấy vị trí gắn tóm tắt hồ sơ cho ${definition.file}.`);
  }
  cards = cards.replace(
    asideMarker,
    summaryHtml + '            </div>\n            <div class="ticketAside">',
  );

  return transformed.slice(0, cardsStart) + cards + transformed.slice(cardsEnd + "      }).join('');".length);
}

function transformInboxAllocationReceipt(moduleSource, definition) {
  if (definition.rootId !== "pg-inbox-me") return moduleSource;
  let transformed = moduleSource;

  const styleMarker = "</style>";
  const receiptStyles = `
  #pg-inbox-me .allocationReceiptPanel{
    margin:0 22px 18px;
    padding:16px 18px;
    border:1px solid rgba(17,76,65,.14);
    border-radius:18px;
    background:linear-gradient(135deg,rgba(231,246,240,.94),rgba(255,250,246,.96));
  }
  #pg-inbox-me .allocationReceiptHead{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;}
  #pg-inbox-me .allocationReceiptTitle{font-size:17px;font-weight:900;color:var(--accent-deep,#114c41);}
  #pg-inbox-me .allocationReceiptSub{margin-top:5px;color:rgba(18,24,38,.64);line-height:1.5;}
  #pg-inbox-me .allocationReceiptList{display:grid;gap:8px;margin-top:12px;}
  #pg-inbox-me .allocationReceiptItem{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid rgba(17,76,65,.1);border-radius:13px;background:rgba(255,255,255,.78);}
  #pg-inbox-me .allocationReceiptItem strong{display:block;color:rgba(18,24,38,.9);}
  #pg-inbox-me .allocationReceiptMeta{margin-top:3px;font-size:12px;color:rgba(18,24,38,.58);}
  #pg-inbox-me .allocationReceiptStatus{flex:none;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:900;background:rgba(234,108,45,.11);color:#a94b1b;}
  #pg-inbox-me .allocationReceiptStatus.is-received{background:rgba(31,157,111,.13);color:#12704e;}
  @media(max-width:640px){#pg-inbox-me .allocationReceiptPanel{margin:0 14px 14px;}#pg-inbox-me .allocationReceiptItem{align-items:flex-start;flex-direction:column;}}
`;
  if (!transformed.includes(styleMarker)) {
    throw new Error(`Không tìm thấy style của ${definition.file}.`);
  }
  transformed = transformed.replace(styleMarker, receiptStyles + styleMarker);

  const actionsMarker = `      <div class="modal-actions">
        <button class="btn ghost" id="btnJsonMe">Xem JSON</button>`;
  const actionsReplacement = `      <section class="allocationReceiptPanel" id="allocationReceiptPanelMe" style="display:none;" aria-live="polite">
        <div class="allocationReceiptHead">
          <div>
            <div class="allocationReceiptTitle">Xác nhận cấp phát</div>
            <div class="allocationReceiptSub" id="allocationReceiptSubMe">Kiểm tra đúng hàng hóa của bạn trước khi xác nhận.</div>
          </div>
        </div>
        <div class="allocationReceiptList" id="allocationReceiptListMe"></div>
      </section>

      <div class="modal-actions">
        <button class="btn primary" id="btnConfirmAllocationReceiptMe" style="display:none;">Đã nhận</button>
        <button class="btn ghost" id="btnJsonMe">Xem JSON</button>`;
  if (!transformed.includes(actionsMarker)) {
    throw new Error(`Không tìm thấy khu vực nút chi tiết trong ${definition.file}.`);
  }
  transformed = transformed.replace(actionsMarker, actionsReplacement);

  const setDetailMarker = "  function setDetail(ticket){";
  const receiptRenderer = `  function renderAllocationReceiptMe(ticket){
    const panel = $('allocationReceiptPanelMe');
    const listEl = $('allocationReceiptListMe');
    const subEl = $('allocationReceiptSubMe');
    const button = $('btnConfirmAllocationReceiptMe');
    const view = ticket && ticket.allocationReceipt;
    if (!panel || !listEl || !button) return;
    const rows = view && Array.isArray(view.items) ? view.items : [];
    if (!view || !view.recipient || !rows.length) {
      panel.style.display = 'none';
      button.style.display = 'none';
      button.disabled = true;
      listEl.innerHTML = '';
      return;
    }
    panel.style.display = '';
    if (subEl) {
      subEl.textContent = view.pendingCount > 0 && view.canConfirm
        ? 'Bạn còn ' + String(view.pendingCount) + ' mục chưa xác nhận. Chỉ bấm sau khi đã nhận hàng thực tế.'
        : view.pendingCount > 0
          ? 'Đề xuất đang được xử lý. Nút xác nhận sẽ mở sau khi hoàn tất cấp phát.'
        : 'Bạn đã xác nhận đủ ' + String(view.totalCount) + ' mục cấp phát trong đơn này.';
    }
    listEl.innerHTML = rows.map(function(row){
      const received = row.status === 'RECEIVED';
      const detail = [row.category, row.description, 'SL ' + (row.quantity || '1')].filter(Boolean).join(' · ');
      const confirmed = received && row.confirmedAt
        ? (' · ' + (row.confirmedByName || 'Bạn') + ' · ' + fmtISO(row.confirmedAt))
        : '';
      return '<div class="allocationReceiptItem">' +
        '<div><strong>' + esc(row.itemName || 'Hàng hóa cấp phát') + '</strong><div class="allocationReceiptMeta">' + esc(detail + confirmed) + '</div></div>' +
        '<span class="allocationReceiptStatus' + (received ? ' is-received' : '') + '">' + (received ? '✓ Đã nhận' : 'Chưa nhận') + '</span>' +
      '</div>';
    }).join('');
    button.style.display = view.pendingCount > 0 && view.canConfirm ? '' : 'none';
    button.disabled = view.pendingCount < 1 || !view.canConfirm;
    button.textContent = view.pendingCount > 1 ? ('Đã nhận ' + String(view.pendingCount) + ' mục') : 'Đã nhận';
  }

`;
  if (!transformed.includes(setDetailMarker)) {
    throw new Error(`Không tìm thấy hàm dựng chi tiết trong ${definition.file}.`);
  }
  transformed = transformed.replace(setDetailMarker, receiptRenderer + setDetailMarker);

  const payloadRenderMarker = "    setPayloadMe(json, serviceCode, rid);";
  if (!transformed.includes(payloadRenderMarker)) {
    throw new Error(`Không tìm thấy điểm dựng payload trong ${definition.file}.`);
  }
  transformed = transformed.replace(
    payloadRenderMarker,
    payloadRenderMarker + "\n    renderAllocationReceiptMe(ticket);",
  );

  const actionFunctionMarker = "  async function requestSealReissue(){";
  const receiptAction = `  function confirmAllocationReceiptMe(){
    const ticket = state.current;
    const view = ticket && ticket.allocationReceipt;
    if (!ticket || !ticket.maDonDv || !view || !view.canConfirm || view.pendingCount < 1) return;
    const button = $('btnConfirmAllocationReceiptMe');
    if (button) button.disabled = true;
    try{
      if (window.App && App.ui) {
        if (typeof App.ui.showWriteLoading === 'function') App.ui.showWriteLoading('Đang ghi nhận hàng đã nhận...');
        else if (typeof App.ui.showLoading === 'function') App.ui.showLoading('Đang ghi nhận hàng đã nhận...');
      }
    }catch(_){}
    runGASFallback(
      ['confirmMyAllocationReceipt', 'confirmAllocationReceipt'],
      [ticket.maDonDv, attachCurrentAppUserContext({})],
      function(res){
        try{ App.ui && App.ui.hideLoading && App.ui.hideLoading(); }catch(_){}
        if (!res || res.ok === false) {
          if (button) button.disabled = false;
          hcAlert((res && (res.message || res.error)) || 'Chưa ghi nhận được hàng đã nhận.', { title: 'Chưa xác nhận được' });
          return;
        }
        const updated = res.ticket && typeof res.ticket === 'object' ? res.ticket : ticket;
        if (res.json && typeof res.json === 'object') updated.json = res.json;
        if (res.allocationReceipt) updated.allocationReceipt = res.allocationReceipt;
        updated.duLieuJson = JSON.stringify(updated.json || {});
        state.current = updated;
        state.byId.set(updated.maDonDv || ticket.maDonDv, updated);
        setDetail(updated);
        loadTickets({ preserveLoading: true });
        hcAlert(res.message || 'Đã ghi nhận bạn đã nhận hàng cấp phát.', { title: 'Đã xác nhận' });
      },
      function(error){
        try{ App.ui && App.ui.hideLoading && App.ui.hideLoading(); }catch(_){}
        if (button) button.disabled = false;
        hcAlert((error && error.message) || String(error || 'Chưa ghi nhận được hàng đã nhận.'), { title: 'Chưa xác nhận được' });
      }
    );
  }

`;
  if (!transformed.includes(actionFunctionMarker)) {
    throw new Error(`Không tìm thấy vị trí gắn thao tác nhận cấp phát trong ${definition.file}.`);
  }
  transformed = transformed.replace(
    actionFunctionMarker,
    receiptAction + actionFunctionMarker,
  );

  const bindingMarker =
    "    $('btnCancelMe').addEventListener('click', cancelTicket);";
  if (!transformed.includes(bindingMarker)) {
    throw new Error(`Không tìm thấy vị trí bind nút nhận cấp phát trong ${definition.file}.`);
  }
  transformed = transformed.replace(
    bindingMarker,
    "    $('btnConfirmAllocationReceiptMe').addEventListener('click', confirmAllocationReceiptMe);\n" + bindingMarker,
  );
  return transformed;
}

function inboxSearchAutofillGuard(definition) {
  const inputId =
    definition.rootId === "pg-inbox" ? "txtSearch" : "txtSearchMe";
  return `
        var searchInput = document.getElementById("${inputId}");
        if (searchInput) {
          var accountIdentityPattern = /\\s[·•]\\s*\\d{4,}\\s*$/;
          var clearRestoredSearch = function (force) {
            var value = String(searchInput.value || "").trim();
            var looksLikeAccountIdentity = accountIdentityPattern.test(value);
            if (force || looksLikeAccountIdentity) {
              searchInput.value = "";
              searchInput.dispatchEvent(new Event("input", { bubbles: true }));
            }
          };
          var unlockSearchInput = function () {
            searchInput.removeAttribute("readonly");
          };
          clearRestoredSearch(true);
          searchInput.setAttribute(
            "name",
            "order-search-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2)
          );
          searchInput.addEventListener("pointerdown", unlockSearchInput);
          searchInput.addEventListener("focus", unlockSearchInput);
          searchInput.addEventListener("keydown", function () {
            unlockSearchInput();
          });
          searchInput.addEventListener("paste", function () {
            unlockSearchInput();
          });
          searchInput.addEventListener("drop", function () {
            unlockSearchInput();
          });
          searchInput.addEventListener("input", function () {
            var value = String(searchInput.value || "").trim();
            if (accountIdentityPattern.test(value)) {
              clearRestoredSearch(false);
            }
          }, true);
          [0, 120, 400, 1000, 2200, 5000, 10000].forEach(function (delay) {
            window.setTimeout(function () {
              clearRestoredSearch(false);
            }, delay);
          });
          window.setInterval(function () {
            clearRestoredSearch(false);
          }, 350);
          window.addEventListener("focus", function () {
            clearRestoredSearch(false);
          });
          document.addEventListener("visibilitychange", function () {
            if (!document.hidden) clearRestoredSearch(false);
          });
          window.addEventListener("pageshow", function (event) {
            if (event.persisted) clearRestoredSearch(true);
          });
        }
  `;
}

function inboxPageFor(definition) {
  const sharedInbox = transformInboxMultiItemCards(
    repairKnownLegacyEncoding(readLegacy("InboxShared.html")),
    { file: "InboxShared.html", rootId: "shared" },
  );
  const moduleSource = hardenInboxSearchAutofill(
    hardenInboxDetailOpen(
      transformInboxAllocationReceipt(
        transformInboxMultiItemCards(
          transformInboxElectronicSignatureUpload(
            repairKnownLegacyEncoding(readLegacy(definition.file)),
            definition,
          ),
          definition,
        ),
        definition,
      ),
      definition,
    ),
    definition,
  );
  return `<!doctype html>
<html lang="vi" data-rpc-endpoint="/api/inbox/rpc">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#114c41">
    <title>${definition.title} · Thuận Việt</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800;900&family=Montserrat:wght@600;700;800&display=swap" rel="stylesheet">
    ${sharedStyles}
    ${standaloneStyles}
    ${inboxStandaloneStyles}
  </head>
  <body>
    <div id="legacyParityLoading" class="legacy-parity-loading" aria-hidden="true">
      <div class="legacy-parity-loading-card" role="status">
        <span class="legacy-parity-spinner" aria-hidden="true"></span>
        <strong id="legacyParityLoadingText">Đang tải dữ liệu đơn hàng...</strong>
      </div>
    </div>
    <div id="legacyParityDialog" class="legacy-parity-dialog" aria-hidden="true">
      <section class="legacy-parity-dialog-card" role="alertdialog" aria-modal="true" aria-labelledby="legacyParityDialogTitle">
        <h3 id="legacyParityDialogTitle">Thông báo</h3>
        <p id="legacyParityDialogMessage"></p>
        <input id="legacyParityDialogInput" type="text" hidden>
        <div class="legacy-parity-dialog-actions">
          <button id="legacyParityDialogCancel" type="button">Hủy</button>
          <button id="legacyParityDialogOk" class="is-primary" type="button">Đồng ý</button>
        </div>
      </section>
    </div>
    <button class="inbox-parity-back" type="button" aria-label="Đóng và về trang chính" title="Đóng" onclick="window.parent.location.href='/'">×</button>
    ${definition.rootId === "pg-inbox" ? '<span id="inboxAdminModal" aria-hidden="false" hidden></span>' : ""}
    <script>${runtime}</script>
    ${sharedInbox}
    ${moduleSource}
    <script>
      window.addEventListener("DOMContentLoaded", function () {
        ${inboxSearchAutofillGuard(definition)}
        var root = document.getElementById("${definition.rootId}");
        if (root) root.classList.add("workspace-mounted");
        if (typeof window.${definition.open} === "function") {
          window.${definition.open}();
        }
      });
    </script>
  </body>
</html>`;
}

fs.mkdirSync(publicRoot, { recursive: true });
if (["all", "modules", "evaluation"].includes(buildScope)) {
  for (const moduleDefinition of modules) {
    if (buildScope === "evaluation" && !["evaluation.html", "evaluation-config.html"].includes(moduleDefinition.output)) continue;
    const outputPath = path.join(publicRoot, moduleDefinition.output);
    const standaloneSourceName = v3StandaloneModuleSources.get(
      moduleDefinition.file,
    );
    if (standaloneSourceName) {
      const standaloneSourcePath = path.join(
        projectRoot,
        "scripts",
        "v3-parity",
        standaloneSourceName,
      );
      if (!fs.existsSync(standaloneSourcePath)) {
        throw new Error(
          `Không tìm thấy nguồn V3 của Tuyển dụng: ${standaloneSourcePath}`,
        );
      }
      fs.copyFileSync(standaloneSourcePath, outputPath);
      continue;
    }
    if (moduleDefinition.file === "AccountingConfigModal.html") {
      if (!fs.existsSync(outputPath)) {
        throw new Error(
          `Không tìm thấy trang Kế toán V3 tại ${outputPath}. Không được dựng lại trang này từ nguồn GAS cũ.`,
        );
      }
      continue;
    }
    if (moduleDefinition.file === "EvaluationConfigModal.html") {
      if (!fs.existsSync(evaluationV3SourcePath)) {
        throw new Error(
          `Không tìm thấy nguồn V3 của cấu hình CnB: ${evaluationV3SourcePath}`,
        );
      }
      fs.copyFileSync(evaluationV3SourcePath, outputPath);
      continue;
    }

    fs.writeFileSync(
      outputPath,
      pageFor(moduleDefinition),
      "utf8",
    );
  }
}

const inboxModules = [
  {
    file: "inboxMe.html",
    output: "inbox-me.html",
    title: "Đơn hàng của tôi",
    rootId: "pg-inbox-me",
    open: "refreshInboxMePage",
  },
  {
    file: "inboxAdmin.html",
    output: "inbox-admin.html",
    title: "Quản lý đơn hàng",
    rootId: "pg-inbox",
    open: "refreshInboxAdminPage",
  },
];
if (buildScope === "all" || buildScope === "inbox") {
  for (const definition of inboxModules) {
    fs.writeFileSync(
      path.join(publicRoot, definition.output),
      inboxPageFor(definition),
      "utf8",
    );
  }
}

console.log(
  `Đã dựng parity phạm vi ${buildScope} từ nguồn tham chiếu tại ${legacyRoot}.`,
);
