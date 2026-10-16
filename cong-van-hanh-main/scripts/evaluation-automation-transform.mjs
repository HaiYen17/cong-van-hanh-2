function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) {
    throw new Error(`Không tìm thấy điểm gắn ${label} trong EvaluationConfigModal.html.`);
  }
  return source.replace(needle, replacement);
}

const automationStyles = `
  #evaluationConfigModal .evaluation-cycle-generation-config{display:grid;gap:14px;margin-bottom:16px;padding:16px;border:1px solid rgba(17,76,65,.12);border-radius:8px;background:rgba(244,247,244,.72)}
  #evaluationConfigModal .evaluation-cycle-generation-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}
  #evaluationConfigModal .evaluation-cycle-generation-head h4{margin:0;color:var(--accent-deep);font-size:.94rem;font-weight:950}
  #evaluationConfigModal .evaluation-cycle-generation-head p{margin:4px 0 0;color:var(--muted-strong);font-size:.72rem;font-weight:720;line-height:1.55}
  #evaluationConfigModal .evaluation-automation-shell{display:grid;gap:14px}
  #evaluationConfigModal .evaluation-automation-shell[hidden],#evaluationConfigModal .evaluation-config-form[hidden],#evaluationConfigModal .evaluation-config-field[hidden]{display:none!important}
  #evaluationConfigModal .evaluation-automation-source-actions{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap}
  #evaluationConfigModal .evaluation-automation-source-actions .evaluation-config-field{flex:1 1 420px}
  #evaluationConfigModal .evaluation-automation-map{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:14px;border:1px solid rgba(17,76,65,.1);border-radius:8px;background:#fff}
  #evaluationConfigModal .evaluation-automation-map-head{grid-column:1/-1;display:flex;align-items:flex-end;justify-content:space-between;gap:10px}
  #evaluationConfigModal .evaluation-automation-map-head h5{margin:0;color:var(--accent-deep);font-size:.86rem;font-weight:950}
  #evaluationConfigModal .evaluation-automation-map-head p{margin:3px 0 0;color:var(--muted-strong);font-size:.68rem;font-weight:720}
  #evaluationConfigModal .evaluation-automation-status{padding:10px 12px;border:1px dashed rgba(17,76,65,.18);border-radius:8px;color:var(--muted-strong);font-size:.72rem;font-weight:760;line-height:1.55}
  #evaluationConfigModal .evaluation-automation-status[data-tone="success"]{border-style:solid;border-color:rgba(34,129,98,.28);background:rgba(222,247,237,.54);color:#176c53}
  #evaluationConfigModal .evaluation-automation-status[data-tone="error"]{border-style:solid;border-color:rgba(192,62,49,.25);background:rgba(255,235,232,.62);color:#a83b31}
  #evaluationConfigModal .evaluation-automation-preview-summary{display:flex;gap:8px;flex-wrap:wrap}
  #evaluationConfigModal .evaluation-automation-table-wrap{max-height:330px;overflow:auto;border:1px solid rgba(17,76,65,.1);border-radius:8px;background:#fff}
  #evaluationConfigModal .evaluation-automation-table{width:100%;border-collapse:collapse;font-size:.7rem}
  #evaluationConfigModal .evaluation-automation-table th{position:sticky;top:0;z-index:1;padding:9px 10px;background:#edf3f0;color:var(--accent-deep);font-size:.64rem;font-weight:950;text-align:left;text-transform:uppercase}
  #evaluationConfigModal .evaluation-automation-table td{padding:9px 10px;border-top:1px solid rgba(17,76,65,.08);color:var(--muted-strong);font-weight:720;vertical-align:top}
  #evaluationConfigModal .evaluation-automation-table td strong{display:block;color:var(--accent-deep);font-weight:900}
  #evaluationConfigModal .evaluation-automation-runbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:4px;flex-wrap:wrap}
  @media(max-width:1080px){#evaluationConfigModal .evaluation-automation-map{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:680px){#evaluationConfigModal .evaluation-automation-map{grid-template-columns:1fr}#evaluationConfigModal .evaluation-cycle-generation-head{display:grid}#evaluationConfigModal .evaluation-automation-table-wrap{max-height:420px}#evaluationConfigModal .evaluation-automation-table,#evaluationConfigModal .evaluation-automation-table tbody,#evaluationConfigModal .evaluation-automation-table tr,#evaluationConfigModal .evaluation-automation-table td{display:block;width:100%}#evaluationConfigModal .evaluation-automation-table thead{display:none}#evaluationConfigModal .evaluation-automation-table tr{padding:8px;border-top:1px solid rgba(17,76,65,.08)}#evaluationConfigModal .evaluation-automation-table td{padding:3px 5px;border:0}}
`;

