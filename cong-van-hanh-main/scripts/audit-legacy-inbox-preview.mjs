import "dotenv/config";

import pg from "pg";

const runId = process.argv
  .slice(2)
  .find((value) => value.startsWith("--run-id="))
  ?.slice("--run-id=".length);

if (!runId) {
  throw new Error("Thiếu --run-id=<MigrationRun ID>.");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  const grouped = await client.query(
    `select severity, code, count(*)::int as count
       from "MigrationIssue"
      where "runId" = $1
      group by severity, code
      order by count(*) desc, code asc`,
    [runId],
  );
  const samples = await client.query(
    `select "rowNumber", "externalId", code, field, message
       from "MigrationIssue"
      where "runId" = $1 and severity = 'ERROR'
      order by "rowNumber"
      limit 40`,
    [runId],
  );
  const creators = await client.query(
    `select
       mr."normalizedData"->>'creatorEmployeeCode' as "employeeCode",
       max(mr."normalizedData"->>'creatorName') as "creatorName",
       count(*)::int as "requestCount",
       bool_or(e.id is not null) as "employeeExists",
       bool_or(u.id is not null) as "userExists"
     from "MigrationRecord" mr
     left join "Employee" e
       on e."employeeCode" = mr."normalizedData"->>'creatorEmployeeCode'
     left join "User" u on u."employeeId" = e.id
     where mr."runId" = $1
     group by mr."normalizedData"->>'creatorEmployeeCode'
     order by "userExists" asc, "requestCount" desc, "employeeCode" asc`,
    [runId],
  );
  const overlap = await client.query(
    `select
       count(*)::int as "sourceRows",
       count(r.id)::int as "existingRequestCodes",
       count(eim.id)::int as "alreadyMappedRequests"
     from "MigrationRecord" mr
     left join "Request" r
       on r.code = mr."normalizedData"->>'requestCode'
     left join "MigrationRun" run on run.id = mr."runId"
     left join "ExternalIdMap" eim
       on eim."sourceId" = run."sourceId"
      and eim."entityType" = 'Request'
      and eim."externalId" = mr."externalId"
     where mr."runId" = $1`,
    [runId],
  );
  console.table(grouped.rows);
  console.table(samples.rows);
  console.table(creators.rows);
  console.table(overlap.rows);
} finally {
  await client.end();
}
