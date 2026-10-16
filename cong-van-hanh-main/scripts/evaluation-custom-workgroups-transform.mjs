function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) {
    throw new Error(`Không tìm thấy điểm gắn ${label} trong EvaluationConfigModal.html.`);
  }
  return source.replace(needle, replacement);
}

function replaceFunction(source, name, replacement) {
  const startMarker = `  function ${name}(`;
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Không tìm thấy hàm ${name}.`);
  const end = source.indexOf("\n  function ", start + startMarker.length);
  if (end < 0) throw new Error(`Không tìm thấy cuối hàm ${name}.`);
  return source.slice(0, start) + replacement.trimEnd() + source.slice(end);
}

function removeRequiredDiv(source, startMarker, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Không tìm thấy ${label}.`);
  const tagPattern = /<\/?div\b[^>]*>/gi;
  tagPattern.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tagPattern.exec(source))) {
    if (/^<\/div/i.test(match[0])) depth -= 1;
    else depth += 1;
    if (depth === 0) {
      return source.slice(0, start) + source.slice(tagPattern.lastIndex);
    }
  }
  throw new Error(`Không tìm thấy thẻ đóng của ${label}.`);
}

const styles = `
  #evaluationConfigModal .evaluation-work-group-definition-list{display:grid;gap:10px}
  #evaluationConfigModal .evaluation-jd-bulk-assign{display:grid;gap:4px;min-width:190px}
  #evaluationConfigModal .evaluation-jd-bulk-assign>span{color:var(--muted-strong);font-size:.68rem;font-weight:850;text-transform:uppercase}
  #evaluationConfigModal .evaluation-jd-criteria-map{display:grid;gap:12px;margin-top:6px;padding:14px;border:1px solid rgba(17,76,65,.1);border-radius:8px;background:rgba(255,255,255,.82)}
  #evaluationConfigModal .evaluation-jd-criteria-map-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}
  #evaluationConfigModal .evaluation-jd-criteria-map-table{width:100%;border-collapse:separate;border-spacing:0;overflow:hidden;border:1px solid rgba(17,76,65,.11);border-radius:8px;background:#fff}
  #evaluationConfigModal .evaluation-jd-criteria-map-table th{padding:10px 12px;background:rgba(17,76,65,.06);color:var(--accent-deep);font-size:.69rem;font-weight:950;text-align:left;text-transform:uppercase}
  #evaluationConfigModal .evaluation-jd-criteria-map-table td{padding:10px 12px;border-top:1px solid rgba(17,76,65,.09);vertical-align:middle}
  #evaluationConfigModal .evaluation-jd-criteria-map-table td:first-child{width:36%;color:var(--accent-deep);font-weight:900}
  #evaluationConfigModal .evaluation-jd-activity-row{grid-template-columns:minmax(0,1.35fr) minmax(180px,.6fr) minmax(120px,.42fr) minmax(104px,.35fr) minmax(170px,.65fr)}
  #evaluationConfigModal .evaluation-jd-activity-row[data-activity-type="execution"]{border-left-color:#2e7d62}
  #evaluationConfigModal .evaluation-jd-activity-row[data-activity-type="management"]{border-left-color:#d06b2a}
  #evaluationConfigModal .evaluation-jd-activity-row[data-activity-type="excluded"]{border-left-color:#8a9793;opacity:.76}
  @media(max-width:980px){#evaluationConfigModal .evaluation-jd-activity-row{grid-template-columns:1fr 1fr}#evaluationConfigModal .evaluation-jd-activity-copy{grid-column:1/-1}}
  @media(max-width:680px){#evaluationConfigModal .evaluation-jd-activity-row{grid-template-columns:1fr}#evaluationConfigModal .evaluation-jd-criteria-map-table,#evaluationConfigModal .evaluation-jd-criteria-map-table tbody,#evaluationConfigModal .evaluation-jd-criteria-map-table tr,#evaluationConfigModal .evaluation-jd-criteria-map-table td{display:block;width:100%}#evaluationConfigModal .evaluation-jd-criteria-map-table thead{display:none}#evaluationConfigModal .evaluation-jd-criteria-map-table td:first-child{width:100%;padding-bottom:4px;border-top:1px solid rgba(17,76,65,.09)}#evaluationConfigModal .evaluation-jd-criteria-map-table td:last-child{padding-top:4px;border-top:0}}
`;

