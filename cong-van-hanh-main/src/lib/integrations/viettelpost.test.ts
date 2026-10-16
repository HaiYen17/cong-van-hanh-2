import assert from "node:assert/strict";
import test from "node:test";

import { redactVtpDiagnosticValue } from "./viettelpost";

test("redacts Viettel Post credentials by key", () => {
  const result = redactVtpDiagnosticValue({
    Authorization: "Bearer secret",
    PASSWORD: "123456",
    cookie: "session=secret",
    nested: {
      accessToken: "secret-token",
      message: "Sai tài khoản hoặc mật khẩu",
    },
    USERNAME: "0559134339",
  });

  assert.deepEqual(result, {
    Authorization: "[Đã che]",
    PASSWORD: "[Đã che]",
    cookie: "[Đã che]",
    nested: {
      accessToken: "[Đã che]",
      message: "Sai tài khoản hoặc mật khẩu",
    },
    USERNAME: "0559134339",
  });
});

test("redacts JWT and long opaque token values without hiding API errors", () => {
  const result = redactVtpDiagnosticValue({
    data: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwNTU5MTM0MzM5In0.signature123456",
    message: "Account is not activated for Partner API",
    opaque: "AbCdEf0123456789AbCdEf0123456789AbCdEf0123456789AbCdEf",
  });

  assert.deepEqual(result, {
    data: "[Đã che]",
    message: "Account is not activated for Partner API",
    opaque: "[Đã che]",
  });
});
