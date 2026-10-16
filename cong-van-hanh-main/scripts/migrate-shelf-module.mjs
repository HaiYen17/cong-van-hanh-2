import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const name = '20260905003000_add_shelf_inventory';
const sql = await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8');
const checksum = createHash('sha256').update(sql).digest('hex');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
await client.connect();
try {
  const existing = await client.query('SELECT checksum,finished_at FROM _prisma_migrations WHERE migration_name=$1 AND rolled_back_at IS NULL', [name]);
  if (existing.rows.length) {
    if (existing.rows.length !== 1 || existing.rows[0].checksum !== checksum || !existing.rows[0].finished_at) throw new Error('Migration đã tồn tại nhưng checksum hoặc trạng thái không khớp.');
    console.log('Shelf migration already applied with matching checksum.');
  } else {
    const preflight = (await client.query(`SELECT
      (SELECT count(*)::int FROM "WarehouseRfidTag") AS products,
      (SELECT count(*)::int FROM (SELECT upper(regexp_replace(epc,'\\s','','g')) FROM "WarehouseRfidTag" GROUP BY 1 HAVING count(*)>1) duplicates) AS normalized_collisions,
      to_regclass('rfid_shelves') IS NOT NULL AS shelf_tables_exist`)).rows[0];
    console.log(JSON.stringify({ preflight }));
    if (preflight.normalized_collisions || preflight.shelf_tables_exist) throw new Error('Cần kiểm tra EPC trùng hoặc bảng kệ đã tồn tại trước khi migrate.');
    if (process.argv.includes('--apply')) {
      // Record precisely this additive migration in the same transaction, without applying unrelated pending migrations.
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout='15s'; SET LOCAL statement_timeout='120s'");
        await client.query(sql.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, ''));
        if (process.env.SHELF_RUNTIME_DB_ROLE) {
          const role = (await client.query('SELECT quote_ident(rolname) AS name FROM pg_roles WHERE rolname=$1', [process.env.SHELF_RUNTIME_DB_ROLE])).rows[0];
          if (!role) throw new Error('Runtime database role not found.');
          await client.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON rfid_entity_registry,rfid_shelves,rfid_shelf_operations,rfid_shelf_inventory_sessions,rfid_shelf_inventory_lines TO ${role.name}`);
        }
        await client.query(`INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,started_at,applied_steps_count)
          VALUES($1,$2,now(),$3,now(),1)`, [randomUUID(), checksum, name]);
        await client.query('COMMIT');
        console.log('Shelf migration applied and recorded atomically.');
      } catch(error) { await client.query('ROLLBACK'); throw error; }
    }
  }
} finally { await client.end(); }
