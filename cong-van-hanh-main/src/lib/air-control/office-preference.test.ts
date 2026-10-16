import assert from "node:assert/strict";
import test from "node:test";

import {
  compareElectricalFloors,
  LONG_AN_OFFICE,
  preferredElectricalOfficeForCompany,
  QUAN_12_OFFICE,
  resolvePreferredElectricalOffice,
} from "@/lib/air-control/office-preference";

test("Nệm Thành Công employees default to the Long An office", () => {
  assert.equal(
    preferredElectricalOfficeForCompany({
      code: "NTC",
      legalName: "Công ty TNHH Nệm Thành Công",
    }),
    LONG_AN_OFFICE,
  );
});

test("other employees default to the Quận 12 office", () => {
  assert.equal(
    preferredElectricalOfficeForCompany({ code: "NTV" }),
    QUAN_12_OFFICE,
  );
});

test("office matching ignores accents and falls back to an available building", () => {
  assert.equal(
    resolvePreferredElectricalOffice(
      ["Văn Phòng Quận 12", "Văn phòng Long An"],
      "Van phong Long An",
    ),
    "Văn phòng Long An",
  );
  assert.equal(
    resolvePreferredElectricalOffice(["Chi nhánh khác"], LONG_AN_OFFICE),
    "Chi nhánh khác",
  );
});

test("floor order keeps ground floor before numbered floors", () => {
  assert.deepEqual(
    ["Tầng 3", "Tầng Trệt", "Tầng 1", "Tầng 2"].sort(
      compareElectricalFloors,
    ),
    ["Tầng Trệt", "Tầng 1", "Tầng 2", "Tầng 3"],
  );
});
