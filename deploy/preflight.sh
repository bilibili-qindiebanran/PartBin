#!/usr/bin/env bash
# 部署后在目标服务器执行：检查监听、健康检查、配置与备份
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:8787}"
fail=0
check() { printf '%-42s' "$1"; shift; if "$@" >/dev/null 2>&1; then echo 'ok'; else echo 'FAIL'; fail=1; fi; }

check 'health endpoint' curl -fsS "$BASE/health"
check 'HTTPS 8787 未直接暴露（应失败）' bash -c '! curl -fsS --max-time 2 https://127.0.0.1:8787/health'
check 'data 目录存在' test -d "${DATA_DIR:-/var/lib/partbin}"
check '环境变量 APP_SECRET' test -n "${APP_SECRET:-}"
check '环境变量 PUBLIC_ORIGIN' test -n "${PUBLIC_ORIGIN:-}"

if curl -fsS "$BASE/health" 2>/dev/null | grep -q '"status":"ok"'; then :; else fail=1; fi
echo
if [ "$fail" -eq 0 ]; then echo '预检通过；仍需在真实域名上执行 TLS/端口/监控检查。'; else echo '预检存在问题。'; exit 1; fi
