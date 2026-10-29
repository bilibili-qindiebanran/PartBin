# PartBin · 硬件出入库系统

自托管的硬件库存与借还管理：开发板、模块、元件放在哪个柜子、还剩几个、借给了谁，打开浏览器就能查到。

PartBin 面向个人、实验室和小团队。它不依赖云服务，数据保存在自己的 SQLite 文件里；支持桌面与手机，桌面上用表格快速录入，手机上用卡片和底部导航完成日常查询与借还。

## 功能

- **库存主数据**：物料编号、厂商、型号、规格、单价、购买日期、备注
- **分类与位置**：多级分类；柜 / 抽屉 / 盒多级位置；按分类子树或位置筛选
- **出入库**：入库、出库、盘点、报废、丢失；超库存拒绝，每次操作记录余额与操作人
- **实例管理**：同一物料可登记多个唯一实例（资产编号、序列号），跟踪在库 / 维修 / 借出 / 丢失 / 退役
- **借出归还**：借用人、联系方式、预计归还；支持部分归还、逾期筛选、未归还撤销
- **照片**：浏览器压缩后上传，服务端按魔数校验 JPEG/PNG/WebP；相册排序
- **CSV**：导出物料 / 流水 / 借出；导入先预览、确认后写入，自动创建分类与位置
- **看板**：在用物料、低库存、本月出库、未还借出、库存提醒、最近流水
- **账号安全**：邀请码注册、TOTP 双因素、恢复码、持久化登录锁定、会话双过期、审计日志
- **双端界面**：1280px 桌面表格 / 767px 以下移动卡片、毛玻璃、减弱动效降级

## 技术栈与架构

```
浏览器 ──HTTPS──> Caddy / Cloudflare ──HTTP──> PartBin 127.0.0.1:8787
                                              ├─ Fastify 5 API
                                              ├─ Vue 3 静态文件
                                              ├─ SQLite (WAL)
                                              ├─ uploads/ 照片
                                              └─ backups/ 加密备份
```

- Node 24 + Fastify 5 + 内置 `node:sqlite`
- Vue 3 + Vite + Element Plus + Pinia + Vue Router
- 单进程、单 SQLite 文件；无需 MySQL/Redis
- 部署方式：Docker Compose（快速、隔离）或 systemd（裸机长期运行）
- 公网入口：Caddy 自动 HTTPS，或 Cloudflare Tunnel 免入站端口

## 目录结构

```
.
├─ server/                 # API、数据库迁移、测试、运维脚本
│  ├─ src/
│  │  ├─ routes/           # Fastify 路由
│  │  ├─ services/         # 业务服务
│  │  ├─ db/migrations/    # 001/002/003 SQL
│  │  └─ scripts/          # backup/restore/db-check/admin
│  └─ test/                # Vitest
├─ web/                    # Vue 前端
├─ deploy/                 # systemd / Caddy / Cloudflare / fail2ban / ufw
├─ Dockerfile
├─ docker-compose.yml
├─ docs/DEPLOY.md          # 完整部署与上线清单
├─ docs/SECURITY.md        # 安全运维手册
├─ SECURITY.md             # 安全概览
└─ DELIVERY.md             # 交付范围与验证记录
```

## 本地开发

要求：Node 24、pnpm 11。

```bash
git clone https://github.com/bilibili-qindiebanran/PartBin.git
cd PartBin
pnpm install

# 初始化管理员；空库必须执行，首个注册者不会自动成为管理员
pnpm admin:create -- --username admin --password '<至少 12 位密码>'

pnpm dev
```

- 前端：http://127.0.0.1:5180
- API：http://127.0.0.1:8787
- 数据目录：`./data`（SQLite、照片、备份；已在 `.gitignore` 中）

`pnpm dev` 会同时启动 Vite 与 API；Vite 把 `/api`、`/health` 代理到 8787。

---

## 生产部署一：Docker Compose

适合快速部署与隔离运行。镜像以非 root 用户运行，根文件系统只读，仅 `/data` 与 `/tmp` 可写。

### 1. 准备环境变量

```bash
cp .env.example .env
```

编辑 `.env`，至少设置：

```ini
APP_SECRET=<openssl rand -base64 48>
PUBLIC_ORIGIN=https://partbin.example.com
COOKIE_SECURE=true
PARTBIN_DOMAIN=partbin.example.com
```

`APP_SECRET` 与 `PUBLIC_ORIGIN` 在生产环境必填；缺少时服务拒绝启动。`PARTBIN_DOMAIN` 仅 Caddy 容器使用。

### 2. 启动

```bash
docker compose build
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:8787/health
```

默认只发布到 `127.0.0.1:8787`，不会直接暴露公网。

### 3. 初始化管理员

```bash
docker compose exec partbin node --disable-warning=ExperimentalWarning \
  server/scripts/create-admin.js --username admin --password '<至少 12 位密码>'
```

Docker 中数据保存在命名卷 `partbin-data`。常用排查：

