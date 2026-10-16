import "dotenv/config";

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const gid = (p) => `${p}_${randomUUID()}`;
const data = JSON.parse(
  readFileSync(new URL("./directory-seed.json", import.meta.url), "utf8"),
);

const companyStatus = (s) => (/kích hoạt|active/i.test(s || "") ? "ACTIVE" : "INACTIVE");
const employeeStatus = (s) => (/nghỉ|thôi/i.test(s || "") ? "INACTIVE" : "ACTIVE");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    // Công ty (mã số thuế nguồn bị lỗi định dạng + trùng → để trống, nhập lại sau).
    const byLegalName = new Map();
    for (const co of data.companies) {
      const code = (co.code || co.legalName.slice(0, 6)).toUpperCase();
      const r = await c.query(
        `
          INSERT INTO "Company" ("id", "code", "legalName", "status", "updatedAt")
          VALUES ($1, $2, $3, $4::"CompanyStatus", now())
          ON CONFLICT ("code") DO UPDATE SET
            "legalName" = EXCLUDED."legalName",
            "status" = EXCLUDED."status",
            "updatedAt" = now()
          RETURNING "id"
        `,
        [gid("co"), code, co.legalName, companyStatus(co.status)],
      );
      byLegalName.set(co.legalName.trim(), r.rows[0].id);
    }

    const usedEmail = new Set();
    let imported = 0;
    for (const e of data.employees) {
      let email = (e.email || "").trim().toLowerCase();
      if (!email || usedEmail.has(email)) email = null;
      else usedEmail.add(email);

      const companyId = byLegalName.get((e.company || "").trim()) || null;

      await c.query(
        `
          INSERT INTO "Employee"
            ("id", "employeeCode", "fullName", "email", "phone", "department", "title", "status", "companyId", "updatedAt")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::"EmployeeStatus", $9, now())
          ON CONFLICT ("employeeCode") DO UPDATE SET
            "fullName" = EXCLUDED."fullName",
            "email" = EXCLUDED."email",
            "phone" = EXCLUDED."phone",
            "department" = EXCLUDED."department",
            "title" = EXCLUDED."title",
            "status" = EXCLUDED."status",
            "companyId" = EXCLUDED."companyId",
            "updatedAt" = now()
        `,
        [
          gid("emp"),
          e.employeeCode,
          e.fullName,
          email,
          e.phone || null,
          e.department || null,
          e.title || null,
          employeeStatus(e.status),
          companyId,
        ],
      );
      imported += 1;
    }

    await c.query("COMMIT");
    console.log(`Companies: ${data.companies.length}, Employees imported: ${imported}`);
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
