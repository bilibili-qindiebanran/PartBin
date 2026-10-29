# 部署手册

目标：Debian/Ubuntu 单机，Node 24，应用监听 `127.0.0.1:8787`，Caddy 终止 TLS，数据在 `/var/lib/partbin`。

## 1. 系统与用户

```bash
sudo useradd --system --home /var/lib/partbin --shell /usr/sbin/nologin partbin
sudo mkdir -p /var/lib/partbin
sudo chown -R partbin:partbin /var/lib/partbin
sudo chmod 700 /var/lib/partbin
```

安装 Node 24 与 pnpm 后，将代码放到 `/opt/partbin`，以 `partbin` 用户执行 `pnpm install --prod=false && pnpm build`。

## 2. 环境变量

```bash
sudo -u partbin cp .env.example /var/lib/partbin/.env
sudo -u partbin chmod 600 /var/lib/partbin/.env
```

必填：

- `APP_SECRET`：`openssl rand -base64 48`
- `PUBLIC_ORIGIN=https://partbin.example.com`
- `COOKIE_SECURE=true`

可选：`DATA_DIR=/var/lib/partbin`、`TRUST_PROXY=true`、`BACKUP_PASSPHRASE`（备份脚本使用）。

## 3. 初始化与启动

```bash
sudo -u partbin env $(cat /var/lib/partbin/.env | xargs) pnpm admin:create -- --username admin --password '<强密码>'
```

systemd 单元示例（`/etc/systemd/system/partbin.service`）：

```ini
[Unit]
Description=PartBin
After=network.target

[Service]
Type=simple
User=partbin
Group=partbin
WorkingDirectory=/opt/partbin
EnvironmentFile=/var/lib/partbin/.env
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/src/index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/partbin
UMask=0077

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now partbin
curl -fsS http://127.0.0.1:8787/health
```

## 4. Caddy 与防火墙

```caddy
partbin.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8787
}
```

```bash
sudo ufw default deny incoming
sudo ufw allow 443/tcp
sudo ufw allow from <管理 IP> to any port 22 proto tcp
sudo ufw enable
```

确认 8787 从公网不可达；SSH 禁用密码与 root 登录。

## 5. 备份与恢复

```bash
# 每日 03:20，以 partbin 用户运行
BACKUP_PASSPHRASE='<离线保管的强密码>' pnpm backup

# 验证最近备份（临时目录恢复 + db:check）
BACKUP_PASSPHRASE='...' pnpm backup:verify -- --file /var/lib/partbin/backups/partbin-xxx.db.pbk

# 停止服务后恢复
sudo systemctl stop partbin
BACKUP_PASSPHRASE='...' pnpm restore -- --file /var/lib/partbin/backups/partbin-xxx.db.pbk
pnpm db:check
sudo systemctl start partbin
```

备份只包含 SQLite；照片目录需用 restic 等工具单独加密异地备份。密码离线保管。

## 6. 升级

```bash
pnpm backup
sudo systemctl stop partbin
git pull --ff-only
pnpm install
pnpm build
sudo systemctl start partbin
curl -fsS http://127.0.0.1:8787/health
```

迁移在启动时自动执行；失败会拒绝启动。先看 `journalctl -u partbin -n 100`，必要时从备份恢复。

## 7. 监控

- `/health` 返回 `status/db/version/uptimeSeconds`，适合 Uptime 探活；
- 日志为 JSON 输出到 journald，可接 fail2ban 与日志采集；
- 建议监控：证书剩余天数、磁盘 80%、备份最近成功时间、5xx 比例、401/429 突增。
