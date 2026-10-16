import 'dotenv/config';
import assert from 'node:assert/strict';
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
await client.connect();
try {
  const row = (await client.query(`SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE barcode IS NOT NULL AND barcode <> '')::int AS with_barcode,
    count(DISTINCT upper(barcode))::int AS unique_barcodes,
    count(*) FILTER (WHERE epc IS NULL)::int AS barcode_only,
    to_regclass('rfid_shelf_barcode_seq') IS NOT NULL AS sequence_exists
    FROM rfid_shelves`)).rows[0];
  assert.equal(row.with_barcode, row.total, 'Có Kệ/Xe chưa được backfill Barcode.');
  assert.equal(row.unique_barcodes, row.total, 'Barcode Kệ/Xe bị trùng.');
  assert.equal(row.sequence_exists, true, 'Thiếu sequence sinh Barcode Kệ/Xe.');
  console.log(JSON.stringify(row));
} finally {
  await client.end();
}
