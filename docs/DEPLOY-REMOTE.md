# 远端部署（用户态 systemd，无需 root）

适用于没有 root、只有普通账号的内网/虚拟机（下文用 `<host>` 代表 `~/.ssh/config` 里的 Host 别名）。
与 [DEPLOY.md](DEPLOY.md) 的裸机/systemd 方案等价，但**全部运行在用户空间**：Node、pnpm、服务单元都在 `$HOME` 下。

> 真实主机名、内网域名与代理地址请写在 **`deploy/deploy.local.env`**（已加入 `.gitignore`，不会入库）：
>
> ```ini
> PARTBIN_SSH_HOST=your-host
> PARTBIN_PUBLIC_ORIGIN=https://partbin.example.internal
> PARTBIN_TRUSTED_PROXIES=10.0.0.80
> ```
>
> 脚本会在解析参数前自动读取该文件（存在才读）。下文示例中的 `<host>` 也可直接换成别名。

## 1. 布局

```
~/partbin/
├── app -> releases/20261031T125103Z     代码软链（切换=发布，切回=回滚）
├── releases/<UTC 时间戳>/               每次部署一个新目录，含 node_modules 与 web/dist
├── data/                                DATA_DIR：inventory.db / uploads / backups
├── env                                  运行配置（600），密钥生成后不再改写
├── node/  tools/  store/               Node 运行时、pnpm、pnpm 共享存储
└── releases/<ts>/VERSION                git 短哈希 + 构建时间
```

**数据不进代码目录**：`DATA_DIR=~/partbin/data`，每次部署只新建 `releases/<ts>` 并切换软链，
`data/`、`env` 从创建起就不再被写入。迁移由 `server/src/db/migrate.js` 在启动时自动执行
（版本记录在 `schema_migration`，已应用即跳过，单个迁移失败会回滚并拒绝启动）。

## 2. 首次部署

远端只要有一个普通账号和 SSH 即可（Debian 13 实测）：本脚本会自动下载 Node（npmmirror）、
安装 pnpm、写入单元、构建前端、导入本地数据。

```bash
# 本机执行
./deploy/remote-deploy.sh
```

首次运行会：

1. 建 `~/partbin/{releases,data,logs,tools,store}`（700）；
2. 安装 Node `v24.22.2` 与 pnpm `11.28.5` 到 `~/partbin/node`、`~/partbin/tools`；
3. 生成 `~/partbin/env`（含 `APP_SECRET` 与 `BACKUP_PASSPHRASE`，**只生成一次**）；
4. 打包仓库（排除 `data/`、`node_modules`、`web/dist`、`.env`）上传并构建；
5. 远端无 `data/inventory.db` 时，用 `VACUUM INTO` 快照本地库并连同 `uploads/` 导入；
6. 切换软链、启动服务、`/health` 与 `db:check` 通过后清理旧版本。

### 必须手动做一次：开启 linger

用户态服务默认随登录会话存活，**退出登录会被回收，也不会开机自启**：

```bash
ssh <host> 'sudo loginctl enable-linger "$(id -un)"'
ssh <host> 'loginctl show-user "$(id -un)" | grep Linger'   # 期望 Linger=yes
```

这一步需要 root 密码，只能由本人执行。未开启时服务在本次登录期间可用，重启后需要手动
`systemctl --user start partbin`。

### 备份密码

`BACKUP_PASSPHRASE` 写在 `~/partbin/env`（600）。**请立刻抄到离线位置**：

```bash
ssh <host> 'cat ~/partbin/env'
```

丢失后所有 `.pbk` 备份都无法恢复。`APP_SECRET` 同样不可改（改了 TOTP 密钥全部失效）。

## 3. 日常更新

```bash
./deploy/remote-deploy.sh
```

脚本是幂等的，每次都会：停服 → 新建 release → 构建 → **迁移前加密备份** → 切软链 →
启动 → `/health` → `db:check` → 保留最近 3 个 release。

- 备份失败会**回退软链并中止**，不会带着旧库直接升版本；
- 健康检查失败会打印最近日志并提示回滚；
- 旧 release 自动删除，`data/` 与 `env` 全程不动。

## 4. 回滚与排查

```bash
./deploy/remote-deploy.sh --status    # 版本、数据体积、服务/定时器状态、健康
./deploy/remote-deploy.sh --logs      # journalctl --user -u partbin -n 80
./deploy/remote-deploy.sh --rollback  # 切回上一个 release 并验证健康
```

回滚只换代码，不回滚数据库（迁移只向前）。需要回滚数据时停服后按
[DEPLOY.md](DEPLOY.md) 第 6 节用 `pnpm restore` 恢复备份。

## 5. 备份

`partbin-backup.timer`（用户态）每日 03:20 执行 `server/scripts/backup.js`，产物在
`~/partbin/data/backups/partbin-<时间戳>.db.pbk`，保留 `BACKUP_KEEP` 份。每次部署也会额外备份一次。

