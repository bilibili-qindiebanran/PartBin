# 部署手册

PartBin 是单进程 + SQLite：一个容器或一个 systemd 服务即可。应用只应监听本机/内网，TLS 与公网入口交给 Caddy 或 Cloudflare Tunnel。

## 0. 架构

```
浏览器 ──HTTPS──> Caddy / Cloudflare ──HTTP──> PartBin 127.0.0.1:8787
                                              ├─ SQLite (data/inventory.db)
                                              ├─ uploads/
                                              └─ backups/*.db.pbk
```

- 8787 禁止出现在公网防火墙放行列表；
- 每日加密备份留在本地，异地由 restic 等工具负责；
- 数据目录权限 700，属主为运行用户。

## 1. Docker（推荐快速部署）

```bash
cp .env.example .env
# 编辑 .env：APP_SECRET、PUBLIC_ORIGIN、COOKIE_SECURE=true、PARTBIN_DOMAIN
docker compose build
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:8787/health
```

初始化管理员（容器内执行，使用已注入的环境变量）：

```bash
docker compose exec partbin node --disable-warning=ExperimentalWarning \
  server/scripts/create-admin.js --username admin --password '<至少 12 位密码>'
```

数据在命名卷 `partbin-data`。备份：

```bash
docker compose exec -e BACKUP_PASSPHRASE='<离线密码>' partbin \
  node --disable-warning=ExperimentalWarning server/scripts/backup.js
docker compose exec partbin ls -lh /data/backups
```

### Caddy 容器自动 HTTPS

```bash
# .env 里设置 PARTBIN_DOMAIN=partbin.example.com
docker compose -f docker-compose.yml -f deploy/docker-compose.caddy.yml up -d
```

Caddy 使用 `deploy/caddy/Caddyfile.docker`，证书保存在 `caddy-data` 卷。80/443 由 Caddy 暴露；PartBin 只发布到 `127.0.0.1:8787`。

### Cloudflare Tunnel

```bash
# .env 里设置 TUNNEL_TOKEN
docker compose -f docker-compose.yml -f deploy/docker-compose.cloudflared.yml up -d
```

不需要放行 80/443；在 Cloudflare Zero Trust 中把域名指向该 Tunnel。此时可删掉 compose 的 `ports`，让源站完全不可直连。若保留，务必只绑定 `127.0.0.1`。

### 镜像硬化说明

- 运行用户 UID 10001，非 root；
- 根文件系统只读，仅 `/data` 与 `/tmp` 可写；
- `cap_drop: ALL`、`no-new-privileges`；
- 内置 HEALTHCHECK；
- 生产建议把 `node:24-bookworm-slim` 固定到 digest，并在升级时先跑备份。

## 2. systemd（推荐裸机长期运行）

```bash
sudo useradd --system --home /var/lib/partbin --shell /usr/sbin/nologin partbin
sudo install -d -o partbin -g partbin -m 700 /var/lib/partbin /etc/partbin
sudo install -d /opt/partbin
# 将仓库放到 /opt/partbin，然后：
sudo -u partbin pnpm install --frozen-lockfile
sudo -u partbin pnpm build

sudo cp deploy/systemd/partbin.service /etc/systemd/system/
# 环境文件放 /etc/partbin/partbin.env，权限 600
sudo cp deploy/systemd/partbin-backup.service deploy/systemd/partbin-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now partbin
sudo systemctl enable --now partbin-backup.timer
curl -fsS http://127.0.0.1:8787/health
```

`partbin.env` 至少包含：

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
DATA_DIR=/var/lib/partbin
APP_SECRET=<openssl rand -base64 48>
PUBLIC_ORIGIN=https://partbin.example.com
COOKIE_SECURE=true
BACKUP_PASSPHRASE=<离线保管>
```

初始化管理员：

```bash
sudo -u partbin env $(grep -v '^#' /etc/partbin/partbin.env | xargs) \
  pnpm admin:create -- --username admin --password '<强密码>'
```

## 3. Caddy（宿主机）

```bash
sudo cp deploy/caddy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

`Caddyfile` 使用 `{$PARTBIN_DOMAIN}` 环境变量；在 `/etc/caddy/environment` 或 systemd override 中设置。Caddy 自动申请与续期证书。

## 4. 防火墙与 fail2ban

```bash
sudo SSH_PORT=22 bash deploy/ufw.sh
sudo ufw status verbose
```