const workGroupPane = `
          <section class="evaluation-config-subpane" data-evaluation-criteria-pane="work-groups">
            <div class="evaluation-config-grid">
              <section class="evaluation-config-panel">
                <div class="evaluation-config-panel-head">
                  <div>
                    <p class="evaluation-config-kicker">Nhóm công việc</p>
                    <h3 class="evaluation-config-title">Định nghĩa nhóm công việc đánh giá</h3>
                    <p class="evaluation-config-note">Tạo các nhóm dùng để phân loại đầu việc trong JD, ví dụ: Vận hành, Chuyên môn, Quản trị, Phát triển đội ngũ.</p>
                  </div>
                  <button class="ui-button ui-button--secondary" type="button" data-action="reset-work-group-definition">Tạo mới</button>
                </div>
                <form id="evaluationWorkGroupDefinitionForm" class="evaluation-config-form" novalidate>
                  <input id="evaluationWorkGroupDefinitionId" type="hidden">
                  <div class="evaluation-config-form-grid">
                    <label class="evaluation-config-field evaluation-config-field--wide"><span class="evaluation-config-label">Tên Nhóm công việc</span><input id="evaluationWorkGroupDefinitionName" class="evaluation-config-input" type="text" placeholder="Vận hành"></label>
                    <label class="evaluation-config-field"><span class="evaluation-config-label">Mã nhóm</span><input id="evaluationWorkGroupDefinitionCode" class="evaluation-config-input evaluation-config-code-input" type="text" readonly placeholder="Tự sinh khi nhập tên"></label>
                    <label class="evaluation-config-field evaluation-config-field--wide"><span class="evaluation-config-label">Mô tả</span><textarea id="evaluationWorkGroupDefinitionDescription" class="evaluation-config-textarea" placeholder="Phạm vi công việc thuộc nhóm này"></textarea></label>
                  </div>
                  <div class="evaluation-config-action-row"><button class="ui-button ui-button--primary" type="submit">Lưu Nhóm công việc</button></div>
                </form>
              </section>
              <section class="evaluation-config-panel">
                <div class="evaluation-config-panel-head"><div><p class="evaluation-config-kicker">Danh sách</p><h3 class="evaluation-config-title">Nhóm công việc đang dùng</h3></div></div>
                <div id="evaluationWorkGroupDefinitionList" class="evaluation-config-list evaluation-work-group-definition-list"></div>
              </section>
            </div>
          </section>

`;

const criteriaMap = `
              <section class="evaluation-jd-criteria-map" aria-label="Đánh giá tiêu chuẩn theo Nhóm công việc">
                <div class="evaluation-jd-criteria-map-head">
                  <div><p class="evaluation-config-kicker">Đánh giá tiêu chuẩn</p><h4 class="evaluation-criteria-set-editor-title">Bộ tiêu chí theo Nhóm công việc</h4><p class="evaluation-config-note">Chỉ hiển thị các Nhóm công việc đã được gán cho đầu việc trong JD này.</p></div>
                </div>
                <div id="evaluationJdWorkGroupCriteriaTable"></div>
              </section>`;

