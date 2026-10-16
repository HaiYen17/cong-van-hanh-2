#!/usr/bin/env bash

set -euo pipefail

skip_install=false
skip_checks=false
for argument in "$@"; do
  case "$argument" in
    --skip-install) skip_install=true ;;
    --skip-checks) skip_checks=true ;;
    *)
      echo "Tham so khong ho tro: $argument" >&2
      exit 2
      ;;
  esac
done

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

require_command() {
  local command_name="$1"
  local install_hint="$2"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Khong tim thay '$command_name'. $install_hint" >&2
    exit 1
  fi
}

run_step() {
  local label="$1"
  shift
  printf '\n=== %s ===\n' "$label"
  "$@"
}

dotenv_value() {
  local variable_name="$1"
  local line
  line="$(grep -E "^[[:space:]]*${variable_name}[[:space:]]*=" .env | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 0
  fi

  local value="${line#*=}"
  value="$(printf '%s' "$value" | sed -E "s/^[[:space:]]*['\"]?//; s/['\"]?[[:space:]]*$//")"
  printf '%s' "$value"
}

echo "=== Cong van hanh - local setup (macOS/Linux) ==="
echo "Project: $project_root"

require_command git "Cai Git/Xcode Command Line Tools roi chay lai."
require_command node "Cai Node.js 22.16.0 (khuyen nghi) hoac Node.js >= 20.9."
require_command npm "npm duoc cai kem Node.js."

node_version="$(node --version | sed 's/^v//')"
if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 9) ? 0 : 1)'; then
  echo "Node.js $node_version qua cu. Next.js trong project yeu cau toi thieu Node.js 20.9." >&2
  exit 1
fi

if [[ "$node_version" == "22.16.0" ]]; then
  echo "Node.js $node_version: OK"
else
  echo "CANH BAO: dang dung Node.js $node_version; snapshot nay duoc xac minh voi Node.js 22.16.0."
fi
echo "npm $(npm --version)"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Da tao .env tu .env.example. Can dien gia tri dev that truoc khi ket noi database."
else
  echo ".env da ton tai; script giu nguyen, khong ghi de."
fi

if [[ "$skip_install" == false ]]; then
  run_step "Cai dependencies dung package-lock" npm ci
else
  echo "Bo qua npm ci theo tham so --skip-install."
fi

run_step "Sinh Prisma Client" npm run db:generate

if [[ "$skip_checks" == false ]]; then
  run_step "Kiem tra danh muc module deploy" npm run check:deploy-modules
  run_step "Chay test phan quyen" npm run test:permissions
else
  echo "Bo qua guard/test theo tham so --skip-checks."
fi

required_names=(
  DATABASE_URL
  AUTH_SESSION_SECRET
  APP_URL
  CONFIG_SECRET_ENCRYPTION_KEY
)
unconfigured=()
for variable_name in "${required_names[@]}"; do
  value="$(dotenv_value "$variable_name")"
  normalized="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  if [[ -z "$value" || "$normalized" == *replace-with* || "$normalized" == *password* || "$normalized" == *changeme* || "$normalized" == *example* ]]; then
    unconfigured+=("$variable_name")
  fi
done

proxy_path="${CLOUD_SQL_PROXY_PATH:-}"
if [[ -z "$proxy_path" ]] && command -v cloud-sql-proxy >/dev/null 2>&1; then
  proxy_path="$(command -v cloud-sql-proxy)"
fi

printf '\n=== Ket qua ===\n'
if (( ${#unconfigured[@]} > 0 )); then
  printf 'Can cau hinh an toan trong .env: %s\n' "$(IFS=', '; echo "${unconfigured[*]}")"
else
  echo "Cac bien local bat buoc da co gia tri (khong hien thi secret)."
fi

if command -v gcloud >/dev/null 2>&1; then
  echo "Google Cloud CLI: OK"
else
  echo "Google Cloud CLI: chua cai (chi bat buoc khi can Cloud SQL/Secret Manager)."
fi

if [[ -n "$proxy_path" && -x "$proxy_path" ]]; then
  echo "Cloud SQL Auth Proxy: $proxy_path"
else
  echo "Cloud SQL Auth Proxy: chua tim thay. Co the dat CLOUD_SQL_PROXY_PATH sau khi cai."
fi

printf '\nBuoc tiep theo:\n'
echo "1. Nho chu repo/GCP cap quyen rieng va cung cap .env qua kenh bao mat."
echo "2. Doc docs/local-development-setup.md."
echo "3. Chay 'npm run dev:local' de mo proxy va Next.js."
