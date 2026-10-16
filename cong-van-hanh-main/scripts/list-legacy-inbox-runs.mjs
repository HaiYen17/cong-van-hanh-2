import "dotenv/config";

import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  const result = await client.query(
    `select
       run.id,
       run.mode,
       run.status,
       run.phase,
       run."rowsRead",
       run."rowsCreated",
       run."rowsUpdated",
       run."rowsSkipped",
       run."rowsFailed",
       run.cursor,
       run.summary,
       run."startedAt",
       run."completedAt",
       count(*) filter (where record.status = 'PENDING')::int as pending,
       count(*) filter (where record.status = 'IMPORTED')::int as imported,
       count(*) filter (where record.status = 'SKIPPED')::int as skipped,
       count(*) filter (where record.status = 'FAILED')::int as failed
     from "MigrationRun" run
     join "MigrationSource" source on source.id = run."sourceId"
     left join "MigrationRecord" record on record."runId" = run.id
     where source.key = 'google-sheet-98-inbox'
     group by run.id
     order by run."startedAt" desc
     limit 12`,
  );
  console.table(result.rows);
} finally {
  await client.end();
}
