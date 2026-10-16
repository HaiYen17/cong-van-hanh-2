# Project Foundation - Cong van hanh

This file records the baseline created in Step 1 so later threads do not have
to rediscover the same decisions.

## Stack

| Area | Choice |
|---|---|
| App | Next.js App Router + TypeScript |
| Styling | Tailwind CSS v4 tokens in `src/app/globals.css` |
| Font | Be Vietnam Pro via `next/font/google` in root layout |
| ORM | Prisma 7 with Postgres |
| Auth direction | Internal username/password, session table, role/permission model |
| Shared UI | `src/components/ui` and `src/components/layout` |
| Dev database | Cloud SQL `tvg-postgres-dev`, database `cong_van_hanh_dev` |
| Local DB access | Cloud SQL Auth Proxy on `127.0.0.1:5433` |

## Current Structure

| Path | Purpose |
|---|---|
| `src/app` | App Router pages, root layout, global styles |
| `src/app/cau-hinh` | Step 3 configuration screens for companies, employees, accounts, and role/permission overview |
| `src/app/thuc-thi` | Separate execution area placeholder for daily workflows |
| `src/components/ui` | Shared primitives such as button, badge, panel |
| `src/components/layout` | Shared app shell/navigation layout |
| `src/lib/db.ts` | Lazy Prisma client getter |
| `src/lib/auth` | Password hashing, session shape, role/permission constants |
| `prisma/schema.prisma` | Core database schema for users, employees, companies, roles, permissions, sessions, audit log |
| `docs/permissions-foundation.md` | Permission model inherited from the old Hanh chinh app |
| `.env.example` | Safe env template |

## Manual Work Completed In Step 1

1. Created Cloud SQL dev database `cong_van_hanh_dev`.
2. Created users `cvh_migration_user` and `cvh_app_user`.
3. Granted database/schema access needed for the next migration step.
4. Logged in Google ADC and set quota project `tvg-ops-dev`.
5. Configured local `.env` to connect through Cloud SQL Auth Proxy.
6. Created and pushed the private GitHub repository.
7. Recorded initial permission rules in `docs/permissions-foundation.md`.

## Completed In Step 2

1. Created the first Prisma migration for auth/core foundation.
2. Seeded module groups, modules, permissions, core roles, and the first Super Admin.
3. Added internal username/password login, session cookie, logout, and route protection.
4. Confirmed Super Admin can sign in against the Cloud SQL dev database.

## Completed In Step 3

1. Added `/cau-hinh` as the configuration area for core data.
2. Added company and employee create/list/status management.
3. Added user account create/list/status management, with soft archive/inactive behavior.
4. Added read-only role and permission overview.
5. Added `/thuc-thi` as the separate execution area placeholder.
6. Added shared UI primitives for link buttons, selects, and tables.
7. Seeded the `accounts` module plus `users.read` and `users.manage` permissions.

## Cloud SQL Proxy

Start this before running Prisma commands that need the dev database:

```powershell
C:\tools\cloud-sql-proxy\cloud-sql-proxy.x86.exe --address 127.0.0.1 --port 5433 tvg-ops-dev:asia-southeast1:tvg-postgres-dev
```

Local `DATABASE_URL` should point to:

```text
127.0.0.1:5433/cong_van_hanh_dev
```

Do not commit `.env`.

## Next Technical Step

Start the first Hanh chinh execution module as a vertical slice:
request form -> admin processing -> approval if needed -> history/audit.
Keep configuration data in `/cau-hinh` and daily work in `/thuc-thi`.