安装 fail2ban 后：

```bash
sudo cp deploy/fail2ban/partbin.conf /etc/fail2ban/filter.d/
sudo cp deploy/fail2ban/jail.local /etc/fail2ban/jail.d/partbin.local
sudo systemctl restart fail2ban
sudo fail2ban-client status partbin
```

过滤器匹配 PartBin journald 中的 401/429。请确认日志确实进入 journald（systemd 部署默认如此）。

## 5. Cloudflare Tunnel（无公网入站）

```bash
cloudflared tunnel login
cloudflared tunnel create partbin
cloudflared tunnel route dns partbin partbin.example.com
sudo cp deploy/cloudflared/config.yml.example /etc/cloudflared/config.yml
# 填入 tunnel UUID 与 credentials 路径
sudo cloudflared service install
```

应用保持监听 `127.0.0.1:8787`。若使用容器，改用 `deploy/docker-compose.cloudflared.yml`，源站无需发布端口。`TRUST_PROXY` 仅在源站只能被代理访问时开启，优先用 `TRUSTED_PROXIES` 限定网段。

## 6. 备份、恢复与异地

```bash
# 本地加密快照（systemd timer 每日 03:20）
BACKUP_PASSPHRASE='...' pnpm backup

# 校验：临时目录恢复 + db:check
BACKUP_PASSPHRASE='...' pnpm backup:verify -- --file /var/lib/partbin/backups/partbin-xxx.db.pbk

# 恢复：先停服务
sudo systemctl stop partbin
BACKUP_PASSPHRASE='...' pnpm restore -- --file /var/lib/partbin/backups/partbin-xxx.db.pbk
pnpm db:check
sudo systemctl start partbin
```

异地加密：用 restic 对 `/var/lib/partbin`（SQLite、uploads、backups）做快照并上传；密码离线保管。每月至少执行一次恢复演练并记录 RTO。

## 7. 监控与告警

- 探活：`GET /health`，非 200 或 `db != ok` 告警；
- systemd：`systemctl status partbin`，`journalctl -u partbin -f`；
- 建议监控：证书剩余天数、磁盘 80%、备份最近成功时间、5xx 比例、401/429 突增、fail2ban 封禁；
- 日志为 JSON，已脱敏 Cookie/Authorization；不要将日志全文上传公开渠道。

## 8. 升级与回滚

```bash
pnpm backup
sudo systemctl stop partbin
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
sudo systemctl start partbin
curl -fsS http://127.0.0.1:8787/health
```

迁移在启动时自动执行；失败拒绝启动。查看日志后从备份恢复，或回退到上一个 git tag 再启动。

## 9. 12.10 上线清单

在目标服务器逐项执行并保存输出：

- [ ] `DOMAIN=... bash deploy/verify-public.sh` 通过（TLS、HSTS、跳转、8787 不可达、证书 >14 天）
- [ ] SSL Labs 评级 A 或 A+
- [ ] `curl -fsS https://<域名>/health` 返回 `status: ok`
- [ ] `docker compose ps` / `systemctl status partbin` 健康
- [ ] 默认 `registration_mode=invite`；管理员由 CLI 创建；无默认口令
- [ ] 管理员已启用 TOTP，恢复码离线保存
- [ ] 连续失败触发锁定，重启服务后仍生效（`pnpm db:check`/登录验证）
- [ ] Cookie 为 `__Host-` 前缀，含 Secure/HttpOnly/SameSite=Lax
- [ ] `securityheaders.com` 与 CSP 检查通过，无 `unsafe-eval`
- [ ] 跨站写请求 403（Origin / Sec-Fetch-Site）
- [ ] CSV 公式注入转义；上传 SVG/HTML/超大文件被拒绝
- [ ] 审计覆盖登录、用户管理、邀请码、库存写操作，且无敏感字段
- [ ] 备份加密、异地存储、恢复演练成功，`pnpm db:check` 全绿
- [ ] fail2ban 生效；SSH 禁密码与 root；`unattended-upgrades` 开启
- [ ] `pnpm audit --prod` 无 high/critical
- [ ] 监控告警（宕机、证书、磁盘、备份）实际触发一次
- [ ] 应急手册可执行：封禁、吊销全部会话、从备份恢复

> 未完成上述公网项前，不要把 8787 暴露到公网。清单中依赖真实域名/证书/监控的项必须在目标机执行，不能只在本地通过。
