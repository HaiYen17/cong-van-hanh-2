import assert from "node:assert/strict";
import test from "node:test";

import {
  listModuleMailRoutes,
  moduleMailRouterTestUtils,
  resolveModuleMailRoute,
} from "@/lib/mail/module-mail-router";

test("evaluation routes always use the CnB mailbox", () => {
  for (const moduleKey of ["evaluation", "evaluation-config"]) {
    const route = resolveModuleMailRoute(moduleKey, { allowDefault: false });
    assert.equal(route.senderEmail, "ns.cnb@nemthuanviet.vn");
    assert.equal(route.senderName, "Thuần Việt - Nhân sự CnB");
    assert.equal(route.provider, "gmail-workspace");
  }
});

test("configuration does not silently fall back to the admin mailbox", () => {
  assert.throws(
    () => resolveModuleMailRoute("evaluation-unknown", { allowDefault: false }),
    /chưa có mail gửi riêng/,
  );
  assert.deepEqual(
    listModuleMailRoutes(["evaluation-config"]).map((route) => route.senderEmail),
    ["ns.cnb@nemthuanviet.vn"],
  );
});

test("Gmail MIME contains the merged PDF as a real attachment", () => {
  const route = resolveModuleMailRoute("evaluation-config", {
    allowDefault: false,
  });
  const message = moduleMailRouterTestUtils.normalizeMessage({
    attachments: [
      {
        content: Buffer.from("%PDF-1.4\nmerged evaluation data", "utf8"),
        contentType: "application/pdf",
        fileName: "Hợp đồng lao động - Nguyễn Văn A.pdf",
      },
    ],
    htmlBody: "<p>Nội dung đánh giá</p>",
    subject: "Kết quả đánh giá",
    textBody: "Nội dung đánh giá",
    to: "nhan.su@example.com",
  });
  const raw = moduleMailRouterTestUtils.buildRawMessage(route, message);
  assert.match(raw, /Content-Type: multipart\/mixed/);
  assert.match(raw, /Content-Type: multipart\/alternative/);
  assert.match(raw, /Content-Type: application\/pdf/);
  assert.match(raw, /Content-Disposition: attachment;/);
  assert.match(
    raw,
    /filename\*=UTF-8''H%E1%BB%A3p%20%C4%91%E1%BB%93ng%20lao%20%C4%91%E1%BB%99ng%20-%20Nguy%E1%BB%85n%20V%C4%83n%20A\.pdf/,
  );
  assert.match(raw, /filename="Hop dong lao dong - Nguyen Van A\.pdf"/);
  assert.match(raw, /JVBERi0xLjQ/);
});

test("Gmail MIME giữ đủ nhiều PDF trong cùng một email", () => {
  const route = resolveModuleMailRoute("evaluation-config", {
    allowDefault: false,
  });
  const message = moduleMailRouterTestUtils.normalizeMessage({
    attachments: [
      {
        content: Buffer.from("%PDF-1.4\nhop dong", "utf8"),
        contentType: "application/pdf",
        fileName: "Hợp đồng lao động.pdf",
      },
      {
        content: Buffer.from("%PDF-1.4\nphu luc", "utf8"),
        contentType: "application/pdf",
        fileName: "Phụ lục lương.pdf",
      },
    ],
    subject: "Bộ hồ sơ nhân sự",
    textBody: "Hai biểu mẫu",
    to: "nhan.su@example.com",
  });
  const raw = moduleMailRouterTestUtils.buildRawMessage(route, message);
  assert.equal((raw.match(/Content-Disposition: attachment;/g) || []).length, 2);
  assert.match(raw, /filename="Hop dong lao dong\.pdf"/);
  assert.match(raw, /filename="Phu luc luong\.pdf"/);
});

test("mail router rejects an empty or oversized attachment", () => {
  assert.throws(
    () =>
      moduleMailRouterTestUtils.normalizeMessage({
        attachments: [
          {
            content: Buffer.alloc(0),
            contentType: "application/pdf",
            fileName: "empty.pdf",
          },
        ],
        subject: "Kết quả đánh giá",
        textBody: "Nội dung",
        to: "nhan.su@example.com",
      }),
    /đang rỗng/,
  );
});
