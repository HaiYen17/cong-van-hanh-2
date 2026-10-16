# Cong van hanh

Hanh chinh v3 baseline for the internal administration workflow app.

> **QUY TẮC SỐ 1 — Bám sát app cũ.** Đây là bản dựng lại app Google Apps Script
> "Hành chính" (`C:\Users\minht\OneDrive\Desktop\Hành chính`, chỉ-đọc). Trước khi
> viết/sửa bất kỳ module nào, PHẢI đọc hết file nguồn bản cũ tương ứng
> (`*Modal.html`, `AppScripts.html`, `.gs`), liệt kê đủ mọi tab/trường/nút/hành vi
> rồi đối chiếu 1-1 với bản v3 (CÓ/THIẾU/KHÁC). Không tự ý đơn giản hoá; placeholder
> chỉ khi user chốt. Chi tiết quy tắc xem `AGENTS.md`.

Read these first in every new thread:

1. `AGENTS.md` (Quy tắc số 1 + ràng buộc Next.js)
2. `CODEX_WORKING_GUIDE.md`
3. `docs/product-blueprint.md`
4. `docs/project-foundation.md`
5. `docs/permissions-foundation.md`

## Local Development

Recommended versions: Node.js `22.16.0` and npm `10.9.2`. Next.js requires at
least Node.js 20.9.

```shell
git clone https://github.com/thuanvietdev/cong-van-hanh.git
cd cong-van-hanh
npm run setup:local
npm run dev:local
```

The app runs at `http://localhost:3000` by default.

The setup and dev commands select the correct Windows or macOS script
automatically. For GitHub access, safe `.env` handoff, Google Cloud IAM, Cloud
SQL Auth Proxy, and the full new-machine checklist, read
[`docs/local-development-setup.md`](docs/local-development-setup.md).

## Verification

```bash
npm run lint
npm run build
```

`npm run build` runs `prisma generate` first, because the generated Prisma
client is ignored by Git.

## Environment

`.env` is ignored by Git. Use `.env.example` as the safe template.

Required local values:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Dev Postgres connection string |
| `AUTH_SESSION_SECRET` | Secret for future internal auth/session signing |
| `APP_URL` | Local or deployed app URL |

## Database

Prisma is configured for Postgres. Local development uses Cloud SQL Auth Proxy:

```powershell
C:\tools\cloud-sql-proxy\cloud-sql-proxy.x86.exe --address 127.0.0.1 --port 5433 tvg-ops-dev:asia-southeast1:tvg-postgres-dev
```

Then use:

```bash
npm run db:generate
npm run db:migrate
npm run db:studio
```

Do not run migrations against production until a dev/staging database and backup
process are confirmed.
