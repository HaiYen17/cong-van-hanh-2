import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import pg from "pg";

const { Pool } = pg;

const sourceFile = new URL("./permission-seed.json", import.meta.url);
const source = JSON.parse(await readFile(sourceFile, "utf8"));
const checksum = createHash("sha256")
  .update(JSON.stringify(source))
  .digest("hex");

const SOURCE_KEY = "google-sheet-permissions-v1";
const SOURCE_NAME = "Google Sheets - Cấu hình quyền và phân quyền hệ thống";
const now = () => new Date();
const id = (prefix) => `${prefix}_${randomUUID()}`;

const groupKeyMap = new Map([
  ["admin-management", "admin-config"],
  ["admin-execution", "admin-execution"],
  ["admin-config", "admin-config"],
  ["nguoi-thuan-viet-orders", "employee-default"],
  ["nguoi-thuan-viet-legal", "legal"],
  ["nguoi-thuan-viet-asset", "asset-repair"],
  ["nguoi-thuan-viet-admin", "hanh-chinh-nv"],
  ["nguoi-thuan-viet-utilities", "tien-ich"],
]);

const moduleKeyMap = new Map([
  ["my-orders", "my-requests"],
  ["cat-chat", null],
]);

function mappedModuleKey(key) {
  return moduleKeyMap.has(key) ? moduleKeyMap.get(key) : key;
}

function shouldGrantSpecializedPermission(action, grantedActions) {
  if (action === "read" || action === "view") {
    return grantedActions.includes("view");
  }
  if (action === "archive" || action === "delete") {
    return grantedActions.includes("delete");
  }
  if (action === "manage") {
    return (
      grantedActions.includes("edit") || grantedActions.includes("delete")
    );
  }
  return grantedActions.includes("edit");
}

async function upsertSource(client) {
  const result = await client.query(
    `
      INSERT INTO "MigrationSource" (
        "id", "key", "name", "kind", "status", "config", "updatedAt"
      )
      VALUES ($1, $2, $3, 'GOOGLE_SHEET', 'ACTIVE', $4::jsonb, $5)
      ON CONFLICT ("key") DO UPDATE SET
        "name" = EXCLUDED."name",
        "status" = 'ACTIVE',
        "config" = EXCLUDED."config",
        "updatedAt" = EXCLUDED."updatedAt",
        "archivedAt" = NULL
      RETURNING "id"
    `,
    [
      id("migration-source"),
      SOURCE_KEY,
      SOURCE_NAME,
      JSON.stringify(source.source),
      now(),
    ],
  );
  return result.rows[0].id;
}

async function createRun(client, sourceId) {
  const runId = id("migration-run");
  await client.query(
    `
      INSERT INTO "MigrationRun" (
        "id", "sourceId", "mode", "status", "phase", "checksum",
        "sourceConfigSnapshot", "metadata", "startedAt"
      )
      VALUES (
        $1, $2, 'BACKFILL', 'RUNNING', 'PERMISSIONS', $3,
        $4::jsonb, $5::jsonb, $6
      )
    `,
    [
      runId,
      sourceId,
      checksum,
      JSON.stringify(source.source),
      JSON.stringify({
        legacyPasswordHashesCopied: false,
        sourceRoles: source.roles.length,
        sourceAssignments: source.assignments.length,
      }),
      now(),
    ],
  );
  return runId;
}

async function addIssue(
  client,
  runId,
  {
    code,
    externalId,
    field,
    message,
    rawData,
    rowNumber,
    severity = "WARNING",
  },
) {
  await client.query(
    `
      INSERT INTO "MigrationIssue" (
        "id", "runId", "severity", "rowNumber", "externalId",
        "field", "code", "message", "rawData"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    `,
    [
      id("migration-issue"),
      runId,
      severity,
      rowNumber ?? null,
      externalId ?? null,
      field ?? null,
      code,
      message,
      JSON.stringify(rawData ?? {}),
    ],
  );
}