const workGroupFunctions = `
  function evaluationWorkGroupDefinitions() {
    return list('workGroupDefinitions').filter(isActiveLine).slice().sort(function (left, right) {
      return (numValue(left.sortOrder) || 0) - (numValue(right.sortOrder) || 0) || text(left.name || left.workGroupName).localeCompare(text(right.name || right.workGroupName), 'vi');
    });
  }
  function evaluationWorkGroupId(item) {
    return text(item && (item.id || item.workGroupId || item.code || item.workGroupCode));
  }
  function evaluationWorkGroupKeys(item) {
    return [item && item.id, item && item.workGroupId, item && item.code, item && item.workGroupCode, item && item.name, item && item.workGroupName].map(text).filter(Boolean);
  }
  function evaluationWorkGroupByValue(value) {
    var target = text(value);
    return evaluationWorkGroupDefinitions().find(function (item) { return evaluationWorkGroupKeys(item).indexOf(target) !== -1; }) || null;
  }
  function evaluationWorkGroupLegacyType(item) {
    var explicit = jdActivityType(item && item.legacyActivityType);
    if (explicit === 'execution' || explicit === 'management') return explicit;
    var key = normalizeKey(item && (item.code || item.workGroupCode || item.name || item.workGroupName));
    return key.indexOf('management') !== -1 || key.indexOf('quan_ly') !== -1 || key.indexOf('quan ly') !== -1 ? 'management' : 'execution';
  }
  function defaultEvaluationWorkGroupForType(activityType) {
    var target = jdActivityType(activityType);
    var items = evaluationWorkGroupDefinitions();
    return items.find(function (item) { return boolValue(item.isDefault); }) || items.find(function (item) { return evaluationWorkGroupLegacyType(item) === target; }) || items[0] || null;
  }
  function ensureJdActivityWorkGroupAssignment(activity) {
    var type = jdActivityType(activity && activity.activityType);
    if (type === 'excluded') return Object.assign({}, activity, { evaluationWorkGroupId: '', evaluationWorkGroupCode: '', evaluationWorkGroupName: '' });
    var assigned = evaluationWorkGroupByValue(activity && (activity.evaluationWorkGroupId || activity.evaluationWorkGroupCode || activity.evaluationWorkGroupName));
    if (!assigned && (type === 'execution' || type === 'management')) assigned = defaultEvaluationWorkGroupForType(type);
    if (!assigned) return activity;
    return Object.assign({}, activity, {
      activityType: evaluationWorkGroupLegacyType(assigned),
      evaluationWorkGroupId: evaluationWorkGroupId(assigned),
      evaluationWorkGroupCode: assigned.code || assigned.workGroupCode || '',
      evaluationWorkGroupName: assigned.name || assigned.workGroupName || ''
    });
  }
  function activityEvaluationWorkGroup(activity) {
    return evaluationWorkGroupByValue(activity && (activity.evaluationWorkGroupId || activity.evaluationWorkGroupCode || activity.evaluationWorkGroupName));
  }
  function evaluationWorkGroupOptionsHtml(selected, includeExcluded) {
    var current = text(selected);
    var options = '<option value="">Chưa gán Nhóm công việc</option>' + evaluationWorkGroupDefinitions().map(function (item) {
      var value = evaluationWorkGroupId(item);
      return '<option value="' + escapeHtml(value) + '"' + (value === current ? ' selected' : '') + '>' + escapeHtml(item.name || item.workGroupName || item.code) + '</option>';
    }).join('');
    if (includeExcluded) options += '<option value="__excluded__"' + (current === '__excluded__' ? ' selected' : '') + '>Không đánh giá</option>';
    return options;
  }
  function assignedEvaluationWorkGroups() {
    var seen = {};
    return (state.jdActivityDraftItems || []).reduce(function (items, activity) {
      if (jdActivityType(activity.activityType) === 'excluded') return items;
      var group = activityEvaluationWorkGroup(activity);
      if (!group) return items;
      var key = evaluationWorkGroupId(group);
      if (!key || seen[key]) return items;
      seen[key] = true;
      items.push(group);
      return items;
    }, []);
  }
  function criteriaMappingMatchesGroup(mapping, group) {
    var mappingKeys = [mapping && mapping.evaluationWorkGroupId, mapping && mapping.evaluationWorkGroupCode, mapping && mapping.evaluationWorkGroupName, mapping && mapping.workGroupId, mapping && mapping.workGroupCode, mapping && mapping.workGroupName].map(text).filter(Boolean);
    return evaluationWorkGroupKeys(group).some(function (key) { return mappingKeys.indexOf(key) !== -1; });
  }
  function buildJdCriteriaMappings(document) {
    return Array.isArray(document && document.criteriaMappings) ? document.criteriaMappings.map(function (line) { return Object.assign({}, line); }) : [];
  }
  function ensureJdCriteriaMappings() {
    var previous = state.jdCriteriaMappings || [];
    state.jdCriteriaMappings = assignedEvaluationWorkGroups().map(function (group) {
      var current = previous.find(function (line) { return criteriaMappingMatchesGroup(line, group); }) || {};
      var legacyType = evaluationWorkGroupLegacyType(group);
      var fallbackSetId = legacyType === 'management' ? state.jdManagementCriteriaSetId : state.jdExecutionCriteriaSetId;
      return {
        evaluationWorkGroupId: evaluationWorkGroupId(group),
        evaluationWorkGroupCode: group.code || group.workGroupCode || '',
        evaluationWorkGroupName: group.name || group.workGroupName || '',
        criteriaSetId: current.criteriaSetId || current.criteriaSetCode || fallbackSetId || '',
        criteriaSetCode: current.criteriaSetCode || '',
        criteriaSetName: current.criteriaSetName || ''
      };
    });
  }
  function criteriaMappingForGroup(group) {
    return (state.jdCriteriaMappings || []).find(function (line) { return criteriaMappingMatchesGroup(line, group); }) || null;
  }
  function setJdActivityEvaluationWorkGroup(activityId, value) {
    state.jdActivityDraftItems = (state.jdActivityDraftItems || []).map(function (activity) {
      if (String(activity.id || activity.code || '') !== String(activityId || '')) return activity;
      if (value === '__excluded__') return Object.assign({}, activity, { activityType: 'excluded', evaluationWorkGroupId: '', evaluationWorkGroupCode: '', evaluationWorkGroupName: '' });
      var group = evaluationWorkGroupByValue(value);
      if (!group) return Object.assign({}, activity, { activityType: 'unclassified', evaluationWorkGroupId: '', evaluationWorkGroupCode: '', evaluationWorkGroupName: '' });
      return Object.assign({}, activity, {
        activityType: evaluationWorkGroupLegacyType(group),
        evaluationWorkGroupId: evaluationWorkGroupId(group),
        evaluationWorkGroupCode: group.code || group.workGroupCode || '',
        evaluationWorkGroupName: group.name || group.workGroupName || ''
      });
    });
    ensureJdCriteriaMappings();
    renderJdWorkspace();
  }
  function assignJdNaturalGroup(groupValue, workGroupValue) {
    var naturalGroup = byId(state.jdWorkGroupDraftItems || [], groupValue, ['draftKey', 'id', 'code', 'workGroupCode']);
    var assigned = evaluationWorkGroupByValue(workGroupValue);
    if (!naturalGroup || !assigned) return;
    state.jdActivityDraftItems = (state.jdActivityDraftItems || []).map(function (activity) {
      return jdActivityGroupMatches(activity, naturalGroup) ? Object.assign({}, activity, {
        activityType: evaluationWorkGroupLegacyType(assigned),
        evaluationWorkGroupId: evaluationWorkGroupId(assigned),
        evaluationWorkGroupCode: assigned.code || assigned.workGroupCode || '',
        evaluationWorkGroupName: assigned.name || assigned.workGroupName || ''
      }) : activity;
    });
    ensureJdCriteriaMappings();
    renderJdWorkspace();
  }
  function setJdWorkGroupCriteria(groupValue, criteriaSetValue) {
    var group = evaluationWorkGroupByValue(groupValue);
    if (!group) return;
    var criteriaSet = byId(list('criteriaSets'), criteriaSetValue, ['id', 'criteriaSetId', 'code', 'criteriaSetCode']) || {};
    var mapping = criteriaMappingForGroup(group);
    if (!mapping) {
      ensureJdCriteriaMappings();
      mapping = criteriaMappingForGroup(group);
    }
    if (mapping) {
      mapping.criteriaSetId = criteriaSet.id || criteriaSet.criteriaSetId || criteriaSetValue || '';
      mapping.criteriaSetCode = criteriaSet.code || criteriaSet.criteriaSetCode || '';
      mapping.criteriaSetName = criteriaSet.name || criteriaSet.criteriaSetName || '';
    }
    var legacyType = evaluationWorkGroupLegacyType(group);
    if (legacyType === 'management') state.jdManagementCriteriaSetId = mapping && mapping.criteriaSetId || '';
    else if (legacyType === 'execution') state.jdExecutionCriteriaSetId = mapping && mapping.criteriaSetId || '';
    renderJdWorkGroups();
  }
  function renderJdCriteriaMappingTable() {
    var node = $('evaluationJdWorkGroupCriteriaTable');
    if (!node) return;
    ensureJdCriteriaMappings();
    var groups = assignedEvaluationWorkGroups();
    if (!groups.length) {
      node.innerHTML = '<div class="evaluation-config-empty">Gán Nhóm công việc cho ít nhất một đầu việc để thiết lập Bộ tiêu chí.</div>';
      return;
    }
    var rows = groups.map(function (group) {
      var mapping = criteriaMappingForGroup(group) || {};
      return '<tr><td>' + escapeHtml(group.name || group.workGroupName || group.code) + '</td><td><select class="evaluation-config-select" data-jd-group-criteria data-group-id="' + escapeHtml(evaluationWorkGroupId(group)) + '">' + selectOptionsHtml(criteriaSetOptions(), mapping.criteriaSetId || mapping.criteriaSetCode || '', 'Chọn Bộ tiêu chí') + '</select></td></tr>';
    }).join('');
    node.innerHTML = '<table class="evaluation-jd-criteria-map-table"><thead><tr><th>Nhóm công việc</th><th>Bộ tiêu chí</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  function renderWorkGroupDefinitions() {
    renderRows('evaluationWorkGroupDefinitionList', evaluationWorkGroupDefinitions(), 'Chưa có Nhóm công việc.', function (item) {
      var itemId = evaluationWorkGroupId(item);
      var actions = item.isVirtual ? '' : mini('edit-work-group-definition', itemId, 'Sửa') + miniDelete('workGroupDefinition', itemId, 'Xóa nhóm');
      return row(item.name || item.workGroupName || item.code, item.code || item.workGroupCode || '', actions, pills([item.legacyActivityType === 'management' ? 'Tương thích Quản lý' : item.legacyActivityType === 'execution' ? 'Tương thích Thực thi' : 'Nhóm tùy biến', item.isVirtual ? 'Mặc định hệ thống' : 'Đang dùng']));
    });
  }
  function resetWorkGroupDefinition() {
    if ($('evaluationWorkGroupDefinitionId')) $('evaluationWorkGroupDefinitionId').value = '';
    if ($('evaluationWorkGroupDefinitionCode')) $('evaluationWorkGroupDefinitionCode').value = '';
    if ($('evaluationWorkGroupDefinitionName')) $('evaluationWorkGroupDefinitionName').value = '';
    if ($('evaluationWorkGroupDefinitionDescription')) $('evaluationWorkGroupDefinitionDescription').value = '';
  }
  function editWorkGroupDefinition(id) {
    var item = evaluationWorkGroupByValue(id);
    if (!item || item.isVirtual) return;
    $('evaluationWorkGroupDefinitionId').value = item.id || '';
    $('evaluationWorkGroupDefinitionCode').value = item.code || item.workGroupCode || '';
    $('evaluationWorkGroupDefinitionName').value = item.name || item.workGroupName || '';
    $('evaluationWorkGroupDefinitionDescription').value = item.description || '';
    activateCriteriaSubtab('work-groups');
  }
  function criteriaMappingsForSave() {
    ensureJdCriteriaMappings();
    return (state.jdCriteriaMappings || []).map(function (line) {
      var set = byId(list('criteriaSets'), line.criteriaSetId || line.criteriaSetCode, ['id', 'criteriaSetId', 'code', 'criteriaSetCode']) || {};
      return Object.assign({}, line, {
        criteriaSetId: set.id || set.criteriaSetId || line.criteriaSetId || '',
        criteriaSetCode: set.code || set.criteriaSetCode || line.criteriaSetCode || '',
        criteriaSetName: set.name || set.criteriaSetName || line.criteriaSetName || ''
      });
    });
  }
`;