const automationBlock = `
            <section class="evaluation-cycle-generation-config" aria-label="Cách sinh kỳ đánh giá">
              <div class="evaluation-cycle-generation-head">
                <div><p class="evaluation-config-kicker">Cách sinh kỳ</p><h4>Thủ công hoặc tự động theo chu kỳ</h4><p>Loại đánh giá chỉ định nghĩa nội dung. Lịch sinh kỳ, nguồn dữ liệu và phân bổ tự động được quản lý riêng tại đây.</p></div>
                <button class="ui-button ui-button--secondary" type="button" data-action="reset-evaluation-automation-schedule">Cấu hình mới</button>
              </div>
              <div class="evaluation-config-form-grid">
                <label class="evaluation-config-field"><span class="evaluation-config-label">Cách sinh kỳ</span><select id="evaluationAutomationGenerationMode" class="evaluation-config-select"><option value="manual">Thủ công</option><option value="monthly">Theo tháng</option><option value="quarterly">Theo Quý</option><option value="yearly">Theo Năm</option></select></label>
                <label id="evaluationAutomationGenerationTimingField" class="evaluation-config-field" hidden><span class="evaluation-config-label">Mốc sinh Kỳ</span><select id="evaluationAutomationGenerationTiming" class="evaluation-config-select"><option value="period_start">Đầu Kỳ</option><option value="period_end">Cuối Kỳ</option></select></label>
              </div>
            </section>
            <form id="evaluationAutomationScheduleForm" class="evaluation-config-form evaluation-automation-shell" novalidate hidden>
              <input id="evaluationAutomationScheduleId" type="hidden">
              <div class="evaluation-config-form-grid">
                <label class="evaluation-config-field evaluation-config-field--wide"><span class="evaluation-config-label">Loại đánh giá áp dụng</span><select id="evaluationAutomationCycleType" class="evaluation-config-select"></select></label>
                <label class="evaluation-config-field"><span class="evaluation-config-label">Tên mốc / quy tắc</span><input id="evaluationAutomationRuleKey" class="evaluation-config-input" type="text" placeholder="Ví dụ: Hết thử việc 1 tháng"></label>
                <label class="evaluation-config-field"><span class="evaluation-config-label">Trạng thái lịch</span><select id="evaluationAutomationScheduleStatus" class="evaluation-config-select"><option value="active">Đang hoạt động</option><option value="draft">Tạm dừng</option></select></label>
              </div>
              <div class="evaluation-automation-source-actions">
                <label class="evaluation-config-field"><span class="evaluation-config-label">Link Google Sheet</span><input id="evaluationAutomationSourceLink" class="evaluation-config-input" type="url" placeholder="https://docs.google.com/spreadsheets/d/..."></label>
                <button class="ui-button ui-button--secondary" type="button" data-action="inspect-evaluation-automation">Đọc nguồn</button>
              </div>
              <div class="evaluation-config-form-grid">
                <label class="evaluation-config-field"><span class="evaluation-config-label">Sheet lấy dữ liệu</span><select id="evaluationAutomationSheetName" class="evaluation-config-select"><option value="">Đọc nguồn để chọn sheet</option></select></label>
                <label class="evaluation-config-field"><span class="evaluation-config-label">Dòng header</span><input id="evaluationAutomationHeaderRow" class="evaluation-config-input" type="number" min="1" step="1" value="1"></label>
              </div>
              <div id="evaluationAutomationSourceStatus" class="evaluation-automation-status">Google Sheet cần được chia sẻ quyền xem cho <strong>cong-van-hanh-web@tvg-ops-dev.iam.gserviceaccount.com</strong>.</div>
              <section class="evaluation-automation-map" aria-label="Ánh xạ nhân sự và mốc thời gian">
                <div class="evaluation-automation-map-head"><div><h5>1. Nhân sự và mốc thời gian</h5><p>Mã dòng nguồn là Job ID hoặc mã hồ sơ riêng của dòng, không phải MNV và không bắt buộc. Hệ thống dùng nó để chống sinh trùng khi Sheet đổi thứ tự.</p></div></div>
                <label class="evaluation-config-field"><span class="evaluation-config-label">Mã dòng nguồn (không bắt buộc)</span><select id="evaluationAutomationMapStableId" class="evaluation-config-select" data-automation-map="stableId"></select></label>
                <label class="evaluation-config-field"><span class="evaluation-config-label">Mã nhân viên</span><select id="evaluationAutomationMapEmployeeCode" class="evaluation-config-select" data-automation-map="employeeCode"></select></label>
                <label class="evaluation-config-field"><span class="evaluation-config-label">Email nhân viên</span><select id="evaluationAutomationMapEmployeeEmail" class="evaluation-config-select" data-automation-map="employeeEmail"></select></label>
                <label class="evaluation-config-field"><span class="evaluation-config-label">Họ và tên nhân viên</span><select id="evaluationAutomationMapEmployeeName" class="evaluation-config-select" data-automation-map="employeeName"></select></label>
                <label class="evaluation-config-field"><span class="evaluation-config-label">Chức vụ / chức danh</span><select id="evaluationAutomationMapJobTitle" class="evaluation-config-select" data-automation-map="jobTitle"></select></label>
                <label class="evaluation-config-field"><span class="evaluation-config-label">Phòng ban / khu vực</span><select id="evaluationAutomationMapDepartment" class="evaluation-config-select" data-automation-map="department"></select></label>
                <label class="evaluation-config-field"><span class="evaluation-config-label">Mốc thời gian xác định *</span><select id="evaluationAutomationMapMilestone" class="evaluation-config-select" data-automation-map="milestoneDate"></select></label>
              </section>
              <section class="evaluation-automation-map" aria-label="Ánh xạ người đánh giá">
                <div class="evaluation-automation-map-head"><div><h5>2. Người đánh giá và phân bổ</h5><p>Map thẳng từng cột vai trò có trong nguồn. Vai trò nào không tham gia workflow của Loại đánh giá thì có thể để trống.</p></div></div>
                <label class="evaluation-config-field"><span class="evaluation-config-label">Quản lý trực tiếp</span><select id="evaluationAutomationMapManager" class="evaluation-config-select" data-automation-map="manager"></select></label>
                <label class="evaluation-config-field"><span class="evaluation-config-label">Đồng nghiệp</span><select id="evaluationAutomationMapPeer" class="evaluation-config-select" data-automation-map="peer"></select></label>
                <label class="evaluation-config-field"><span class="evaluation-config-label">HR phụ trách</span><select id="evaluationAutomationMapHr" class="evaluation-config-select" data-automation-map="hr"></select></label>
                <label class="evaluation-config-field"><span class="evaluation-config-label">BOD</span><select id="evaluationAutomationMapBod" class="evaluation-config-select" data-automation-map="bod"></select></label>
              </section>
              <section class="evaluation-automation-map" aria-label="Cửa sổ hiệu lực của phiếu">
                <div class="evaluation-automation-map-head"><div><h5>3. Cửa sổ hiệu lực của phiếu</h5><p>Ngày sinh phiếu = mốc thời gian trừ số ngày bắt đầu. Deadline = mốc thời gian cộng số ngày hết hiệu lực.</p></div></div>
                <label class="evaluation-config-field"><span class="evaluation-config-label">Bắt đầu trước mốc (ngày)</span><input id="evaluationAutomationLeadDays" class="evaluation-config-input" type="number" min="0" step="1" value="7"></label>
                <label class="evaluation-config-field"><span class="evaluation-config-label">Hết hiệu lực sau mốc (ngày)</span><input id="evaluationAutomationExpiryDays" class="evaluation-config-input" type="number" min="0" step="1" value="0"></label>
              </section>
              <div class="evaluation-config-action-row">
                <button class="ui-button ui-button--secondary" type="button" data-action="preview-evaluation-automation">Xem trước đối chiếu</button>
                <button class="ui-button ui-button--primary" type="submit">Lưu lịch sinh kỳ</button>
              </div>
              <div id="evaluationAutomationPreview"></div>
              <div class="evaluation-automation-runbar">
                <p class="evaluation-config-note">Tên kỳ được sinh tự động theo mẫu T07/2026, QIII/2026 hoặc 2027 rồi ghép với tên loại đánh giá.</p>
                <button id="evaluationAutomationRunButton" class="ui-button ui-button--primary" type="button" data-action="run-evaluation-automation" disabled>Sinh phiếu đến hạn ngay</button>
              </div>
              <div id="evaluationAutomationScheduleList" class="evaluation-config-list"></div>
            </form>
`;

