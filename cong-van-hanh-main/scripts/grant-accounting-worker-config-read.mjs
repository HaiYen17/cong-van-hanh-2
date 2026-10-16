import pg from "pg";

const APPLY = process.argv.includes("--apply");
const configDatabaseUrl = process.env.CONFIG_DATABASE_URL || process.env.DATABASE_URL;
const workerDatabaseUrl = process.env.WORKER_DATABASE_URL || process.env.ACCOUNTING_DATABASE_URL;
if (!configDatabaseUrl || !workerDatabaseUrl) {
  throw new Error("Thiếu CONFIG_DATABASE_URL/DATABASE_URL hoặc WORKER_DATABASE_URL/ACCOUNTING_DATABASE_URL.");
}

const roleMatch = workerDatabaseUrl.match(/^postgres(?:ql)?:\/\/([^:]+):/i);
if (!roleMatch || !/^[-_a-zA-Z0-9]+$/.test(roleMatch[1])) {
  throw new Error("Không xác định được PostgreSQL role của accounting worker.");
}
const quotedRole = `"${roleMatch[1].replaceAll('"', '""')}"`;

const connectionUrl = new URL(configDatabaseUrl);
if (process.env.DB_PROXY_HOST) {
  connectionUrl.hostname = process.env.DB_PROXY_HOST;
  connectionUrl.port = process.env.DB_PROXY_PORT || "5432";
  for (const key of ["schema", "connection_limit", "pool_timeout", "pgbouncer", "host", "sslmode"]) {
    connectionUrl.searchParams.delete(key);
  }
  connectionUrl.searchParams.set("sslmode", "disable");
}

const client = new pg.Client({ connectionString: connectionUrl.toString() });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`GRANT USAGE ON SCHEMA accounting_portal TO ${quotedRole}`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA accounting_portal TO ${quotedRole}`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA accounting_portal GRANT SELECT ON TABLES TO ${quotedRole}`);
  if (APPLY) await client.query("COMMIT");
  else await client.query("ROLLBACK");
  console.log(JSON.stringify({ ok: true, apply: APPLY, schema: "accounting_portal", permission: "USAGE+SELECT" }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