const renderJdWorkGroups = `
  function renderJdWorkGroups() {
    var node = $('evaluationJdWorkGroupList');
    var document = selectedJdDocument();
    if (!node || !document) return;
    var groups = state.jdWorkGroupDraftItems || [];
    var activities = state.jdActivityDraftItems || [];
    if (!groups.length || !activities.length) {
      node.innerHTML = '<div class="evaluation-config-empty">JD này chưa có cấu trúc công việc. Hãy đồng bộ lại Folder để hệ thống bóc Nhóm công việc và Hoạt động chính.</div>';
      renderJdCriteriaMappingTable();
      return;
    }
    var groupTotal = groups.reduce(function (total, group) { return total + (numValue(group.weightPercent) || 0); }, 0);
    var toolbar = '<div class="evaluation-jd-weight-toolbar"><span class="evaluation-config-pill" data-tone="' + (Math.abs(groupTotal - 100) < 0.01 ? 'muted' : 'orange') + '">Tổng nhóm ' + escapeHtml(formatWeight(groupTotal)) + '%</span><button class="evaluation-config-mini-button" type="button" data-action="equalize-jd-groups">Chia đều nhóm</button><button class="evaluation-config-mini-button" type="button" data-action="normalize-jd-groups">Chuẩn hóa nhóm</button></div>';
    node.innerHTML = toolbar + groups.map(function (group) {
      var groupKey = jdGroupDraftKey(group);
      var collapsed = state.jdCollapsedGroupKeys && state.jdCollapsedGroupKeys[groupKey];
      var groupActivities = activities.filter(function (activity) { return jdActivityGroupMatches(activity, group); });
      var activeGroupActivities = groupActivities.filter(function (activity) { return jdActivityType(activity.activityType) !== 'excluded'; });
      var activityTotal = activeGroupActivities.reduce(function (total, activity) { return total + (numValue(activity.weightPercent) || 0); }, 0);
      return '<section class="evaluation-jd-group"><div class="evaluation-jd-group-head"><div><p class="evaluation-jd-group-name">' + escapeHtml(group.name || group.groupName || group.workGroupName || 'Nhóm công việc trong JD') + '</p><p class="evaluation-config-note">' + escapeHtml(groupActivities.length + ' hoạt động chính · Tổng việc đang tính ' + formatWeight(activityTotal) + '%') + '</p></div><div class="evaluation-jd-group-actions"><label class="evaluation-jd-weight-control"><span>Tỷ trọng nhóm</span><input class="evaluation-config-input" type="number" min="0" max="100" step=".01" value="' + escapeHtml(formatWeight(group.weightPercent)) + '" data-jd-group-weight data-key="' + escapeHtml(groupKey) + '"></label><label class="evaluation-jd-bulk-assign"><span>Gán tất cả</span><select class="evaluation-config-select" data-jd-assign-all data-key="' + escapeHtml(groupKey) + '"><option value="">Chọn Nhóm công việc</option>' + evaluationWorkGroupOptionsHtml('', false).replace('<option value="">Chưa gán Nhóm công việc</option>', '') + '</select></label>' + mini('equalize-jd-activities', groupKey, 'Chia đều việc') + mini('normalize-jd-activities', groupKey, 'Chuẩn hóa việc') + miniIcon('toggle-jd-group-collapse', groupKey, collapsed ? 'Mở nhóm' : 'Thu gọn nhóm', collapsed ? '+' : '−') + '</div></div>' + (collapsed ? '' : '<div class="evaluation-jd-activity-list">' + groupActivities.map(function (activity) {
        var type = jdActivityType(activity.activityType);
        var assigned = activityEvaluationWorkGroup(activity);
        var selected = type === 'excluded' ? '__excluded__' : evaluationWorkGroupId(assigned);
        var mapping = assigned && criteriaMappingForGroup(assigned);
        return '<div class="evaluation-jd-activity-row" data-activity-type="' + escapeHtml(type) + '"><div class="evaluation-jd-activity-copy"><strong>' + escapeHtml(activity.activityText || activity.name || '') + '</strong><span>Kết quả đầu ra: ' + escapeHtml(activity.expectedOutputText || 'Chưa có mô tả đầu ra') + '</span></div><label class="evaluation-config-field"><span class="evaluation-config-label">Nhóm công việc</span><select class="evaluation-config-select" data-jd-evaluation-work-group data-id="' + escapeHtml(activity.id || activity.code || '') + '">' + evaluationWorkGroupOptionsHtml(selected, true) + '</select></label><label class="evaluation-config-field"><span class="evaluation-config-label">Tần suất</span><select class="evaluation-config-select" data-jd-activity-frequency data-id="' + escapeHtml(activity.id || activity.code || '') + '">' + selectOptionsHtml(JD_FREQUENCY_OPTIONS, activity.frequency || 'monthly', '') + '</select></label><label class="evaluation-jd-weight-control"><span>Tỷ trọng việc</span><input class="evaluation-config-input" type="number" min="0" max="100" step=".01" value="' + escapeHtml(formatWeight(activity.weightPercent)) + '" data-jd-activity-weight data-id="' + escapeHtml(activity.id || activity.code || '') + '"></label><div class="evaluation-jd-activity-rule"><span>' + escapeHtml(mapping && criteriaSetNameByValue(mapping.criteriaSetId || mapping.criteriaSetCode) || (type === 'excluded' ? 'Không đưa vào phiếu đánh giá' : 'Chưa gán Bộ tiêu chí')) + '</span></div></div>';
      }).join('') + '</div>') + '</section>';
    }).join('');
    renderJdCriteriaMappingTable();
  }
`;

