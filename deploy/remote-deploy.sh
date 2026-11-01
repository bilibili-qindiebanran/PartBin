#!/usr/bin/env bash
# PartBin 远端部署（用户态 systemd，无需 root，可重复执行）
#
#   ./deploy/remote-deploy.sh                 部署 / 更新（不动数据）
#   ./deploy/remote-deploy.sh --import-data   额外把本地 data/ 导入远端（覆盖前自动留存旧库）
#   ./deploy/remote-deploy.sh --rollback      回滚到上一个 release
#   ./deploy/remote-deploy.sh --status        查看状态
#   ./deploy/remote-deploy.sh --logs          查看最近日志
#
# 远端布局（全部在 $HOME/partbin 下，从未使用 root 权限）：
#   app      -> releases/<时间戳>      代码软链，切换即回滚
#   releases/<时间戳>/                 每次部署一个新目录（含 node_modules、web/dist）
#   data/                              DATA_DIR：inventory.db / uploads / backups，任何部署都不碰
#   env                                运行配置（600），首次生成后不再改写密钥
#   node/  tools/  store/              Node 运行时、pnpm、pnpm 共享存储
#
# 可用环境变量覆盖（也可写在本地未跟踪文件 deploy/deploy.local.env 中）：
#   PARTBIN_SSH_HOST（默认 partbin-host，指向 ~/.ssh/config 的 Host 别名）
#   PARTBIN_NODE_VERSION（默认 v24.22.2）  PARTBIN_REGISTRY（默认 npmmirror）
#   PARTBIN_BIND_HOST（默认 0.0.0.0）       PARTBIN_PORT（默认 8787）
#   PARTBIN_PUBLIC_ORIGIN（默认 https://partbin.example.internal，按实际反代域名改）
#   PARTBIN_COOKIE_SECURE / PARTBIN_TRUSTED_PROXIES（仅在 --sync-env 时写入）
#   PARTBIN_KEEP_RELEASES（默认 3）
#
# deploy/deploy.local.env 不入库，可安全写真实主机名、内部域名与代理地址：
#   PARTBIN_SSH_HOST=your-host
#   PARTBIN_PUBLIC_ORIGIN=https://partbin.example.internal
#   PARTBIN_TRUSTED_PROXIES=10.0.0.80

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)

# 本地未跟踪参数（真实主机名/内部域名等，不提交到仓库）
LOCAL_ENV="$SCRIPT_DIR/deploy.local.env"
if [[ -f $LOCAL_ENV ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$LOCAL_ENV"
  set +a
fi

HOST=${PARTBIN_SSH_HOST:-partbin-host}
NODE_VERSION=${PARTBIN_NODE_VERSION:-v24.22.2}
REGISTRY=${PARTBIN_REGISTRY:-https://registry.npmmirror.com}
BIND_HOST=${PARTBIN_BIND_HOST:-0.0.0.0}
BIND_PORT=${PARTBIN_PORT:-8787}
PUBLIC_ORIGIN=${PARTBIN_PUBLIC_ORIGIN:-https://partbin.example.internal}
COOKIE_SECURE=${PARTBIN_COOKIE_SECURE:-}
TRUSTED_PROXIES=${PARTBIN_TRUSTED_PROXIES:-}
KEEP_RELEASES=${PARTBIN_KEEP_RELEASES:-3}

ACTION=deploy
IMPORT_DATA=0
SYNC_ENV=0

die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
say() { printf '\n\033[36m▸ %s\033[0m\n' "$*"; }
ok() { printf '\033[32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }

while (($#)); do
  case $1 in
    --import-data) IMPORT_DATA=1 ;;
    --sync-env) SYNC_ENV=1 ;;
    --rollback) ACTION=rollback ;;
    --status) ACTION=status ;;
    --logs) ACTION=logs ;;
    --host) HOST=${2:?}; shift ;;
    --public-origin) PUBLIC_ORIGIN=${2:?}; shift ;;
    --cookie-secure) COOKIE_SECURE=${2:?}; shift ;;
    -h | --help)
      sed -n '2,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "未知参数：$1（--help 查看用法）" ;;
  esac
  shift
