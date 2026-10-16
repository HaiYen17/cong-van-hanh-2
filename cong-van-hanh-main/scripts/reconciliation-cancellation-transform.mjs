function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) {
    throw new Error(
      `Không tìm thấy điểm gắn ${label} trong ReconciliationModal.html.`,
    );
  }
  return source.replace(needle, replacement);
}

function replaceAllRequired(source, needle, replacement, minimum, label) {
  const count = source.split(needle).length - 1;
  if (count < minimum) {
    throw new Error(
      `Không tìm thấy đủ điểm gắn ${label} trong ReconciliationModal.html.`,
    );
  }
  return source.replaceAll(needle, replacement);
}

export function transformReconciliationCancellation(source) {
  const cancelStyles = `

  #reconciliationModal .reconciliation-history-action {
    width: 1%;
    white-space: nowrap;
  }

  #reconciliationModal .reconciliation-cancel-button {
    min-height: 34px;
    padding: 7px 11px;
    border-color: rgba(185, 46, 39, 0.2);
    background: #bf352f;
    color: #fff;
    font-size: 0.76rem;
    box-shadow: 0 8px 18px rgba(185, 46, 39, 0.16);
  }

  #reconciliationModal .reconciliation-cancel-button:hover {
    background: #a92c27;
  }
`;
  source = replaceRequired(
    source,
    `  #reconciliationModal .reconciliation-link:hover {
    text-decoration: underline;
  }
`,
    `  #reconciliationModal .reconciliation-link:hover {
    text-decoration: underline;
  }
${cancelStyles}`,
    "style nút Hủy bảng kê",
  );

  source = replaceRequired(
    source,
    "Mở lại bảng tổng hợp hoặc bảng kê chi tiết đã sinh trước đó.",
    "Mở lại hoặc hủy đồng thời bảng tổng hợp và file chi tiết của từng kỳ để tạo lại.",
    "mô tả lịch sử có chức năng hủy",
  );
  source = replaceAllRequired(
    source,
    "                      <th>Cập nhật</th>",
    `                      <th>Cập nhật</th>
                      <th>Thao tác</th>`,
    2,
    "cột Thao tác lịch sử",
  );

  source = replaceRequired(
    source,
    `    activeButtonId: ''
  };`,
    `    activeButtonId: '',
    busyTitle: 'Đang tạo đối soát'
  };`,
    "trạng thái tiêu đề tiến trình",
  );
  source = replaceRequired(
    source,
    `  function renderBusy(text) {
    const elapsed = state.busyStartedAt ? Math.max(1, Math.floor((Date.now() - state.busyStartedAt) / 1000)) : 0;
    showBusyPopup('Đang tạo đối soát', \`\${text}. Hệ thống đang chạy, đã chờ \${elapsed}s.\`);
  }`,
    `  function renderBusy(text) {
    const elapsed = state.busyStartedAt ? Math.max(1, Math.floor((Date.now() - state.busyStartedAt) / 1000)) : 0;
    showBusyPopup(state.busyTitle || 'Đang tạo đối soát', \`\${text}. Hệ thống đang chạy, đã chờ \${elapsed}s.\`);
  }`,
    "tiêu đề popup tiến trình",
  );
  source = replaceRequired(
    source,
    `  function startBusy(text, buttonId) {
    stopBusy(false);
    state.busy = true;
    state.busyStartedAt = Date.now();
    state.activeButtonId = buttonId || '';
    toggleButtons();
    renderBusy(text);
    state.busyTimer = window.setInterval(() => renderBusy(text), 700);
  }`,
    `  function startBusy(text, buttonId, title) {
    stopBusy(false);
    state.busy = true;
    state.busyStartedAt = Date.now();
    state.activeButtonId = buttonId || '';
    state.busyTitle = title || 'Đang tạo đối soát';
    toggleButtons();
    renderBusy(text);
    state.busyTimer = window.setInterval(() => renderBusy(text), 700);
  }`,
    "hàm mở tiến trình hủy",
  );
  source = replaceRequired(
    source,
    `    state.activeButtonId = '';
    toggleButtons();`,
    `    state.activeButtonId = '';
    state.busyTitle = 'Đang tạo đối soát';
    toggleButtons();`,
    "reset tiêu đề tiến trình",
  );
  source = replaceRequired(
    source,
    `    document.querySelectorAll('#reconciliationModal [data-remove-reconcile-file]').forEach((button) => {
      button.disabled = isBusy;
    });`,
    `    document.querySelectorAll('#reconciliationModal [data-remove-reconcile-file], #reconciliationModal [data-cancel-reconcile-period]').forEach((button) => {
      button.disabled = isBusy;
    });`,
    "khóa nút Hủy bảng kê khi đang xử lý",
  );

  const registryBlock = `    const primary = response.primary || {};
    $('reconciliationPrimaryRegistryBody').innerHTML = primary.latestPeriod
      ? \`<tr><td>\${escapeHtml(primary.latestPeriod)}</td><td><a class="reconciliation-link" href="\${escapeAttr(primary.link)}" target="_blank" rel="noopener">Mở bảng tổng hợp</a></td><td>\${escapeHtml(primary.updatedLabel || '')}</td></tr>\`
      : \`<tr><td colspan="3">\${escapeHtml(response.primaryError || 'Chưa tìm thấy kỳ nào trong bảng tổng hợp.')}</td></tr>\`;
    const secondary = Array.isArray(response.secondary) ? response.secondary : [];
    $('reconciliationSecondaryRegistryBody').innerHTML = secondary.length
      ? secondary.map((item) => \`<tr><td>\${escapeHtml(item.periodCode || item.name || '')}</td><td><a class="reconciliation-link" href="\${escapeAttr(item.link)}" target="_blank" rel="noopener">Mở file chi tiết</a></td><td>\${escapeHtml(item.updatedLabel || '')}</td></tr>\`).join('')
      : \`<tr><td colspan="3">\${escapeHtml(response.secondaryError || 'Chưa thấy file bảng kê nào trong folder theo dõi.')}</td></tr>\`;`;
  const cancelFunctions = `  function parseReconciliationPeriodCode(periodCode) {
    const match = String(periodCode || '').match(/^T(\\d{2})\\.(\\d{4})$/i);
    if (!match) return null;
    const month = Number(match[1]);
    const year = Number(match[2]);
    if (month < 1 || month > 12 || year < 2020 || year > 2100) return null;
    return { month: month, year: year, periodCode: 'T' + match[1] + '.' + match[2] };
  }

  function renderCancelPeriodButton(periodCode, canCancel) {
    const period = parseReconciliationPeriodCode(periodCode);
    if (!canCancel || !period) return '';
    return '<button class="btn danger reconciliation-cancel-button" type="button" data-cancel-reconcile-period="' +
      escapeAttr(period.periodCode) + '">Hủy bảng kê</button>';
  }

  async function cancelReconciliationPeriod(periodCode) {
    if (state.busy) return;
    const period = parseReconciliationPeriodCode(periodCode);
    if (!period) {
      showPopup('Không hủy được bảng kê', 'Kỳ đối soát không hợp lệ.', 'error');
      return;
    }
    const confirmed = await App.ui.confirm(
      'Hệ thống sẽ xóa tab tổng hợp và đưa file bảng kê chi tiết của ' +
        period.periodCode +
        ' vào Thùng rác. Dữ liệu run cũ vẫn được giữ để kiểm toán. Tiếp tục?',
      {
        title: 'Hủy bảng kê ' + period.periodCode,
        okLabel: 'Hủy bảng kê',
        cancelLabel: 'Giữ lại'
      }
    );
    if (!confirmed) return;

    try {
      startBusy(
        'Đang dọn tab tổng hợp và file chi tiết của ' + period.periodCode,
        'cancel',
        'Đang hủy bảng kê'
      );
      const response = await App.gas('cancelReconciliationPeriod', {
        month: period.month,
        year: period.year
      });
      stopBusy(false);
      if (!response || !response.success) {
        throw new Error((response && response.message) || 'Hủy bảng kê thất bại.');
      }
      if (response.registry) {
        renderRegistrySummary(response.registry);
      } else {
        await refreshRegistrySummary();
      }
      setStatus(response.message || ('Đã hủy ' + period.periodCode + '.'), 'success');
      showPopup(
        'Đã hủy bảng kê',
        response.message || ('Đã hủy ' + period.periodCode + '. Ông có thể tạo lại kỳ này ngay.'),
        'success'
      );
    } catch (error) {
      stopBusy(false);
      showPopup(
        'Không hủy được bảng kê',
        (error && error.message) || String(error),
        'error'
      );
    }
  }

`;
  source = replaceRequired(
    source,
    "  function refreshRegistrySummary() {",
    cancelFunctions + "  function refreshRegistrySummary() {",
    "luồng xác nhận Hủy bảng kê",
  );
  source = replaceRequired(
    source,
    registryBlock,
    `    const primary = response.primary || {};
    const canCancel = response.canCancel === true;
    $('reconciliationPrimaryRegistryBody').innerHTML = primary.latestPeriod
      ? '<tr><td>' + escapeHtml(primary.latestPeriod) + '</td><td><a class="reconciliation-link" href="' + escapeAttr(primary.link) + '" target="_blank" rel="noopener">Mở bảng tổng hợp</a></td><td>' + escapeHtml(primary.updatedLabel || '') + '</td><td class="reconciliation-history-action">' + renderCancelPeriodButton(primary.latestPeriod, canCancel) + '</td></tr>'
      : '<tr><td colspan="4">' + escapeHtml(response.primaryError || 'Chưa tìm thấy kỳ nào trong bảng tổng hợp.') + '</td></tr>';
    const secondary = Array.isArray(response.secondary) ? response.secondary : [];
    $('reconciliationSecondaryRegistryBody').innerHTML = secondary.length
      ? secondary.map((item) => '<tr><td>' + escapeHtml(item.periodCode || item.name || '') + '</td><td><a class="reconciliation-link" href="' + escapeAttr(item.link) + '" target="_blank" rel="noopener">Mở file chi tiết</a></td><td>' + escapeHtml(item.updatedLabel || '') + '</td><td class="reconciliation-history-action">' + renderCancelPeriodButton(item.periodCode || '', canCancel) + '</td></tr>').join('')
      : '<tr><td colspan="4">' + escapeHtml(response.secondaryError || 'Chưa thấy file bảng kê nào trong folder theo dõi.') + '</td></tr>';
    toggleButtons();`,
    "nút Hủy bảng kê trong lịch sử",
  );
  source = replaceAllRequired(
    source,
    'colspan="3"',
    'colspan="4"',
    3,
    "colspan bảng lịch sử",
  );

  source = replaceRequired(
    source,
    `    $('reconciliationFileList').addEventListener('click', function(event) {`,
    `    $('reconciliationModal').addEventListener('click', function(event) {
      const button = event.target.closest('[data-cancel-reconcile-period]');
      if (!button) return;
      cancelReconciliationPeriod(button.getAttribute('data-cancel-reconcile-period') || '');
    });
    $('reconciliationFileList').addEventListener('click', function(event) {`,
    "sự kiện nút Hủy bảng kê",
  );

  return source;
}
