// Use the deployed service's secret versions in memory; never write them to source or logs.
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';

const sdkPython = process.env.CLOUDSDK_PYTHON || join(process.env.LOCALAPPDATA, 'Programs/Python/Python312/python.exe');
const sdk = join(process.env.LOCALAPPDATA, 'Google/Cloud SDK/google-cloud-sdk/lib/gcloud.py');
const secret = name => {
  // Base64 transport preserves the exact secret bytes across Windows newline conversion.
  const encoded = execFileSync(sdkPython, [sdk, 'secrets', 'versions', 'access', 'latest', `--secret=${name}`, '--project=tvg-ops-dev', '--format=get(payload.data)'], { encoding:'utf8', stdio:['ignore','pipe','pipe'] });
  return Buffer.from(encoded.trim(), 'base64url').toString('utf8');
};
const database = new URL(secret('cong-van-hanh-database-url'));
if (database.searchParams.get('host') !== '/cloudsql/tvg-ops-dev:asia-southeast1:tvg-postgres-dev') throw new Error('Unexpected database instance; stop before connecting.');
database.hostname = '127.0.0.1'; database.port = '5433'; database.searchParams.delete('host');
const env = { ...process.env, DATABASE_URL:database.toString(),
  AUTH_SESSION_SECRET:secret('cong-van-hanh-auth-session-secret'),
  CONFIG_SECRET_ENCRYPTION_KEY:secret('config-secret-encryption-key') };
const args = process.argv.slice(2);
if (args[0] === '--owner-migration') {
  args.shift();
  if (!['scripts/migrate-shelf-module.mjs', 'scripts/migrate-shelf-report-module.mjs', 'scripts/migrate-shelf-vehicle-module.mjs', 'scripts/migrate-shelf-sku-config.mjs', 'scripts/migrate-shelf-sku-floors.mjs'].includes(args[0])) throw new Error('Owner connection is reserved for an approved shelf migration.');
  const ownerUrl = parse(readFileSync('.env')).DATABASE_URL;
  const owner = new URL(ownerUrl);
  if (owner.hostname !== database.hostname || owner.port !== database.port || owner.pathname !== database.pathname) throw new Error('Migration owner connection targets another database.');
  env.DATABASE_URL = ownerUrl;
  env.SHELF_RUNTIME_DB_ROLE = decodeURIComponent(database.username);
}
const result = spawnSync(process.execPath, ['--conditions=react-server','--import','tsx', ...args], { env, stdio:'inherit' });
process.exitCode = result.status ?? 1;
