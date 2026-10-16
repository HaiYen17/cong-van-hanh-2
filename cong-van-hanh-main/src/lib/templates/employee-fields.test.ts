import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEmployeeTemplateValues,
  calculateEmployeeAge,
  EMPLOYEE_TEMPLATE_FIELD_OPTIONS,
  formatTemplateDateValue,
  parseTemplateDateParts,
  sensitiveEmployeeFieldPolicyViolation,
  toIsoTemplateDate,
} from "./employee-fields";

test("chuẩn hóa ngày nhân sự từ các định dạng nguồn V3", () => {
  assert.deepEqual(parseTemplateDateParts("19/08/1990"), {
    day: 19,
    month: 8,
    year: 1990,
  });
  assert.deepEqual(parseTemplateDateParts("1990-08-19T00:00:00.000Z"), {
    day: 19,
    month: 8,
    year: 1990,
  });
  assert.equal(toIsoTemplateDate("19-8-1990"), "1990-08-19");
  assert.equal(
    formatTemplateDateValue("1990-08-19", "dd/mm/yyyy"),
    "19/08/1990",
  );
  assert.equal(parseTemplateDateParts("31/02/1990"), null);
});

test("suy ra ngày, tháng, năm sinh và tuổi tròn", () => {
  const now = new Date(2026, 7, 19);
  const values = buildEmployeeTemplateValues(
    {
      bankAccount: "00123456789",
      bankName: "Ngân hàng A",
      birthDate: "20/08/1990",
      employeeCode: "TV001",
      fullName: "Nguyễn Văn A",
      identityDate: "01/02/2020",
      identityNumber: "079000000001",
      identityPlace: "Cục CSQLHC",
      permanentResidence: "123 Nguyễn Huệ, TP.HCM",
      personalTaxCode: "0312345678",
      socialInsuranceNumber: "7901234567",
      status: "ACTIVE",
      terminationDate: "",
    },
    { now },
  );

  assert.equal(values.birthDate, "1990-08-20");
  assert.equal(values.birthDay, "20");
  assert.equal(values.birthMonth, "08");
  assert.equal(values.birthYear, "1990");
  assert.equal(values.age, "35");
  assert.equal(values.identityDate, "2020-02-01");
  assert.equal(values.permanentResidence, "123 Nguyễn Huệ, TP.HCM");
  assert.equal(values.personalTaxCode, "0312345678");
  assert.equal(values.socialInsuranceNumber, "7901234567");
  assert.equal(values.status, "Đang làm việc");
  assert.equal(calculateEmployeeAge("19/08/1990", now), "36");
});

test("không đưa CCCD, ngày sinh và tài khoản vào danh sách tra cứu nhân sự", () => {
  const values = buildEmployeeTemplateValues(
    {
      bankAccount: "00123456789",
      birthDate: "19/08/1990",
      employeeCode: "TV001",
      fullName: "Nguyễn Văn A",
      identityNumber: "079000000001",
      status: "ACTIVE",
    },
    { includeSensitive: false },
  );

  assert.equal(values.employeeCode, "TV001");
  assert.equal(values.status, "Đang làm việc");
  assert.equal("identityNumber" in values, false);
  assert.equal("bankAccount" in values, false);
  assert.equal("birthDate" in values, false);
});

test("trường nhạy cảm chỉ dùng cho người thao tác hoặc đúng nhân sự của phiếu đánh giá", () => {
  assert.match(
    sensitiveEmployeeFieldPolicyViolation({
      bindingMode: "scalar-actor",
      contextSource: "subject",
      datasetKey: "employee",
      isTableField: false,
      sourceFieldKey: "birthDate",
    }),
    /chỉ được tự điền/,
  );
  assert.equal(
    sensitiveEmployeeFieldPolicyViolation({
      bindingMode: "scalar-actor",
      contextSource: "actor",
      datasetKey: "employee",
      isTableField: false,
      sourceFieldKey: "birthDate",
    }),
    "",
  );
  assert.equal(
    sensitiveEmployeeFieldPolicyViolation({
      bindingMode: "scalar-actor",
      contextSource: "evaluation-subject",
      datasetKey: "employee",
      isTableField: false,
      sourceFieldKey: "personalTaxCode",
    }),
    "",
  );
  assert.equal(
    EMPLOYEE_TEMPLATE_FIELD_OPTIONS.find((field) => field.key === "bankAccount")
      ?.sensitive,
    true,
  );
  for (const key of [
    "permanentResidence",
    "personalTaxCode",
    "socialInsuranceNumber",
  ]) {
    assert.equal(
      EMPLOYEE_TEMPLATE_FIELD_OPTIONS.find((field) => field.key === key)
        ?.sensitive,
      true,
    );
  }
});
