import "dotenv/config";
import { randomUUID } from "node:crypto";
import pg from "pg";
const { Pool } = pg;

const samples = [
  {
    name: "Hợp đồng",
    condition: "HC giữ 01 bản chính",
    cycle: "Theo năm",
    startIndex: 1,
    tokens: [
      { type: "COMPANY" }, { type: "HYPHEN" }, { type: "SERIAL", value: "###" },
      { type: "SLASH" }, { type: "MM" }, { type: "SLASH" }, { type: "YYYY" },
    ],
  },
  {
    name: "Công văn đi",
    condition: "Không yêu cầu lưu",
    cycle: "Theo tháng",
    startIndex: 1,
    tokens: [
      { type: "SERIAL", value: "##" }, { type: "SLASH" }, { type: "COMPANY" },
      { type: "HYPHEN" }, { type: "MM" }, { type: "YYYY" },
    ],
  },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const c = await pool.connect();
for (const s of samples) {
  await c.query(
    `INSERT INTO "DocumentType" ("id","name","takesNumber","condition","cycle","startIndex","formatTokens","status","updatedAt")
     VALUES ($1,$2,true,$3,$4,$5,$6::jsonb,'ACTIVE',now())
     ON CONFLICT ("name") DO NOTHING`,
    [`dtype_${randomUUID()}`, s.name, s.condition, s.cycle, s.startIndex, JSON.stringify(s.tokens)],
  );
}
const r = await c.query(`SELECT name, "cycle", "startIndex" FROM "DocumentType" ORDER BY name`);
console.log("Loại văn bản:", r.rows.map((x) => `${x.name}(${x.cycle})`).join(" | "));
c.release(); await pool.end();
