import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCompanySignatureMap,
  signatureConfigForUi,
} from "./company-signature-config-shared";
import { normalizeSignaturePng } from "./company-signature-config";
import { openConfigSecret, sealConfigSecret } from "./secret-vault";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=";

test("company routing preserves independent certificate and BOD associations without leaking artwork", () => {
  const image = sealConfigSecret(PNG)!;
  const config = parseCompanySignatureMap(JSON.stringify({
    companyA: { certAlias: "cert-A", bodUserIds: ["bod1", "bod1"], signatureImage: image },
    companyB: { certAlias: "cert-B", bodUserIds: ["bod1", "bod2"] },
  }));
  assert.deepEqual(config.companyA.bodUserIds, ["bod1"]);
  assert.deepEqual(config.companyB.bodUserIds, ["bod1", "bod2"]);
  assert.equal(openConfigSecret(config.companyA.signatureImage), PNG);
  const ui = signatureConfigForUi("companyA", config.companyA);
  assert.deepEqual(ui, { companyId: "companyA", certAlias: "cert-A", bodUserIds: ["bod1"], hasImage: true });
  assert.equal(JSON.stringify(ui).includes(image), false);
  assert.equal(JSON.stringify(ui).includes(PNG), false);
});

test("malformed maps fail rather than discarding another company's settings", () => {
  for (const raw of ["{", "[]", "null", '{"companyA":false}', '{"companyA":{"certAlias":"a","bodUserIds":[42]}}']) {
    assert.throws(() => parseCompanySignatureMap(raw));
  }
  assert.deepEqual(parseCompanySignatureMap('{"companyA":"legacy-alias"}').companyA, { certAlias: "legacy-alias", bodUserIds: [] });
  assert.equal(Object.hasOwn(parseCompanySignatureMap('{"__proto__":"ignored"}'), "__proto__"), false);
});

test("signature image accepts bounded PNG content and rejects other data or invalid dimensions", () => {
  assert.equal(normalizeSignaturePng(`data:image/png;base64,${PNG}`), PNG);
  assert.throws(() => normalizeSignaturePng("data:image/svg+xml;base64,PHN2Zz4="));
  assert.throws(() => normalizeSignaturePng(Buffer.from("not a PNG").toString("base64")));
  const huge = Buffer.from(PNG, "base64");
  huge.writeUInt32BE(100000, 16);
  assert.throws(() => normalizeSignaturePng(huge.toString("base64")));
  assert.throws(() => normalizeSignaturePng("A".repeat(800000)));
});