async function addRecord(
  client,
  runId,
  {
    entityType,
    externalId,
    fingerprint,
    internalId,
    issueCount,
    normalizedData,
    rawData,
    rowNumber,
  },
) {
  await client.query(
    `
      INSERT INTO "MigrationRecord" (
        "id", "runId", "rowNumber", "entityType", "externalId",
        "internalId", "fingerprint", "status", "rawData",
        "normalizedData", "issueCount", "processedAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, 'IMPORTED',
        $8::jsonb, $9::jsonb, $10, $11, $11
      )
    `,
    [
      id("migration-record"),
      runId,
      rowNumber,
      entityType,
      externalId,
      internalId,
      fingerprint,
      JSON.stringify(rawData),
      JSON.stringify(normalizedData),
      issueCount,
      now(),
    ],
  );
}

async function upsertExternalId(
  client,
  sourceId,
  entityType,
  externalId,
  internalId,
  fingerprint,
) {
  await client.query(
    `
      INSERT INTO "ExternalIdMap" (
        "id", "sourceId", "entityType", "externalId", "internalId",
        "fingerprint", "metadata", "lastSeenAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, $7, $7)
      ON CONFLICT ("sourceId", "entityType", "externalId") DO UPDATE SET
        "internalId" = EXCLUDED."internalId",
        "fingerprint" = EXCLUDED."fingerprint",
        "lastSeenAt" = EXCLUDED."lastSeenAt",
        "updatedAt" = EXCLUDED."updatedAt"
    `,
    [
      id("external-id"),
      sourceId,
      entityType,
      externalId,
      internalId,
      fingerprint,
      now(),
    ],
  );
}

