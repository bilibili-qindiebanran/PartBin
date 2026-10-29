#!/usr/bin/env bash
# 在公网目标机执行：检查 TLS、HSTS、跳转、端口暴露与安全头
set -uo pipefail

DOMAIN="${DOMAIN:-}"
if [ -z "$DOMAIN" ]; then
  echo "用法：DOMAIN=partbin.example.com bash deploy/verify-public.sh"
  exit 2
fi

fail=0
ok() { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; fail=1; }

headers="$(curl -fsSI "https://$DOMAIN/" 2>/dev/null || true)"
if [ -n "$headers" ]; then ok "HTTPS 可访问"; else bad "HTTPS 不可访问"; fi
echo "$headers" | grep -qi '^strict-transport-security:' && ok 'HSTS 已开启' || bad '缺少 HSTS'
echo "$headers" | grep -qi '^content-security-policy:' && ok 'CSP 已开启' || bad '缺少 CSP'
echo "$headers" | grep -qi '^x-content-type-options: nosniff' && ok 'nosniff 已开启' || bad '缺少 nosniff'

redirect="$(curl -sI "http://$DOMAIN/" 2>/dev/null | awk 'tolower($1)=="location:"{print $2}' | tr -d '\r')"
case "$redirect" in https://*) ok "HTTP 跳转到 HTTPS";; *) bad "HTTP 未跳转 HTTPS（$redirect）";; esac

if timeout 3 bash -c "</dev/tcp/$DOMAIN/8787" 2>/dev/null; then
  bad '8787 可从公网访问'
else
  ok '8787 未直接暴露'
fi

cert_days="$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null \
  | openssl x509 -noout -checkend 1209600 2>/dev/null && echo yes || echo no)"
if [ "$cert_days" = "yes" ]; then ok '证书剩余 > 14 天'; else bad '证书不足 14 天或读取失败'; fi

echo
if [ "$fail" -eq 0 ]; then echo '公网基础检查通过；请继续 SSL Labs 与监控告警实测。'; else echo '存在未通过项。'; exit 1; fi