done

rsh() { ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=30 "$HOST" "$@"; }

# ---------------------------------------------------------------- 前置检查
say "前置检查（$HOST）"
[[ -f $ROOT/package.json && -f $ROOT/pnpm-lock.yaml ]] || die "未在 PartBin 仓库根目录运行"
for bin in tar ssh git; do command -v "$bin" >/dev/null || die "本机缺少 $bin"; done

exec 9>"${TMPDIR:-/tmp}/partbin-deploy-${HOST}.lock"
flock -n 9 || die "已有部署进程在运行（锁：/tmp/partbin-deploy-${HOST}.lock）"

REMOTE_HOME=$(rsh 'printf %s "$HOME"') || die "无法通过 SSH 连接 $HOST（检查 ~/.ssh/config）"
R_ROOT="$REMOTE_HOME/partbin"
ok "SSH 正常，远端 HOME=$REMOTE_HOME"

GIT_HEAD=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "nogit")
if [[ -n $(git -C "$ROOT" status --porcelain 2>/dev/null | head -n 1) ]]; then
  warn "工作区有未提交改动，本次按当前工作区内容部署（HEAD=$GIT_HEAD）"
fi

# ---------------------------------------------------------------- 状态 / 日志
if [[ $ACTION == status || $ACTION == logs ]]; then
  rsh "R_ROOT='$R_ROOT' ACTION='$ACTION' bash -s" <<'EOS'
set -euo pipefail
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
if [[ "$ACTION" == logs ]]; then
  exec journalctl --user -u partbin.service -n 80 --no-pager
fi
echo "远端根目录 : $R_ROOT"
echo "当前版本   : $(cat "$R_ROOT/app/VERSION" 2>/dev/null || echo 未部署)"
echo "代码目录   : $(readlink -f "$R_ROOT/app" 2>/dev/null || echo 无)"
echo "历史版本   : $(ls -1d "$R_ROOT"/releases/*/ 2>/dev/null | wc -l) 个"
echo "数据目录   : $(sed -n 's/^DATA_DIR=//p' "$R_ROOT/env" 2>/dev/null || echo 未生成)"
echo "数据体积   : $(du -sh "$R_ROOT/data" 2>/dev/null | cut -f1)"
echo "备份份数   : $(ls -1 "$R_ROOT/data/backups" 2>/dev/null | wc -l)"
loginctl show-user "$(id -un)" 2>/dev/null | grep -i '^Linger=' || true
echo "--- 服务 ---"
systemctl --user is-active partbin.service 2>/dev/null || echo inactive
systemctl --user is-enabled partbin.service 2>/dev/null || echo disabled
echo "--- 定时器 ---"
systemctl --user list-timers partbin-backup.timer --no-pager 2>/dev/null | head -3 || echo 未安装
echo "--- 健康 ---"
wget -q -O- --timeout=5 "http://127.0.0.1:$(sed -n 's/^PORT=//p' "$R_ROOT/env" 2>/dev/null || echo 8787)/health" || echo "健康检查失败"
EOS
  exit 0
fi

# ---------------------------------------------------------------- 回滚
if [[ $ACTION == rollback ]]; then
  say "回滚到上一个 release"
  rsh "R_ROOT='$R_ROOT' bash -s" <<'EOS'
