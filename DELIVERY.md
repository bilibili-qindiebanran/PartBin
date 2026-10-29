# PartBin 交付说明

- 交付日期：2026-10-30
- 交付状态：**软件功能与部署包完成；公网验收项按约定预留，未在真实公网执行**
- 生产建议：先在目标服务器按 [docs/DEPLOY.md](docs/DEPLOY.md) 完成第 9 节清单，再对外公布

## 1. 交付范围

| 范围 | 状态 |
| --- | --- |
| 库存主数据、分类/位置树、搜索、低库存 | 已交付 |
| 出入库、盘点、报废、丢失、流水台账 | 已交付 |
| 实例、借出、部分归还、逾期、撤销 | 已交付 |
| 照片上传、相册、CSV 导入/导出 | 已交付 |
| 邀请制注册、TOTP、持久化锁定、审计、安全响应头 | 已交付 |
| 加密备份、恢复演练、`db:check`、健康检查、优雅关闭 | 已交付 |
| Docker / Compose / systemd / Caddy / Cloudflare / fail2ban 配置 | 已交付（本地验证） |
| 公网 TLS、端口扫描、SSL Labs、真实监控告警、真实恢复演练 | **预留，未执行** |

## 2. 验证记录

- `pnpm test`：14 个测试文件、**75 passed**
- `pnpm build`：通过，路由按页拆包
- `pnpm audit --prod`：**No known vulnerabilities found**
- `pnpm privacy:check`：通过（140 个文件）
- `db:check`：演示数据与恢复演练均为 `ok: true`
- 加密备份：生成、错误密码拒绝、临时目录恢复、恢复后检查均通过
- Docker：镜像构建成功；只读根文件系统、非 root、cap_drop ALL 的容器启动成功，`/health` 200，管理员 CLI 与登录成功
- Docker Compose：配置校验通过；实际启动、健康检查、创建管理员、清理卷均成功
- Caddy 配置：`caddy validate` 通过
- 移动端：Chrome 430×932 实测设置页与仪表盘 `scrollWidth = 430`，无横向溢出

## 3. 公网预留项（必须在目标服务器执行）

以下项目代码/脚本/文档已准备，但本次未执行，不能宣称已通过：

- 域名解析、真实证书签发/续期、HTTP→HTTPS、HSTS
- SSL Labs A/A+
- 公网 8787 不可达、ufw 生效、fail2ban 实际封禁
- Cloudflare Tunnel 或 Caddy 在真实域名下工作
- 管理员在目标环境启用 TOTP 并离线保存恢复码
- 监控（宕机、证书、磁盘、备份）实际触发一次
- 目标机加密备份与异地 restic、恢复演练
- SSH 禁密码/root、unattended-upgrades
- 完整 12.10 清单与应急演练

执行命令见 [docs/DEPLOY.md](docs/DEPLOY.md) 第 9 节；完成后把 `cyan-dev` 合并到 `main` 并补打 `m8`（若本次 tag 仅代表交付预留）。

## 4. 部署入口

- Docker：`docker compose up -d`，初始化管理员见 [docs/DEPLOY.md](docs/DEPLOY.md)
- 裸机：`deploy/systemd/partbin.service` + Caddy
- 安全运维：[docs/SECURITY.md](docs/SECURITY.md)
- 配置模板：[.env.example](.env.example)

## 5. 数据与安全

- 不包含任何真实 `data/`、数据库、上传照片、`.env` 或密钥；
- 管理员必须通过 `pnpm admin:create` 创建；
- 备份密码与 `APP_SECRET` 分开、离线保管；
- 公网验收项完成前，不要放行 8787 或对外公布地址。
