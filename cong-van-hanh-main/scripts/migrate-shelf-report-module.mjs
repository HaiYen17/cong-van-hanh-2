import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const name = '20260905033000_add_shelf_inventory_reports';
const sql = await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8');
const checksum = createHash('sha256').update(sql).digest('hex');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
await client.connect();
try {
  const existing = await client.query('SELECT checksum,finished_at FROM _prisma_migrations WHERE migration_name=$1 AND rolled_back_at IS NULL', [name]);
  if (existing.rows.length) {
    if (existing.rows.length !== 1 || existing.rows[0].checksum !== checksum || !existing.rows[0].finished_at) throw new Error('Migration báo cáo kệ đã tồn tại nhưng checksum hoặc trạng thái không khớp.');
    console.log('Shelf report migration already applied with matching checksum.');
  } else {
    const preflight = (await client.query(`SELECT
      to_regclass('rfid_shelf_inventory_sessions') IS NOT NULL AS base_exists,
      to_regclass('rfid_shelf_inventory_reports') IS NOT NULL AS report_exists,
      to_regclass('rfid_shelf_inventory_report_sessions') IS NOT NULL AS link_exists`)).rows[0];
    console.log(JSON.stringify({ preflight }));
    if (!preflight.base_exists) throw new Error('Migration kiểm kê kệ nền chưa được áp dụng.');
    if (preflight.report_exists || preflight.link_exists) throw new Error('Bảng báo cáo kệ đã tồn tại nhưng chưa có lịch sử migration; cần kiểm tra thủ công.');
    if (process.argv.includes('--apply')) {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout='15s'; SET LOCAL statement_timeout='120s'");
        await client.query(sql.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, ''));
        if (process.env.SHELF_RUNTIME_DB_ROLE) {
          const role = (await client.query('SELECT quote_ident(rolname) AS name FROM pg_roles WHERE rolname=$1', [process.env.SHELF_RUNTIME_DB_ROLE])).rows[0];
          if (!role) throw new Error('Runtime database role not found.');
          await client.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON rfid_shelf_inventory_reports,rfid_shelf_inventory_report_sessions TO ${role.name}`);
        }
        await client.query(`INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,started_at,applied_steps_count)
          VALUES($1,$2,now(),$3,now(),1)`, [randomUUID(), checksum, name]);
        await client.query('COMMIT');
        console.log('Shelf report migration applied and recorded atomically.');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  }
} finally { await client.end(); }
