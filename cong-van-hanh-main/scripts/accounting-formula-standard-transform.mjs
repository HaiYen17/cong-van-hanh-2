function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) {
    throw new Error(
      `Không tìm thấy điểm gắn ${label} trong AccountingConfigModal.html.`,
    );
  }
  return source.replace(needle, replacement);
}

export function transformAccountingFormulaStandard(source) {
  // MANUAL_ADJUSTMENT đã được loại khỏi cấu hình vận hành. Luôn bỏ lựa chọn này
  // khỏi trang sinh lại để một lần build parity không vô tình đưa nó trở về UI.
  source = source.replace(
    /<option value="MANUAL_ADJUSTMENT">[^<]*<\/option>/g,
    "",
  );
  if (!source.includes('value="DEBIT_BALANCE"')) {
    source = replaceRequired(
      source,
      '<select class="ui-module-select" name="side"><option value="">Tự động</option><option value="DEBIT">Bên Nợ</option><option value="CREDIT">Bên Có</option><option value="NET">Chênh lệch Nợ - Có</option></select>',
      '<select class="ui-module-select" name="side"><option value="">Tự động</option><option value="DEBIT">Chỉ số bên Nợ</option><option value="CREDIT">Chỉ số bên Có</option><option value="DEBIT_BALANCE">Số dư ròng theo bên Nợ</option><option value="CREDIT_BALANCE">Số dư ròng theo bên Có</option><option value="NET">Nợ trừ Có</option></select>',
      "cách tính số dư theo bên Nợ/Có",
    );
  }

  if (!source.includes('value="MOVEMENT_DETAIL"')) {
    source = replaceRequired(
      source,
      '<option value="MOVEMENT">Phát sinh trong kỳ</option><option value="CASH_MOVEMENT">Dòng tiền</option>',
      '<option value="MOVEMENT">Phát sinh trong kỳ</option><option value="MOVEMENT_DETAIL">Phát sinh chi tiết có tài khoản đối ứng</option><option value="CASH_MOVEMENT">Dòng tiền</option>',
      "phép tính phát sinh chi tiết",
    );
  }
  if (!source.includes('value="LINE_REFERENCE"')) {
    source = replaceRequired(
      source,
      '<option value="LINE_EXPRESSION">Công thức theo mã dòng</option><option value="CROSS_REPORT">Lấy từ báo cáo khác</option>',
      '<option value="LINE_EXPRESSION">Công thức theo mã dòng</option><option value="LINE_REFERENCE">Lấy từ một dòng khác</option><option value="CROSS_REPORT">Lấy từ báo cáo khác</option>',
      "phép tính tham chiếu dòng",
    );
  }

  if (!source.includes("['OPENING_DEBIT_BALANCE'")) {
    source = replaceRequired(
      source,
      "    ['OPENING_CREDIT', 'Số dư Có đầu kỳ', 'BALANCE', 'OPENING', 'CREDIT'],",
      "    ['OPENING_CREDIT', 'Số dư Có đầu kỳ', 'BALANCE', 'OPENING', 'CREDIT'],\n" +
        "    ['OPENING_DEBIT_BALANCE', 'Số dư ròng theo bên Nợ đầu kỳ', 'BALANCE', 'OPENING', 'DEBIT_BALANCE'],\n" +
        "    ['OPENING_CREDIT_BALANCE', 'Số dư ròng theo bên Có đầu kỳ', 'BALANCE', 'OPENING', 'CREDIT_BALANCE'],",
      "chỉ tiêu số dư đầu kỳ",
    );
    source = replaceRequired(
      source,
      "    ['CLOSING_CREDIT', 'Số dư Có cuối kỳ', 'BALANCE', 'ENDING', 'CREDIT'],",
      "    ['CLOSING_CREDIT', 'Số dư Có cuối kỳ', 'BALANCE', 'ENDING', 'CREDIT'],\n" +
        "    ['CLOSING_DEBIT_BALANCE', 'Số dư ròng theo bên Nợ cuối kỳ', 'BALANCE', 'ENDING', 'DEBIT_BALANCE'],\n" +
        "    ['CLOSING_CREDIT_BALANCE', 'Số dư ròng theo bên Có cuối kỳ', 'BALANCE', 'ENDING', 'CREDIT_BALANCE'],",
      "chỉ tiêu số dư cuối kỳ",
    );
    source = replaceRequired(
      source,
      "    ['CLOSING_NET', 'Chênh lệch Nợ - Có cuối kỳ', 'BALANCE', 'ENDING', 'NET'],",
      "    ['CLOSING_NET', 'Chênh lệch Nợ - Có cuối kỳ', 'BALANCE', 'ENDING', 'NET'],\n" +
        "    ['DELTA_DEBIT_BALANCE', 'Tăng/giảm số dư ròng bên Nợ', 'DELTA_BALANCE', 'DELTA', 'DEBIT_BALANCE'],\n" +
        "    ['DELTA_CREDIT_BALANCE', 'Tăng/giảm số dư ròng bên Có', 'DELTA_BALANCE', 'DELTA', 'CREDIT_BALANCE'],",
      "chỉ tiêu biến động số dư",
    );
  }

  if (!source.includes("operator === 'CROSS_REPORT') return sign + ' Dòng '")) {
    source = replaceRequired(
      source,
      "  function builderFormulaTermText(term) {\n    var sign = Number(term && term.sign) < 0 ? '−' : '+';",
      "  function builderFormulaTermText(term) {\n    var sign = Number(term && term.sign) < 0 ? '−' : '+';\n" +
        "    var operator = String(term && term.operator || '').toUpperCase();\n" +
        "    if (operator === 'CROSS_REPORT') return sign + ' Dòng ' + String(term.targetReportKey || 'báo cáo khác') + ':' + String(term.targetRowCode || '?');\n" +
        "    if (operator === 'LINE_REFERENCE') return sign + ' Dòng ' + String(term.targetRowCode || term.lineRef || '?') + ' trong báo cáo';",
      "mô tả thành phần công thức",
    );
  }

  if (!source.includes('data-accounting-formula-term data-term-index=')) {
    source = replaceRequired(
      source,
      "    return '<div class=\"accounting-formula-term\" data-accounting-formula-term>' +",
      "    return '<div class=\"accounting-formula-term\" data-accounting-formula-term data-term-index=\"' + Number(index || 0) + '\">' +",
      "chỉ số thành phần công thức",
    );
  }

  if (!source.includes("var previousTerms = Array.isArray(rulePayload.terms)")) {
    source = replaceRequired(
      source,
      "        formulaTerms = Array.prototype.slice.call(form.querySelectorAll('[data-accounting-formula-term]')).map(function (termNode) {\n          var metric = builderMetricParts(termNode.querySelector('[data-term-field=\"metricKey\"]').value) || builderMetricParts('CLOSING_NET');\n          return {",
      "        formulaTerms = Array.prototype.slice.call(form.querySelectorAll('[data-accounting-formula-term]')).map(function (termNode) {\n" +
        "          var termIndex = Number(termNode.getAttribute('data-term-index') || 0);\n" +
        "          var previousTerms = Array.isArray(rulePayload.terms) ? rulePayload.terms : [];\n" +
        "          var previousTerm = Object.assign({}, previousTerms[termIndex] || (termIndex === 0 ? rulePayload : {}));\n" +
        "          var metric = builderMetricParts(termNode.querySelector('[data-term-field=\"metricKey\"]').value) || builderMetricParts('CLOSING_NET');\n" +
        "          return Object.assign(previousTerm, {",
      "giữ điều kiện nâng cao khi sửa công thức",
    );
    source = replaceRequired(
      source,
      "            accountSetKey: termNode.querySelector('[data-term-field=\"accountSetKey\"]').value\n          };",
      "            accountSetKey: termNode.querySelector('[data-term-field=\"accountSetKey\"]').value\n          });",
      "đóng thành phần công thức đã ghép",
    );
    source = replaceRequired(
      source,
      "      cellPayload.accountSetKey = contentKind === 'ACCOUNT_SET' ? firstTerm.accountSetKey || '' : '';",
      "      cellPayload.accountSetKey = contentKind === 'ACCOUNT_SET' ? firstTerm.accountSetKey || '' : '';\n" +
        "      cellPayload.counterAccountSetKey = contentKind === 'ACCOUNT_SET' ? firstTerm.counterAccountSetKey || '' : '';\n" +
        "      cellPayload.sourceKey = contentKind === 'ACCOUNT_SET' ? firstTerm.sourceKey || '' : '';\n" +
        "      cellPayload.datasetType = contentKind === 'ACCOUNT_SET' ? firstTerm.datasetType || '' : '';\n" +
        "      cellPayload.targetReportKey = contentKind === 'ACCOUNT_SET' ? firstTerm.targetReportKey || '' : '';\n" +
        "      cellPayload.targetRowCode = contentKind === 'ACCOUNT_SET' ? firstTerm.targetRowCode || '' : '';\n" +
        "      cellPayload.periodSelector = contentKind === 'ACCOUNT_SET' ? firstTerm.periodSelector || '' : '';\n" +
        "      cellPayload.conditionKey = contentKind === 'ACCOUNT_SET' ? firstTerm.conditionKey || '' : '';\n" +
        "      cellPayload.intercompanyMode = contentKind === 'ACCOUNT_SET' ? firstTerm.intercompanyMode || '' : '';\n" +
        "      cellPayload.maturityClass = contentKind === 'ACCOUNT_SET' ? firstTerm.maturityClass || '' : '';\n" +
        "      cellPayload.excludeClosingEntries = contentKind === 'ACCOUNT_SET' ? firstTerm.excludeClosingEntries !== false : false;\n" +
        "      cellPayload.excludeReversals = contentKind === 'ACCOUNT_SET' ? firstTerm.excludeReversals === true : false;\n" +
        "      cellPayload.useColumnBasis = contentKind === 'ACCOUNT_SET' ? firstTerm.useColumnBasis !== false : true;\n" +
        "      cellPayload.filters = contentKind === 'ACCOUNT_SET' && firstTerm.filters && typeof firstTerm.filters === 'object' ? firstTerm.filters : {};",
      "thuộc tính nâng cao của ô công thức",
    );
  }

  return source
    .replace(/<option value="MANUAL_ADJUSTMENT">[^<]*<\/option>/g, "")
    .replace(/,\s*MANUAL_ADJUSTMENT:\s*'[^']*'/g, "")
    .replace(/^\s*if \(operator === 'MANUAL_ADJUSTMENT'\).*$/gm, "");
}