const automationFunctions = `
  var EVALUATION_AUTOMATION_MAPPING_IDS = {
    stableId: 'evaluationAutomationMapStableId', employeeCode: 'evaluationAutomationMapEmployeeCode', employeeEmail: 'evaluationAutomationMapEmployeeEmail', employeeName: 'evaluationAutomationMapEmployeeName', jobTitle: 'evaluationAutomationMapJobTitle', department: 'evaluationAutomationMapDepartment', reviewer: 'evaluationAutomationMapReviewer', manager: 'evaluationAutomationMapManager', peer: 'evaluationAutomationMapPeer', hr: 'evaluationAutomationMapHr', bod: 'evaluationAutomationMapBod', milestoneDate: 'evaluationAutomationMapMilestone'
  };
  function evaluationAutomationGenerationMode() {
    return trim($('evaluationAutomationGenerationMode') && $('evaluationAutomationGenerationMode').value) || 'manual';
  }
  function evaluationAutomationEnabled() { return evaluationAutomationGenerationMode() !== 'manual'; }
  function evaluationAutomationModeLabel(value) {
    if (value === 'monthly') return 'Theo tháng';
    if (value === 'quarterly') return 'Theo Quý';
    if (value === 'yearly') return 'Theo Năm';
    return 'Thủ công';
  }
  function evaluationAutomationTimingLabel(value) { return value === 'period_end' ? 'Cuối Kỳ' : 'Đầu Kỳ'; }
  function readEvaluationAutomationConfig() {
    var mappings = {};
    Object.keys(EVALUATION_AUTOMATION_MAPPING_IDS).forEach(function (key) { var node = $(EVALUATION_AUTOMATION_MAPPING_IDS[key]); mappings[key] = trim(node && node.value); });
    var mode = evaluationAutomationGenerationMode();
    return {
      id: trim($('evaluationAutomationScheduleId') && $('evaluationAutomationScheduleId').value) || null,
      cycleScheduleId: trim($('evaluationAutomationScheduleId') && $('evaluationAutomationScheduleId').value) || null,
      cycleTypeTemplateId: trim($('evaluationAutomationCycleType') && $('evaluationAutomationCycleType').value),
      automationRuleKey: trim($('evaluationAutomationRuleKey') && $('evaluationAutomationRuleKey').value) || 'default',
      generationMode: mode,
      generationTiming: trim($('evaluationAutomationGenerationTiming') && $('evaluationAutomationGenerationTiming').value) || 'period_start',
      status: trim($('evaluationAutomationScheduleStatus') && $('evaluationAutomationScheduleStatus').value) || 'active',
      automationSourceEnabled: mode !== 'manual',
      automationSourceLink: trim($('evaluationAutomationSourceLink') && $('evaluationAutomationSourceLink').value),
      automationSheetName: trim($('evaluationAutomationSheetName') && $('evaluationAutomationSheetName').value),
      automationHeaderRow: Math.max(1, numValue($('evaluationAutomationHeaderRow') && $('evaluationAutomationHeaderRow').value) || 1),
      automationSourceMappings: mappings,
      automationReviewerRole: trim($('evaluationAutomationReviewerRole') && $('evaluationAutomationReviewerRole').value) || 'manager',
      automationCycleGrouping: mode === 'quarterly' || mode === 'yearly' ? mode : 'monthly',
      automationLeadDays: Math.max(0, numValue($('evaluationAutomationLeadDays') && $('evaluationAutomationLeadDays').value) || 0),
      automationExpiryDays: Math.max(0, numValue($('evaluationAutomationExpiryDays') && $('evaluationAutomationExpiryDays').value) || 0)
    };
  }
  function setEvaluationAutomationValue(id, value) { var node = $(id); if (node) node.value = value == null ? '' : String(value); }
  function evaluationAutomationHeaderOptions(selected) {
    var headers = state.evaluationAutomationMeta && state.evaluationAutomationMeta.headers || [];
    var values = headers.slice();
    if (selected && values.indexOf(selected) === -1) values.unshift(selected);
    return '<option value="">Không lấy cột này</option>' + values.map(function (header) { return '<option value="' + escapeHtml(header) + '"' + (String(header) === String(selected || '') ? ' selected' : '') + '>' + escapeHtml(header) + '</option>'; }).join('');
  }
  function renderEvaluationAutomationSheetOptions(selected) {
    var node = $('evaluationAutomationSheetName'); if (!node) return;
    var sheets = state.evaluationAutomationMeta && state.evaluationAutomationMeta.sheets || [];
    var values = sheets.map(function (sheet) { return sheet.title; }).filter(Boolean);
    if (selected && values.indexOf(selected) === -1) values.unshift(selected);
    node.innerHTML = '<option value="">Chọn sheet</option>' + values.map(function (value) { return '<option value="' + escapeHtml(value) + '"' + (String(value) === String(selected || '') ? ' selected' : '') + '>' + escapeHtml(value) + '</option>'; }).join('');
  }
  function evaluationAutomationStatusLabel(value) {
    if (value === 'ready') return 'Đến hạn sinh'; if (value === 'future') return 'Chưa tới ngày'; if (value === 'expired') return 'Đã quá hạn'; if (value === 'waiting_cycle') return 'Chờ mốc sinh kỳ'; if (value === 'unresolved') return 'Chưa đối chiếu'; return 'Dữ liệu lỗi';
  }
  function renderEvaluationAutomationPreview() {
    var node = $('evaluationAutomationPreview'); if (!node) return;
    var preview = state.evaluationAutomationPreview;
    if (!preview) { node.innerHTML = '<div class="evaluation-automation-status">Bấm <strong>Xem trước đối chiếu</strong> để kiểm tra nhân sự, người chấm, ngày sinh phiếu và deadline trước khi bật chạy thật.</div>'; return; }
    var summary = preview.summary || {};
    var chips = ['Tổng ' + (summary.total || 0), 'Đến hạn ' + (summary.ready || 0), 'Chờ mốc kỳ ' + (summary.waitingCycle || 0), 'Chưa tới ngày ' + (summary.future || 0), 'Quá hạn ' + (summary.expired || 0), 'Cần xử lý ' + ((summary.unresolved || 0) + (summary.invalid || 0))];
    var rows = preview.rows || [];
    var body = rows.length ? rows.slice(0, 80).map(function (row) { return '<tr><td><strong>' + escapeHtml(row.employeeName || ('Dòng ' + row.rowNumber)) + '</strong>' + escapeHtml(row.employeeCode || '') + '</td><td>' + escapeHtml(row.managerName || '—') + '</td><td>' + escapeHtml(row.milestoneDate || '—') + '</td><td>' + escapeHtml((row.availableFrom || '—') + ' → ' + (row.deadline || '—')) + '</td><td><span class="evaluation-config-pill">' + escapeHtml(evaluationAutomationStatusLabel(row.status)) + '</span>' + (row.issue ? '<div>' + escapeHtml(row.issue) + '</div>' : '') + '</td></tr>'; }).join('') : '<tr><td colspan="5">Sheet không có dòng dữ liệu phù hợp.</td></tr>';
    node.innerHTML = '<div class="evaluation-automation-preview-summary">' + chips.map(function (label) { return '<span class="evaluation-config-pill">' + escapeHtml(label) + '</span>'; }).join('') + '</div><div class="evaluation-automation-table-wrap"><table class="evaluation-automation-table"><thead><tr><th>Nhân sự</th><th>Quản lý</th><th>Mốc</th><th>Hiệu lực phiếu</th><th>Đối chiếu</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  function renderEvaluationAutomationScheduleList() {
    renderRows('evaluationAutomationScheduleList', list('cycleSchedules').filter(isActiveLine), 'Chưa có lịch sinh kỳ tự động.', function (item) {
      var type = cycleTypeByValue(item.cycleTypeTemplateId || item.cycleTypeCode) || {};
      var title = type.name || item.cycleTypeName || item.name || 'Lịch sinh kỳ';
      var meta = (item.automationRuleKey && item.automationRuleKey !== 'default' ? item.automationRuleKey + ' · ' : '') + evaluationAutomationModeLabel(item.generationMode || item.automationCycleGrouping) + ' · ' + evaluationAutomationTimingLabel(item.generationTiming) + ' · ' + (item.automationSheetName || 'Chưa chọn Sheet');
      return row(title, meta, mini('edit-evaluation-automation-schedule', item.id, 'Sửa') + miniDelete('cycleSchedule', item.id, 'Xóa lịch'), pills([item.status === 'active' ? 'Đang hoạt động' : 'Tạm dừng']));
    });
  }
  function renderEvaluationAutomation(preferredMappings) {
    var automatic = evaluationAutomationEnabled();
    if ($('evaluationConfigCycleForm')) $('evaluationConfigCycleForm').hidden = automatic;
    if ($('evaluationAutomationScheduleForm')) $('evaluationAutomationScheduleForm').hidden = !automatic;
    if ($('evaluationAutomationGenerationTimingField')) $('evaluationAutomationGenerationTimingField').hidden = !automatic;
    var hasPreferredMappings = !!preferredMappings;
    var mappings = preferredMappings || {};
    Object.keys(EVALUATION_AUTOMATION_MAPPING_IDS).forEach(function (key) {
      var node = $(EVALUATION_AUTOMATION_MAPPING_IDS[key]); if (!node) return;
      var selected = hasPreferredMappings ? trim(mappings[key]) : trim(node.value); node.innerHTML = evaluationAutomationHeaderOptions(selected); node.value = selected;
    });
    var status = $('evaluationAutomationSourceStatus');
    if (status && state.evaluationAutomationMeta) { status.dataset.tone = 'success'; status.innerHTML = '<strong>' + escapeHtml(state.evaluationAutomationMeta.spreadsheetTitle || 'Đã đọc Google Sheet') + '</strong> · ' + escapeHtml((state.evaluationAutomationMeta.headers || []).length + ' header · ' + (state.evaluationAutomationMeta.selectedSheetName || 'chưa chọn sheet')); }
    var runButton = $('evaluationAutomationRunButton');
    if (runButton) runButton.disabled = !automatic || !trim($('evaluationAutomationScheduleId') && $('evaluationAutomationScheduleId').value) || trim($('evaluationAutomationScheduleStatus') && $('evaluationAutomationScheduleStatus').value) !== 'active' || !!state.evaluationAutomationBusy;
    renderEvaluationAutomationPreview();
    renderEvaluationAutomationScheduleList();
  }
  function applyEvaluationAutomationConfig(item) {
    item = item || {};
    var mode = item.generationMode || item.automationCycleGrouping || 'manual';
    if (mode !== 'monthly' && mode !== 'quarterly' && mode !== 'yearly') mode = 'manual';
    setEvaluationAutomationValue('evaluationAutomationScheduleId', item.id || item.cycleScheduleId || '');
    setEvaluationAutomationValue('evaluationAutomationGenerationMode', mode);
    setEvaluationAutomationValue('evaluationAutomationGenerationTiming', item.generationTiming || 'period_start');
    setEvaluationAutomationValue('evaluationAutomationCycleType', item.cycleTypeTemplateId || '');
    setEvaluationAutomationValue('evaluationAutomationRuleKey', item.automationRuleKey && item.automationRuleKey !== 'default' ? item.automationRuleKey : '');
    setEvaluationAutomationValue('evaluationAutomationScheduleStatus', item.status === 'active' ? 'active' : 'draft');
    setEvaluationAutomationValue('evaluationAutomationSourceLink', item.automationSourceLink || item.sourceSpreadsheetUrl || '');
    setEvaluationAutomationValue('evaluationAutomationHeaderRow', item.automationHeaderRow || item.sourceHeaderRow || 1);
    setEvaluationAutomationValue('evaluationAutomationReviewerRole', item.automationReviewerRole || 'manager');
    setEvaluationAutomationValue('evaluationAutomationLeadDays', item.automationLeadDays == null ? 7 : item.automationLeadDays);
    setEvaluationAutomationValue('evaluationAutomationExpiryDays', item.automationExpiryDays == null ? 0 : item.automationExpiryDays);
    state.evaluationAutomationMeta = null; state.evaluationAutomationPreview = null;
    renderEvaluationAutomationSheetOptions(item.automationSheetName || item.sourceSheetName || '');
    renderEvaluationAutomation(item.automationSourceMappings || item.sourceMappings || {});
  }
  function resetEvaluationAutomationSchedule() {
    state.evaluationAutomationMeta = null; state.evaluationAutomationPreview = null;
    applyEvaluationAutomationConfig({ automationRuleKey: '', generationMode: evaluationAutomationGenerationMode() === 'manual' ? 'monthly' : evaluationAutomationGenerationMode(), generationTiming: 'period_start', status: 'active', automationHeaderRow: 1, automationLeadDays: 7, automationExpiryDays: 0, automationReviewerRole: 'manager', automationSourceMappings: {} });
    renderSelects(); renderEvaluationAutomation();
  }
  function editEvaluationAutomationSchedule(id) {
    var item = byId(list('cycleSchedules'), id, ['id', 'cycleScheduleId', 'databaseId']); if (!item) return;
    applyEvaluationAutomationConfig(item); renderSelects(); renderEvaluationAutomation(item.automationSourceMappings || {});
  }
  function evaluationAutomationValidationMessage() {
    if (!evaluationAutomationEnabled()) return '';
    var config = readEvaluationAutomationConfig();
    if (!config.cycleTypeTemplateId) return 'Chọn Loại đánh giá áp dụng.';
    if (!config.automationSourceLink) return 'Nhập link Google Sheet dùng để sinh phiếu.';
    if (!config.automationSheetName) return 'Đọc nguồn và chọn sheet lấy dữ liệu.';
    if (!config.automationSourceMappings.milestoneDate) return 'Chọn header Mốc thời gian xác định.';
    if (!config.automationSourceMappings.employeeCode && !config.automationSourceMappings.employeeEmail && !config.automationSourceMappings.employeeName) return 'Map ít nhất Mã nhân viên, Email hoặc Họ và tên.';
    return '';
  }
  function inspectEvaluationAutomation() {
    if (state.evaluationAutomationBusy) return;
    var record = readEvaluationAutomationConfig(); if (!record.automationSourceLink) return alertMessage('Nhập link Google Sheet trước nha.', 'Thiếu nguồn dữ liệu');
    state.evaluationAutomationBusy = true; showWriteLoading('Đang đọc danh sách sheet và header...');
    App.gas('inspectEvaluationAutomationSource', { record: record }).then(function (response) {
      state.evaluationAutomationMeta = response || {};
      var selectedSheet = response && response.selectedSheetName || record.automationSheetName || '';
      renderEvaluationAutomationSheetOptions(selectedSheet); if ($('evaluationAutomationSheetName')) $('evaluationAutomationSheetName').value = selectedSheet;
      state.evaluationAutomationPreview = null; renderEvaluationAutomation(response && response.autoMappings || {}); hideLoading();
      alertMessage('Đã đọc sheet và tự nhận diện các header phù hợp. Ông kiểm tra lại mapping trước khi xem trước nha.', 'Đã đọc nguồn');
    }).catch(function (error) { showErrorAfterLoading(error, 'Không đọc được Google Sheet.', 'Không đọc được nguồn'); }).finally(function () { state.evaluationAutomationBusy = false; renderEvaluationAutomation(); hideLoading(); });
  }
  function previewEvaluationAutomation() {
    if (state.evaluationAutomationBusy) return;
    var message = evaluationAutomationValidationMessage(); if (message) return alertMessage(message, 'Lịch sinh kỳ chưa đủ thông tin');
    state.evaluationAutomationBusy = true; showWriteLoading('Đang đối chiếu nhân sự, người chấm và mốc thời gian...');
    App.gas('previewEvaluationAutomationSource', { record: readEvaluationAutomationConfig() }).then(function (response) {
      state.evaluationAutomationPreview = response || {}; renderEvaluationAutomation(); hideLoading();
      var summary = response && response.summary || {}; alertMessage('Đối chiếu xong ' + (summary.total || 0) + ' dòng; có ' + (summary.ready || 0) + ' phiếu đang đến hạn sinh.', 'Đã xem trước');
    }).catch(function (error) { showErrorAfterLoading(error, 'Không đối chiếu được nguồn.', 'Đối chiếu thất bại'); }).finally(function () { state.evaluationAutomationBusy = false; renderEvaluationAutomation(); hideLoading(); });
  }
  function saveEvaluationAutomationScheduleFromForm() {
    var message = evaluationAutomationValidationMessage(); if (message) return alertMessage(message, 'Lịch sinh kỳ chưa đủ thông tin');
    return callWrite('saveEvaluationAutomationSchedule', { record: readEvaluationAutomationConfig() }, 'Đã lưu lịch sinh kỳ tự động.').then(function (response) {
      var schedule = response && (response.schedule || response.record); if (schedule && schedule.id) setEvaluationAutomationValue('evaluationAutomationScheduleId', schedule.id);
      renderEvaluationAutomation(); return response;
    });
  }
  function runEvaluationAutomationNowFromForm() {
    if (state.evaluationAutomationBusy) return;
    var scheduleId = trim($('evaluationAutomationScheduleId') && $('evaluationAutomationScheduleId').value);
    if (!scheduleId) return alertMessage('Lưu lịch sinh kỳ trước khi chạy thật.', 'Chưa thể sinh phiếu');
    var run = function () {
      state.evaluationAutomationBusy = true; showWriteLoading('Đang đọc nguồn và sinh các phiếu đến hạn...');
      return App.gas('runEvaluationAutomationNow', { scheduleId: scheduleId }).then(function (response) { return callRead({ force: true }).then(function () { hideLoading(); alertMessage(response && response.message || 'Đã chạy lịch sinh kỳ tự động.', 'Đã hoàn tất'); return response; }); }).catch(function (error) { showErrorAfterLoading(error, 'Không sinh được phiếu tự động.', 'Sinh phiếu thất bại'); }).finally(function () { state.evaluationAutomationBusy = false; renderEvaluationAutomation(); hideLoading(); });
    };
    if (typeof window.hcConfirm === 'function') return window.hcConfirm('Hệ thống sẽ chạy ngay lịch đã lưu, tự bỏ qua kỳ và phiếu đã tồn tại.', { title: 'Sinh phiếu đến hạn?', okLabel: 'Sinh phiếu', cancelLabel: 'Xem lại' }).then(function (confirmed) { if (confirmed) return run(); });
    return run();
  }
`;

