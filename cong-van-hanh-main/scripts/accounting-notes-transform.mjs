function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) {
    throw new Error(`Không tìm thấy điểm gắn ${label} trong AccountingConfigModal.html.`);
  }
  return source.replace(needle, replacement);
}

export function transformAccountingNotes(source) {
  const styles = `
  #accountingConfigModal .accounting-note-catalog-field{display:grid;gap:9px;padding:12px;border:1px solid rgba(17,76,65,.12);border-radius:8px;background:#f8fbf9}
  #accountingConfigModal .accounting-note-required{display:grid!important;grid-template-columns:20px minmax(0,1fr);align-items:center;justify-content:start;gap:10px;width:100%;padding:10px 12px;border:1px solid rgba(17,76,65,.14);border-radius:8px;background:#fff;color:var(--accent-deep);font-size:.76rem;font-weight:850;line-height:1.4;cursor:pointer}
  #accountingConfigModal .accounting-note-required input[type="checkbox"]{position:static!important;inset:auto!important;display:block!important;grid-column:1;width:18px!important;height:18px!important;margin:0!important;padding:0!important;justify-self:start;accent-color:#e96a25;cursor:pointer}
  #accountingConfigModal .accounting-note-required span{display:block;grid-column:2;margin:0;text-align:left}
  #accountingConfigModal .accounting-notes-overlay{position:fixed;inset:0;z-index:2147483643;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(13,34,29,.56)}
  #accountingConfigModal .accounting-notes-overlay.is-visible{display:flex}
  #accountingConfigModal .accounting-notes-dialog{display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;width:min(920px,calc(100vw - 24px));height:min(84vh,780px);overflow:hidden;border:1px solid rgba(17,76,65,.15);border-radius:12px;background:#fff;box-shadow:0 26px 70px rgba(8,34,28,.3)}
  #accountingConfigModal .accounting-notes-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:18px 20px;border-bottom:1px solid rgba(17,76,65,.1)}
  #accountingConfigModal .accounting-notes-head h3{margin:2px 0 0;color:var(--accent-deep);font-size:1.08rem;font-weight:950}
  #accountingConfigModal .accounting-notes-toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(17,76,65,.08);background:#fbfdfc}
  #accountingConfigModal .accounting-notes-list{min-height:0;overflow:auto;padding:10px 20px 18px}
  #accountingConfigModal .accounting-note-choice{display:grid;grid-template-columns:22px 94px minmax(0,1fr);gap:10px;align-items:start;padding:10px 8px;border-bottom:1px solid rgba(17,76,65,.075);cursor:pointer}
  #accountingConfigModal .accounting-note-choice:hover{background:#f6faf8}
  #accountingConfigModal .accounting-note-choice input{width:18px;height:18px;margin-top:2px;accent-color:#e96a25}
  #accountingConfigModal .accounting-note-choice-code{color:#b85b22;font-size:.73rem;font-weight:950}
  #accountingConfigModal .accounting-note-choice-copy strong{display:block;color:var(--accent-deep);font-size:.77rem;line-height:1.45}
  #accountingConfigModal .accounting-note-choice-copy span{display:block;margin-top:2px;color:var(--muted-strong);font-size:.66rem;line-height:1.4}
  #accountingConfigModal .accounting-note-mandatory{display:inline-flex;margin-left:7px;padding:2px 6px;border-radius:999px;background:#fff0e7;color:#b64e18;font-size:.58rem;font-weight:950;text-transform:uppercase}
  #accountingConfigModal .accounting-notes-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 20px;border-top:1px solid rgba(17,76,65,.1);background:#fff}
  #accountingConfigModal .accounting-output-notes{display:grid;gap:8px;margin-top:28px}
  #accountingConfigModal .accounting-output-notes h5{margin:0;color:var(--accent-deep);font-size:.92rem;text-align:center}
  #accountingConfigModal .accounting-output-note-table{width:100%;border-collapse:collapse;table-layout:fixed}
  #accountingConfigModal .accounting-output-note-table th,#accountingConfigModal .accounting-output-note-table td{padding:7px 8px;border:1px solid #d4e0dc;font-size:.68rem;vertical-align:top}
  #accountingConfigModal .accounting-output-note-table th{background:#edf8f0;color:#114c41;text-align:center;font-weight:950}
  #accountingConfigModal .accounting-output-note-table td.is-number{text-align:right}
  #accountingConfigModal .accounting-preview-note-button{display:inline-flex;max-width:100%;min-width:82px;min-height:32px;align-items:center;justify-content:center;padding:6px 10px;border:1px dashed rgba(17,76,65,.22);border-radius:7px;background:#f5f8f7;color:rgba(17,76,65,.58);font:inherit;font-size:.65rem;font-weight:900;line-height:1.2;cursor:pointer;opacity:.66;transition:border-color .16s ease,background .16s ease,color .16s ease,box-shadow .16s ease,opacity .16s ease,transform .16s ease}
  #accountingConfigModal .accounting-preview-note-button:hover,#accountingConfigModal .accounting-preview-note-button:focus-visible{border-color:rgba(17,76,65,.42);background:#eef5f2;color:var(--accent-deep);outline:none;opacity:1;transform:translateY(-1px)}
  #accountingConfigModal .accounting-preview-note-button.is-linked{border-style:solid;opacity:1}
  #accountingConfigModal .accounting-preview-note-button.is-linked.is-required{border-color:#d44b3d;background:#fff0ed;color:#a72e24;box-shadow:inset 0 0 0 1px rgba(212,75,61,.12)}
  #accountingConfigModal .accounting-preview-note-button.is-linked.is-required:hover,#accountingConfigModal .accounting-preview-note-button.is-linked.is-required:focus-visible{border-color:#b93328;background:#ffe4df;color:#8f241c}
  #accountingConfigModal .accounting-preview-note-button.is-linked.is-optional{border-color:#78ad99;background:#eaf6f0;color:#15584a}
  #accountingConfigModal .accounting-preview-note-button.is-linked.is-optional:hover,#accountingConfigModal .accounting-preview-note-button.is-linked.is-optional:focus-visible{border-color:#4d8f78;background:#def1e7;color:#0f4a3e}
  #accountingConfigModal .accounting-preview-note-code{display:block;overflow:hidden;max-width:94px;text-overflow:ellipsis;white-space:nowrap;font-size:.7rem;font-weight:950;letter-spacing:.01em}
  #accountingConfigModal .accounting-preview-note-placeholder{white-space:nowrap;font-size:.59rem;font-weight:850}
  #accountingConfigModal .accounting-note-auto-link{display:grid;gap:5px}
  #accountingConfigModal .accounting-note-auto-link .ui-button{width:100%;justify-content:center}
  #accountingConfigModal .accounting-note-auto-link small{color:var(--muted-strong);font-size:.64rem;line-height:1.45}
  @media(max-width:760px){#accountingConfigModal .accounting-notes-overlay{padding:0}#accountingConfigModal .accounting-notes-dialog{width:100vw;height:100vh;max-height:none;border-radius:0}#accountingConfigModal .accounting-notes-toolbar{grid-template-columns:1fr}#accountingConfigModal .accounting-note-choice{grid-template-columns:22px 70px minmax(0,1fr)}}
`;
  source = replaceRequired(
    source,
    "</style>",
    styles + "</style>",
    "giao diện danh mục thuyết minh",
  );

  source = replaceRequired(
    source,
    '<label class="ui-module-field"><span class="ui-module-label">Thuyết minh</span><input class="ui-module-input" name="noteReference" placeholder="Ví dụ: 01"></label>',
    '<div class="accounting-note-catalog-field"><label class="ui-module-field"><span class="ui-module-label">Dòng thuyết minh liên kết</span><select class="ui-module-select" name="noteItemId" data-accounting-note-options><option value="">Không liên kết thuyết minh</option></select></label><input type="hidden" name="noteReference"><label class="accounting-note-required"><input type="checkbox" name="noteRequired"><span>Bắt buộc xuất dòng thuyết minh này trong mọi lần tạo báo cáo</span></label><small class="accounting-note">Danh mục được kiểm tra với MISA tối đa một lần trong 24 giờ.</small></div>',
    "chọn thuyết minh ở form dòng báo cáo",
  );

  source = replaceRequired(
    source,
    '<div class="accounting-runtime-actions"><button id="accountingOutputSelectSamePeriod" class="ui-button ui-button--secondary" type="button">Chọn tất cả phiên cùng kỳ</button><button id="accountingOutputGenerate" class="ui-button ui-button--primary" type="button">Tạo bản xem trước</button></div>',
    '<div id="accountingNoteCatalogStatus" class="accounting-issue">Danh mục thuyết minh sẽ tự kiểm tra tối đa một lần trong 24 giờ.</div><div class="accounting-runtime-actions"><button id="accountingOutputSelectSamePeriod" class="ui-button ui-button--secondary" type="button">Chọn tất cả phiên cùng kỳ</button><button id="accountingOutputGenerate" class="ui-button ui-button--primary" type="button">Tạo bản xem trước</button></div>',
    "trạng thái danh mục thuyết minh khi xuất báo cáo",
  );

  source = replaceRequired(
    source,
    '              <div class="accounting-builder-report-row">\n                <select id="accountingBuilderReportSelect" class="ui-module-select" aria-label="Báo cáo đang dựng"></select>\n                <button id="accountingBuilderNewReport" class="ui-icon-button ui-icon-button--accent" type="button" aria-label="Tạo báo cáo mới" title="Tạo báo cáo mới">+</button>\n              </div>',
    '              <div class="accounting-builder-report-row">\n                <select id="accountingBuilderReportSelect" class="ui-module-select" aria-label="Báo cáo đang dựng"></select>\n                <button id="accountingBuilderNewReport" class="ui-icon-button ui-icon-button--accent" type="button" aria-label="Tạo báo cáo mới" title="Tạo báo cáo mới">+</button>\n              </div>\n              <div class="accounting-note-auto-link"><button id="accountingBuilderAutoLinkNotes" class="ui-button ui-button--secondary" type="button">Tự ghép thuyết minh chuẩn MISA</button><small>Chỉ ghép các dòng xác định chắc chắn; không ghi đè liên kết đã chỉnh thủ công.</small></div>',
    "nút tự ghép thuyết minh trong bộ dựng",
  );

  const pickerMarkup = `
        <div id="accountingNotesPicker" class="accounting-notes-overlay" aria-hidden="true">
          <section class="accounting-notes-dialog" role="dialog" aria-modal="true" aria-labelledby="accountingNotesPickerTitle">
            <div class="accounting-notes-head"><div><p class="accounting-kicker">Thuyết minh báo cáo</p><h3 id="accountingNotesPickerTitle">Chọn thêm dòng muốn xuất hiện</h3><p class="accounting-note">Dòng bắt buộc đã được khóa sẵn. Kế toán chỉ cần tích thêm những dòng cần cho lần xuất này.</p></div><button class="ui-close-button" type="button" data-accounting-close-notes aria-label="Đóng">&times;</button></div>
            <div class="accounting-notes-toolbar"><input id="accountingNotesSearch" class="ui-module-input" type="search" placeholder="Tìm theo mã hoặc nội dung thuyết minh"><span id="accountingNotesCount" class="ui-badge">0 dòng</span></div>
            <div id="accountingNotesList" class="accounting-notes-list"><div class="accounting-empty">Đang đọc danh mục thuyết minh...</div></div>
            <div class="accounting-notes-actions"><button class="ui-button ui-button--secondary" type="button" data-accounting-close-notes>Hủy</button><button id="accountingNotesContinue" class="ui-button ui-button--primary" type="button">Dùng các dòng đã chọn</button></div>
          </section>
        </div>
`;
  source = replaceRequired(
    source,
    "        <div id=\"accountingReportEditor\"",
    pickerMarkup + "        <div id=\"accountingReportEditor\"",
    "popup chọn thuyết minh",
  );

  source = replaceRequired(
    source,
    "    reportOutput: null, reportOutputRequest: null, reportOutputExport: null, outputSelectedSnapshotKeys: []",
    "    reportOutput: null, reportOutputRequest: null, reportOutputExport: null, outputSelectedSnapshotKeys: [],\n    noteCatalog: null, noteCatalogPromise: null, noteCatalogSourceSignature: '', outputSelectedNoteIds: [], outputMandatoryNoteIds: [], pendingOutputRequest: null",
    "trạng thái thuyết minh",
  );

  const noteFunctions = `
  function accountingNoteItems() {
    return state.noteCatalog && Array.isArray(state.noteCatalog.items) ? state.noteCatalog.items : [];
  }
  function accountingNoteById(itemId) {
    itemId = text(itemId).toLowerCase();
    return accountingNoteItems().find(function (item) { return text(item.itemId).toLowerCase() === itemId; }) || null;
  }
  function accountingNoteOptionHtml(selected) {
    var current = text(selected).toLowerCase();
    var options = '<option value="">Không liên kết thuyết minh</option>';
    var lastPart = '';
    accountingNoteItems().forEach(function (item) {
      var part = text(item.partInTab || item.part || 'Danh mục thuyết minh');
      if (part !== lastPart) {
        if (lastPart) options += '</optgroup>';
        options += '<optgroup label="' + escapeHtml(part) + '">';
        lastPart = part;
      }
      var itemId = text(item.itemId).toLowerCase();
      options += '<option value="' + escapeHtml(itemId) + '"' + (itemId === current ? ' selected' : '') + '>' + escapeHtml((item.itemCode ? item.itemCode + ' · ' : '') + item.itemName) + '</option>';
    });
    if (lastPart) options += '</optgroup>';
    return options;
  }
  function builderNoteCellHtml(rowPayload, rowType) {
    if (rowType === 'SPACER') return '&nbsp;';
    rowPayload = rowPayload || {};
    var itemId = text(rowPayload.noteItemId).toLowerCase();
    var linkedNote = accountingNoteById(itemId);
    var noteCode = text(linkedNote && linkedNote.itemCode || rowPayload.noteReference);
    var noteName = text(linkedNote && linkedNote.itemName);
    var isLinked = !!itemId;
    var isRequired = isLinked && rowPayload.noteRequired === true;
    var buttonLabel = isLinked
      ? 'Đổi thuyết minh ' + (noteCode || noteName || '')
      : (noteCode ? 'Ghép mã ' + noteCode + ' với danh mục thuyết minh' : 'Chọn và ghép thuyết minh');
    var title = isLinked
      ? ((noteCode ? noteCode + ' · ' : '') + (noteName || 'Dòng thuyết minh') + ' — Bấm để đổi hoặc bỏ liên kết')
      : 'Bấm để chọn một dòng trong danh mục thuyết minh MISA';
    var content = isLinked
      ? '<span class="accounting-preview-note-code">' + escapeHtml(noteCode || 'Đã ghép') + '</span>'
      : '<span class="accounting-preview-note-placeholder">' + escapeHtml(noteCode ? noteCode + ' · Ghép danh mục' : 'Ghép thuyết minh') + '</span>';
    var stateClass = isLinked ? ' is-linked ' + (isRequired ? 'is-required' : 'is-optional') : ' is-empty';
    return '<button class="accounting-preview-note-button' + stateClass + '" type="button" aria-label="' + escapeHtml(buttonLabel) + '" title="' + escapeHtml(title) + '">' + content + '</button>';
  }
  function accountingNoteByCode(itemCode) {
    itemCode = text(itemCode).toUpperCase();
    var matches = accountingNoteItems().filter(function (item) { return text(item.itemCode).toUpperCase() === itemCode; });
    return matches.find(function (item) { return Number(item.formulaType) === 2; }) || matches[0] || null;
  }
  function accountingAutomaticNoteMap() {
    return {
      BAO_CAO_KET_QUA_KINH_DOANH: {
        '01': 'VI.1', '02': 'VI.2', '11': 'VI.3', '21': 'VI.4',
        '22': 'VI.5', '23': 'VI.6', '24': 'VI.6.1', '25': 'VI.9',
        '26': 'VI.9', '31': 'VI.7', '32': 'VI.8', '51': 'VI.11', '52': 'VI.11'
      },
      BAO_CAO_TINH_HINH_TAI_CHINH: {
        '110': 'V.1', '120': 'V.2', '260': 'V.2',
        '131': 'V.3', '211': 'V.3', '135': 'V.4', '215': 'V.4',
        '137': 'V.5', '136': 'V.6', '216': 'V.6', '140': 'V.7',
        '250': 'V.8', '221': 'V.9', '227': 'V.10', '224': 'V.11',
        '150': 'V.12', '230': 'V.12', '240': 'V.13',
        '161': 'V.14', '271': 'V.14', '165': 'V.15', '274': 'V.15',
        '321': 'V.16', '339': 'V.16', '311': 'V.17', '331': 'V.17',
        '313': 'V.18', '314': 'V.19', '333': 'V.19',
        '316': 'V.20', '334': 'V.20', '320': 'V.21', '338': 'V.21',
        '319': 'V.22', '337': 'V.22', '340': 'V.23', '341': 'V.24',
        '322': 'V.25', '343': 'V.25', '272': 'V.26', '342': 'V.26',
        '400': 'V.27', '416': 'V.28', '417': 'V.29'
      }
    };
  }
  function automaticNoteLinkRecords() {
    var mappings = accountingAutomaticNoteMap();
    var records = [];
    var reportCounts = {};
    recordsForType('REPORT_ROW').forEach(function (record) {
      var payload = Object.assign({}, record.payload || {});
      var reportKey = text(payload.reportKey).toUpperCase();
      var rowCode = text(payload.displayCode || payload.rowCode || record.displayCode);
      var noteCode = mappings[reportKey] && mappings[reportKey][rowCode];
      if (!noteCode || text(payload.noteItemId)) return;
      var noteItem = accountingNoteByCode(noteCode);
      if (!noteItem || !text(noteItem.itemId)) return;
      payload.noteItemId = text(noteItem.itemId).toLowerCase();
      payload.noteReference = text(noteItem.itemCode || noteCode);
      payload.noteRequired = true;
      records.push({ recordType: 'REPORT_ROW', recordId: record.recordId, payload: payload });
      reportCounts[reportKey] = (reportCounts[reportKey] || 0) + 1;
    });
    return { records: records, reportCounts: reportCounts };
  }
  function autoLinkAccountingNotes() {
    if (!selectedVersionIsDraft()) {
      popup('Không thể tự ghép', 'Chỉ phiên bản đang soạn mới được thay đổi liên kết thuyết minh.');
      return;
    }
    loadAccountingNoteCatalog({ ensureFresh: true }).then(function () {
      var suggestion = automaticNoteLinkRecords();
      if (!suggestion.records.length) {
        popup('Không có dòng cần ghép', 'Các dòng xác định chắc chắn đã được ghép, hoặc danh mục MISA chưa sẵn sàng.');
        return;
      }
      var incomeCount = suggestion.reportCounts.BAO_CAO_KET_QUA_KINH_DOANH || 0;
      var balanceCount = suggestion.reportCounts.BAO_CAO_TINH_HINH_TAI_CHINH || 0;
      App.ui.confirm(
        'Hệ thống sẽ ghép ' + suggestion.records.length + ' dòng: ' + incomeCount + ' dòng Kết quả kinh doanh và ' + balanceCount + ' dòng Tình hình tài chính. Các ô đã chỉnh tay được giữ nguyên.',
        { title: 'Tự ghép thuyết minh chuẩn MISA', okLabel: 'Ghép ' + suggestion.records.length + ' dòng' }
      ).then(function (ok) {
        if (!ok) return;
        callServer('saveAccountingReportBuilderRecords', {
          versionId: selectedVersionId(),
          records: suggestion.records,
          note: 'Tự ghép dòng báo cáo với danh mục thuyết minh chuẩn MISA'
        }, {
          write: true,
          loading: 'Đang ghép thuyết minh vào các dòng báo cáo...',
          successPopup: 'Đã ghép thuyết minh chuẩn MISA và lưu lịch sử chỉnh sửa.'
        }).then(function (response) {
          mergeBuilderRecords(response && response.records || []);
        });
      });
    }).catch(function () {});
  }
  function renderAccountingNoteSelects() {
    Array.from(root.querySelectorAll('[data-accounting-note-options]')).forEach(function (select) {
      var current = select.value;
      select.innerHTML = accountingNoteOptionHtml(current);
      select.value = current;
    });
    var status = $('accountingNoteCatalogStatus');
    if (!status) return;
    var items = accountingNoteItems();
    var meta = state.noteCatalog && state.noteCatalog.meta || [];
    var checked = meta[0] && (meta[0].last_checked_at || meta[0].lastCheckedAt);
    status.textContent = items.length
      ? 'Đã sẵn sàng ' + accountingFormatNumber(items.length) + ' dòng thuyết minh' + (checked ? ' · kiểm tra ' + accountingFormatDateTime(checked) : '') + ' · chỉ gọi MISA tối đa 1 lần/24 giờ.'
      : 'Chưa có danh mục thuyết minh trong PostgreSQL. Hệ thống sẽ thử đọc bằng phiên MISA đã lưu.';
  }
  function loadAccountingNoteCatalog(options) {
    options = options || {};
    var sourceKeys = (options.sourceKeys || []).slice().sort();
    var sourceSignature = sourceKeys.length ? sourceKeys.join('|') : 'LATEST';
    if (state.noteCatalog && !options.force && state.noteCatalogSourceSignature === sourceSignature) return Promise.resolve(state.noteCatalog);
    if (state.noteCatalogPromise) return state.noteCatalogPromise;
    var payload = {
      sourceKeys: sourceKeys,
      subAccountingSystem: 99,
      ensureFresh: options.ensureFresh !== false,
      limit: 2000
    };
    var request = options.silent
      ? App.gas('getAccountingDescriptionTemplate', payload)
      : callServer('getAccountingDescriptionTemplate', payload, { loading: 'Đang đọc danh mục thuyết minh...' });
    state.noteCatalogPromise = request.then(function (catalog) {
      state.noteCatalog = catalog || { items: [], meta: [], warnings: [] };
      state.noteCatalogSourceSignature = sourceSignature;
      renderAccountingNoteSelects();
      if (state.builderSelection && state.builderSelection.kind === 'cell') renderBuilderInspector();
      return state.noteCatalog;
    }).catch(function () {
      return state.noteCatalog || { items: [], meta: [], warnings: [] };
    }).then(function (catalog) {
      state.noteCatalogPromise = null;
      return catalog;
    });
    return state.noteCatalogPromise;
  }
  function accountingRequiredNoteIds(reportKey) {
    var required = [];
    recordsForType('REPORT_ROW').forEach(function (record) {
      var payload = record.payload || {};
      var itemId = text(payload.noteItemId).toLowerCase();
      if (text(payload.reportKey).toUpperCase() === text(reportKey).toUpperCase() && payload.noteRequired === true && itemId && required.indexOf(itemId) === -1) required.push(itemId);
    });
    return required;
  }
  function renderAccountingNotesPicker() {
    var list = $('accountingNotesList');
    if (!list) return;
    var search = normalizeSearch($('accountingNotesSearch').value);
    var mandatory = state.outputMandatoryNoteIds || [];
    var selected = state.outputSelectedNoteIds || [];
    var items = accountingNoteItems().filter(function (item) {
      if (!search) return true;
      return normalizeSearch([item.itemCode, item.itemName, item.part].join(' ')).indexOf(search) !== -1;
    });
    mandatory.forEach(function (itemId) {
      var item = accountingNoteById(itemId);
      if (item && items.indexOf(item) === -1) items.unshift(item);
    });
    var visible = items.slice(0, 250);
    $('accountingNotesCount').textContent = selected.length + ' đã chọn · ' + items.length + ' phù hợp';
    list.innerHTML = visible.length ? visible.map(function (item) {
      var itemId = text(item.itemId).toLowerCase();
      var required = mandatory.indexOf(itemId) !== -1;
      var checked = required || selected.indexOf(itemId) !== -1;
      return '<label class="accounting-note-choice"><input type="checkbox" data-accounting-note-pick="' + escapeHtml(itemId) + '"' + (checked ? ' checked' : '') + (required ? ' disabled' : '') + '><span class="accounting-note-choice-code">' + escapeHtml(item.itemCode || '—') + '</span><span class="accounting-note-choice-copy"><strong>' + escapeHtml(item.itemName || 'Dòng thuyết minh') + (required ? '<span class="accounting-note-mandatory">Bắt buộc</span>' : '') + '</strong><span>' + escapeHtml(item.part || item.partInTab || 'Thuyết minh báo cáo tài chính') + '</span></span></label>';
    }).join('') : '<div class="accounting-empty">Không tìm thấy dòng thuyết minh phù hợp.</div>';
  }
  function closeAccountingNotesPicker() {
    var picker = $('accountingNotesPicker');
    picker.classList.remove('is-visible');
    picker.setAttribute('aria-hidden', 'true');
    state.pendingOutputRequest = null;
  }
  function openAccountingNotesPicker(request) {
    state.pendingOutputRequest = request;
    state.outputMandatoryNoteIds = accountingRequiredNoteIds(request.reportKey);
    state.outputSelectedNoteIds = state.outputSelectedNoteIds.filter(function (itemId) { return !!accountingNoteById(itemId); });
    state.outputMandatoryNoteIds.forEach(function (itemId) {
      if (state.outputSelectedNoteIds.indexOf(itemId) === -1) state.outputSelectedNoteIds.push(itemId);
    });
    return loadAccountingNoteCatalog({ sourceKeys: request.sourceKeys, ensureFresh: true }).then(function () {
      state.outputMandatoryNoteIds.forEach(function (itemId) {
        if (state.outputSelectedNoteIds.indexOf(itemId) === -1) state.outputSelectedNoteIds.push(itemId);
      });
      $('accountingNotesSearch').value = '';
      renderAccountingNotesPicker();
      var picker = $('accountingNotesPicker');
      picker.classList.add('is-visible');
      picker.setAttribute('aria-hidden', 'false');
      window.setTimeout(function () { $('accountingNotesSearch').focus(); }, 0);
    });
  }
  function generateAccountingOutput(request) {
    return callServer('generateAccountingReportOutput', request, { loading: 'Đang lấy số từ PostgreSQL và dựng báo cáo...' }).then(function (output) {
      state.reportOutput = output; state.reportOutputRequest = request; clearAccountingOutputExportLinks(); renderAccountingOutput();
      var warningCount = output && output.warnings ? output.warnings.length : 0;
      var noteCount = output && output.notes && output.notes.rows ? output.notes.rows.length : 0;
      popup('Đã tạo bản xem trước', 'Đọc ' + accountingFormatNumber(output.balanceRowCount || 0) + ' dòng dữ liệu nguồn · ' + accountingFormatNumber(output.nonZeroCellCount || 0) + ' ô có số' + (noteCount ? ' · ' + noteCount + ' dòng thuyết minh' : '') + (warningCount ? ' · ' + warningCount + ' cảnh báo cần xem.' : '.'));
      return output;
    });
  }
  function accountingOutputNotesHtml(notes) {
    var rows = notes && notes.rows || [];
    if (!rows.length) return '';
    return '<section class="accounting-output-notes"><h5>' + escapeHtml(notes.title || 'THUYẾT MINH BÁO CÁO TÀI CHÍNH') + '</h5><table class="accounting-output-note-table"><colgroup><col style="width:12%"><col style="width:46%"><col style="width:14%"><col style="width:14%"><col style="width:14%"></colgroup><thead><tr><th>Mã</th><th>Nội dung thuyết minh</th><th>Đầu kỳ</th><th>Phát sinh</th><th>Cuối kỳ</th></tr></thead><tbody>' + rows.map(function (row) {
      function amount(value) { return value == null ? '' : accountingOutputNumber(value, '#,##0;(#,##0);-'); }
      var style = (row.isBold || row.required ? 'font-weight:900;' : '') + (row.isItalic ? 'font-style:italic;' : '');
      return '<tr><td style="' + style + '">' + escapeHtml(row.itemCode || '') + '</td><td style="' + style + '">' + escapeHtml(row.itemName || '') + '</td><td class="is-number">' + escapeHtml(amount(row.openingValue)) + '</td><td class="is-number">' + escapeHtml(amount(row.movementValue)) + '</td><td class="is-number">' + escapeHtml(amount(row.closingValue)) + '</td></tr>';
    }).join('') + '</tbody></table></section>';
  }
`;
  source = replaceRequired(
    source,
    "  function renderAccountingOutput() {",
    noteFunctions + "  function renderAccountingOutput() {",
    "logic danh mục và popup thuyết minh",
  );

  source = replaceRequired(
    source,
    "    preview.innerHTML = '<h4 class=\"accounting-output-title\">' + escapeHtml(output.report && (output.report.displayTitle || output.report.reportName) || 'Báo cáo kế toán') + '</h4><p class=\"accounting-output-period\">Kỳ ' + escapeHtml(output.periodFrom || '') + ' đến ' + escapeHtml(output.periodTo || '') + '</p><table class=\"accounting-output-table\">' + colgroup + head + '<tbody>' + (body || '<tr><td colspan=\"' + Math.max(1, columns.length) + '\">Không có dòng dữ liệu.</td></tr>') + '</tbody></table>';",
    "    preview.innerHTML = '<h4 class=\"accounting-output-title\">' + escapeHtml(output.report && (output.report.displayTitle || output.report.reportName) || 'Báo cáo kế toán') + '</h4><p class=\"accounting-output-period\">Kỳ ' + escapeHtml(output.periodFrom || '') + ' đến ' + escapeHtml(output.periodTo || '') + '</p><table class=\"accounting-output-table\">' + colgroup + head + '<tbody>' + (body || '<tr><td colspan=\"' + Math.max(1, columns.length) + '\">Không có dòng dữ liệu.</td></tr>') + '</tbody></table>' + accountingOutputNotesHtml(output.notes);",
    "bản xem trước thuyết minh",
  );

  source = replaceRequired(
    source,
    "      periodFrom: firstFrom, periodTo: firstTo\n    };",
    "      periodFrom: firstFrom, periodTo: firstTo,\n      noteItemIds: state.outputSelectedNoteIds.slice()\n    };",
    "danh sách thuyết minh trong yêu cầu báo cáo",
  );

  source = replaceRequired(
    source,
    "  function builderColorOptions(selected, fill) {",
    "  function builderNoteOptions(selected) { return accountingNoteOptionHtml(selected); }\n  function builderColorOptions(selected, fill) {",
    "danh sách thuyết minh trong bộ dựng",
  );

  source = replaceRequired(
    source,
    "        else if (columnType === 'NOTE_REFERENCE') content = rowType === 'SPACER' ? '&nbsp;' : escapeHtml(payload.noteReference || '');",
    "        else if (columnType === 'NOTE_REFERENCE') content = builderNoteCellHtml(payload, rowType);",
    "nút ghép thuyết minh trực tiếp trong ô bản dựng",
  );

  source = replaceRequired(
    source,
    "'<label class=\"ui-module-field accounting-builder-condition\" data-builder-show=\"TEXT TITLE\"><span class=\"ui-module-label\">Nội dung muốn hiện</span><input class=\"ui-module-input\" name=\"cellText\" value=\"' + escapeHtml(cellText) + '\" placeholder=\"Nhập chữ hoặc tiêu đề\"></label>' +\n          '<label class=\"ui-module-field\"><span class=\"ui-module-label\">Ô này dùng để làm gì?</span><select class=\"ui-module-select\" name=\"contentKind\">' + builderContentKindOptions(kind) + '</select></label>' +",
    "(selectedColumnType === 'NOTE_REFERENCE' ? '' : '<label class=\"ui-module-field accounting-builder-condition\" data-builder-show=\"TEXT TITLE\"><span class=\"ui-module-label\">Nội dung muốn hiện</span><input class=\"ui-module-input\" name=\"cellText\" value=\"' + escapeHtml(cellText) + '\" placeholder=\"Nhập chữ hoặc tiêu đề\"></label>') +\n          (selectedColumnType === 'NOTE_REFERENCE' ? '<div class=\"accounting-note-catalog-field\"><input type=\"hidden\" name=\"cellText\" value=\"' + escapeHtml(cellText) + '\"><label class=\"ui-module-field\"><span class=\"ui-module-label\">Dòng thuyết minh</span><select class=\"ui-module-select\" name=\"noteItemId\">' + builderNoteOptions(payload.noteItemId) + '</select></label><label class=\"accounting-note-required\"><input type=\"checkbox\" name=\"noteRequired\"' + (payload.noteRequired ? ' checked' : '') + '><span>Bắt buộc xuất dòng này trong báo cáo</span></label><small class=\"accounting-note\">Mã và tên lấy từ danh mục MISA; công thức của mẫu vẫn được khóa và tính trên ứng dụng.</small></div>' : '') +\n          '<label class=\"ui-module-field\"><span class=\"ui-module-label\">Ô này dùng để làm gì?</span><select class=\"ui-module-select\" name=\"contentKind\">' + builderContentKindOptions(kind) + '</select></label>' +",
    "chọn dòng thuyết minh trong ô bộ dựng",
  );

  source = replaceRequired(
    source,
    "      } else if (selectedColumnPayload.columnType === 'NOTE_REFERENCE' && contentKind === 'TEXT') {\n        rowPayload.noteReference = cellPayload.text;\n      }",
    "      } else if (selectedColumnPayload.columnType === 'NOTE_REFERENCE' && contentKind === 'TEXT') {\n        rowPayload.noteItemId = form.elements.noteItemId ? text(form.elements.noteItemId.value).toLowerCase() : '';\n        var linkedNote = accountingNoteById(rowPayload.noteItemId);\n        rowPayload.noteReference = linkedNote ? text(linkedNote.itemCode) : cellPayload.text;\n        rowPayload.noteRequired = !!(rowPayload.noteItemId && form.elements.noteRequired && form.elements.noteRequired.checked);\n        cellPayload.text = rowPayload.noteReference;\n      }",
    "lưu khóa và trạng thái bắt buộc của thuyết minh",
  );

  source = replaceRequired(
    source,
    "    return payload;\n  }\n  function resetForm(form) {",
    "    if (form.dataset.accountingForm === 'REPORT_ROW' && payload.noteItemId) {\n      var linkedNote = accountingNoteById(payload.noteItemId);\n      payload.noteReference = linkedNote ? text(linkedNote.itemCode) : payload.noteReference;\n      payload.noteRequired = !!payload.noteRequired;\n    }\n    return payload;\n  }\n  function resetForm(form) {",
    "chuẩn hóa thuyết minh ở form dòng",
  );

  source = replaceRequired(
    source,
    "    $('accountingOutputGenerate').addEventListener('click', function () {\n      var request;\n      try { request = accountingOutputRequestPayload(); }\n      catch (error) { popup('Chưa thể tạo báo cáo', error && error.message || String(error)); return; }\n      callServer('generateAccountingReportOutput', request, { loading: 'Đang lấy số từ PostgreSQL và dựng báo cáo...' }).then(function (output) {\n        state.reportOutput = output; state.reportOutputRequest = request; clearAccountingOutputExportLinks(); renderAccountingOutput();\n        var warningCount = output && output.warnings ? output.warnings.length : 0;\n        popup('Đã tạo bản xem trước', 'Đọc ' + accountingFormatNumber(output.balanceRowCount || 0) + ' dòng dữ liệu nguồn · ' + accountingFormatNumber(output.nonZeroCellCount || 0) + ' ô có số' + (warningCount ? ' · ' + warningCount + ' cảnh báo cần xem.' : '.'));\n      }).catch(function () {});\n    });",
    "    $('accountingOutputGenerate').addEventListener('click', function () {\n      var request;\n      try { request = accountingOutputRequestPayload(); }\n      catch (error) { popup('Chưa thể tạo báo cáo', error && error.message || String(error)); return; }\n      if (request.reportKey === 'DATA_CHECK') { generateAccountingOutput(request).catch(function () {}); return; }\n      openAccountingNotesPicker(request).catch(function () {});\n    });",
    "mở popup trước khi tạo báo cáo",
  );

  source = replaceRequired(
    source,
    "    $('accountingOutputExport').addEventListener('click', function () {",
    "    $('accountingNotesSearch').addEventListener('input', renderAccountingNotesPicker);\n    $('accountingNotesList').addEventListener('change', function (event) {\n      var input = event.target.closest('[data-accounting-note-pick]');\n      if (!input) return;\n      var itemId = text(input.dataset.accountingNotePick).toLowerCase();\n      state.outputSelectedNoteIds = state.outputSelectedNoteIds.filter(function (value) { return value !== itemId; });\n      if (input.checked) state.outputSelectedNoteIds.push(itemId);\n      renderAccountingNotesPicker();\n    });\n    root.addEventListener('click', function (event) {\n      if (event.target.closest('[data-accounting-close-notes]') || event.target === $('accountingNotesPicker')) closeAccountingNotesPicker();\n    });\n    $('accountingNotesContinue').addEventListener('click', function () {\n      var request = state.pendingOutputRequest;\n      if (!request) return;\n      request.noteItemIds = state.outputSelectedNoteIds.slice();\n      closeAccountingNotesPicker();\n      generateAccountingOutput(request).catch(function () {});\n    });\n    $('accountingOutputExport').addEventListener('click', function () {",
    "sự kiện popup thuyết minh",
  );

  source = replaceRequired(
    source,
    "    state.builderSelection = Object.assign({ reportKey: state.previewReportKey }, selection || {});\n    state.builderDraft = null;\n    renderBuilderInspector();",
    "    state.builderSelection = Object.assign({ reportKey: state.previewReportKey }, selection || {});\n    state.builderDraft = null;\n    if (state.builderSelection.kind === 'cell') {\n      var noteColumn = builderRecordById('REPORT_COLUMN', state.builderSelection.columnRecordId);\n      if (noteColumn && text(noteColumn.payload && noteColumn.payload.columnType).toUpperCase() === 'NOTE_REFERENCE' && !state.noteCatalog) loadAccountingNoteCatalog({ silent: true, ensureFresh: true });\n    }\n    renderBuilderInspector();",
    "tự tải danh mục khi chọn ô thuyết minh",
  );

  source = replaceRequired(
    source,
    "      if (event.target.closest('#accountingBuilderNewReport')) { openReportEditor(null); return; }",
    "      if (event.target.closest('#accountingBuilderAutoLinkNotes')) { autoLinkAccountingNotes(); return; }\n      if (event.target.closest('#accountingBuilderNewReport')) { openReportEditor(null); return; }",
    "sự kiện tự ghép thuyết minh",
  );

  source = replaceRequired(
    source,
    "  function onOpen() {\n    accountingSetRuntimeDateDefaults();",
    "  function onOpen() {\n    accountingSetRuntimeDateDefaults();\n    loadAccountingNoteCatalog({ silent: true, ensureFresh: true });",
    "kiểm tra danh mục thuyết minh mỗi ngày khi mở module",
  );

  return source;
}
