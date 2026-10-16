# Google Cloud deployment

Hạ tầng mục tiêu:

- Web Next.js: Cloud Run service `cong-van-hanh-web`
- Worker kế toán: Cloud Run service `thuanviet-accounting-worker`
- PostgreSQL: Cloud SQL for PostgreSQL
- File: Cloud Storage
- Hàng đợi: Cloud Tasks
- Lịch đồng bộ: Cloud Scheduler
- Bí mật: Secret Manager

## Nguyên tắc môi trường

- `tvg-ops-dev`: development/staging, không chứa dữ liệu production duy nhất.
- Production dùng project riêng và Cloud SQL riêng.
- Không đưa mật khẩu, token MISA hay connection string vào Git/Cloud Build substitutions.
- Web và worker nhận secret bằng Secret Manager và service account riêng.

## Build web

```powershell
gcloud builds submit `
  --project <PROJECT_ID> `
  --region asia-southeast1 `
  --config infra/gcp/cloudbuild.web.yaml
```

Image được đẩy vào Artifact Registry repository `cong-van-hanh`.
Deployment Cloud Run được thực hiện riêng sau khi đã tạo Cloud SQL, secrets và
service account; không nhúng những giá trị đó vào file này.

## Secrets bắt buộc

- `cong-van-hanh-database-url`
- `cong-van-hanh-auth-session-secret`
- `cong-van-hanh-cron-secret`
- `accounting-worker-api-secret`
- `accounting-misa-session` (chỉ tạo khi người quản trị MISA cung cấp)

`APP_URL` là biến môi trường thường, trỏ về domain Cloud Run hoặc domain riêng.
