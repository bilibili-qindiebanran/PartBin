#!/usr/bin/env bash
# 生成本地开发用的自签证书（CA + 服务器证书），用于真机测试摄像头扫码。
#
# 浏览器只在安全上下文（HTTPS 或 localhost）允许 getUserMedia，
# 因此手机通过 http://<局域网 IP>:5180 访问时无法调用摄像头。
#
# 用法：
#   pnpm cert:dev            # 首次生成；已存在则跳过
#   pnpm cert:dev -- --force # 重新生成（换了网络 / IP 变化后用这个）
#
# 产物（已在 .gitignore 中忽略）：
#   web/.cert/dev-key.pem   服务器私钥
#   web/.cert/dev-cert.pem  服务器证书
#   web/.cert/ca.pem        根证书，需导入手机并设为受信任
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$ROOT_DIR/web/.cert"
CA_KEY="$CERT_DIR/ca-key.pem"
CA_CERT="$CERT_DIR/ca.pem"
SERVER_KEY="$CERT_DIR/dev-key.pem"
SERVER_CRT="$CERT_DIR/dev-cert.pem"
SERVER_CSR="$CERT_DIR/dev.csr"
SAN_EXT="$CERT_DIR/san.ext"

# iOS 13+ 要求服务器证书有效期不超过 825 天
SERVER_DAYS=825
CA_DAYS=3650

FORCE=0
for arg in "$@"; do
  case "$arg" in
    -f | --force) FORCE=1 ;;
    -h | --help)
      sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "未知参数：$arg（支持 --force）" >&2
      exit 1
      ;;
  esac
done

if ! command -v openssl >/dev/null 2>&1; then
  echo "缺少 openssl，请先安装：sudo apt install openssl" >&2
  exit 1
fi

# openssl 需要 >= 1.1.1 才有 -addext（Ubuntu 20.04+ 自带，够用）
if ! openssl version | grep -qE 'OpenSSL (1\.1\.[1-9]|[3-9]\.)'; then
  echo "openssl 版本过旧（需要 1.1.1+）：$(openssl version)" >&2
  exit 1
fi

if [[ -f "$SERVER_CRT" && -f "$SERVER_KEY" && $FORCE -eq 0 ]]; then
  echo "证书已存在：$SERVER_CRT"
  echo "如需重建（例如换了网络），运行：pnpm cert:dev -- --force"
  openssl x509 -in "$SERVER_CRT" -noout -subject -enddate -ext subjectAltName 2>/dev/null |
    sed 's/^/  /'
  exit 0
fi

mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"

# ---- 收集要签进 SAN 的局域网 IPv4 ----
LAN_IPS=()
if command -v ip >/dev/null 2>&1; then
  while read -r ip; do
    [[ -n "$ip" ]] && LAN_IPS+=("$ip")
  done < <(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | sort -u)
elif command -v hostname >/dev/null 2>&1; then
  for ip in $(hostname -I 2>/dev/null || true); do
    [[ "$ip" == *:* ]] && continue
    [[ "$ip" =~ ^127\. ]] && continue
    LAN_IPS+=("$ip")
  done
fi

HOST_NAME="$(hostname 2>/dev/null || echo partbin)"

{
  echo "basicConstraints=critical,CA:FALSE"
  echo "keyUsage=critical,digitalSignature,keyEncipherment"
  echo "extendedKeyUsage=serverAuth"
  echo "subjectAltName=@alt_names"
  echo
  echo "[alt_names]"
  echo "DNS.1=localhost"
  echo "DNS.2=$HOST_NAME.local"
  echo "IP.1=127.0.0.1"
  echo "IP.2=::1"
  ip_idx=3
  for ip in "${LAN_IPS[@]}"; do
    echo "IP.$ip_idx=$ip"
    ip_idx=$((ip_idx + 1))
  done
} >"$SAN_EXT"

echo "==> 生成根证书 CA（$CA_DAYS 天）"
openssl req -x509 -newkey rsa:2048 -sha256 -days "$CA_DAYS" -nodes \
  -keyout "$CA_KEY" -out "$CA_CERT" \
  -subj "/CN=PartBin Dev CA/O=PartBin Development" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null

echo "==> 生成服务器证书（$SERVER_DAYS 天）"
openssl req -new -newkey rsa:2048 -sha256 -nodes \
  -keyout "$SERVER_KEY" -out "$SERVER_CSR" \
  -subj "/CN=partbin-dev/O=PartBin Development" 2>/dev/null

openssl x509 -req -in "$SERVER_CSR" -sha256 -days "$SERVER_DAYS" \
  -CA "$CA_CERT" -CAkey "$CA_KEY" -CAcreateserial \
  -out "$SERVER_CRT" -extfile "$SAN_EXT" 2>/dev/null

rm -f "$SERVER_CSR" "$SAN_EXT" "$CERT_DIR/ca.srl"
chmod 600 "$CA_KEY" "$SERVER_KEY"
chmod 644 "$CA_CERT" "$SERVER_CRT"

echo
echo "✅ 已生成："
echo "   CA 证书   $CA_CERT   ← 装到手机上"
echo "   服务器证书 $SERVER_CRT"
echo
echo "证书覆盖的地址："
echo "   https://localhost:5180"
for ip in "${LAN_IPS[@]}"; do
  echo "   https://$ip:5180"
done
echo
cat <<'TIP'
下一步：
  1) 重启开发服务器：pnpm dev（检测到证书会自动启用 HTTPS）
  2) 把 web/.cert/ca.pem 传到手机并安装为受信任的根证书
       iOS：设置 → 通用 → VPN与设备管理 → 安装描述文件
            再进 通用 → 关于本机 → 证书信任设置 → 打开完全信任
       Android：设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书
  3) 手机连同一局域网，访问上面列出的 https://<IP>:5180
  4) 换网络或 IP 变化后重新生成：pnpm cert:dev -- --force
TIP
