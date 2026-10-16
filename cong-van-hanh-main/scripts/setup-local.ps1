[CmdletBinding()]
param(
  [switch]$SkipInstall,
  [switch]$SkipChecks
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Assert-Command {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$InstallHint
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Khong tim thay '$Name'. $InstallHint"
  }
}

function Invoke-NativeStep {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )

  Write-Host "`n=== $Label ===" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Label that bai voi exit code $LASTEXITCODE."
  }
}

function Get-DotEnvValue {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyString()][string[]]$Lines,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $escapedName = [regex]::Escape($Name)
  $line = $Lines |
    Where-Object { $_ -match "^\s*$escapedName\s*=" } |
    Select-Object -Last 1

  if (-not $line) {
    return $null
  }

  $value = ($line -split "=", 2)[1].Trim()
  return $value.Trim('"').Trim("'")
}

Write-Host "=== Cong van hanh - local setup ===" -ForegroundColor Cyan
Write-Host "Project: $projectRoot"

Assert-Command -Name "git" -InstallHint "Cai Git for Windows roi mo lai PowerShell."
Assert-Command -Name "node" -InstallHint "Cai Node.js 22.16.0 (khuyen nghi) hoac Node.js >= 20.9."
Assert-Command -Name "npm" -InstallHint "npm duoc cai kem Node.js."

$nodeVersionText = (& node --version).Trim().TrimStart("v")
$nodeVersion = [version]$nodeVersionText
$minimumNodeVersion = [version]"20.9.0"
$recommendedNodeVersion = [version]"22.16.0"

if ($nodeVersion -lt $minimumNodeVersion) {
  throw "Node.js $nodeVersionText qua cu. Next.js trong project yeu cau toi thieu Node.js 20.9."
}

if ($nodeVersion -ne $recommendedNodeVersion) {
  Write-Host "CANH BAO: dang dung Node.js $nodeVersionText; snapshot nay duoc xac minh voi Node.js $recommendedNodeVersion." -ForegroundColor Yellow
} else {
  Write-Host "Node.js ${nodeVersionText}: OK" -ForegroundColor Green
}

$npmVersionText = (& npm --version).Trim()
Write-Host "npm $npmVersionText"

$envPath = Join-Path $projectRoot ".env"
$envExamplePath = Join-Path $projectRoot ".env.example"
if (-not (Test-Path -LiteralPath $envPath)) {
  Copy-Item -LiteralPath $envExamplePath -Destination $envPath
  Write-Host "Da tao .env tu .env.example. Can dien gia tri dev that truoc khi ket noi database." -ForegroundColor Yellow
} else {
  Write-Host ".env da ton tai; script giu nguyen, khong ghi de." -ForegroundColor Green
}

if (-not $SkipInstall) {
  Invoke-NativeStep -Label "Cai dependencies dung package-lock" -Command { npm ci }
} else {
  Write-Host "Bo qua npm ci theo tham so -SkipInstall." -ForegroundColor Yellow
}

Invoke-NativeStep -Label "Sinh Prisma Client" -Command { npm run db:generate }

if (-not $SkipChecks) {
  Invoke-NativeStep -Label "Kiem tra danh muc module deploy" -Command { npm run check:deploy-modules }
  Invoke-NativeStep -Label "Chay test phan quyen" -Command { npm run test:permissions }
} else {
  Write-Host "Bo qua guard/test theo tham so -SkipChecks." -ForegroundColor Yellow
}

$envLines = Get-Content -LiteralPath $envPath
$requiredNames = @(
  "DATABASE_URL",
  "AUTH_SESSION_SECRET",
  "APP_URL",
  "CONFIG_SECRET_ENCRYPTION_KEY"
)
$unconfigured = @()
foreach ($name in $requiredNames) {
  $value = Get-DotEnvValue -Lines $envLines -Name $name
  if (
    [string]::IsNullOrWhiteSpace($value) -or
    $value -match "(?i)replace-with|password|changeme|example"
  ) {
    $unconfigured += $name
  }
}

$gcloudCommand = Get-Command "gcloud" -ErrorAction SilentlyContinue
$proxyCandidates = @(
  $env:CLOUD_SQL_PROXY_PATH,
  (Join-Path $env:ProgramFiles "Google\Cloud SQL Auth Proxy\cloud-sql-proxy.exe"),
  "C:\tools\cloud-sql-proxy\cloud-sql-proxy.x86.exe"
) | Where-Object { $_ }
$proxyCommand = Get-Command "cloud-sql-proxy" -ErrorAction SilentlyContinue
$proxyPath = if ($proxyCommand) {
  $proxyCommand.Source
} else {
  $proxyCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}

Write-Host "`n=== Ket qua ===" -ForegroundColor Cyan
if ($unconfigured.Count -gt 0) {
  Write-Host "Can cau hinh an toan trong .env: $($unconfigured -join ', ')" -ForegroundColor Yellow
} else {
  Write-Host "Cac bien local bat buoc da co gia tri (khong hien thi secret)." -ForegroundColor Green
}

if ($gcloudCommand) {
  Write-Host "Google Cloud CLI: OK" -ForegroundColor Green
} else {
  Write-Host "Google Cloud CLI: chua cai (chi bat buoc khi can Cloud SQL/Secret Manager)." -ForegroundColor Yellow
}

if ($proxyPath) {
  Write-Host "Cloud SQL Auth Proxy: $proxyPath" -ForegroundColor Green
} else {
  Write-Host "Cloud SQL Auth Proxy: chua tim thay. Co the dat CLOUD_SQL_PROXY_PATH sau khi cai." -ForegroundColor Yellow
}

Write-Host "`nBuoc tiep theo:" -ForegroundColor Cyan
Write-Host "1. Nho chu repo/GCP cap quyen rieng va cung cap .env qua kenh bao mat."
Write-Host "2. Doc docs/local-development-setup.md."
Write-Host "3. Chay 'npm run dev:local' de mo proxy va Next.js."