async function importRole(client, runId, sourceId, roleSource, catalog) {
  const roleResult = await client.query(
    `
      INSERT INTO "Role" (
        "id", "key", "name", "description", "rank", "status",
        "isSystem", "isCore", "includeDefaultEmployeeAccess", "updatedAt"
      )
      VALUES (
        $1, $2, $3, $4, $5, $6::"RoleStatus",
        FALSE, $7, $8, $9
      )
      ON CONFLICT ("key") DO UPDATE SET
        "name" = EXCLUDED."name",
        "description" = EXCLUDED."description",
        "rank" = EXCLUDED."rank",
        "status" = EXCLUDED."status",
        "isCore" = "Role"."isCore" OR EXCLUDED."isCore",
        "includeDefaultEmployeeAccess" = EXCLUDED."includeDefaultEmployeeAccess",
        "updatedAt" = EXCLUDED."updatedAt",
        "archivedAt" = NULL
      RETURNING "id", "key"
    `,
    [
      id("role"),
      roleSource.key,
      roleSource.name,
      roleSource.description || null,
      roleSource.rank,
      roleSource.isActive ? "ACTIVE" : "INACTIVE",
      roleSource.isCore,
      roleSource.includeDefaultEmployeeAccess,
      now(),
    ],
  );
  const role = roleResult.rows[0];
  let issueCount = 0;

  // Quyền lõi Admin đã được seed đầy đủ và được hệ thống cũ tự mở rộng.
  // Chỉ nhập metadata của dòng này, không thu hẹp phạm vi đã có trong PostgreSQL.
  if (roleSource.key !== "admin") {
    const selectedGroupKeys = new Set();
    for (const oldKey of roleSource.groupKeys) {
      const mappedKey = groupKeyMap.get(oldKey);
      if (mappedKey && catalog.groups.has(mappedKey)) {
        selectedGroupKeys.add(mappedKey);
      }
    }
    if (roleSource.includeDefaultEmployeeAccess) {
      for (const group of catalog.groups.values()) {
        if (group.collectionKey === "nguoi-thuan-viet") {
          selectedGroupKeys.add(group.key);
        }
      }
    }

    const explicitModuleKeys = new Set();
    for (const oldKey of roleSource.moduleKeys) {
      const mappedKey = mappedModuleKey(oldKey);
      if (mappedKey && catalog.modules.has(mappedKey)) {
        explicitModuleKeys.add(mappedKey);
      } else {
        issueCount += 1;
        await addIssue(client, runId, {
          code: "MODULE_NOT_IN_NEW_CATALOG",
          externalId: roleSource.key,
          field: oldKey,
          message: `Module cũ "${oldKey}" chưa có module tương ứng trong cổng mới.`,
          rawData: { oldModuleKey: oldKey },
          rowNumber: roleSource.rowNumber,
        });
      }
    }

    const configuredActionMap = {};
    for (const [oldKey, actions] of Object.entries(
      roleSource.moduleActionMap,
    )) {
      const mappedKey = mappedModuleKey(oldKey);
      if (mappedKey && catalog.modules.has(mappedKey)) {
        configuredActionMap[mappedKey] = [
          ...new Set(
            actions.filter((action) =>
              ["view", "edit", "delete"].includes(action),
            ),
          ),
        ];
        if (
          configuredActionMap[mappedKey].includes("edit") ||
          configuredActionMap[mappedKey].includes("delete")
        ) {
          configuredActionMap[mappedKey] = [
            ...new Set(["view", ...configuredActionMap[mappedKey]]),
          ];
        }
      }
    }

    const accessibleModuleKeys = new Set(explicitModuleKeys);
    for (const groupKey of selectedGroupKeys) {
      for (const moduleKey of catalog.groups.get(groupKey).moduleKeys) {
        accessibleModuleKeys.add(moduleKey);
      }
    }
    const effectiveActionMap = {};
    for (const moduleKey of accessibleModuleKeys) {
      effectiveActionMap[moduleKey] =
        configuredActionMap[moduleKey] ?? ["view"];
    }

    const permissionIds = new Set();
    for (const [moduleKey, actions] of Object.entries(configuredActionMap)) {
      const appModule = catalog.modules.get(moduleKey);
      for (const action of actions) {
        const permissionResult = await client.query(
          `
            INSERT INTO "Permission" (
              "id", "key", "module", "action", "description", "appModuleId"
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT ("key") DO UPDATE SET
              "appModuleId" = EXCLUDED."appModuleId",
              "description" = EXCLUDED."description"
            RETURNING "id"
          `,
          [
            id("permission"),
            `portal.${moduleKey}.${action}`,
            `portal.${moduleKey}`,
            action,
            `${action} module ${appModule.label}.`,
            appModule.id,
          ],
        );
        permissionIds.add(permissionResult.rows[0].id);
      }
    }

    for (const [moduleKey, actions] of Object.entries(effectiveActionMap)) {
      const appModule = catalog.modules.get(moduleKey);
      for (const permission of appModule.permissions) {
        if (
          !permission.key.startsWith("portal.") &&
          shouldGrantSpecializedPermission(permission.action, actions)
        ) {
          permissionIds.add(permission.id);
        }
      }
    }

    await client.query('DELETE FROM "RolePermission" WHERE "roleId" = $1', [
      role.id,
    ]);
    await client.query('DELETE FROM "RoleModuleGroup" WHERE "roleId" = $1', [
      role.id,
    ]);
    await client.query('DELETE FROM "RoleAppModule" WHERE "roleId" = $1', [
      role.id,
    ]);

    for (const permissionId of permissionIds) {
      await client.query(
        `
          INSERT INTO "RolePermission" ("roleId", "permissionId")
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [role.id, permissionId],
      );
    }
    for (const groupKey of selectedGroupKeys) {
      await client.query(
        `
          INSERT INTO "RoleModuleGroup" ("roleId", "moduleGroupId")
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [role.id, catalog.groups.get(groupKey).id],
      );
    }
    for (const moduleKey of explicitModuleKeys) {
      await client.query(
        `
          INSERT INTO "RoleAppModule" ("roleId", "appModuleId")
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [role.id, catalog.modules.get(moduleKey).id],
      );
    }
  }

  const normalizedData = {
    description: roleSource.description,
    includeDefaultEmployeeAccess: roleSource.includeDefaultEmployeeAccess,
    key: roleSource.key,
    name: roleSource.name,
    rank: roleSource.rank,
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(normalizedData))
    .digest("hex");
  await addRecord(client, runId, {
    entityType: "Role",
    externalId: roleSource.key,
    fingerprint,
    internalId: role.id,
    issueCount,
    normalizedData,
    rawData: roleSource,
    rowNumber: roleSource.rowNumber,
  });
  await upsertExternalId(
    client,
    sourceId,
    "Role",
    roleSource.key,
    role.id,
    fingerprint,
  );
  return { issueCount, roleId: role.id };
}

async function importAssignment(
  client,
  runId,
  sourceId,
  assignment,
) {
  const employeeResult = await client.query(
    `
      SELECT "id", "employeeCode", "fullName", "email"
      FROM "Employee"
      WHERE "employeeCode" = $1
      LIMIT 1
    `,
    [assignment.employeeCode],
  );
  const roleResult = await client.query(
    `
      SELECT "id", "key", "name"
      FROM "Role"
      WHERE "key" = $1 AND "status" = 'ACTIVE'
      LIMIT 1
    `,
    [assignment.roleKey],
  );
  if (!employeeResult.rowCount) {
    throw new Error(`Không tìm thấy nhân sự ${assignment.employeeCode}.`);
  }
  if (!roleResult.rowCount) {
    throw new Error(`Không tìm thấy quyền ${assignment.roleKey}.`);
  }

  const employee = employeeResult.rows[0];
  const role = roleResult.rows[0];
  const username = assignment.employeeCode.trim().toLowerCase();
  let userResult = await client.query(
    `
      SELECT "id", "passwordHash", "activationStatus"
      FROM "User"
      WHERE "employeeId" = $1
      LIMIT 1
    `,
    [employee.id],
  );

  if (!userResult.rowCount) {
    userResult = await client.query(
      `
        SELECT "id", "passwordHash", "employeeId", "activationStatus"
        FROM "User"
        WHERE "username" = $1 OR "email" = $2
        LIMIT 1
      `,
      [username, `${username}@cong-van-hanh.local`],
    );
  }

  let userId;
  let passwordHash = "";
  if (userResult.rowCount) {
    const existing = userResult.rows[0];
    if (existing.employeeId && existing.employeeId !== employee.id) {
      throw new Error(
        `Tài khoản ${username} đã gắn với một nhân sự khác.`,
      );
    }
    userId = existing.id;
    passwordHash = existing.passwordHash || "";
    const requiresPassword = passwordHash
      ? assignment.requiresPassword
      : true;
    const activationStatus = passwordHash ? "APPROVED" : "NOT_REQUESTED";
    await client.query(
      `
        UPDATE "User"
        SET
          "displayName" = $1,
          "employeeId" = $2,
          "requiresPassword" = $3,
          "activationStatus" = $4::"UserActivationStatus",
          "status" = 'ACTIVE',
          "archivedAt" = NULL,
          "updatedAt" = $5
        WHERE "id" = $6
      `,
      [
        employee.fullName,
        employee.id,
        requiresPassword,
        activationStatus,
        now(),
        userId,
      ],
    );
  } else {
    userId = id("user");
    await client.query(
      `
        INSERT INTO "User" (
          "id", "email", "username", "passwordHash", "displayName",
          "requiresPassword", "activationStatus", "status", "employeeId", "updatedAt"
        )
        VALUES (
          $1, $2, $3, '', $4, TRUE,
          'NOT_REQUESTED'::"UserActivationStatus", 'ACTIVE', $5, $6
        )
      `,
      [
        userId,
        `${username}@cong-van-hanh.local`,
        username,
        employee.fullName,
        employee.id,
        now(),
      ],
    );
  }

  await client.query('DELETE FROM "UserRole" WHERE "userId" = $1', [userId]);
  await client.query(
    `
      INSERT INTO "UserRole" ("userId", "roleId", "assignedById")
      VALUES ($1, $2, NULL)
      ON CONFLICT DO NOTHING
    `,
    [userId, role.id],
  );

  let issueCount = 0;
  if (assignment.requiresPassword && !passwordHash) {
    issueCount = 1;
    await addIssue(client, runId, {
      code: "PASSWORD_RESET_REQUIRED",
      externalId: assignment.employeeCode,
      field: "password",
      message:
        "Hash mật khẩu GAS không tương thích bcrypt; Super Admin cần tạo mật khẩu mới trên cổng mới.",
      rawData: {
        legacyPasswordPresent: assignment.legacyPasswordPresent,
        legacyPasswordValueCopied: false,
      },
      rowNumber: 10_000 + assignment.rowNumber,
    });
  }

  const normalizedData = {
    employeeCode: assignment.employeeCode,
    requiresPassword: assignment.requiresPassword,
    roleKey: assignment.roleKey,
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(normalizedData))
    .digest("hex");
  await addRecord(client, runId, {
    entityType: "UserRole",
    externalId: assignment.employeeCode,
    fingerprint,
    internalId: userId,
    issueCount,
    normalizedData,
    rawData: {
      ...assignment,
      legacyPasswordValueCopied: false,
    },
    rowNumber: 10_000 + assignment.rowNumber,
  });
  await upsertExternalId(
    client,
    sourceId,
    "UserRole",
    assignment.employeeCode,
    userId,
    fingerprint,
  );
  return { issueCount, userId };
}

async function loadCatalog(client) {
  const groupResult = await client.query(
    `
      SELECT "id", "key", "collectionKey"
      FROM "ModuleGroup"
      WHERE "isActive" = TRUE
    `,
  );
  const moduleResult = await client.query(
    `
      SELECT "id", "key", "label", "groupId"
      FROM "AppModule"
      WHERE "isActive" = TRUE
    `,
  );
  const permissionResult = await client.query(
    `
      SELECT "id", "key", "action", "appModuleId"
      FROM "Permission"
      WHERE "appModuleId" IS NOT NULL
    `,
  );

  const groups = new Map(
    groupResult.rows.map((group) => [
      group.key,
      { ...group, moduleKeys: [] },
    ]),
  );
  const modules = new Map(
    moduleResult.rows.map((appModule) => [
      appModule.key,
      { ...appModule, permissions: [] },
    ]),
  );
  for (const appModule of modules.values()) {
    const group = [...groups.values()].find(
      ({ id: groupId }) => groupId === appModule.groupId,
    );
    group?.moduleKeys.push(appModule.key);
  }
  for (const permission of permissionResult.rows) {
    const appModule = [...modules.values()].find(
      ({ id: appModuleId }) => appModuleId === permission.appModuleId,
    );
    appModule?.permissions.push(permission);
  }
  return { groups, modules };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const sourceId = await upsertSource(client);
    const runId = await createRun(client, sourceId);
    const catalog = await loadCatalog(client);
    let rowsCreated = 0;
    let totalIssues = 0;

    for (const role of source.roles) {
      const result = await importRole(
        client,
        runId,
        sourceId,
        role,
        catalog,
      );
      rowsCreated += 1;
      totalIssues += result.issueCount;
    }
    for (const assignment of source.assignments) {
      const result = await importAssignment(
        client,
        runId,
        sourceId,
        assignment,
      );
      rowsCreated += 1;
      totalIssues += result.issueCount;
    }

    const status = totalIssues ? "PARTIAL" : "COMPLETED";
    const completedAt = now();
    await client.query(
      `
        UPDATE "MigrationRun"
        SET
          "status" = $1,
          "phase" = 'COMPLETED',
          "rowsRead" = $2,
          "rowsValid" = $2,
          "rowsCreated" = $3,
          "rowsFailed" = 0,
          "summary" = $4,
          "completedAt" = $5
        WHERE "id" = $6
      `,
      [
        status,
        source.roles.length + source.assignments.length,
        rowsCreated,
        `Đã nhập ${source.roles.length} vai trò và ${source.assignments.length} phân quyền; ${totalIssues} việc cần rà soát.`,
        completedAt,
        runId,
      ],
    );
    await client.query(
      `
        UPDATE "MigrationSource"
        SET "lastRunAt" = $1, "updatedAt" = $1
        WHERE "id" = $2
      `,
      [completedAt, sourceId],
    );
    await client.query(
      `
        INSERT INTO "AuditLog" (
          "id", "action", "targetType", "targetId", "summary", "metadata"
        )
        VALUES (
          $1, 'SYNC', 'MigrationRun', $2, $3, $4::jsonb
        )
      `,
      [
        id("audit"),
        runId,
        "Nhập cấu hình quyền và phân quyền hệ thống từ Google Sheets.",
        JSON.stringify({
          checksum,
          legacyPasswordHashesCopied: false,
          issues: totalIssues,
          rowsCreated,
          status,
        }),
      ],
    );

    await client.query("COMMIT");
    console.log(
      JSON.stringify({
        checksum,
        issues: totalIssues,
        legacyPasswordHashesCopied: false,
        rowsCreated,
        rowsRead: source.roles.length + source.assignments.length,
        runId,
        status,
      }),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