```bash
docker compose logs -f partbin
docker compose exec partbin ls -lh /data
```

### 4. HTTPS（三选一）

**A. 宿主机 Caddy（推荐简单场景）**

`/etc/caddy/Caddyfile`：

```caddy
partbin.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8787
}
```

```bash
sudo systemctl reload caddy
```

同时确保防火墙只开放 80/443，8787 不对公网放行。

**B. Caddy 容器（证书也在容器里）**

在 `.env` 设置 `PARTBIN_DOMAIN` 后：

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.caddy.yml up -d
```

Caddy 会占用 80/443，并反代到 Compose 内部的 `partbin:8787`。

**C. Cloudflare Tunnel（无需公网入站）**

在 `.env` 设置 `TUNNEL_TOKEN`，并在 Cloudflare Zero Trust 配置域名指向该 Tunnel：

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.cloudflared.yml up -d
```

若使用 Tunnel，可删除 `docker-compose.yml` 中 `partbin` 的 `ports`，让源站完全不可直连。

### 5. 备份与恢复（Docker）

```bash
# 加密备份写入容器内 /data/backups
docker compose exec -e BACKUP_PASSPHRASE='<离线密码>' partbin \
  node --disable-warning=ExperimentalWarning server/scripts/backup.js

# 复制到宿主机保存
docker compose cp partbin:/data/backups ./backups

# 验证备份（临时目录恢复 + db:check）
BACKUP_PASSPHRASE='<离线密码>' pnpm backup:verify -- --file ./backups/partbin-xxx.db.pbk

# 恢复：先停服务
docker compose stop partbin
docker compose run --rm -e BACKUP_PASSPHRASE='<离线密码>' partbin \
  node --disable-warning=ExperimentalWarning server/scripts/restore.js \
  --file /data/backups/partbin-xxx.db.pbk
docker compose start partbin
```

照片目录与备份目录都应在异地用 restic 等工具再做加密快照；本地 `.pbk` 只是数据库快照。

---

## 生产部署二：systemd + Caddy

适合裸机、长期运行、希望直接用系统 journald/定时器的场景。

### 1. 系统用户与目录

```bash
sudo useradd --system --home /var/lib/partbin --shell /usr/sbin/nologin partbin
sudo install -d -o partbin -g partbin -m 700 /var/lib/partbin /etc/partbin
sudo install -d -o partbin -g partbin /opt/partbin
```

安装 Node 24 与 pnpm 11 后，将仓库放到 `/opt/partbin`：

```bash
sudo -u partbin git clone https://github.com/bilibili-qindiebanran/PartBin.git /opt/partbin
sudo -u partbin bash -lc 'cd /opt/partbin && pnpm install --frozen-lockfile && pnpm build'
```

### 2. 环境文件

```bash
sudo -u partbin cp /opt/partbin/.env.example /etc/partbin/partbin.env
sudo chmod 600 /etc/partbin/partbin.env
sudo -u partbin vi /etc/partbin/partbin.env
```