const saveJdClassification = `
  function saveJdClassification() {
    var document = selectedJdDocument();
    if (!document) return alertMessage('Chọn JD cần phân loại trước.', 'Thiếu JD');
    var mappedTitle = trim(state.jdMappedJobTitleName || $('evaluationJdMappedTitle') && $('evaluationJdMappedTitle').value);
    if (!mappedTitle) return alertMessage('Chọn chức danh tương ứng trong danh mục nhân sự.', 'Thiếu chức danh');
    var unclassified = (state.jdActivityDraftItems || []).filter(function (activity) {
      return jdActivityType(activity.activityType) !== 'excluded' && !activityEvaluationWorkGroup(activity);
    });
    if (unclassified.length) return alertMessage('Còn ' + unclassified.length + ' đầu việc chưa được gán Nhóm công việc.', 'Chưa phân loại đủ');
    var criteriaMappings = criteriaMappingsForSave();
    var missingMappings = criteriaMappings.filter(function (line) { return !line.criteriaSetId && !line.criteriaSetCode; });
    if (missingMappings.length) return alertMessage('Chọn Bộ tiêu chí cho: ' + missingMappings.map(function (line) { return line.evaluationWorkGroupName; }).join(', ') + '.', 'Thiếu Bộ tiêu chí');
    if (!guardWrite()) return Promise.resolve(null);
    normalizeJdWeightsForSave();
    var workGroups = (state.jdWorkGroupDraftItems || []).map(function (group) {
      return { id: group.id || '', code: group.code || group.workGroupCode || '', workGroupCode: group.workGroupCode || group.code || '', weightPercent: numValue(group.weightPercent) || 0 };
    });
    var activityTypes = (state.jdActivityDraftItems || []).map(function (activity) {
      var assigned = activityEvaluationWorkGroup(activity);
      return {
        id: activity.id || '',
        code: activity.code || activity.activityCode || '',
        activityType: jdActivityType(activity.activityType),
        evaluationWorkGroupId: assigned ? evaluationWorkGroupId(assigned) : '',
        evaluationWorkGroupCode: assigned && (assigned.code || assigned.workGroupCode) || '',
        evaluationWorkGroupName: assigned && (assigned.name || assigned.workGroupName) || '',
        frequency: jdFrequency(activity.frequency),
        frequencyName: jdFrequencyLabel(activity.frequency),
        weightPercent: numValue(activity.weightPercent) || 0
      };
    });
    var ruleOverrides = jdCriteriaRuleOverridesForSave();
    state.jdMappedJobTitleName = mappedTitle;
    showWriteLoading('Đang lưu phân loại JD và Nhóm công việc...');
    return App.gas('enqueueEvaluationJdClassificationJob', {
      documentId: document.id || document.jdDocumentId || '',
      documentCode: document.code || document.jdDocumentCode || '',
      providerFileId: document.providerFileId || document.fileId || '',
      mappedJobTitleName: mappedTitle,
      mappedJobTitleCode: makeCode(mappedTitle, 'TITLE'),
      executionCriteriaSetId: state.jdExecutionCriteriaSetId,
      managementCriteriaSetId: state.jdManagementCriteriaSetId,
      criteriaMappings: criteriaMappings,
      ruleOverrides: ruleOverrides,
      workGroups: workGroups,
      activityTypes: activityTypes
    }).then(function (response) {
      clearEvaluationConfigWarmup();
      upsertLocalJdClassificationJob(response && response.job);
      renderJdClassificationQueuePanel(document);
      renderSources();
      return notifyAfterLoading(response, response && response.message || 'Đã lưu phân loại JD.', 'Đã cập nhật JD');
    }).catch(function (error) {
      showErrorAfterLoading(error, 'Không lưu được phân loại JD.', 'Không lưu được');
      throw error;
    }).finally(hideLoading);
  }
`;

