function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) {
    throw new Error(
      `Không tìm thấy điểm gắn ${label} trong EvaluationModal.html.`,
    );
  }
  return source.replace(needle, replacement);
}

export function transformEvaluationWorkflowDecision(source) {
  const styles = `
  #evaluationModal .evaluation-bod-gate{grid-column:1/-1;padding:18px;border:1px solid rgba(17,76,65,.14);border-radius:8px;background:linear-gradient(135deg,#f4faf7,#fff8f1);color:var(--accent-deep)}
  #evaluationModal .evaluation-bod-gate strong{display:block;font-size:1rem;font-weight:950}
  #evaluationModal .evaluation-bod-gate span{display:block;margin-top:5px;color:var(--muted-strong);font-size:.76rem;font-weight:700;line-height:1.55}
  #evaluationModal .evaluation-prior-review{grid-column:1/-1;display:grid;gap:12px;min-width:0;padding:16px;border:1px solid rgba(17,76,65,.12);border-radius:8px;background:#f8fbfa}
  #evaluationModal .evaluation-prior-review h4{margin:0;color:var(--accent-deep);font-size:1rem}
  #evaluationModal .evaluation-prior-review-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;min-width:0}
  #evaluationModal .evaluation-prior-review-row{display:grid;grid-template-columns:minmax(0,1fr);align-content:start;gap:7px;padding:12px;border:1px solid rgba(17,76,65,.1);border-radius:8px;background:#fff;font-size:.8rem;line-height:1.55}
  #evaluationModal .evaluation-prior-review-row strong,#evaluationModal .evaluation-prior-review-comment{min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--accent-deep)}
  #evaluationModal .evaluation-prior-review-comment{margin:0;color:var(--muted-strong)}
  #evaluationModal .evaluation-prior-review-score-sections{grid-column:1/-1;display:grid;gap:12px;min-width:0}
  #evaluationModal .evaluation-prior-review-score-sections .evaluation-score-section{box-shadow:none}
  #evaluationModal .evaluation-prior-review-score-sections .evaluation-jd-rubric-list{grid-template-columns:repeat(2,minmax(0,1fr))}
  #evaluationModal .evaluation-prior-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;grid-column:1/-1}
  #evaluationModal .evaluation-prior-summary-card{display:grid;gap:5px;padding:12px;border:1px solid rgba(17,76,65,.16);border-radius:8px;background:#fff;color:#173f36}
  #evaluationModal .evaluation-prior-summary-card span{color:#526861;font-size:.67rem;font-weight:800;line-height:1.4}
  #evaluationModal .evaluation-prior-summary-card strong{color:#114c41;font-size:1rem;font-weight:950}
  #evaluationModal .evaluation-prior-summary-card[data-tone="culture"]{border-color:rgba(234,108,45,.24);background:#fffaf6}
  #evaluationModal .evaluation-prior-review-details{grid-column:1/-1;border:1px solid rgba(17,76,65,.14);border-radius:8px;background:#fff;overflow:hidden}
  #evaluationModal .evaluation-prior-review-details>summary{padding:11px 13px;color:#114c41;font-size:.75rem;font-weight:900;cursor:pointer}
  #evaluationModal .evaluation-prior-review-details[open]>summary{border-bottom:1px solid rgba(17,76,65,.12);background:#edf7f3}
  #evaluationModal .evaluation-prior-review-details .evaluation-prior-review-score-sections{padding:12px}
  #evaluationModal .evaluation-prior-assignment-list{grid-column:1/-1;display:grid;gap:9px}
  #evaluationModal .evaluation-prior-assignment{display:grid;gap:7px;padding:13px;border:1px solid rgba(234,108,45,.25);border-radius:8px;background:#fffaf6;color:#173f36}
  #evaluationModal .evaluation-prior-assignment h4{margin:0;color:#9f4c16;font-size:.82rem}
  #evaluationModal .evaluation-prior-assignment-meta{color:#60736e;font-size:.68rem;font-weight:750}
  #evaluationModal .evaluation-prior-assignment-answer{display:grid;gap:3px;padding-top:7px;border-top:1px solid rgba(234,108,45,.14)}
  #evaluationModal .evaluation-prior-assignment-answer span{color:#6a7773;font-size:.65rem;font-weight:800}
  #evaluationModal .evaluation-prior-assignment-answer strong{white-space:pre-wrap;overflow-wrap:anywhere;color:#173f36;font-size:.76rem}
  #evaluationModal .evaluation-score-row.has-employee-note{border-color:rgba(234,108,45,.34);box-shadow:0 0 0 2px rgba(234,108,45,.07)}
  #evaluationModal .evaluation-score-row.has-employee-note .evaluation-score-reflection{border-color:rgba(234,108,45,.32);background:#fff3e9;color:#9f4c16;opacity:1}
  #evaluationModal .evaluation-score-row.has-employee-note .evaluation-score-reflection-panel{border-color:rgba(234,108,45,.28);background:#fffaf6;color:#71411f}
  @media(max-width:760px){#evaluationModal .evaluation-prior-review-list{grid-template-columns:minmax(0,1fr)}}
  @media(max-width:760px){#evaluationModal .evaluation-prior-summary{grid-template-columns:minmax(0,1fr)}}
  #evaluationModal .evaluation-extra-row[hidden]{display:none!important}
  #evaluationModal .evaluation-duration-control{display:grid;grid-template-columns:minmax(120px,.75fr) minmax(150px,1fr) auto;gap:8px;align-items:center}
  #evaluationModal .evaluation-duration-permanent{display:flex;align-items:center;gap:7px;min-height:44px;padding:0 12px;border:1px solid rgba(17,76,65,.12);border-radius:8px;background:#f5f8f6;color:var(--accent-deep);font-size:.72rem;font-weight:900;white-space:nowrap}
  #evaluationModal .evaluation-duration-permanent input{width:18px;height:18px;accent-color:var(--accent)}
  #evaluationModal .evaluation-calculated-note{display:block;margin-top:6px;color:var(--muted-strong);font-size:.66rem;font-weight:750}
  #evaluationModal .evaluation-extra-list,#evaluationModal .evaluation-extra-list input,#evaluationModal .evaluation-extra-list select,#evaluationModal .evaluation-extra-list textarea,#evaluationModal .evaluation-extra-list button{font-family:"Be Vietnam Pro",Arial,sans-serif!important}
  #evaluationModal .evaluation-decision-question{display:block;color:var(--accent-deep);font-family:"Be Vietnam Pro",Arial,sans-serif!important;font-size:.76rem;font-weight:900;letter-spacing:normal;line-height:1.55}
  #evaluationModal .evaluation-decision-question *{font-family:"Be Vietnam Pro",Arial,sans-serif!important;font-size:inherit!important;letter-spacing:normal!important;line-height:inherit!important}
  #evaluationModal .evaluation-decision-question b,#evaluationModal .evaluation-decision-question strong{font-weight:700!important}
  #evaluationModal .evaluation-decision-question p,#evaluationModal .evaluation-decision-question div{margin:.15em 0}
  #evaluationModal .evaluation-multi-choice{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  #evaluationModal .evaluation-multi-choice-option{position:relative;display:flex;align-items:center;gap:9px;min-height:42px;padding:8px 11px;border:1px solid rgba(17,76,65,.12);border-radius:8px;background:#f8faf9;color:var(--accent-deep);font-size:.73rem;font-weight:850;cursor:pointer}
  #evaluationModal .evaluation-multi-choice-option:has(input:checked){border-color:rgba(234,108,45,.46);background:#fff3e9;color:#9f4c16;box-shadow:0 0 0 2px rgba(234,108,45,.07)}
  #evaluationModal .evaluation-multi-choice-option input{width:18px;height:18px;accent-color:var(--accent)}
  #evaluationModal [data-decision-field-code="BOD_DECISION"]{padding:18px;border-color:rgba(234,108,45,.28);background:#fffaf6}
  #evaluationModal [data-decision-field-code="BOD_FEEDBACK"]{padding:18px;border-color:rgba(17,76,65,.16);background:#f6faf8}
  #evaluationModal [data-decision-field-code="INDIRECT_MANAGER_DECISION"]{padding:18px;border-color:rgba(36,118,101,.28);background:#f5fbf8}
  #evaluationModal [data-decision-field-code="INDIRECT_MANAGER_FEEDBACK"]{padding:18px;border-color:rgba(17,76,65,.16);background:#f6faf8}
  @media(max-width:720px){#evaluationModal .evaluation-duration-control,#evaluationModal .evaluation-multi-choice{grid-template-columns:1fr}#evaluationModal .evaluation-duration-permanent{justify-content:flex-start}}
`;
  source = replaceRequired(
    source,
    "</style>",
    styles + "</style>",
    "style duyệt BGD/CnB",
  );

  source = replaceRequired(
    source,
    "    if (role === 'supervisor' || role === 'leader' || role === 'cap tren' || role === 'quan ly') return 'manager';",
    `    if (role === 'supervisor' || role === 'leader' || role === 'm1' || role === 'manager 1' || role === 'cap tren' || role === 'quan ly' || role === 'quan ly truc tiep') return 'manager';
    if (role === 'm2' || role === 'manager 2' || role === 'indirect manager' || role === 'quan ly gian tiep') return 'indirect_manager';`,
    "chuẩn hóa vai trò M2",
  );
  source = replaceRequired(
    source,
    "    if (normalize(instance.managerEmployeeCode) === viewerCode) candidates.push('manager');",
    `    if (normalize(instance.managerEmployeeCode) === viewerCode) candidates.push('manager');
    if (normalize(instance.indirectManagerEmployeeCode) === viewerCode) candidates.push('indirect_manager');
    if (normalize(instance.bodEmployeeCode) === viewerCode) candidates.push('bod');`,
    "nhận diện người duyệt M2/M3",
  );
  source = replaceRequired(
    source,
    "    if (normalized === 'manager') return 'Quản lý đánh giá';",
    `    if (normalized === 'manager') return 'Quản lý trực tiếp đánh giá';
    if (normalized === 'indirect_manager') return 'Quản lý gián tiếp duyệt';`,
    "nhãn vai trò M2",
  );
  source = replaceRequired(
    source,
    "    return normalized === 'self' ? 'employee' : normalized;",
    `    if (normalized === 'self') return 'employee';
    if (normalized === 'indirect_manager') return 'indirectManager';
    return normalized;`,
    "prefix dữ liệu M2",
  );

  source = replaceRequired(
    source,
    `    return '<button class="evaluation-score-reflection" type="button" data-action="toggle-employee-reflection" aria-expanded="false" title="Xem ghi chú tự đánh giá của nhân viên">' +`,
    `    return '<button class="evaluation-score-reflection" type="button" data-action="toggle-employee-reflection" aria-expanded="' + (comment ? 'true' : 'false') + '" title="' + (comment ? 'Nhân viên có ghi chú — đang hiển thị' : 'Xem phần tự đánh giá của nhân viên') + '">' +`,
    "tự mở ghi chú nhân viên cho QLTT",
  );
  source = replaceRequired(
    source,
    `      '<span class="evaluation-score-reflection-label">NV tự chấm</span>' +`,
    `      '<span class="evaluation-score-reflection-label">' + (comment ? 'Nhân viên có ghi chú' : 'NV tự chấm') + '</span>' +`,
    "nhãn ghi chú nhân viên",
  );
  source = replaceRequired(
    source,
    `    return '<div class="evaluation-score-row' + (isEmpty ? ' is-empty' : '') + (reflectionHtml ? ' has-reflection' : '') + '" data-score-id="' + escapeHtml(score.id) + '"`,
    `    return '<div class="evaluation-score-row' + (isEmpty ? ' is-empty' : '') + (reflectionHtml ? ' has-reflection' : '') + (trim(score.employeeComment) ? ' is-reflection-open has-employee-note' : '') + '" data-score-id="' + escapeHtml(score.id) + '"`,
    "đánh dấu hàng có ghi chú nhân viên",
  );

  source = replaceRequired(
    source,
    "  function decisionFieldsForInstance(instance, role) {",
    `  function evaluationDecisionFieldSort(left, right) {
    function priority(field) {
      var code = text(field && (field.code || field.fieldCode || field.id)).toUpperCase();
      if (code === 'INDIRECT_MANAGER_DECISION' || code === 'BOD_DECISION') return 0;
      if (code === 'INDIRECT_MANAGER_FEEDBACK' || code === 'BOD_FEEDBACK') return 1;
      return 2;
    }
    function order(field) {
      var value = Number(field && field.sortOrder);
      return Number.isFinite(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;
    }
    return priority(left) - priority(right) || order(left) - order(right) ||
      text(left && (left.createdAt || left.id || left.code)).localeCompare(text(right && (right.createdAt || right.id || right.code)), 'vi');
  }
  function decisionFieldsForInstance(instance, role) {`,
    "thứ tự quyết định trước nội dung phản hồi",
  );
  source = replaceRequired(
    source,
    `    }).sort(function (left, right) {
      return (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0);
    });`,
    "    }).sort(evaluationDecisionFieldSort);",
    "sắp xếp trường quyết định",
  );

  const decisionHelpers = `  function evaluationDecisionAnswerValues(value) {
    if (Array.isArray(value)) return value.map(trim).filter(Boolean);
    var raw = trim(value);
    if (!raw) return [];
    if (raw.charAt(0) === '[') {
      try {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(trim).filter(Boolean);
      } catch (_) {}
    }
    return [raw];
  }
  function evaluationDecisionConfiguredValues(value) {
    if (Array.isArray(value)) return value.map(trim).filter(Boolean);
    return trim(value).split(/[|;\\n]+/).map(trim).filter(Boolean);
  }
  function evaluationDecisionComparable(value) {
    var key = normalize(value);
    if (key === 'co' || key === 'có' || key === 'true') return 'yes';
    if (key === 'khong' || key === 'không' || key === 'false') return 'no';
    return key;
  }
  function evaluationReadonlyFieldVisible(field, answers) {
    var condition = field.visibilityCondition || {};
    var source = condition.sourceFieldCode || field.dependsOnFieldCode || field.showWhenFieldCode;
    if (!source) return true;
    var actual = evaluationDecisionAnswerValues(answers[source]).map(evaluationDecisionComparable);
    var include = evaluationDecisionConfiguredValues(condition.includeValues || field.conditionValues || field.dependsOnValue || field.showWhenValue).map(evaluationDecisionComparable);
    var exclude = evaluationDecisionConfiguredValues(condition.excludeValues || field.conditionExcludedValues).map(evaluationDecisionComparable);
    if (exclude.some(function (value) { return actual.indexOf(value) !== -1; })) return false;
    if (!include.length) return actual.length > 0;
    return (condition.matchMode || field.conditionMatchMode) === 'all'
      ? include.every(function (value) { return actual.indexOf(value) !== -1; })
      : include.some(function (value) { return actual.indexOf(value) !== -1; });
  }
  function evaluationReadonlyAnswerLabel(field, value) {
    var type = normalize(field.fieldType || field.type);
    if (value == null || value === '') return 'Chưa trả lời';
    if (type === 'duration') {
      var duration = evaluationDecisionDuration(value);
      if (duration.permanent || ['forever', 'permanent'].indexOf(duration.unit) !== -1) return 'Vĩnh viễn';
      return duration.amount ? text(duration.amount) + ' ' + ({ day: 'ngày', month: 'tháng', year: 'năm' }[duration.unit] || duration.unit || '') : 'Chưa trả lời';
    }
    if (type === 'currency' && Number.isFinite(Number(value))) return Number(value).toLocaleString('vi-VN') + ' ₫';
    if (type === 'date' || type === 'calculated_date') {
      var parts = text(value).match(/^(\\d{4})-(\\d{2})-(\\d{2})(?:T.*)?$/);
      if (parts) return parts[3] + '/' + parts[2] + '/' + parts[1];
    }
    var options = Array.isArray(field.options) ? field.options : [];
    return evaluationDecisionAnswerValues(value).map(function (entry) {
      var option = options.find(function (candidate) { return text(candidate && (candidate.value || candidate.label) || candidate) === entry; });
      if (option && option.label) return option.label;
      if (entry === 'yes' || entry === 'true') return 'Có';
      if (entry === 'no' || entry === 'false') return 'Không';
      return entry;
    }).join(', ') || 'Chưa trả lời';
  }
  function evaluationReadonlyScoreRow(score, role) {
    var prefix = roleScorePrefix(role);
    var value = score[prefix + 'Score'];
    var comment = trim(score[prefix + 'Comment']);
    var scoreLabel = value == null || value === '' ? 'Chưa chấm' : formatScoreValueForUi(value) + '/' + scoreInputMeta(score).max;
    return '<div class="evaluation-prior-review-row"><span>' + escapeHtml(score.criteriaName || score.criteriaCode || 'Tiêu chí') + '</span><strong>' + escapeHtml(scoreLabel) + '</strong>' + (comment ? '<p class="evaluation-prior-review-comment">Nhận xét: ' + escapeHtml(comment) + '</p>' : '') + '</div>';
  }
  function evaluationReadonlyScoreSummaryValue(scores, role) {
    var prefix = roleScorePrefix(role);
    var values = (scores || []).map(function (score) {
      var value = Number(score[prefix + 'Score']);
      var maximum = Number(scoreInputMeta(score).max) || 10;
      return Number.isFinite(value) && maximum > 0 ? { value: value, maximum: maximum } : null;
    }).filter(Boolean);
    if (!values.length) return { label: '--', count: 0 };
    var maxima = values.map(function (item) { return item.maximum; }).filter(function (value, index, list) { return list.indexOf(value) === index; });
    if (maxima.length === 1) {
      var average = values.reduce(function (total, item) { return total + item.value; }, 0) / values.length;
      return { label: formatScoreValueForUi(average) + '/' + formatScoreValueForUi(maxima[0]), count: values.length };
    }
    var percent = values.reduce(function (total, item) { return total + item.value / item.maximum * 100; }, 0) / values.length;
    return { label: formatScoreValueForUi(percent) + '%', count: values.length };
  }
  function evaluationReadonlyScoreSummary(scores, role) {
    var total = evaluationReadonlyScoreSummaryValue(scores, role);
    var groups = [];
    var groupMap = {};
    var culture = [];
    (scores || []).forEach(function (score) {
      if (text(score.contentMode).toLowerCase() === 'jd_dynamic') {
        var key = text(score.workGroupCode || score.workGroupName || 'jd-group');
        if (!groupMap[key]) {
          groupMap[key] = { name: score.workGroupName || 'Nhóm công việc', scores: [] };
          groups.push(groupMap[key]);
        }
        groupMap[key].scores.push(score);
      } else {
        culture.push(score);
      }
    });
    var cards = '<div class="evaluation-prior-summary-card"><span>Điểm tổng của vai trò</span><strong>' + escapeHtml(total.label) + '</strong></div>';
    cards += groups.map(function (group) {
      var summary = evaluationReadonlyScoreSummaryValue(group.scores, role);
      return '<div class="evaluation-prior-summary-card"><span>' + escapeHtml(group.name) + '</span><strong>' + escapeHtml(summary.label) + '</strong></div>';
    }).join('');
    cards += culture.map(function (score) {
      var summary = evaluationReadonlyScoreSummaryValue([score], role);
      return '<div class="evaluation-prior-summary-card" data-tone="culture"><span>' + escapeHtml(score.criteriaName || score.criteriaCode || 'Giá trị văn hóa') + '</span><strong>' + escapeHtml(summary.label) + '</strong></div>';
    }).join('');
    return '<div class="evaluation-prior-summary">' + cards + '</div>';
  }
  function evaluationReadonlyJdScores(scores, role) {
    var groups = [];
    var groupMap = {};
    scores.forEach(function (score) {
      var groupKey = text(score.workGroupCode || score.workGroupName || 'jd-group');
      if (!groupMap[groupKey]) {
        groupMap[groupKey] = { key: groupKey, name: score.workGroupName || 'Nhóm công việc', sortOrder: Number(score.workGroupSortOrder) || 0, activities: [], activityMap: {} };
        groups.push(groupMap[groupKey]);
      }
      var group = groupMap[groupKey];
      var activityKey = text(score.activityCode || score.activityId || score.activityText || 'activity');
      if (!group.activityMap[activityKey]) {
        group.activityMap[activityKey] = {
          text: score.activityText || 'Hoạt động chính', expectedOutputText: score.expectedOutputText || '',
          activityType: score.activityType || 'execution', criteriaSetName: score.criteriaSetName || '',
          sortOrder: Number(score.activitySortOrder) || 0, scores: []
        };
        group.activities.push(group.activityMap[activityKey]);
      }
      group.activityMap[activityKey].scores.push(score);
    });
    groups.sort(function (left, right) { return left.sortOrder - right.sortOrder; });
    return '<div class="evaluation-jd-score-groups">' + groups.map(function (group) {
      group.activities.sort(function (left, right) { return left.sortOrder - right.sortOrder; });
      return '<section class="evaluation-jd-score-group"><div class="evaluation-jd-score-group-head"><h4 class="evaluation-jd-score-group-title">' + escapeHtml(group.name) + '</h4><span class="evaluation-pill">' + escapeHtml(group.activities.length + ' hoạt động') + '</span></div>' +
        group.activities.map(function (activity) {
          return '<div class="evaluation-jd-activity" data-activity-type="' + escapeHtml(activity.activityType) + '"><div class="evaluation-jd-activity-head"><p class="evaluation-jd-activity-title">' + escapeHtml(activity.text) + '</p><p class="evaluation-jd-activity-output">Kết quả đầu ra: ' + escapeHtml(activity.expectedOutputText || 'Chưa có mô tả') + '</p>' + pillHtml([activityTypeLabel(activity.activityType), activity.criteriaSetName]) + '</div><div class="evaluation-jd-rubric-list">' + activity.scores.map(function (score) { return evaluationReadonlyScoreRow(score, role); }).join('') + '</div></div>';
        }).join('') + '</section>';
    }).join('') + '</div>';
  }
  function evaluationReadonlyScoreSections(scores, role) {
    return '<div class="evaluation-prior-review-score-sections">' + evaluationConfiguredSections(scores).map(function (section, sectionIndex) {
      var isJd = section.bodyMode === 'jd';
      var tone = evaluationSectionTone(section.name, isJd ? 'jd_dynamic' : 'criteria_set');
      return evaluationScoreSectionMarkup({
        index: evaluationSectionRoman(sectionIndex),
        kicker: isJd ? 'Năng lực và kết quả công việc' : 'Khối đánh giá đã cấu hình',
        title: section.name,
        note: isJd ? 'Theo Nhóm công việc → Hoạt động chính → Tiêu chí.' : 'Các tiêu chí trong cùng nội dung đánh giá.',
        tone: tone,
        count: section.scores.length,
        body: isJd ? evaluationReadonlyJdScores(section.scores, role) : section.scores.map(function (score) { return evaluationReadonlyScoreRow(score, role); }).join('')
      });
    }).join('') + '</div>';
  }
  function evaluationPriorReviewAssignments(instance) {
    var assignments = Array.isArray(instance && instance.reviewAssignments) ? instance.reviewAssignments.slice() : [];
    var currentId = text(instance && instance.reviewAssignmentId || state.selectedAssignmentId);
    var current = assignments.find(function (assignment) { return text(assignment.id) === currentId; });
    var currentStage = current ? Number(current.stageIndex) : Number.MAX_SAFE_INTEGER;
    return assignments.filter(function (assignment) {
      return assignment && assignment.status === 'submitted' && Number(assignment.stageIndex) < currentStage && ['indirect_manager', 'bod'].indexOf(normalizeRole(assignment.role)) !== -1;
    }).sort(function (left, right) {
      return Number(left.stageIndex) - Number(right.stageIndex) || Number(left.stepIndex) - Number(right.stepIndex);
    });
  }
  function evaluationReadonlyAssignmentAnswer(code, value) {
    var normalizedCode = text(code).toUpperCase();
    if (normalizedCode === 'INDIRECT_MANAGER_DECISION' || normalizedCode === 'BOD_DECISION') {
      return ({ accepted: 'Đồng ý', adjustment: 'Yêu cầu điều chỉnh', rejected: 'Từ chối' })[text(value)] || text(value);
    }
    return evaluationReadonlyAnswerLabel({ code: code }, value);
  }
  function evaluationReadonlyPriorAssignments(instance) {
    var assignments = evaluationPriorReviewAssignments(instance);
    if (!assignments.length) return '';
    var answersByAssignment = instance && instance.assignmentDecisionAnswers || {};
    return '<section class="evaluation-prior-review" data-prior-review-role="earlier-approvals"><h4>Kết quả các cấp quản lý đã duyệt trước</h4><div class="evaluation-prior-assignment-list">' + assignments.map(function (assignment) {
      var answers = answersByAssignment[assignment.id] || {};
      var answerRows = Object.keys(answers).filter(function (code) {
        var value = answers[code];
        return value != null && value !== '';
      }).map(function (code) {
        var label = code === 'INDIRECT_MANAGER_DECISION' || code === 'BOD_DECISION' ? 'Kết luận' : code === 'INDIRECT_MANAGER_FEEDBACK' || code === 'BOD_FEEDBACK' ? 'Nội dung điều chỉnh / lý do' : code;
        return '<div class="evaluation-prior-assignment-answer"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(evaluationReadonlyAssignmentAnswer(code, answers[code])) + '</strong></div>';
      }).join('');
      if (trim(assignment.overallComment)) answerRows += '<div class="evaluation-prior-assignment-answer"><span>Nhận xét chung</span><strong>' + escapeHtml(assignment.overallComment) + '</strong></div>';
      return '<article class="evaluation-prior-assignment"><h4>' + escapeHtml(assignment.stepLabel || roleLabel(assignment.role)) + '</h4><div class="evaluation-prior-assignment-meta">' + escapeHtml(assignment.employeeName || assignment.employeeCode || 'Người duyệt') + '</div>' + (answerRows || '<div class="evaluation-prior-assignment-answer"><strong>Đã hoàn thành lượt duyệt.</strong></div>') + '</article>';
    }).join('') + '</div></section>';
  }
  function evaluationReadonlyPriorReview(instance, role, includeScores) {
    var prefix = roleScorePrefix(role);
    var label = role === 'self' ? 'Nhân viên tự đánh giá' : 'Quản lý trực tiếp đánh giá';
    var roleScores = scoresForSelected(role);
    var rows = includeScores ? evaluationReadonlyScoreSummary(roleScores, role) + '<details class="evaluation-prior-review-details"><summary>Xem chi tiết tiêu chí và công việc</summary>' + evaluationReadonlyScoreSections(roleScores, role) + '</details>' : '';
    var fields = decisionFieldsForInstance(instance, role).slice();
    var nested = instance && instance.decisionAnswers && instance.decisionAnswers[normalizeRole(role)] || {};
    var saved = list('decisionValues').filter(function (record) {
      return isActiveLine(record) && String(record.evaluationInstanceId || record.instanceId || '') === String(instance.id || '') && normalizeRole(record.role) === normalizeRole(role);
    });
    saved.map(function (record) { return text(record.fieldCode || record.code || record.fieldId || record.decisionFieldId); }).concat(Object.keys(nested)).forEach(function (code) {
      if (!code || fields.some(function (field) { return [field.id, field.code, field.fieldCode].map(text).indexOf(code) !== -1; })) return;
      if (list('decisionFields').some(function (field) { return [field.id, field.code, field.fieldCode].map(text).indexOf(code) !== -1; })) return;
      var record = saved.find(function (item) { return [item.fieldCode, item.code, item.fieldId, item.decisionFieldId].map(text).indexOf(code) !== -1; }) || {};
      fields.push({ code: code, label: record.fieldLabel || record.label || code, fieldType: record.fieldType || 'text' });
    });
    var answers = {};
    fields.forEach(function (field) {
      var value = decisionValueForField(instance, field, role);
      [field.code, field.fieldCode, field.id].filter(Boolean).forEach(function (code) { answers[code] = value; });
    });
    rows += fields.sort(evaluationDecisionFieldSort).filter(function (field) { return evaluationReadonlyFieldVisible(field, answers); }).map(function (field) {
      var question = evaluationSanitizeQuestionHtml(field.labelHtml || field.fieldLabelHtml || '') || escapeHtml(field.label || field.name || field.code || 'Câu hỏi');
      return '<div class="evaluation-prior-review-row"><div>' + question + '</div><strong>' + escapeHtml(evaluationReadonlyAnswerLabel(field, decisionValueForField(instance, field, role))) + '</strong></div>';
    }).join('');
    var overall = trim(instance[prefix + 'OverallComment']);
    if (overall) rows += '<div class="evaluation-prior-review-row"><span>Nhận xét chung</span><strong>' + escapeHtml(overall) + '</strong></div>';
    return '<section class="evaluation-prior-review" data-prior-review-role="' + escapeHtml(role) + '"><h4>' + escapeHtml(label) + '</h4><div class="evaluation-prior-review-list">' + (rows || '<p class="evaluation-note">Chưa có câu trả lời hoặc nhận xét được lưu.</p>') + '</div></section>';
  }
  function evaluationSanitizeQuestionHtml(value) {
    var template = document.createElement('template');
    template.innerHTML = text(value).slice(0, 20000);
    Array.prototype.slice.call(template.content.querySelectorAll('script,style,iframe,object,embed,form,input,button,svg,math,link,meta')).forEach(function (node) { node.remove(); });
    var allowedTags = { B:1, BR:1, DIV:1, EM:1, I:1, P:1, S:1, SPAN:1, STRONG:1, U:1 };
    var allowedStyles = { color:1, 'background-color':1, 'font-style':1, 'font-weight':1, 'text-decoration':1, 'text-align':1 };
    function clean(parent) {
      Array.prototype.slice.call(parent.childNodes).forEach(function (node) {
        if (node.nodeType === 8) { node.remove(); return; }
        if (node.nodeType !== 1) return;
        if (!allowedTags[node.tagName]) {
          while (node.firstChild) parent.insertBefore(node.firstChild, node);
          node.remove();
          clean(parent);
          return;
        }
        Array.prototype.slice.call(node.attributes).forEach(function (attribute) {
          if (attribute.name.toLowerCase() !== 'style') { node.removeAttribute(attribute.name); return; }
          var safe = attribute.value.split(';').map(function (entry) {
            var colon = entry.indexOf(':');
            var property = entry.slice(0, colon).trim().toLowerCase();
            var styleValue = entry.slice(colon + 1).trim();
            if (colon < 1 || !allowedStyles[property] || !styleValue || /url|expression|javascript|[<>\\\\]/i.test(styleValue)) return '';
            return property + ':' + styleValue;
          }).filter(Boolean).join(';');
          if (safe) node.setAttribute('style', safe); else node.removeAttribute('style');
        });
        clean(node);
      });
    }
    clean(template.content);
    return template.innerHTML.trim();
  }
  function evaluationDecisionDuration(value) {
    var fallback = { amount: '', unit: 'month', permanent: false };
    if (!value) return fallback;
    if (typeof value === 'object') return Object.assign(fallback, value);
    var raw = trim(value);
    if (!raw) return fallback;
    if (normalize(raw) === 'vinh vien' || raw === 'permanent') return { amount: '', unit: 'month', permanent: true };
    try { return Object.assign(fallback, JSON.parse(raw)); } catch (_) {}
    var parts = raw.split(/[:|\\s]+/);
    return { amount: parts[0] || '', unit: parts[1] || 'month', permanent: false };
  }
  function evaluationAddDuration(startValue, durationValue) {
    var start = trim(startValue);
    var duration = evaluationDecisionDuration(durationValue);
    if (duration.permanent) return 'Vĩnh viễn';
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(start) || !Number(duration.amount)) return '';
    var date = new Date(start + 'T00:00:00.000Z');
    if (Number.isNaN(date.valueOf())) return '';
    if (duration.unit === 'day') date.setUTCDate(date.getUTCDate() + Number(duration.amount));
    if (duration.unit === 'month') date.setUTCMonth(date.getUTCMonth() + Number(duration.amount));
    if (duration.unit === 'year') date.setUTCFullYear(date.getUTCFullYear() + Number(duration.amount));
    return date.toISOString().slice(0, 10);
  }
  function evaluationDecisionRowValue(row) {
    var input = row && row.querySelector('[data-decision-value]');
    return input ? trim(input.value) : '';
  }
  function syncDecisionFieldUi() {
    var rows = $all('[data-decision-field-id]');
    rows.forEach(function (row) {
      if (normalize(row.getAttribute('data-decision-field-type')) !== 'multi_choice') return;
      var output = row.querySelector('[data-decision-value]');
      var selected = Array.prototype.slice.call(row.querySelectorAll('[data-decision-multi-option]:checked')).map(function (input) { return input.value; });
      if (output) output.value = JSON.stringify(selected);
    });
    rows.forEach(function (row) {
      if (normalize(row.getAttribute('data-decision-field-type')) !== 'duration') return;
      var amount = row.querySelector('[data-decision-duration-amount]');
      var unit = row.querySelector('[data-decision-duration-unit]');
      var permanent = row.querySelector('[data-decision-duration-permanent]');
      var output = row.querySelector('[data-decision-value]');
      if (amount) amount.disabled = !!(permanent && permanent.checked);
      if (unit) unit.disabled = !!(permanent && permanent.checked);
      if (output) output.value = permanent && permanent.checked ? 'permanent' : JSON.stringify({ amount: Number(amount && amount.value || 0), unit: unit && unit.value || 'month', permanent: false });
    });
    var values = {};
    rows.forEach(function (row) { values[row.getAttribute('data-decision-field-code')] = evaluationDecisionRowValue(row); });
    rows.forEach(function (row) {
      var dependsOn = trim(row.getAttribute('data-decision-depends-on'));
      var expected = trim(row.getAttribute('data-decision-depends-value'));
      if (!dependsOn) { row.hidden = false; return; }
      var conditionValues = evaluationDecisionConfiguredValues(row.getAttribute('data-decision-condition-values') || expected).map(evaluationDecisionComparable);
      var excludedValues = evaluationDecisionConfiguredValues(row.getAttribute('data-decision-condition-excluded')).map(evaluationDecisionComparable);
      var actualValues = evaluationDecisionAnswerValues(values[dependsOn]).map(evaluationDecisionComparable);
      var actual = {};
      actualValues.forEach(function (value) { actual[value] = true; });
      var excluded = excludedValues.some(function (value) { return actual[value]; });
      var matches = conditionValues.length
        ? (row.getAttribute('data-decision-condition-mode') === 'all'
          ? conditionValues.every(function (value) { return actual[value]; })
          : conditionValues.some(function (value) { return actual[value]; }))
        : actualValues.length > 0;
      row.hidden = excluded || !matches;
    });
    rows.forEach(function (row) {
      if (normalize(row.getAttribute('data-decision-field-type')) !== 'calculated_date') return;
      var output = row.querySelector('[data-decision-value]');
      if (!output) return;
      output.value = evaluationAddDuration(values[row.getAttribute('data-decision-calc-start')], values[row.getAttribute('data-decision-calc-duration')]);
      values[row.getAttribute('data-decision-field-code')] = output.value;
    });
  }

`;
  source = replaceRequired(
    source,
    "  function renderDecisionInput(field, value) {",
    decisionHelpers + "  function renderDecisionInput(field, value) {",
    "hàm trường quyết định",
  );

  source = replaceRequired(
    source,
    "    var attrs = ' data-decision-value class=\"evaluation-input\"';",
    `    var attrs = ' data-decision-value class="evaluation-input"';
    if (type === 'duration') {
      var duration = evaluationDecisionDuration(value);
      return '<div class="evaluation-duration-control"><input class="evaluation-input" type="number" min="1" step="1" data-decision-duration-amount value="' + escapeHtml(duration.amount || '') + '" placeholder="Số lượng">' +
        '<select class="evaluation-input" data-decision-duration-unit><option value="day"' + (duration.unit === 'day' ? ' selected' : '') + '>Ngày</option><option value="month"' + (duration.unit === 'month' ? ' selected' : '') + '>Tháng</option><option value="year"' + (duration.unit === 'year' ? ' selected' : '') + '>Năm</option></select>' +
        '<label class="evaluation-duration-permanent"><input type="checkbox" data-decision-duration-permanent' + (duration.permanent ? ' checked' : '') + '>Vĩnh viễn</label>' +
        '<input type="hidden" data-decision-value value="' + escapeHtml(value || '') + '"></div>';
    }
    if (type === 'calculated_date') {
      return '<input' + attrs + ' type="text" readonly value="' + escapeHtml(value || '') + '" placeholder="Hệ thống tự tính"><span class="evaluation-calculated-note">Tự tính từ ngày bắt đầu và thời hạn.</span>';
    }`,
    "kiểu thời hạn và ngày tự tính",
  );
  source = replaceRequired(
    source,
    `        var optionValue = trim(option && (option.value || option.label) || option);
        if (!optionValue) return '';
        return '<option value="' + escapeHtml(optionValue) + '"' + (text(value) === optionValue ? ' selected' : '') + '>' + escapeHtml(optionValue) + '</option>';`,
    `        var optionValue = trim(option && (option.value || option.label) || option);
        var optionLabel = trim(option && option.label || optionValue);
        if (!optionValue) return '';
        return '<option value="' + escapeHtml(optionValue) + '"' + (text(value) === optionValue ? ' selected' : '') + '>' + escapeHtml(optionLabel) + '</option>';`,
    "nhãn lựa chọn BGD/CnB",
  );

  source = replaceRequired(
    source,
    "    if (type === 'single_choice' || type === 'select') {",
    `    if (type === 'multi_choice' || type === 'multiselect') {
      var multiOptions = Array.isArray(field.options)
        ? field.options
        : Array.isArray(field.optionValues)
          ? field.optionValues
          : text(field.options || field.optionValues || field.choices).split(/[,;\\n|]+/);
      var selectedValues = evaluationDecisionAnswerValues(value);
      var multiHtml = multiOptions.map(function (option) {
        var optionValue = trim(option && (option.value || option.label) || option);
        var optionLabel = trim(option && option.label || optionValue);
        if (!optionValue) return '';
        var checked = selectedValues.indexOf(optionValue) !== -1;
        return '<label class="evaluation-multi-choice-option"><input type="checkbox" data-decision-multi-option value="' + escapeHtml(optionValue) + '"' + (checked ? ' checked' : '') + '><span>' + escapeHtml(optionLabel) + '</span></label>';
      }).join('');
      return '<div class="evaluation-multi-choice">' + multiHtml + '</div><input type="hidden" data-decision-value value="' + escapeHtml(JSON.stringify(selectedValues)) + '">';
    }
    if (type === 'single_choice' || type === 'select') {`,
    "kiểu trả lời chọn nhiều",
  );

  source = replaceRequired(
    source,
    "    var record = list('decisionValues').find(function (item) {",
    `    var nestedAnswers = instance && instance.decisionAnswers && instance.decisionAnswers[normalizeRole(role)] || {};
    var nestedKey = [field && field.code, field && field.fieldCode, field && field.id].map(text).filter(Boolean).find(function (key) { return Object.prototype.hasOwnProperty.call(nestedAnswers, key); });
    if (nestedKey != null) return nestedAnswers[nestedKey];
    var record = list('decisionValues').find(function (item) {`,
    "giá trị nháp quyết định",
  );
  source = replaceRequired(
    source,
    "    return record ? text(record.value || record.fieldValue || '') : '';",
    "    return record ? (record.value != null ? record.value : record.fieldValue || '') : '';",
    "giữ mảng giá trị chọn nhiều",
  );
  source = replaceRequired(
    source,
    `        (String(item.fieldId || item.decisionFieldId || '') === String(field && field.id || '') ||
          String(item.fieldCode || item.code || '') === String(field && field.code || ''));`,
    `        [item.fieldId, item.decisionFieldId, item.fieldCode, item.code].map(text).filter(Boolean).some(function (key) {
          return [field && field.id, field && field.code, field && field.fieldCode].map(text).filter(Boolean).indexOf(key) !== -1;
        });`,
    "khớp câu trả lời bằng khóa không rỗng",
  );

  source = replaceRequired(
    source,
    "    var scores = scoresForSelected(role);",
    `    var approvalRole = normalizeRole(role);
    var bodReadOnlyHtml = '';
    if (approvalRole === 'bod' || approvalRole === 'indirect_manager') {
      var approvalName = approvalRole === 'bod' ? 'Ban giám đốc' : 'Quản lý gián tiếp';
      bodReadOnlyHtml = '<div class="evaluation-bod-gate"><strong>Tổng hợp kết quả các bước trước</strong><span>' + escapeHtml(approvalName) + ' xem điểm nhóm công việc, giá trị văn hóa, câu trả lời và nhận xét đã lưu. Bấm Xem chi tiết khi cần kiểm tra từng tiêu chí.</span></div>' + evaluationReadonlyPriorReview(instance, 'self', true) + evaluationReadonlyPriorReview(instance, 'manager', true) + evaluationReadonlyPriorAssignments(instance);
      role = 'manager';
    }
    var scores = scoresForSelected(role);`,
    "chế độ duyệt M2/BGD không chấm điểm",
  );
  source = replaceRequired(
    source,
    `      node.innerHTML = '<div class="evaluation-empty">Phiếu này chưa có tiêu chí. Báo Admin kiểm tra phần cấu hình và sinh phiếu.</div>';`,
    `      node.innerHTML = bodReadOnlyHtml || '<div class="evaluation-empty">Phiếu này chưa có tiêu chí. Báo Admin kiểm tra phần cấu hình và sinh phiếu.</div>';`,
    "giữ câu trả lời khi lượt QLTT không có tiêu chí điểm",
  );

  source = replaceRequired(
    source,
    "    var reviewPanel = $('evaluationReviewPanel');",
    `    var reviewPanel = $('evaluationReviewPanel');
    var approvalRole = normalizeRole(role);
    var isBodReview = approvalRole === 'bod' || approvalRole === 'indirect_manager';
    var reviewKicker = reviewPanel && reviewPanel.querySelector('.evaluation-kicker');
    var moduleSubtitle = root.querySelector('.service-modal-subtitle');
    if (reviewPanel) reviewPanel.classList.toggle('is-bod-review', isBodReview);
    if (reviewKicker) reviewKicker.textContent = approvalRole === 'indirect_manager' ? 'Phê duyệt quản lý gián tiếp' : isBodReview ? 'Phê duyệt kết quả' : 'Chấm điểm';
    if (moduleSubtitle) moduleSubtitle.textContent = isBodReview
      ? (approvalRole === 'indirect_manager' ? 'Xem kết quả của nhân viên và Quản lý trực tiếp đã khóa, sau đó gửi quyết định trước khi chuyển CEO.' : 'Xem kết quả của nhân viên và Quản lý trực tiếp đã khóa, sau đó gửi quyết định của Ban giám đốc.')
      : 'Chọn đúng phiếu đánh giá được gán cho bạn rồi nhập điểm và nhận xét.';`,
    "nhãn màn M2/Ban giám đốc duyệt",
  );

  source = replaceRequired(
    source,
    `      Array.prototype.slice.call(form.querySelectorAll('input:not([type="hidden"]), select, textarea')).forEach(function (control) {
        control.disabled = !canEdit;
      });`,
    `      Array.prototype.slice.call(form.querySelectorAll('input:not([type="hidden"]), select, textarea')).forEach(function (control) {
        var approvalReview = normalizeRole(role) === 'bod' || normalizeRole(role) === 'indirect_manager';
        var bodScoreControl = approvalReview && !!control.closest('[data-score-id]');
        var bodOverallComment = approvalReview && control.id === 'evaluationReviewComment';
        control.disabled = !canEdit || bodScoreControl || bodOverallComment;
      });`,
    "khóa bảng điểm khi BGD duyệt",
  );

  source = replaceRequired(
    source,
    `    var draftButton = $('evaluationSaveDraftButton');
    var submitButton = $('evaluationSubmitButton');
    if (draftButton) draftButton.disabled = !canEdit;
    if (submitButton) submitButton.disabled = !canEdit;`,
    `    var draftButton = $('evaluationSaveDraftButton');
    var submitButton = $('evaluationSubmitButton');
    var isBodReview = normalizeRole(role) === 'bod' || normalizeRole(role) === 'indirect_manager';
    if (draftButton) {
      draftButton.disabled = !canEdit;
      draftButton.textContent = isBodReview ? 'Lưu quyết định' : 'Lưu nháp';
    }
    if (submitButton) {
      submitButton.disabled = !canEdit;
      submitButton.textContent = isBodReview ? 'Gửi phê duyệt' : 'Gửi đánh giá';
    }
    var overallCommentField = $('evaluationReviewComment') && $('evaluationReviewComment').closest('.evaluation-field');
    if (overallCommentField) overallCommentField.hidden = isBodReview;`,
    "nút thao tác Ban giám đốc duyệt",
  );

  source = replaceRequired(
    source,
    "    var fields = decisionFieldsForInstance(instance, role);",
    `    var fields = decisionFieldsForInstance(instance, role);
    if (instance && normalizeRole(role) === 'indirect_manager') {
      fields = [
        { id: 'INDIRECT_MANAGER_DECISION', code: 'INDIRECT_MANAGER_DECISION', label: 'Xác nhận của Quản lý gián tiếp', fieldType: 'single_choice', options: [{ value: 'accepted', label: 'Đồng ý với đề xuất của QLTT' }, { value: 'adjustment', label: 'Có điều chỉnh đề xuất của QLTT' }, { value: 'rejected', label: 'Từ chối đề xuất của QLTT' }], isRequired: true, role: 'indirect_manager' },
        { id: 'INDIRECT_MANAGER_FEEDBACK', code: 'INDIRECT_MANAGER_FEEDBACK', label: 'Nội dung điều chỉnh / Lý do từ chối', fieldType: 'long_text', isRequired: true, role: 'indirect_manager', dependsOnFieldCode: 'INDIRECT_MANAGER_DECISION', dependsOnValue: 'adjustment|rejected' }
      ].concat(fields.filter(function (field) { return ['INDIRECT_MANAGER_DECISION','INDIRECT_MANAGER_FEEDBACK'].indexOf(text(field.code)) === -1; }));
    }
    if (instance && normalizeRole(role) === 'bod') {
      fields = [
        { id: 'BOD_DECISION', code: 'BOD_DECISION', label: 'Xác nhận của Ban giám đốc', fieldType: 'single_choice', options: [{ value: 'accepted', label: 'Chấp nhận' }, { value: 'adjustment', label: 'Điều chỉnh' }, { value: 'rejected', label: 'Từ chối' }], isRequired: true, role: 'bod' },
        { id: 'BOD_FEEDBACK', code: 'BOD_FEEDBACK', label: 'Nội dung điều chỉnh / Lý do từ chối', fieldType: 'long_text', isRequired: true, role: 'bod', dependsOnFieldCode: 'BOD_DECISION', dependsOnValue: 'adjustment|rejected' }
      ].concat(fields.filter(function (field) { return ['BOD_DECISION','BOD_FEEDBACK'].indexOf(text(field.code)) === -1; }));
    }`,
    "ba lựa chọn BGD",
  );

  source = replaceRequired(
    source,
    `return '<label class="evaluation-extra-row" data-decision-field-id="' + escapeHtml(field.id || '') + '" data-decision-field-code="' + escapeHtml(field.code || '') + '" data-decision-field-type="' + escapeHtml(field.fieldType || 'text') + '">' +`,
    `var visibilityCondition = field.visibilityCondition && typeof field.visibilityCondition === 'object' ? field.visibilityCondition : {};
      var conditionValues = evaluationDecisionConfiguredValues(visibilityCondition.includeValues || field.conditionValues || field.dependsOnValue || field.showWhenValue || []);
      var conditionExcludedValues = evaluationDecisionConfiguredValues(visibilityCondition.excludeValues || field.conditionExcludedValues || []);
      var conditionMode = (visibilityCondition.matchMode || field.conditionMatchMode) === 'all' ? 'all' : 'any';
      var questionHtml = evaluationSanitizeQuestionHtml(field.labelHtml || field.fieldLabelHtml || '');
      return '<div class="evaluation-extra-row" data-decision-field-id="' + escapeHtml(field.id || '') + '" data-decision-field-code="' + escapeHtml(field.code || '') + '" data-decision-field-type="' + escapeHtml(field.fieldType || 'text') + '" data-decision-depends-on="' + escapeHtml(visibilityCondition.sourceFieldCode || field.dependsOnFieldCode || field.showWhenFieldCode || '') + '" data-decision-depends-value="' + escapeHtml(field.dependsOnValue || field.showWhenValue || '') + '" data-decision-condition-mode="' + escapeHtml(conditionMode) + '" data-decision-condition-values="' + escapeHtml(conditionValues.join('|')) + '" data-decision-condition-excluded="' + escapeHtml(conditionExcludedValues.join('|')) + '" data-decision-calc-start="' + escapeHtml(field.calculationStartFieldCode || field.startFieldCode || '') + '" data-decision-calc-duration="' + escapeHtml(field.calculationDurationFieldCode || field.durationFieldCode || '') + '">' +`,
    "metadata điều kiện CnB",
  );
  source = replaceRequired(
    source,
    `        '<span class="evaluation-label">' + escapeHtml(field.label || field.name || field.code || 'Câu hỏi') + (field.isRequired ? ' <span class="evaluation-required">*</span>' : '') + '</span>' +
        renderDecisionInput(field, value) +
      '</label>';`,
    `        '<div class="evaluation-label evaluation-decision-question">' + (questionHtml || escapeHtml(field.label || field.name || field.code || 'Câu hỏi')) + (field.isRequired ? ' <span class="evaluation-required">*</span>' : '') + '</div>' +
        renderDecisionInput(field, value) +
      '</div>';`,
    "hiển thị câu hỏi định dạng",
  );

  source = replaceRequired(
    source,
    "    }).join('') + '</div>';\n  }\n  function syncDecisionAnswerCount() {",
    "    }).join('') + '</div>';\n    syncDecisionFieldUi();\n  }\n  function syncDecisionAnswerCount() {",
    "khởi tạo điều kiện CnB",
  );
  source = replaceRequired(
    source,
    `  function syncDecisionAnswerCount() {
    var node = $('evaluationDecisionFields');
    if (!node || !node.classList.contains('is-visible')) return;
    var fields = $all('[data-decision-field-id]');
    var answeredCount = fields.reduce(function (total, row) {
      var input = row.querySelector('[data-decision-value]');
      return total + (input && trim(input.value) ? 1 : 0);
    }, 0);
    var total = Number(node.dataset.extraTotal) || fields.length;
    var countNode = node.querySelector('[data-extra-answer-count]');
    if (countNode) countNode.textContent = answeredCount + '/' + total + ' đã trả lời';
  }`,
    `  function syncDecisionAnswerCount() {
    var node = $('evaluationDecisionFields');
    if (!node || !node.classList.contains('is-visible')) return;
    syncDecisionFieldUi();
    var fields = $all('[data-decision-field-id]').filter(function (row) { return !row.hidden; });
    var answeredCount = fields.reduce(function (total, row) { return total + (evaluationDecisionRowValue(row) ? 1 : 0); }, 0);
    node.dataset.extraTotal = String(fields.length);
    var countNode = node.querySelector('[data-extra-answer-count]');
    if (countNode) countNode.textContent = answeredCount + '/' + fields.length + ' đã trả lời';
  }`,
    "đếm trường CnB theo điều kiện",
  );

  const decisionInputSelector = "event.target.closest('[data-decision-value]')";
  const expandedDecisionInputSelector =
    "event.target.closest('[data-decision-value],[data-decision-multi-option],[data-decision-duration-amount],[data-decision-duration-unit],[data-decision-duration-permanent]')";
  source = replaceRequired(
    source,
    decisionInputSelector,
    expandedDecisionInputSelector,
    "sự kiện nhập câu trả lời mở rộng",
  );
  source = replaceRequired(
    source,
    decisionInputSelector,
    expandedDecisionInputSelector,
    "sự kiện đổi câu trả lời mở rộng",
  );

  source = replaceRequired(
    source,
    `  function collectDecisionValues() {
    return $all('[data-decision-field-id]').map(function (row) {
      var input = row.querySelector('[data-decision-value]');
      return {
        fieldId: row.getAttribute('data-decision-field-id'),
        fieldCode: row.getAttribute('data-decision-field-code'),
        fieldType: row.getAttribute('data-decision-field-type'),
        value: input ? trim(input.value) : ''
      };
    });
  }`,
    `  function collectDecisionValues() {
    syncDecisionFieldUi();
    return $all('[data-decision-field-id]').filter(function (row) { return !row.hidden; }).map(function (row) {
      return {
        fieldId: row.getAttribute('data-decision-field-id'),
        fieldCode: row.getAttribute('data-decision-field-code'),
        fieldType: row.getAttribute('data-decision-field-type'),
        value: evaluationDecisionRowValue(row)
      };
    });
  }`,
    "thu thập trường CnB",
  );

  source = replaceRequired(
    source,
    `      var confirmPromise = typeof window.hcConfirm === 'function'
        ? window.hcConfirm('Sau khi gửi, phần đánh giá này sẽ chuyển sang bước tiếp theo và bạn không thể sửa nữa.', {
          title: 'Gửi đánh giá?',
          okLabel: 'Gửi đánh giá',
          cancelLabel: 'Xem lại'
        })
        : Promise.resolve(true);`,
    `      var submitRole = roleForInstance(selectedInstance());
      var submitApprovalRole = normalizeRole(submitRole);
      var isBodSubmission = submitApprovalRole === 'bod' || submitApprovalRole === 'indirect_manager';
      var confirmPromise = typeof window.hcConfirm === 'function'
        ? window.hcConfirm(isBodSubmission
          ? (submitApprovalRole === 'indirect_manager' ? 'Sau khi gửi, quyết định của Quản lý gián tiếp sẽ được khóa và phiếu chuyển sang CEO.' : 'Sau khi gửi, quyết định của Ban giám đốc sẽ được khóa và phiếu chuyển sang bước CnB.')
          : 'Sau khi gửi, phần đánh giá này sẽ chuyển sang bước tiếp theo và bạn không thể sửa nữa.', {
          title: isBodSubmission ? 'Gửi phê duyệt?' : 'Gửi đánh giá?',
          okLabel: isBodSubmission ? 'Gửi phê duyệt' : 'Gửi đánh giá',
          cancelLabel: 'Xem lại'
        })
        : Promise.resolve(true);`,
    "xác nhận gửi phê duyệt BGD",
  );
  source = replaceRequired(
    source,
    `    selectedInstanceId: '',
    commentInstanceId: '',`,
    `    selectedInstanceId: '',
    selectedAssignmentId: '',
    commentInstanceId: '',`,
    "trạng thái lượt duyệt đang chọn",
  );
  source = replaceRequired(
    source,
    `  function canReviewInstance(instance, role) {
    if (!instance || state.readOnly || normalize(instance.status) === 'finalized') return false;
    return roleCandidatesForInstance(instance).indexOf(normalizeRole(role)) !== -1 &&
      activeRolesForInstance(instance).indexOf(normalizeRole(role)) !== -1;
  }`,
    `  function canReviewInstance(instance, role) {
    if (!instance || state.readOnly || normalize(instance.status) === 'finalized') return false;
    var assignmentId = text(instance.reviewAssignmentId || '');
    var activeAssignmentIds = Array.isArray(instance.activeReviewAssignmentIds) ? instance.activeReviewAssignmentIds.map(text) : [];
    if (assignmentId && activeAssignmentIds.indexOf(assignmentId) === -1) return false;
    return roleCandidatesForInstance(instance).indexOf(normalizeRole(role)) !== -1 &&
      activeRolesForInstance(instance).indexOf(normalizeRole(role)) !== -1;
  }`,
    "khóa lượt đã gửi khi vai trò lặp lại ở cấp sau",
  );
  source = replaceRequired(
    source,
    `      instanceId: id,
      forceRefresh: options.forceRefresh === true,`,
    `      instanceId: id,
      assignmentId: state.selectedAssignmentId,
      forceRefresh: options.forceRefresh === true,`,
    "tải đúng lượt duyệt",
  );
  source = replaceRequired(
    source,
    `    return App.gas('getEvaluationAssignedInstances', {
      forceRefresh: options.forceRefresh === true,`,
    `    return App.gas('getEvaluationAssignedInstances', {
      assignmentId: state.selectedAssignmentId,
      forceRefresh: options.forceRefresh === true,`,
    "lọc lượt duyệt từ liên kết email",
  );
  const reviewPayloadNeedle = source.includes(
    `      instanceId: numValue($('evaluationSelectedInstanceId').value),
      role: role,`,
  )
    ? `      instanceId: numValue($('evaluationSelectedInstanceId').value),
      role: role,`
    : `      instanceId: String($('evaluationSelectedInstanceId').value || ''),
      role: role,`;
  source = replaceRequired(
    source,
    reviewPayloadNeedle,
    `      instanceId: String($('evaluationSelectedInstanceId').value || ''),
      assignmentId: instance.reviewAssignmentId || state.selectedAssignmentId || '',
      role: role,`,
    "lưu riêng từng lượt duyệt",
  );
  source = replaceRequired(
    source,
    `    state.selectedInstanceId = requestedInstanceId;
    state.commentInstanceId = '';`,
    `    state.selectedInstanceId = requestedInstanceId;
    state.selectedAssignmentId = String(options.assignmentId || options.reviewAssignmentId || '').trim();
    state.commentInstanceId = '';`,
    "nhận mã lượt duyệt từ URL",
  );
  return source;
}
