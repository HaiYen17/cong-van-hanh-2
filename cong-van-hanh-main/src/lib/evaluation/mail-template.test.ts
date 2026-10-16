import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluationMailHtmlToText,
  sanitizeEvaluationMailHtml,
} from "./mail-template";

test("keeps supported rich email formatting", () => {
  const html = sanitizeEvaluationMailHtml(
    '<h2 style="color:#114c41;font-weight:800">Xin chào</h2>' +
      '<div style="padding:12px;border-left:4px solid #d06b2a">Nội dung</div>' +
      '<a href="{{link_danh_gia}}" style="background-color:#d06b2a;color:#fff">Mở phiếu</a>',
  );

  assert.match(html, /<h2 style="color:#114c41;font-weight:800">/);
  assert.match(html, /border-left:4px solid #d06b2a/);
  assert.match(html, /href="\{\{link_danh_gia\}\}"/);
  assert.match(html, /target="_blank"/);
});

test("removes active content, event handlers and unsafe links", () => {
  const html = sanitizeEvaluationMailHtml(
    '<script>alert(1)</script><p onclick="steal()" style="color:red;position:fixed;background-image:url(javascript:bad)">An toàn</p>' +
      '<a href="javascript:alert(1)">Không an toàn</a>',
  );

  assert.doesNotMatch(html, /script|onclick|javascript|position|background-image/i);
  assert.equal(html, '<p style="color:red">An toàn</p><a>Không an toàn</a>');
});

test("creates a readable plain-text fallback", () => {
  const plain = evaluationMailHtmlToText(
    "<h2>Thông báo</h2><p>Chào <strong>{{nguoi_nhan}}</strong>,<br>Vui lòng hoàn thành.</p>",
  );

  assert.equal(
    plain,
    "Thông báo\nChào {{nguoi_nhan}},\nVui lòng hoàn thành.",
  );
});