const monitorProgress = `
  function monitorProgress(instance) {
    var roles = monitorRequiredRoles(instance);
    var done = roles.filter(function (role) {
      return monitorRoleStatus(instance, role) === 'submitted' || monitorRoleCompletion(instance, role).percent >= 100;
    }).length;
    return { done: done, total: roles.length, percent: roles.length ? Math.round(done / roles.length * 100) : 100 };
  }
`;

const jdDocumentDisplayTitle = `
  function jdDocumentDisplayTitle(item) {
    if (!item) return 'JD chưa đặt tên';
    var baseTitle = item.mappedJobTitleName || item.personnelJobTitleName || item.jobTitleName || item.displayTitle || item.docTitle || item.name || item.fileName || item.fileId || '';
    baseTitle = text(baseTitle).replace(/^\\s*\\[BC\\]\\s*(?:[-–—:]\\s*)?/i, '').trim();
    if (!baseTitle) return 'JD chưa đặt tên';
    return isArchivedJdDocument(item) ? '[BC] - ' + baseTitle : baseTitle;
  }
`;

const allActiveJdDocuments = `
  function jdDocumentDedupeKey(item) {
    var fileTitle = text(item && item.fileName).replace(/\\.(?:docx?|pdf)$/i, '').replace(/^\\d{6,8}[_\\s-]*/i, '').replace(/^JD[_\\s-]*/i, '');
    var title = fileTitle || item && (item.mappedJobTitleName || item.personnelJobTitleName || item.jobTitleName || item.displayTitle || item.docTitle || item.name) || '';
    return normalizeKey(title)
      .replace(/^bc\\s*/, '')
      .replace(/\\b(?:copy|ban sao)\\s*\\d*$/i, '')
      .replace(/\\s*\\(\\d+\\)\\s*$/i, '')
      .replace(/[^a-z0-9]+/g, '') || String(item && (item.id || item.code || item.fileId) || '');
  }
  function jdDocumentPriority(item) {
    var fileName = text(item && item.fileName).toLowerCase();
    var mapped = trim(item && (item.mappedJobTitleName || item.personnelJobTitleName));
    var modified = Date.parse(item && (item.driveModifiedAt || item.updatedAt) || '') || 0;
    return (isArchivedJdDocument(item) ? 0 : 1000000000000000) +
      (mapped ? 100000000000000 : 0) +
      (/\\.docx?$/.test(fileName) ? 10000000000000 : 0) + modified;
  }
  function allActiveJdDocuments() {
    var selected = {};
    var order = [];
    list('jdDocuments').filter(isActiveLine).forEach(function (item) {
      var key = jdDocumentDedupeKey(item);
      if (!selected[key]) {
        selected[key] = item;
        order.push(key);
        return;
      }
      if (jdDocumentPriority(item) > jdDocumentPriority(selected[key])) selected[key] = item;
    });
    return order.map(function (key) { return selected[key]; });
  }
`;