至少：

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
DATA_DIR=/var/lib/partbin
APP_SECRET=<openssl rand -base64 48>
PUBLIC_ORIGIN=https://partbin.example.com
COOKIE_SECURE=true
BACKUP_PASSPHRASE=<离线密码>
```

### 3. 初始化管理员

```bash
sudo -u partbin bash -c 'set -a; . /etc/partbin/partbin.env; set +a; cd /opt/partbin && node --disable-warning=ExperimentalWarning server/scripts/create-admin.js --username admin --password "<至少 12 位密码>"'
```

### 4. systemd 服务

```bash
sudo cp /opt/partbin/deploy/systemd/partbin.service /etc/systemd/system/
sudo cp /opt/partbin/deploy/systemd/partbin-backup.service /etc/systemd/system/
sudo cp /opt/partbin/deploy/systemd/partbin-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now partbin
sudo systemctl enable --now partbin-backup.timer
curl -fsS http://127.0.0.1:8787/health
```

单元使用 `ProtectSystem=strict`、`ProtectHome`、`NoNewPrivileges`、空 `CapabilityBoundingSet`、`SystemCallFilter=@system-service`，只允许写 `/var/lib/partbin`。

### 5. Caddy 与防火墙

```bash
sudo cp /opt/partbin/deploy/caddy/Caddyfile /etc/caddy/Caddyfile
# 在 Caddy 环境中设置 PARTBIN_DOMAIN，或把 Caddyfile 中的变量替换成真实域名
sudo systemctl reload caddy
```

```bash
sudo bash /opt/partbin/deploy/ufw.sh
sudo cp /opt/partbin/deploy/fail2ban/partbin.conf /etc/fail2ban/filter.d/
sudo cp /opt/partbin/deploy/fail2ban/jail.local /etc/fail2ban/jail.d/partbin.local
sudo systemctl restart fail2ban
sudo fail2ban-client status partbin
```

### 6. 备份

`partbin-backup.timer` 每天 03:20 执行加密备份。手动执行：

```bash
sudo -u partbin bash -c 'set -a; . /etc/partbin/partbin.env; set +a; cd /opt/partbin && pnpm backup'
sudo -u partbin bash -c 'set -a; . /etc/partbin/partbin.env; set +a; cd /opt/partbin && pnpm db:check'
```

恢复时先 `systemctl stop partbin`，再执行 `pnpm restore -- --file ...`，最后 `pnpm db:check` 并启动服务。完整步骤见 [docs/DEPLOY.md](docs/DEPLOY.md)。

---

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | 生产 | `production` 时强制校验密钥并默认安全 Cookie |
| `HOST` / `PORT` | 否 | 默认 `127.0.0.1:8787`；容器内为 `0.0.0.0:8787` |
| `DATA_DIR` | 否 | 数据目录，默认 `./data`；生产建议 `/var/lib/partbin` |
| `APP_SECRET` | 生产 | TOTP 加密、IP 哈希；至少 32 字节随机值 |
| `PUBLIC_ORIGIN` | 生产 | 公开站点地址，必须与访问域名一致 |
| `COOKIE_SECURE` | 生产 | HTTPS 下为 `true`；启用 `__Host-` Cookie |
| `SESSION_DAYS` | 否 | 空闲会话天数，默认 7 |
| `SESSION_ABSOLUTE_DAYS` | 否 | 绝对会话天数，默认 30 |
| `TRUST_PROXY` | 否 | 前置反向代理时开启；优先用 `TRUSTED_PROXIES` |
| `TRUSTED_PROXIES` | 否 | 逗号分隔的受信代理 IP/CIDR |
| `APP_TZ` | 否 | 统计时区，默认 `Asia/Shanghai` |
| `HSTS_MAX_AGE` | 否 | HSTS max-age，默认 86400 |
| `BACKUP_PASSPHRASE` | 备份时 | 加密备份密码，至少 12 位；与 APP_SECRET 分开 |
| `PARTBIN_DOMAIN` | Caddy 容器 | 证书域名，仅 Compose Caddy 使用 |

## 初始化后：邀请与双因素

1. 管理员登录后进入「设置 → 注册策略」，默认 `invite`；可改 `closed` / `open`。
2. 「设置 → 邀请码」生成邀请码，发给成员；邀请码只显示一次。
3. 成员打开 `/login`，切到「注册」，填写邀请码。
4. 管理员建议立即启用「账号安全 → 动态验证码」，并离线保存恢复码。
5. 敏感操作（邀请码、成员角色、注册策略、TOTP）会要求再次输入密码，10 分钟内有效。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | Vite 5180 + API 8787 |
| `pnpm build` | 构建前端到 `web/dist` |
| `pnpm start` | 单端口生产模式 8787 |
| `pnpm test` | 服务端测试 |
| `pnpm admin:create` | 初始化管理员 |
| `pnpm backup` | 加密数据库备份 |
| `pnpm backup:verify -- --file ...` | 恢复演练 |
| `pnpm restore -- --file ...` | 离线恢复 |
| `pnpm db:check` | 数据完整性检查 |
| `pnpm db:reconcile -- --fix` | 按流水重算数量 |
| `pnpm security:check` | 部署配置体检 |
| `pnpm seed:demo -- --yes` | 写入演示数据 |
| `pnpm privacy:check` | 提交前隐私扫描 |

## 升级

```bash
# 先备份
pnpm backup

# Docker
git pull --ff-only
docker compose build
docker compose up -d

# systemd
sudo systemctl stop partbin
sudo -u partbin git -C /opt/partbin pull --ff-only
sudo -u partbin bash -lc 'cd /opt/partbin && pnpm install --frozen-lockfile && pnpm build'
sudo systemctl start partbin
curl -fsS http://127.0.0.1:8787/health
```

迁移在启动时自动执行；失败会拒绝启动。升级前务必先备份，详见 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 安全与交付状态

- 默认邀请制注册，无默认口令；管理员只能通过 CLI 创建
- 12 位起密码策略、持久化登录锁定、TOTP、恢复码、会话双过期
- 写请求 Origin / `Sec-Fetch-Site` 校验，CSP/HSTS/COOP，审计日志
- 生产环境必须 HTTPS；8787 不得直接暴露公网

当前软件与部署包已交付，公网验收项（SSL Labs、真实域名 TLS、监控告警、真实恢复演练等）为**预留项**，需在目标服务器执行 [docs/DEPLOY.md](docs/DEPLOY.md) 第 9 节清单。详见 [DELIVERY.md](DELIVERY.md)、[SECURITY.md](SECURITY.md)、[docs/SECURITY.md](docs/SECURITY.md)。

## 文档

- [DELIVERY.md](DELIVERY.md)：交付范围、验证记录、预留项
- [docs/DEPLOY.md](docs/DEPLOY.md)：完整部署、备份恢复、上线清单
- [docs/SECURITY.md](docs/SECURITY.md)：安全运维与事件响应
- [PLAN.md](PLAN.md)：设计、数据模型与里程碑
