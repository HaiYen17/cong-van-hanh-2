#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_root"

port_open() {
  nc -z 127.0.0.1 "$1" >/dev/null 2>&1
}

if [[ ! -f .env ]]; then
  echo "THIEU .env. Hay chay 'npm run setup:local' truoc." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "THIEU node_modules. Hay chay 'npm run setup:local' truoc." >&2
  exit 1
fi

if port_open 3000; then
  echo "Dev server da chay san o http://localhost:3000."
  open "http://localhost:3000"
  exit 0
fi

proxy_pid=""
cleanup() {
  if [[ -n "$proxy_pid" ]] && kill -0 "$proxy_pid" >/dev/null 2>&1; then
    kill "$proxy_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

if port_open 5433; then
  echo "Cloud SQL proxy da chay tai 127.0.0.1:5433."
else
  proxy_path="${CLOUD_SQL_PROXY_PATH:-}"
  if [[ -z "$proxy_path" ]] && command -v cloud-sql-proxy >/dev/null 2>&1; then
    proxy_path="$(command -v cloud-sql-proxy)"
  fi

  if [[ -n "$proxy_path" && -x "$proxy_path" ]]; then
    echo "Dang bat Cloud SQL proxy tu $proxy_path ..."
    "$proxy_path" \
      --address 127.0.0.1 \
      --port 5433 \
      tvg-ops-dev:asia-southeast1:tvg-postgres-dev \
      >"${TMPDIR:-/tmp}/cong-van-hanh-cloud-sql-proxy.log" 2>&1 &
    proxy_pid="$!"

    for _ in {1..10}; do
      if port_open 5433; then
        break
      fi
      sleep 1
    done
  else
    echo "CANH BAO: khong tim thay Cloud SQL Auth Proxy. Xem docs/local-development-setup.md."
  fi

  if port_open 5433; then
    echo "Proxy OK (127.0.0.1:5433)."
  else
    echo "CANH BAO: proxy chua san sang; cac man hinh can database se khong hoat dong."
  fi
fi

export ACCOUNTING_WORKER_URL="${ACCOUNTING_WORKER_URL:-https://thuanviet-accounting-worker-fe6q7l75dq-as.a.run.app}"
if [[ -z "${ACCOUNTING_WORKER_SECRET:-}" ]] && command -v gcloud >/dev/null 2>&1; then
  if worker_secret="$(gcloud secrets versions access latest --secret accounting-worker-api-secret --project tvg-ops-dev 2>/dev/null)" && [[ -n "$worker_secret" ]]; then
    export ACCOUNTING_WORKER_SECRET="$worker_secret"
    echo "Worker Ke toan da duoc nap tu Secret Manager."
  else
    echo "CANH BAO: chua doc duoc secret worker Ke toan."
  fi
fi
export ACCOUNTING_WORKER_USE_ID_TOKEN="false"
export ACCOUNTING_EXPORT_BUCKET="tvg-ops-dev-cong-van-hanh-files"

open "http://localhost:3000"
npm run dev