export function transformEvaluationCustomWorkgroups(input) {
  let source = input;
  source = replaceRequired(
    source,
    `<option value="hr">HR</option><option value="final_approval">Duyệt cuối</option>`,
    `<option value="hr">HR</option><option value="bod">BOD</option><option value="final_approval">Duyệt cuối</option>`,
    "đối tượng workflow BOD",
  );
  source = replaceRequired(
    source,
    `    if (value === 'hr') return 'HR';\n    if (value === 'final_approval') return 'Duyệt cuối';`,
    `    if (value === 'hr') return 'HR';\n    if (value === 'bod') return 'BOD';\n    if (value === 'final_approval') return 'Duyệt cuối';`,
    "nhãn vai trò BOD",
  );
  source = replaceRequired(
    source,
    `  var REVIEW_TYPE_ROLES = ['self', 'manager', 'peer', 'hr'];`,
    `  var REVIEW_TYPE_ROLES = ['self', 'manager', 'peer', 'hr', 'bod'];`,
    "vai trò chấm điểm BOD",
  );
  source = replaceRequired(
    source,
    `    if (role === 'colleague' || role === 'coworker' || role === 'dong_nghiep') return 'peer';\n    return role || 'self';`,
    `    if (role === 'colleague' || role === 'coworker' || role === 'dong_nghiep') return 'peer';\n    if (role === 'board' || role === 'board_of_directors' || role === 'ban_giam_doc') return 'bod';\n    return role || 'self';`,
    "chuẩn hóa vai trò BOD",
  );
  source = replaceRequired(source, "</style>", styles + "</style>", "CSS Nhóm công việc");
  source = replaceRequired(
    source,
    "    jdCriteriaRuleOverrides: [],\n    jdMappedJobTitleName: '',",
    "    jdCriteriaRuleOverrides: [],\n    jdCriteriaMappings: [],\n    jdMappedJobTitleName: '',",
    "state Nhóm công việc",
  );
  source = replaceRequired(
    source,
    `            <button class="ui-segmented-button evaluation-review-step-button is-active" type="button" data-evaluation-criteria-tab="score-groups" aria-selected="true"><span class="evaluation-review-step-number">1</span><span class="evaluation-review-step-label">Nhóm đánh giá</span></button>
            <button class="ui-segmented-button evaluation-review-step-button" type="button" data-evaluation-criteria-tab="criteria" aria-selected="false"><span class="evaluation-review-step-number">2</span><span class="evaluation-review-step-label">Tiêu chí</span></button>
            <button class="ui-segmented-button evaluation-review-step-button" type="button" data-evaluation-criteria-tab="criteria-sets" aria-selected="false"><span class="evaluation-review-step-number">3</span><span class="evaluation-review-step-label">Bộ tiêu chí</span></button>`,
    `            <button class="ui-segmented-button evaluation-review-step-button is-active" type="button" data-evaluation-criteria-tab="score-groups" aria-selected="true"><span class="evaluation-review-step-number">1</span><span class="evaluation-review-step-label">Nhóm đánh giá</span></button>
            <button class="ui-segmented-button evaluation-review-step-button" type="button" data-evaluation-criteria-tab="work-groups" aria-selected="false"><span class="evaluation-review-step-number">2</span><span class="evaluation-review-step-label">Nhóm công việc</span></button>
            <button class="ui-segmented-button evaluation-review-step-button" type="button" data-evaluation-criteria-tab="criteria" aria-selected="false"><span class="evaluation-review-step-number">3</span><span class="evaluation-review-step-label">Tiêu chí</span></button>
            <button class="ui-segmented-button evaluation-review-step-button" type="button" data-evaluation-criteria-tab="criteria-sets" aria-selected="false"><span class="evaluation-review-step-number">4</span><span class="evaluation-review-step-label">Bộ tiêu chí</span></button>`,
    "bước Nhóm công việc",
  );
  source = replaceRequired(
    source,
    `          <section class="evaluation-config-subpane" data-evaluation-criteria-pane="criteria">`,
    workGroupPane + `          <section class="evaluation-config-subpane" data-evaluation-criteria-pane="criteria">`,
    "pane Nhóm công việc",
  );
  source = removeRequiredDiv(
    source,
    `<div class="evaluation-jd-rule-scope">`,
    "khối Đánh giá tiêu chuẩn cũ",
  );
  source = replaceRequired(
    source,
    `<h4 class="evaluation-criteria-set-editor-title">Map chức danh và Bộ tiêu chí</h4>
                <p class="evaluation-config-note">Một Hoạt động được phân loại Thực thi hoặc Quản lý sẽ tự dùng Bộ tiêu chí tương ứng.</p>`,
    `<h4 class="evaluation-criteria-set-editor-title">Map chức danh</h4>
                <p class="evaluation-config-note">Đối chiếu chức danh trong JD với chức danh đang dùng trong danh mục nhân sự.</p>`,
    "nội dung Map chức danh JD",
  );
  source = replaceRequired(
    source,
    `              <div id="evaluationJdWorkGroupList" class="evaluation-jd-group-list"></div>`,
    `              <div id="evaluationJdWorkGroupList" class="evaluation-jd-group-list"></div>${criteriaMap}`,
    "bảng Bộ tiêu chí theo Nhóm công việc",
  );
  source = replaceRequired(
    source,
    "    var activities = jdActivitiesFor(document).map(function (activity) {",
    "    var activities = jdActivitiesFor(document).map(function (activity) {",
    "danh sách đầu việc JD",
  );
  source = replaceRequired(
    source,
    "    });\n    (groups || []).forEach(function (group) {\n      var groupActivities = normalizeWeightLines(activities.filter(function (activity) {",
    "    });\n    activities = activities.map(ensureJdActivityWorkGroupAssignment);\n    (groups || []).forEach(function (group) {\n      var groupActivities = normalizeWeightLines(activities.filter(function (activity) {",
    "tương thích phân loại JD cũ",
  );
  source = replaceRequired(
    source,
    "      state.jdCriteriaRuleOverrides = [];\n      state.jdMappedJobTitleName = '';",
    "      state.jdCriteriaRuleOverrides = [];\n      state.jdCriteriaMappings = [];\n      state.jdMappedJobTitleName = '';",
    "reset mapping JD",
  );
  source = replaceRequired(
    source,
    "    state.jdCriteriaRuleOverrides = buildJdCriteriaRuleOverrides(document);\n    state.jdMappedJobTitleName = document.mappedJobTitleName || document.personnelJobTitleName || document.jobTitleName || '';",
    "    state.jdCriteriaRuleOverrides = buildJdCriteriaRuleOverrides(document);\n    state.jdCriteriaMappings = buildJdCriteriaMappings(document);\n    ensureJdCriteriaMappings();\n    state.jdMappedJobTitleName = document.mappedJobTitleName || document.personnelJobTitleName || document.jobTitleName || '';",
    "đọc mapping JD",
  );
  source = replaceRequired(
    source,
    "  function renderCriteria() {",
    workGroupFunctions + "\n  function renderCriteria() {\n    renderWorkGroupDefinitions();",
    "logic Nhóm công việc",
  );
  source = replaceRequired(
    source,
    "  function resetScoreGroup() {",
    "  function resetScoreGroup() {",
    "reset Nhóm đánh giá",
  );
  source = replaceRequired(
    source,
    "      if (action === 'reset-score-group') resetScoreGroup();",
    "      if (action === 'reset-score-group') resetScoreGroup();\n      if (action === 'reset-work-group-definition') resetWorkGroupDefinition();",
    "nút tạo Nhóm công việc",
  );
  source = replaceRequired(
    source,
    "      if (action === 'edit-score-group') editScoreGroup(id);",
    "      if (action === 'edit-score-group') editScoreGroup(id);\n      if (action === 'edit-work-group-definition') editWorkGroupDefinition(id);",
    "nút sửa Nhóm công việc",
  );
  source = replaceRequired(
    source,
    "      var activitySelect = event.target.closest('[data-jd-activity-type]');",
    `      var evaluationWorkGroupSelect = event.target.closest('[data-jd-evaluation-work-group]');
      if (evaluationWorkGroupSelect) {
        setJdActivityEvaluationWorkGroup(evaluationWorkGroupSelect.getAttribute('data-id'), evaluationWorkGroupSelect.value || '');
        return;
      }
      var bulkWorkGroupSelect = event.target.closest('[data-jd-assign-all]');
      if (bulkWorkGroupSelect) {
        assignJdNaturalGroup(bulkWorkGroupSelect.getAttribute('data-key'), bulkWorkGroupSelect.value || '');
        return;
      }
      var criteriaMappingSelect = event.target.closest('[data-jd-group-criteria]');
      if (criteriaMappingSelect) {
        setJdWorkGroupCriteria(criteriaMappingSelect.getAttribute('data-group-id'), criteriaMappingSelect.value || '');
        return;
      }
      var activitySelect = event.target.closest('[data-jd-activity-type]');`,
    "sự kiện gán Nhóm công việc",
  );
  source = replaceRequired(
    source,
    "    bindForm('evaluationCriteriaForm', function () {",
    `    bindForm('evaluationWorkGroupDefinitionForm', function () {
      syncCodeFromName('evaluationWorkGroupDefinitionName', 'evaluationWorkGroupDefinitionCode', 'WG', list('workGroupDefinitions'), ['code', 'workGroupCode'], $('evaluationWorkGroupDefinitionId') && $('evaluationWorkGroupDefinitionId').value);
      var record = {
        id: trim($('evaluationWorkGroupDefinitionId').value) || null,
        code: trim($('evaluationWorkGroupDefinitionCode').value),
        workGroupCode: trim($('evaluationWorkGroupDefinitionCode').value),
        name: trim($('evaluationWorkGroupDefinitionName').value),
        workGroupName: trim($('evaluationWorkGroupDefinitionName').value),
        description: trim($('evaluationWorkGroupDefinitionDescription').value),
        legacyActivityType: 'execution',
        isDefault: boolValue((evaluationWorkGroupByValue($('evaluationWorkGroupDefinitionId').value) || {}).isDefault),
        isActive: true
      };
      if (!record.name) return alertMessage('Nhập tên Nhóm công việc.', 'Thiếu thông tin');
      saveEntity('workGroupDefinition', record, 'Đã lưu Nhóm công việc.');
    });
    bindForm('evaluationCriteriaForm', function () {`,
    "form Nhóm công việc",
  );
  source = source.replace(
    "      scoreGroup: 'nhóm đánh giá',",
    "      scoreGroup: 'nhóm đánh giá',\n      workGroupDefinition: 'Nhóm công việc',",
  );
  source = source.replace(
    "' · ' + progress.done + '/' + progress.total + ' lượt đã gửi'",
    "' · ' + progress.done + '/' + progress.total + ' lượt hoàn tất'",
  );
  source = replaceFunction(source, "monitorProgress", monitorProgress);
  source = replaceFunction(source, "jdDocumentDisplayTitle", jdDocumentDisplayTitle);
  source = replaceFunction(source, "allActiveJdDocuments", allActiveJdDocuments);
  source = replaceFunction(source, "renderJdWorkGroups", renderJdWorkGroups);
  source = replaceFunction(source, "saveJdClassification", saveJdClassification);
  return source;
}