set -euo pipefail
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
current=$(readlink -f "$R_ROOT/app" 2>/dev/null || true)
prev=$(ls -1dt "$R_ROOT"/releases/*/ 2>/dev/null | grep -v -F "$current" | head -n 1 || true)
[[ -n "$prev" ]] || { echo "没有可回滚的历史版本"; exit 1; }
echo "当前：$current"
echo "回滚：$prev"
systemctl --user stop partbin.service >/dev/null 2>&1 || true
ln -sfn "${prev%/}" "$R_ROOT/app"
systemctl --user start partbin.service
port=$(sed -n 's/^PORT=//p' "$R_ROOT/env"); port=${port:-8787}
for _ in $(seq 1 40); do
  if wget -q -O- --timeout=3 "http://127.0.0.1:$port/health" 2>/dev/null | grep -q '"status":"ok"'; then
    echo "回滚完成，健康检查通过"; exit 0
  fi
  sleep 1
done
echo "回滚后健康检查未通过，请查看 journalctl --user -u partbin"; exit 1
EOS
  ok "已回滚"
  exit 0
fi

# ---------------------------------------------------------------- 打包
say "打包代码（排除 data/、node_modules、.env、web/dist）"
APP_TGZ=$(mktemp -t partbin-app.XXXXXX.tgz)
DATA_TGZ=""
STAGE_DIR=""
trap '[[ -n "$STAGE_DIR" ]] && rm -rf "$STAGE_DIR"; rm -f "$APP_TGZ" "$DATA_TGZ" 2>/dev/null || true' EXIT
tar czf "$APP_TGZ" -C "$ROOT" \
  --exclude=./.git \
  --exclude=./node_modules \
  --exclude='./*/node_modules' \
  --exclude=./data \
  --exclude=./server/data \
  --exclude=./web/dist \
  --exclude=./.pnpm-store \
  --exclude=./.env \
  --exclude=./.cert \
  --exclude=./web/.cert \
  --exclude=./deploy/deploy.local.env \
  --exclude='*.log' \
  --exclude='*.db' \
  --exclude='*.db-wal' \
  --exclude='*.db-shm' \
  --exclude='*.pbk' \
  .
ok "包大小 $(du -h "$APP_TGZ" | cut -f1)"

# ---------------------------------------------------------------- 运行时依赖
say "准备远端运行时（Node $NODE_VERSION + pnpm）"
rsh "R_ROOT='$R_ROOT' NODE_VERSION='$NODE_VERSION' REGISTRY='$REGISTRY' bash -s" <<'EOS'
set -euo pipefail
mkdir -p "$R_ROOT"/{releases,data,logs,tools,store}
chmod 700 "$R_ROOT" "$R_ROOT/data"

node_bin="$R_ROOT/node/bin/node"
if [[ -x "$node_bin" ]] && [[ $("$node_bin" -v) == "$NODE_VERSION" ]]; then
  echo "Node 已就绪：$("$node_bin" -v)"
else
  tmpd=$(mktemp -d)
  url="https://npmmirror.com/mirrors/node/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz"
  echo "下载 $url"
  wget -q --timeout=60 -O "$tmpd/node.tar.xz" "$url"
  tar xJf "$tmpd/node.tar.xz" -C "$tmpd"
  rm -rf "$R_ROOT/node"
  mv "$tmpd/node-$NODE_VERSION-linux-x64" "$R_ROOT/node"
  rm -rf "$tmpd"
  echo "Node 安装完成：$("$R_ROOT/node/bin/node" -v)"
fi

if [[ ! -x "$R_ROOT/tools/bin/pnpm" ]]; then
  PATH="$R_ROOT/node/bin:$PATH" npm install -g pnpm@11.28.5 \
    --prefix "$R_ROOT/tools" --registry "$REGISTRY" --no-fund --no-audit >/dev/null
fi
echo "pnpm：$(PATH="$R_ROOT/node/bin:$R_ROOT/tools/bin:$PATH" pnpm -v)"
EOS
ok "运行时就绪"

# ---------------------------------------------------------------- 传输并解包
say "上传代码到新 release"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
REMOTE_TGZ="/tmp/partbin-app-$STAMP-$$.tgz"
rsh "cat > '$REMOTE_TGZ'" <"$APP_TGZ"
rsh "R_ROOT='$R_ROOT' STAMP='$STAMP' REMOTE_TGZ='$REMOTE_TGZ' bash -s" <<'EOS'
set -euo pipefail
rel="$R_ROOT/releases/$STAMP"
rm -rf "$rel"; mkdir -p "$rel"
tar xzf "$REMOTE_TGZ" -C "$rel"
rm -f "$REMOTE_TGZ"
echo "$rel"
EOS
ok "release 目录：releases/$STAMP"

# ---------------------------------------------------------------- 配置
say "生成/校验远端配置"
rsh "R_ROOT='$R_ROOT' BIND_HOST='$BIND_HOST' BIND_PORT='$BIND_PORT' PUBLIC_ORIGIN='$PUBLIC_ORIGIN' COOKIE_SECURE='$COOKIE_SECURE' TRUSTED_PROXIES='$TRUSTED_PROXIES' SYNC_ENV='$SYNC_ENV' bash -s" <<'EOS'
set -euo pipefail
env_file="$R_ROOT/env"
node_bin="$R_ROOT/node/bin/node"

set_env_key() {  # set_env_key KEY VALUE 覆盖已有键
  key=$1; val=$2
  if grep -q "^$key=" "$env_file"; then
    tmp=$(mktemp)
    awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' "$env_file" >"$tmp"
    mv "$tmp" "$env_file"
  else
    echo "$key=$val" >>"$env_file"
  fi
}

if [[ ! -f "$env_file" ]]; then
  umask 077
  secret=$("$node_bin" -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64'))")
  backup_pass=$("$node_bin" -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64url'))")
  cat >"$env_file" <<ENV
# PartBin 运行配置（首次部署由 deploy/remote-deploy.sh 生成）
# APP_SECRET 与 BACKUP_PASSPHRASE 生成后请勿修改：
#   APP_SECRET 变更会导致所有 TOTP 密钥无法解密；BACKUP_PASSPHRASE 变更会导致旧备份无法恢复。
# 请把 BACKUP_PASSPHRASE 抄到离线位置（cat $env_file）。
NODE_ENV=production
HOST=$BIND_HOST
PORT=$BIND_PORT
DATA_DIR=$R_ROOT/data
APP_SECRET='$secret'
PUBLIC_ORIGIN=$PUBLIC_ORIGIN
COOKIE_SECURE=false
APP_TZ=Asia/Shanghai
LOG_LEVEL=info
BACKUP_KEEP=14
BACKUP_PASSPHRASE='$backup_pass'
ENV
  chmod 600 "$env_file"
  echo "已生成 $env_file（含新 APP_SECRET / BACKUP_PASSPHRASE）"
else
  chmod 600 "$env_file"
  echo "沿用已有 $env_file（密钥不变）"
  if [[ "$SYNC_ENV" == 1 ]]; then
    set_env_key HOST "$BIND_HOST"
    set_env_key PORT "$BIND_PORT"
    set_env_key PUBLIC_ORIGIN "$PUBLIC_ORIGIN"
    [[ -n "$COOKIE_SECURE" ]] && set_env_key COOKIE_SECURE "$COOKIE_SECURE"
    if [[ -n "$TRUSTED_PROXIES" ]]; then
      set_env_key TRUSTED_PROXIES "$TRUSTED_PROXIES"
    fi
    echo "已同步 HOST/PORT/PUBLIC_ORIGIN${COOKIE_SECURE:+/COOKIE_SECURE}${TRUSTED_PROXIES:+/TRUSTED_PROXIES}"
  fi
fi

data_dir=$(sed -n 's/^DATA_DIR=//p' "$env_file" | tr -d "'\"")
[[ "$data_dir" == /* ]] || { echo "DATA_DIR 必须是绝对路径，当前：$data_dir"; exit 1; }
case "$data_dir" in
  "$R_ROOT/releases"/* | "$R_ROOT/app"*) echo "DATA_DIR 位于代码目录内，拒绝部署"; exit 1 ;;
esac
echo "DATA_DIR=$data_dir"
EOS
ok "配置就绪"

# ---------------------------------------------------------------- 安装 systemd 单元
say "安装用户态单元到 ~/.config/systemd/user"
rsh "R_ROOT='$R_ROOT' STAMP='$STAMP' bash -s" <<'EOS'
set -euo pipefail
rel="$R_ROOT/releases/$STAMP"
mkdir -p "$HOME/.config/systemd/user"
for unit in partbin.service partbin-backup.service partbin-backup.timer; do
  src="$rel/deploy/systemd-user/$unit"
  dst="$HOME/.config/systemd/user/$unit"
  [[ -f "$src" ]] || { echo "缺少单元文件 $src"; exit 1; }
  if cmp -s "$src" "$dst" 2>/dev/null; then
    echo "未变化：$unit"
  else
    cp "$src" "$dst"; echo "已安装：$unit"
  fi
done
EOS
ok "单元就绪"

# ---------------------------------------------------------------- 构建
say "安装依赖并构建前端（release 内，不触碰数据）"
rsh "R_ROOT='$R_ROOT' STAMP='$STAMP' REGISTRY='$REGISTRY' GIT_HEAD='$GIT_HEAD' bash -s" <<'EOS'
set -euo pipefail
rel="$R_ROOT/releases/$STAMP"
cd "$rel"
export PATH="$R_ROOT/node/bin:$R_ROOT/tools/bin:$PATH"
export npm_config_registry="$REGISTRY"
export CI=1
printf '%s\n' "$GIT_HEAD $(date -u +%FT%TZ)" >"$rel/VERSION"
pnpm install --frozen-lockfile --store-dir "$R_ROOT/store" --reporter=append-only
pnpm build
[[ -f "$rel/web/dist/index.html" ]] || { echo "构建产物缺失：web/dist/index.html"; exit 1; }
echo "构建完成：$(du -sh "$rel/web/dist" | cut -f1)"
EOS
ok "构建完成"

# ---------------------------------------------------------------- 首次数据迁移
if [[ $IMPORT_DATA == 1 ]] || ! rsh "test -f '$R_ROOT/data/inventory.db'"; then
  say "导入本地数据（data/inventory.db + uploads）"
  [[ -f $ROOT/data/inventory.db ]] || die "本地没有 data/inventory.db，无法导入（用 --import-data 强制）"

  stage=$(mktemp -d -t partbin-data.XXXXXX)
  STAGE_DIR="$stage"
  # VACUUM INTO 生成一致快照，避免 WAL 未合并导致的残库
  node "$ROOT/deploy/lib/sqlite-snapshot.mjs" "$ROOT/data/inventory.db" "$stage/inventory.db" ||
    die "本地数据库快照失败"
  if [[ -d $ROOT/data/uploads ]]; then
    cp -a "$ROOT/data/uploads" "$stage/uploads"
  fi
  DATA_TGZ=$(mktemp -t partbin-data.XXXXXX.tgz)
  tar czf "$DATA_TGZ" -C "$stage" .
  ok "数据包 $(du -h "$DATA_TGZ" | cut -f1)，数据库 $(du -h "$stage/inventory.db" | cut -f1)，照片 $(find "$stage/uploads" -type f 2>/dev/null | wc -l) 张"

  REMOTE_DATA="/tmp/partbin-data-$STAMP.tgz"
  rsh "cat > '$REMOTE_DATA'" <"$DATA_TGZ"
  rsh "R_ROOT='$R_ROOT' REMOTE_DATA='$REMOTE_DATA' STAMP='$STAMP' bash -s" <<'EOS'
set -euo pipefail
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
systemctl --user stop partbin.service >/dev/null 2>&1 || true
if [[ -f "$R_ROOT/data/inventory.db" ]]; then
  keep="$R_ROOT/data/inventory.db.pre-import-$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$R_ROOT/data/inventory.db" "$keep"
  rm -f "$R_ROOT/data"/inventory.db-wal "$R_ROOT/data"/inventory.db-shm
  echo "旧库已留存：$keep"
fi
tar xzf "$REMOTE_DATA" -C "$R_ROOT/data"
rm -f "$REMOTE_DATA"
chmod 600 "$R_ROOT/data/inventory.db"
echo "已导入：$(du -h "$R_ROOT/data/inventory.db" | cut -f1)，照片 $(find "$R_ROOT/data/uploads" -type f 2>/dev/null | wc -l) 张"
EOS
  ok "数据导入完成"
fi

# ---------------------------------------------------------------- 切换并重启
say "切换软链并重启服务"
rsh "R_ROOT='$R_ROOT' STAMP='$STAMP' bash -s" <<'EOS'
set -euo pipefail
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
prev=$(readlink -f "$R_ROOT/app" 2>/dev/null || true)
[[ -d "$prev" ]] || prev=""

systemctl --user stop partbin.service >/dev/null 2>&1 || true

# 先切软链（备份单元以 app 为工作目录），失败再回退
ln -sfn "$R_ROOT/releases/$STAMP" "$R_ROOT/app"
systemctl --user daemon-reload

# 迁移前先做一次加密备份（失败即回退软链并中止，避免带着旧库直接升版本）
if [[ -f "$R_ROOT/data/inventory.db" ]]; then
  if systemctl --user start partbin-backup.service; then
    echo "迁移前备份完成：$(ls -1t "$R_ROOT/data/backups" 2>/dev/null | head -n 1)"
  else
    echo "备份失败，回退软链并中止部署"
    [[ -n "$prev" ]] && ln -sfn "$prev" "$R_ROOT/app"
    systemctl --user status partbin-backup.service --no-pager -n 20 || true
    exit 1
  fi
fi

systemctl --user enable partbin.service partbin-backup.timer >/dev/null 2>&1 || true
systemctl --user restart partbin.service
systemctl --user start partbin-backup.timer >/dev/null 2>&1 || true
echo "已切换到 releases/$STAMP"
EOS

say "健康检查"
port=$BIND_PORT
healthy=0
for _ in $(seq 1 40); do
  if rsh "wget -q -O- --timeout=3 'http://127.0.0.1:$port/health'" 2>/dev/null | grep -q '"status":"ok"'; then
    healthy=1
    break
  fi
  sleep 1
done
if ((healthy == 0)); then
  warn "健康检查未通过，最近日志："
  rsh "XDG_RUNTIME_DIR=/run/user/\$(id -u) journalctl --user -u partbin.service -n 60 --no-pager" || true
  die "部署失败；可执行 ./deploy/remote-deploy.sh --rollback 回滚"
fi
ok "服务健康（http://127.0.0.1:$port/health）"

say "数据自检（db:check）"
rsh "R_ROOT='$R_ROOT' STAMP='$STAMP' bash -s" <<'EOS'
set -euo pipefail
rel="$R_ROOT/releases/$STAMP"
set -a; . "$R_ROOT/env"; set +a
"$R_ROOT/node/bin/node" --disable-warning=ExperimentalWarning "$rel/server/scripts/db-check.js"
EOS

# ---------------------------------------------------------------- 清理旧版本
say "清理旧 release（保留最近 $KEEP_RELEASES 个）"
rsh "R_ROOT='$R_ROOT' KEEP='$KEEP_RELEASES' bash -s" <<'EOS'
set -euo pipefail
current=$(readlink -f "$R_ROOT/app")
ls -1dt "$R_ROOT"/releases/*/ 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
  [[ "$(readlink -f "$old")" == "$current" ]] && continue
  rm -rf "$old"
  echo "已删除 $(basename "$old")"
done
EOS

ok "部署完成：$GIT_HEAD → $HOST:$R_ROOT/app"
printf '\n  对外地址   %s\n' "$PUBLIC_ORIGIN"
printf '  本机直连   %s（未配置反向代理时使用）\n' "${PARTBIN_DIRECT_URL:-http://<远端地址>:$BIND_PORT}"
printf '  查看状态   ./deploy/remote-deploy.sh --status\n'
printf '  查看日志   ./deploy/remote-deploy.sh --logs\n'
printf '  回滚       ./deploy/remote-deploy.sh --rollback\n'
