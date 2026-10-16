import "dotenv/config";

import pg from "pg";

const runId = process.argv
  .slice(2)
  .find((value) => value.startsWith("--run-id="))
  ?.slice("--run-id=".length);
if (!runId) throw new Error("Thiếu --run-id=<MigrationRun ID>.");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  const result = await client.query(
    `select
       mr."rowNumber",
       mr."externalId",
       dossier->>'itemIndex' as "itemIndex",
       dossier->>'legacyRegistryId' as "legacyRegistryId",
       existing_request.code as "existingRequestCode",
       existing_dossier.id as "existingDossierId",
       existing_dossier."documentRegistryId"
     from "MigrationRecord" mr
     cross join lateral jsonb_array_elements(
       coalesce(mr."normalizedData"->'legalDossiers', '[]'::jsonb)
     ) dossier
     left join "LegalDossier" existing_dossier
       on existing_dossier."legacyRegistryId" = dossier->>'legacyRegistryId'
     left join "RequestItem" existing_item
       on existing_item.id = existing_dossier."requestItemId"
     left join "Request" existing_request
       on existing_request.id = existing_item."requestId"
     where mr."runId" = $1
       and mr.status = 'FAILED'
     order by mr."rowNumber", (dossier->>'itemIndex')::int`,
    [runId],
  );
  console.table(result.rows);
} finally {
  await client.end();
}