export function transformEvaluationAutomation(input) {
  let source = input;
  source = replaceRequired(source, "            <form id=\"evaluationConfigCycleForm\" class=\"evaluation-config-form\" novalidate>", automationBlock + "            <form id=\"evaluationConfigCycleForm\" class=\"evaluation-config-form\" novalidate>", "khối lịch sinh kỳ trong Kỳ và phân bổ");
  source = replaceRequired(source, "</style>", automationStyles + "</style>", "CSS lịch sinh kỳ");
  source = replaceRequired(source, "    reviewTypeOriginalFields: [],\n    workflowStep: 'flow',", "    reviewTypeOriginalFields: [],\n    evaluationAutomationMeta: null,\n    evaluationAutomationPreview: null,\n    evaluationAutomationBusy: false,\n    workflowStep: 'flow',", "state lịch sinh kỳ");
  source = replaceRequired(source, "  function renderCycleAdmin() {", automationFunctions + "\n  function renderCycleAdmin() {\n    renderEvaluationAutomation();", "logic lịch sinh kỳ");
  source = replaceRequired(source, "    fillSelect('evaluationConfigCycleType', cycleOptions(), cycle && cycle.cycleTypeTemplateId || '', 'Chọn loại đánh giá');", "    fillSelect('evaluationConfigCycleType', cycleOptions(), cycle && cycle.cycleTypeTemplateId || '', 'Chọn loại đánh giá');\n    fillSelect('evaluationAutomationCycleType', cycleOptions(), $('evaluationAutomationCycleType') && $('evaluationAutomationCycleType').value || '', 'Chọn loại đánh giá');", "select loại đánh giá cho lịch");
  source = replaceRequired(source, "      var id = button.getAttribute('data-id');\n      if (action === 'toggle-level-title-picker') {", "      var id = button.getAttribute('data-id');\n      if (action === 'inspect-evaluation-automation') { inspectEvaluationAutomation(); return; }\n      if (action === 'preview-evaluation-automation') { previewEvaluationAutomation(); return; }\n      if (action === 'run-evaluation-automation') { runEvaluationAutomationNowFromForm(); return; }\n      if (action === 'reset-evaluation-automation-schedule') { resetEvaluationAutomationSchedule(); return; }\n      if (action === 'edit-evaluation-automation-schedule') { editEvaluationAutomationSchedule(id); return; }\n      if (action === 'toggle-level-title-picker') {", "sự kiện lịch sinh kỳ");
  source = replaceRequired(source, "      cycle: 'kỳ đánh giá'", "      cycle: 'kỳ đánh giá',\n      cycleSchedule: 'lịch sinh kỳ'", "nhãn xóa lịch sinh kỳ");
  source = replaceRequired(source, "      var frequencyInput = event.target.closest('[data-review-type-frequency-value]');", "      if (event.target === $('evaluationAutomationGenerationMode')) { state.evaluationAutomationPreview = null; renderEvaluationAutomation(); return; }\n      if (event.target === $('evaluationAutomationSheetName') || event.target === $('evaluationAutomationHeaderRow') || event.target === $('evaluationAutomationGenerationTiming')) { state.evaluationAutomationPreview = null; renderEvaluationAutomation(); }\n      var frequencyInput = event.target.closest('[data-review-type-frequency-value]');", "sự kiện đổi lịch sinh kỳ");
  source = replaceRequired(source, "    bindForm('evaluationConfigCycleForm', function () {", "    bindForm('evaluationAutomationScheduleForm', function () { saveEvaluationAutomationScheduleFromForm(); });\n    bindForm('evaluationConfigCycleForm', function () {", "form lịch sinh kỳ");
  return source;
}
