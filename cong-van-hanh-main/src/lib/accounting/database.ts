import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { ACCOUNTING_SCHEMA } from "@/lib/accounting/constants";
import { requireServerEnv } from "@/lib/env";
import { AccountingRpcError } from "@/lib/accounting/types";

const globalForAccounting = globalThis as unknown as {
  accountingPool?: Pool;
};

export function getAccountingPool() {
  if (!globalForAccounting.accountingPool) {
    globalForAccounting.accountingPool = new Pool({
      allowExitOnIdle: true,
      connectionString: requireServerEnv("DATABASE_URL"),
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      keepAlive: true,
      max: 5,
    });
  }
  return globalForAccounting.accountingPool;
}

export async function assertAccountingSchema(client?: PoolClient) {
  const executor = client ?? getAccountingPool();
  const result = await executor.query<{
    audits: string | null;
    records: string | null;
    versions: string | null;
  }>(
    `SELECT
       to_regclass($1) AS versions,
       to_regclass($2) AS records,
       to_regclass($3) AS audits`,
    [
      `${ACCOUNTING_SCHEMA}.config_versions`,
      `${ACCOUNTING_SCHEMA}.config_records`,
      `${ACCOUNTING_SCHEMA}.audit_events`,
    ],
  );
  const row = result.rows[0];
  if (!row?.versions || !row.records || !row.audits) {
    throw new AccountingRpcError(
      "Kho PostgreSQL chưa có đầy đủ schema accounting_portal. Hãy áp dụng migration trước khi mở module.",
      503,
    );
  }
}

export async function withAccountingTransaction<T>(
  operation: (client: PoolClient) => Promise<T>,
) {
  const client = await getAccountingPool().connect();
  try {
    await client.query("BEGIN");
    await assertAccountingSchema(client);
    const value = await operation(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function resolveActorEmail(userId: string) {
  const result = await getAccountingPool().query<{ email: string }>(
    `SELECT email FROM public."User" WHERE id = $1 LIMIT 1`,
    [userId],
  );
  return result.rows[0]?.email || userId;
}

export function firstRow<T extends QueryResultRow>(rows: T[], message: string) {
  const row = rows[0];
  if (!row) {
    throw new AccountingRpcError(message);
  }
  return row;
}
