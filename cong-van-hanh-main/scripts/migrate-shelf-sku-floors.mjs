import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const name = '20260908103000_add_shelf_sku_floors';
const sql = await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8');
const checksum = createHash('sha256').update(sql).digest('hex');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
await client.connect();
try {
  const existing = await client.query(
    'SELECT checksum,finished_at FROM _prisma_migrations WHERE migration_name=$1 AND rolled_back_at IS NULL', [name],
  );
  if (existing.rows.length) {
    if (existing.rows.length !== 1 || existing.rows[0].checksum !== checksum || !existing.rows[0].finished_at) {
      throw new Error('Migration tầng mặc định SKU đã tồn tại nhưng checksum hoặc trạng thái không khớp.');
    }
    console.log('Shelf SKU floor migration already applied with matching checksum.');
  } else {
    const preflight = (await client.query(`SELECT
      to_regclass('rfid_shelf_sku_configurations') IS NOT NULL AS config_exists,
      EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_name='rfid_shelf_sku_configurations' AND column_name='sku_floors') AS floor_column_exists`)).rows[0];
    console.log(JSON.stringify({ preflight }));
    if (!preflight.config_exists) throw new Error('Migration cấu hình nhóm SKU nền chưa được áp dụng.');
    if (preflight.floor_column_exists) throw new Error('Cột tầng SKU đã tồn tại nhưng chưa có lịch sử migration.');
    if (process.argv.includes('--apply')) {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout='15s'; SET LOCAL statement_timeout='120s'");
        await client.query(sql);
        await client.query(`INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,started_at,applied_steps_count)
          VALUES($1,$2,now(),$3,now(),1)`, [randomUUID(), checksum, name]);
        await client.query('COMMIT');
        console.log('Shelf SKU floor migration applied and recorded atomically.');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  }
} finally {
  await client.end();
}
