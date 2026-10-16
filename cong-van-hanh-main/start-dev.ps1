# Khởi động môi trường dev "Cổng vận hành": Cloud SQL proxy + Next.js dev server.
$ErrorActionPreference = "Stop"
$proj = $PSScriptRoot
Set-Location $proj

Write-Host "=== Cong van hanh - DEV ===" -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath (Join-Path $proj ".env"))) {
  Write-Host "THIEU .env. Hay chay 'npm run setup:local' truoc." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $proj "node_modules"))) {
  Write-Host "THIEU node_modules. Hay chay 'npm run setup:local' truoc." -ForegroundColor Red
  exit 1
}

# 1) Cloud SQL Auth Proxy (bật nếu chưa chạy)
$proxy = Get-Process -Name "cloud-sql-proxy*" -ErrorAction SilentlyContinue
if (-not $proxy) {
  $proxyCommand = Get-Command "cloud-sql-proxy" -ErrorAction SilentlyContinue
  $proxyCandidates = @(
    $env:CLOUD_SQL_PROXY_PATH,
    $(if ($proxyCommand) { $proxyCommand.Source }),
    "C:\tools\cloud-sql-proxy\cloud-sql-proxy.x86.exe"
  ) | Where-Object { $_ }
  $proxyPath = $proxyCandidates |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1

  if ($proxyPath) {
    Write-Host "Dang bat Cloud SQL proxy tu $proxyPath ..." -ForegroundColor Yellow
    Start-Process $proxyPath `
      -ArgumentList "--address","127.0.0.1","--port","5433","tvg-ops-dev:asia-southeast1:tvg-postgres-dev" `
      -WindowStyle Hidden
    Start-Sleep -Seconds 4
  } else {
    Write-Host "CANH BAO: khong tim thay Cloud SQL Auth Proxy. Xem docs/local-development-setup.md." -ForegroundColor Red
  }
} else {
  Write-Host "Cloud SQL proxy da chay." -ForegroundColor Green
}

# Kiểm tra cổng proxy
if (Test-NetConnection 127.0.0.1 -Port 5433 -InformationLevel Quiet) {
  Write-Host "Proxy OK (127.0.0.1:5433)." -ForegroundColor Green
} else {
  Write-Host "CANH BAO: proxy chua len. Neu loi DB, chay: gcloud auth application-default login" -ForegroundColor Red
}

# 2) Nạp kết nối worker Kế toán từ Google Cloud; không ghi secret xuống file.
if (-not $env:ACCOUNTING_WORKER_URL) {
  $env:ACCOUNTING_WORKER_URL = "https://thuanviet-accounting-worker-fe6q7l75dq-as.a.run.app"
}
if (-not $env:ACCOUNTING_WORKER_SECRET) {
  $gcloudCommand = Get-Command "gcloud" -ErrorAction SilentlyContinue
  if ($gcloudCommand) {
    $workerSecret = gcloud secrets versions access latest `
      --secret "accounting-worker-api-secret" `
      --project "tvg-ops-dev" 2>$null
    if ($LASTEXITCODE -eq 0 -and $workerSecret) {
      $env:ACCOUNTING_WORKER_SECRET = $workerSecret.Trim()
      Write-Host "Worker Ke toan da duoc nap tu Secret Manager." -ForegroundColor Green
    } else {
      Write-Host "CANH BAO: chua doc duoc secret worker Ke toan." -ForegroundColor Red
    }
  } else {
    Write-Host "CANH BAO: chua cai Google Cloud CLI; bo qua secret worker Ke toan." -ForegroundColor Yellow
  }
}
$env:ACCOUNTING_WORKER_USE_ID_TOKEN = "false"
$env:ACCOUNTING_EXPORT_BUCKET = "tvg-ops-dev-cong-van-hanh-files"

# 3) Dev server — nếu đã chạy sẵn thì chỉ mở trình duyệt, tránh bật trùng cổng 3000
if (Test-NetConnection 127.0.0.1 -Port 3000 -InformationLevel Quiet) {
  Write-Host "Dev server da chay san o http://localhost:3000 - dang mo trinh duyet." -ForegroundColor Green
  Start-Process "http://localhost:3000"
  Start-Sleep -Seconds 2
} else {
  Write-Host "Khoi dong Next.js dev server... (mo http://localhost:3000)" -ForegroundColor Cyan
  Start-Process "http://localhost:3000"
  npm run dev
}