```bash
ssh <host> 'systemctl --user start partbin-backup.service'   # 手动备份
ssh <host> 'systemctl --user list-timers partbin-backup.timer'
```

异地加密仍用 restic 对 `~/partbin/data` 做快照（见 [SECURITY.md](SECURITY.md)）。

## 6. 访问与安全边界

- 默认 `HOST=0.0.0.0`、`PORT=8787`、`PUBLIC_ORIGIN=https://partbin.example.internal`，经内网 nginx 反代提供 HTTPS。
- 直接访问 8787 是 plain HTTP，因此首次生成 env 时 `COOKIE_SECURE=false`（无 `__Host-` 前缀、不下发 HSTS）。

### 6.1 放在内网 nginx 反向代理之后（推荐）

若已有内网 nginx（例如 PVE 上的 LXC），按现有 `*.internal` 站点格式追加一个 server 块：

```nginx
server {
        listen 80;
        server_name partbin.example.internal;
        return 301 https://$host$request_uri;
}

server {
        listen 443 ssl;
        server_name partbin.example.internal;

        ssl_certificate /etc/nginx/ssl/fullchain.crt;   # 需 SAN 覆盖该域名
        ssl_certificate_key /etc/nginx/ssl/server.key;
        ssl_protocols TLSv1.2 TLSv1.3;

        charset utf-8;
        client_max_body_size 20m;   # 应用侧 multipart 上限 8MB

        location / {
                proxy_pass http://<PartBin 主机 IP>:8787;
                proxy_http_version 1.1;
                proxy_set_header Host $host;                          # 必须，Origin 校验依赖它
                proxy_set_header X-Real-IP $remote_addr;
                proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                proxy_set_header X-Forwarded-Proto $scheme;
        }
}
```

三条关键点：

1. `proxy_set_header Host $host`：应用用 `Origin` 与 `Host` 比对防 CSRF，改写成 `127.0.0.1` 会让写请求全部 403。
2. `X-Forwarded-For` + `TRUSTED_PROXIES=<nginx IP>`：否则所有客户端 IP 都记为代理地址，审计与限速失真。
3. DNS 也要指向 nginx：内网 DNS（如 AdGuard Home）若逐条枚举 `.internal`，需补一条
   `partbin.example.internal -> <nginx IP>`；AdGuard **不会热加载** YAML，改完要重启该容器。

改完后同步后端配置：

```bash
./deploy/remote-deploy.sh --sync-env \
  --public-origin https://partbin.example.internal --cookie-secure true
# 或直接改 ~/partbin/env 里的 PUBLIC_ORIGIN / COOKIE_SECURE / TRUSTED_PROXIES，
# 再 systemctl --user restart partbin
```

> 把 `COOKIE_SECURE` 改成 `true` 后，会话 Cookie 变成带 `Secure` 的 `__Host-partbin_sid`，
> **再通过 `http://<IP>:8787` 登录会静默失败**（浏览器不保存 Secure Cookie）。确认只走 HTTPS 再切。

### 6.2 对外提供服务

内网以外不要直接开放 8787。要公网访问，按 [DEPLOY.md](DEPLOY.md) 加 Caddy/Tunnel，
并把 `PUBLIC_ORIGIN` 改成 `https://...`、`COOKIE_SECURE` 改成 `true`。
本方案不满足 `PLAN.md` 12.10 的公网上线门槛，因此**不要**把它当公网部署使用。

## 7. 可覆盖参数

| 变量 | 默认 | 说明 |
|---|---|---|
| `PARTBIN_SSH_HOST` | `partbin-host` | `~/.ssh/config` 中的 Host 别名 |
| `PARTBIN_NODE_VERSION` | `v24.22.2` | 远端 Node 版本（npmmirror 镜像） |
| `PARTBIN_REGISTRY` | `https://registry.npmmirror.com` | npm 源 |
| `PARTBIN_BIND_HOST` | `0.0.0.0` | 首次生成 env 时写入 |
| `PARTBIN_PORT` | `8787` | 同上 |
| `PARTBIN_PUBLIC_ORIGIN` | `https://partbin.example.internal` | 首次生成与 `--sync-env` 时写入 |
| `PARTBIN_COOKIE_SECURE` | 不改动 | 配合 `--sync-env` 写入 `true`/`false` |
| `PARTBIN_TRUSTED_PROXIES` | 不改动 | 配合 `--sync-env` 写入代理地址 |
| `PARTBIN_KEEP_RELEASES` | `3` | 保留的历史版本数 |

## 8. 已知限制

- 回滚不覆盖数据库迁移（SQLite 迁移无 down）。
- 无 root 故无法写 `/etc`、无法配 ufw/fail2ban/系统级 journald；日志用 `journalctl --user`。
- pnpm 共享存储与 release 在同一磁盘，硬链接生效；磁盘规划时给 `~/partbin/store` 留余量。
