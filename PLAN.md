# PartBin · 硬件出入库系统 —— 设计方案与实施计划

> 版本：v1.4　·　日期：2026-10-30　·　状态：M1 已实现；v1.3 公网安全升级待评审
>
> 变更：v1.1 增补「界面设计」；v1.2 更名为 PartBin；v1.3 定位由局域网升级为**可公网部署**；v1.4 增加 Git 提交与隐私检查规则（15.3 / `AGENTS.md`）。
>
> ⚠️ **在 M6（公网安全加固）与 M8（公网部署交付）完成前，当前代码只能在内网使用，不得直接暴露公网。**
>
> 目标读者：项目实现者与后续维护者。本文档即是实现依据，代码阶段不再做设计决策。

---

## 目录

1. [项目概述](#1-项目概述)
2. [范围与非目标](#2-范围与非目标)
3. [技术选型与架构决策](#3-技术选型与架构决策)
4. [运行架构与部署拓扑](#4-运行架构与部署拓扑)
5. [账号体系与权限](#5-账号体系与权限)
6. [数据模型](#6-数据模型)
7. [接口设计](#7-接口设计)
8. [界面设计](#8-界面设计)
9. [关键流程](#9-关键流程)
10. [实现约定](#10-实现约定)
11. [非功能需求](#11-非功能需求)
12. [安全设计](#12-安全设计)
13. [测试策略](#13-测试策略)
14. [部署与运维](#14-部署与运维)
15. [里程碑与验收](#15-里程碑与验收)
16. [风险与假设](#16-风险与假设)
17. [附录](#17-附录)

---

## 1. 项目概述

### 1.1 背景

嵌入式工程师/学生手里会持续积累开发板、模块、传感器、被动元件、工具和线材。购买新硬件前常出现三个问题：

- 不记得**有没有**同型号，重复购买；
- 不记得**还有几个**，买少了或者买多了；
- 不记得**放在哪个盒子**，翻箱倒柜。

同时，同学之间互相借板子、借工具后容易「东西去哪了」说不清。

系统最初按局域网自用设计。升级为公网部署后，威胁模型从「可信网络内的误操作」变为「互联网上的自动化扫描、撞库、暴力破解、供应链与配置错误」，因此账号、会话、注册、限速、审计、备份与主机加固都需要按公网标准重新设计。M1 已实现的账号功能将在 M6 被加固版本替换，详见第 12 章。

### 1.2 目标

**PartBin**（名称：PartBin · 硬件出入库系统）是一个自托管、**可公网部署**的 Web 硬件出入库系统，使用 SQLite 存储，手机与电脑浏览器即可使用：

- 记录物料、数量、位置路径、照片；
- 每次数量变化都留可追溯的出入库流水，并记录操作人；
- 支持借出与部分归还；
- 低库存自动提醒，直接服务于「买之前先核实」；
- 多账号：管理员维护库存，受邀用户只读查询；
- 公网安全：默认关闭注册、邀请制开户、管理员两步验证、持久化登录限速与自动封禁、全站 HTTPS + HSTS、加密异地备份；
- 数据有每日备份，升级、重启、迁移都不丢数据；
- 同一套代码既能通过公网域名访问，也能在局域网内使用。

### 1.3 成功标准

| 维度 | 标准 |
|---|---|
| 核心场景 | 手机上搜 `STM32`，3 秒内看到「拥有量、可用量、位置路径、借出人」 |
| 录入效率 | 拆快递后 10 秒内完成一次入库（名称、数量、位置，可选照片） |
| 可追溯 | 任意物料的数量变化 100% 可由流水解释，每条流水有操作人与操作后余额 |
| 权限 | 普通账号无法通过 UI 或接口修改任何库存数据 |
| 性能 | 1000 物料 + 5 万流水时，列表查询 < 100ms，首屏 < 1s |
| 可用性 | 375px 宽度可完成查询、入库、借还、传图全部核心操作 |
| 数据安全 | 每日本地快照 + restic 加密异地备份；可从备份按文档恢复；升级不丢数据 |
| 公网安全 | 默认无开放注册；登录失败持久化限速与自动封禁；管理员可启用两步验证；全站 HTTPS（SSL Labs A 级）与 HSTS；CSP 与安全响应头齐全；备份加密且异地 |
| 公网可用性 | 月可用性目标 99.5%；备份 RPO ≤ 24h、RTO ≤ 1h；监控覆盖证书到期、磁盘空间与备份结果 |

---

## 2. 范围与非目标

### 2.1 MVP 范围

- 账号：邀请制注册（默认）、登录、退出、改密、两步验证（TOTP + 恢复码）、会话管理；首个管理员通过服务器 CLI 初始化；管理员可改角色、禁用、重置密码、生成邀请码。
- 库存：物料数量制 + 可选实例制；分类树；位置树（柜/层/盒）。
- 业务：入库、出库、盘点调整、报废、丢失；借出、部分归还、撤销借出。
- 展示：仪表盘、库存列表与详情、流水台账、借出管理、照片相册、安全设置与审计日志。
- 数据：CSV 导入（预览 + 确认）与导出；低库存提醒；加密备份与恢复演练。
- 部署：Debian/Ubuntu x86_64 公网服务器（或 Cloudflare Tunnel），systemd 与 Docker Compose 两种方式，Caddy 申请真实证书，ufw + fail2ban 防护。

### 2.2 非目标（本期不做）

| 不做 | 说明 |
|---|---|
| 邮箱/手机验证、自助找回密码 | 不收集邮箱；忘记密码由管理员重置或服务器 CLI 重置。公网场景下这是有意的取舍 |
| 第三方登录（OAuth/LDAP） | 个人/小团队自托管场景不需要 |
| 细粒度自定义权限、操作审批流 | 仅 admin / user 两角色 |
| 每个账号独立库存 | 采用共享库存 + 操作人审计 |
| 条码/二维码打印与扫码 | 已预留 `item.code`、`item_instance.asset_no`，后续加不用改表 |
| 价格统计、资产折旧、采购单/BOM | 保留 `price_cents` 字段，但不做金额看板 |
| 多仓库/多租户、PWA 离线 | — |
| 自建 DDoS 清洗、WAF、验证码平台 | 依赖 Cloudflare / 主机商的上游防护；应用内只做限速、封禁与体积限制 |
| 邮件、短信通知 | 不集成 SMTP；告警交给服务器监控工具 |
| 等保 / GDPR 等合规认证 | 只做最小化数据收集、保留期与访问控制，不申请认证 |

---

## 3. 技术选型与架构决策

### 3.1 技术栈

| 层 | 选型 | 版本/说明 |
|---|---|---|
| 运行时 | Node.js | 开发机 v24.14.0；服务器装 Node 24 LTS；Docker 用 `node:24-bookworm-slim` |
| 包管理 | pnpm workspace | 开发机 pnpm 11.28.5；服务器 `npm i -g pnpm@11` |
| 后端框架 | Fastify | v5，ESM JavaScript + JSDoc 类型注释 |
| 数据库 | SQLite | 通过 Node 内置 `node:sqlite`（内置 SQLite 3.51.2，启用 FTS5） |
| 前端 | Vue 3 + Vite + Element Plus | Vue 3.5 / Vite 7 / Element Plus 2.x，Pinia 仅存登录态与字典缓存 |
| 反向代理 | Caddy 2 | 自动申请/续期真实证书（Let's Encrypt / ZeroSSL），HTTP→HTTPS 跳转与 HSTS；可选 Cloudflare Tunnel 隐藏源站 |
| 部署 | systemd（主）/ Docker Compose（备） | ufw、fail2ban、restic 加密备份；两套配置随仓库交付 |
| 安全组件 | `node:crypto` 内置 | scrypt 密码哈希、TOTP、AES-256-GCM 加密、HMAC 哈希 IP；不引第三方加密库；内置弱口令字典 |
| 安全相关依赖 | `qrcode`（前端）、`image-size`（服务端） | 均为纯 JS、无原生编译：前者渲染 2FA 二维码，后者校验图片尺寸、防解压炸弹 |
| 测试 | Vitest | 配合 Fastify `app.inject()`，不需要真实端口 |

### 3.2 架构决策记录（ADR）

| # | 决策 | 理由 | 放弃的方案 |
|---|---|---|---|
| D1 | SQLite 单文件 + 单进程 | 数据量小（万级物料、十万级流水）、零运维、备份就是一个文件 | MySQL/PostgreSQL：装库、建用户、备份都变复杂 |
| D2 | 使用内置 `node:sqlite` | 无原生编译，服务器不需要 gcc；Node 升级不会因 ABI 重编译炸掉；本机已实测 API 足够 | `better-sqlite3`：成熟但属原生模块，Node 大版本升级易失败；Drizzle/Prisma：为这点表引入代码生成不值 |
| D3 | 数量 = 缓存字段，事实来源为流水 | 列表筛选/排序需要快；流水提供审计；两者矛盾时由 `db:check` 与 `db:reconcile` 修复 | 完全实时聚合：查询更绕；完全只存数量：无法审计 |
| D4 | 借出不扣拥有量，单独建 `loan` | 「我拥有 3 块，借出去 1 块，手上 2 块」语义清晰，避免把人不在手误判为没有 | 借出记出库：归还逻辑会与消耗混淆 |
| D5 | 实例制为可选模式 | 电阻按数量、开发板按个体，两种都要；实例又按数量制记流水会重复计数 | 全实例制：录耗材太痛苦；全数量制：分不清同型号板子 |
| D6 | 共享库存 + admin 写 / user 只读 | 同学能查，只有管理员改，避免误操作 | 每账号独立库存：分类/位置/统计都要按人隔离，复杂度大增 |
| D7 | 默认**关闭注册 + 邀请码**；首个管理员由服务器 CLI 初始化 | 公网暴露下开放注册会被扫描与滥用；邀请码保留「同学自助开户」的便利 | 开放注册 + 首人管理员：仅适合内网，v1.3 起废弃 |
| D8 | 后端 JS + JSDoc，不上 TypeScript | 降低个人项目维护成本；接口契约由本文档与 `lib/validate.js` 固定 | TS 全栈：类型收益有限、构建链更重 |
| D9 | Caddy 做 TLS | 自动化申请与续期真实证书、HTTP/3、配置短；HSTS 可集中设置 | Nginx + certbot：配置与续期更繁琐 |
| D10 | 单端口生产模式（Fastify 托管 SPA + API） | 部署简单，无跨域；dev 用 Vite 代理 | 前端独立 Nginx：多一个部署面 |
| D11 | 应用仅监听 `127.0.0.1`，公网入口交给 Caddy / Cloudflare Tunnel | 缩小暴露面；TLS、超时、请求体限制在边缘处理 | 直接对公网监听 8787：任何代理配置错误都会裸奔 |
| D12 | 不收集邮箱、不做自助找回；邀请码 + 管理员/CLI 重置 | 去掉 SMTP 依赖与邮件泄露面；代价是用户需联系管理员 | 邮件找回：需要 SMTP、发信信誉与额外信息收集 |
| D13 | 登录限速、封禁与审计持久化到 SQLite | 进程重启不清零，可被 fail2ban / 监控消费 | 内存滑窗：重启即绕过，公网不可接受 |
| D14 | 管理员 TOTP 两步验证（推荐开启），恢复码一次性 | 密码泄露时仍有一道门；不引第三方 | 强制所有用户 2FA：对只读同学门槛过高；短信/邮件 OTP：要外部服务 |

### 3.3 仓库形态

pnpm workspace + 部署产物：

```
PartBin/
├─ package.json  pnpm-workspace.yaml  pnpm-lock.yaml
├─ .env.example  .gitignore  README.md  PLAN.md
├─ server/            @partbin/server：Fastify + SQLite + 静态资源
├─ web/               @partbin/web：Vue 3 SPA（构建产物 web/dist）
├─ Dockerfile
├─ deploy/
│  ├─ env.example                     # systemd 环境变量模板（公网）
│  ├─ partbin.service                 # systemd 主服务
│  ├─ partbin-backup.service / .timer
│  ├─ docker-compose.yml
│  ├─ compose.env.example
│  ├─ Caddyfile.example               # 真实证书 + HSTS + 安全头
│  └─ fail2ban/                       # jail.local 与过滤规则模板
├─ docs/DEPLOY.md     # 安装、HTTPS、备份、恢复、升级手册
└─ data/              # 仅开发本地数据，gitignore
```

根 `package.json` 提供统一脚本（见附录 A）。

---

## 4. 运行架构与部署拓扑

### 4.1 公网拓扑

```
 Internet / 手机 / 笔记本
        │ HTTPS 443（或 Cloudflare Tunnel，无入站端口）
        ▼
 ┌───────────────────────────┐
 │ Caddy（真实证书 · HSTS）   │   可选：Cloudflare 代理 / Tunnel
 │ 超时 · 请求体上限 · 访问日志│
 └─────────────┬─────────────┘
               │ HTTP 127.0.0.1:8787
               ▼
 ┌───────────────────────────┐
 │ Fastify（partbin 用户）    │   SPA + /api
 └─────────────┬─────────────┘
               │ node:sqlite
               ▼
 /var/lib/partbin/
   ├─ inventory.db (+ -wal/-shm)
   ├─ uploads/YYYYMM/*.jpg
   └─ backups/            # 本地快照；异地加密备份由 restic 负责
```

- 域名 `partbin.example.com` 的 A/AAAA 指向服务器（或用 DNS-01 验证）；证书由 Caddy 自动申请与续期。
- Fastify **只监听 `127.0.0.1:8787`**；公网仅开放 443，80 只用于 HTTP→HTTPS 跳转与 ACME。
- 推荐家庭/实验室服务器使用 **Cloudflare Tunnel**：无需公网 IP 与入站端口，源站不可直连；`TRUSTED_PROXIES` 只能填 Cloudflare 回源网段。
- 直接公网 IP 方案：ufw 默认拒绝入站，仅放行 443 与受限来源的 SSH；fail2ban 监控 Caddy 与应用日志。
- `PUBLIC_ORIGIN` 固定为 `https://partbin.example.com`，用于 Origin 校验、Cookie 与跳转白名单。
- HSTS、CSP、COOP/CORP、Permissions-Policy 由应用下发，HSTS 同时在 Caddy 兜底。
- 公网入口与后端同机或同 compose 网络；任何情况下不要把 8787 发布到公网。

### 4.2 目录与用户

| 路径 | 用途 | 权限 |
|---|---|---|
| `/opt/partbin` | 应用代码与依赖（`web/dist` 产物） | `partbin:partbin` |
| `/var/lib/partbin` | 数据根目录（env `DATA_DIR`） | `partbin:partbin`，0700 |
| `/var/lib/partbin/inventory.db` | SQLite 主库 | 同上 |
| `/var/lib/partbin/uploads/` | 照片 | 同上 |
| `/var/lib/partbin/backups/` | 本地备份快照 | 同上 |
| `/etc/partbin/env` | 环境变量（含 `APP_SECRET`、restic 密码路径） | `root:partbin`，0600 |

专用系统用户 `partbin`（`--system --shell /usr/sbin/nologin`）。systemd 单元在基础项之外再启用 `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`、`CapabilityBoundingSet=`、`SystemCallFilter=@system-service`、`UMask=0077`，并把 `/var/lib/partbin` 加入 `ReadWritePaths`。数据目录不得位于 web 根目录或 NFS/SMB 挂载点。

### 4.3 Docker 拓扑

```
compose 网络
  partbin     (node:24-bookworm-slim, 非 root, /data 命名卷, healthcheck)
  caddy       (caddy:2-alpine, 443/80, 真实证书, 反代 partbin:8787)
  cloudflared (可选：无入站端口方案)
```

- 镜像多阶段构建：`build` 阶段装全量依赖并构建前端；`runtime` 阶段只装生产依赖 + 复制 `web/dist`。
- 运行用户 `node`；镜像内预建 `/data` 并 chown，命名卷首次挂载继承权限（bind mount 需手工 chown，文档说明）。
- 硬化：`read_only: true` + `tmpfs: /tmp`、`cap_drop: [ALL]`、`security_opt: [no-new-privileges:true]`、不发布 8787、环境文件 0600、生产镜像按 digest 固定。
- 无外网服务器：开发机 `docker buildx build --platform linux/amd64 -t partbin:x.y .` → `docker save | ssh server docker load`。

### 4.4 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 监听地址；Docker 内为 `0.0.0.0` |
| `PORT` | `8787` | 监听端口，不对外发布 |
| `DATA_DIR` | `./data` | 数据根目录；服务器为 `/var/lib/partbin`，Docker 为 `/data` |
| `PUBLIC_ORIGIN` | 无 | **公网必填**，如 `https://partbin.example.com`；用于 Origin 校验、绝对链接与跳转白名单 |
| `SESSION_IDLE_DAYS` | `7` | 空闲多久失效 |
| `SESSION_ABSOLUTE_DAYS` | `30` | 会话最长寿命，无法滑动续期突破 |
| `COOKIE_SECURE` | `true` | 生产必须 true；本地纯 HTTP 调试设 false（此时 Cookie 不带 `__Host-` 前缀） |
| `TRUSTED_PROXIES` | `127.0.0.1/32,::1/128` | 可信代理 CIDR 列表；Cloudflare Tunnel 填其回源网段，不能填 `true` |
| `APP_SECRET` | 无 | 32 字节以上随机值：TOTP 加密、IP 哈希、一次性令牌签名 |
| `REGISTRATION_MODE` | `invite` | 仅首次建库时写入 `setting.registration_mode`；之后以数据库为准（`closed` / `invite` / `open`） |
| `INVITE_TTL_HOURS` | `168` | 邀请码默认有效期 |
| `LOGIN_MAX_ATTEMPTS` | `5` | 单账号窗口内失败上限，超过进入退避 |
| `LOCKOUT_MINUTES` | `15` | 失败过多后的封禁时长 |
| `TOTP_ISSUER` | `PartBin` | 两步验证在认证器里显示的名称 |
| `HSTS_MAX_AGE` | `31536000` | HSTS 有效期（秒）；首次上线可先设 86400，稳定后加满 |
| `APP_TZ` | `Asia/Shanghai` | 「本月」统计与默认时间显示时区 |
| `LOG_LEVEL` | `info` | pino 日志级别 |
| `BACKUP_KEEP` | `14` | 本地快照保留份数 |
| `BACKUP_REPO` | 无 | restic 仓库地址（如 `sftp:backup@nas:/srv/partbin`）；为空则只做本地快照 |
| `BACKUP_PASSWORD_FILE` | 无 | restic 密码文件路径（0600，root 可读） |

> 注册模式、两步验证要求等运行期开关存于数据库 `setting`，由管理员在设置页切换；环境变量只作为首次建库的初始值。

---

## 5. 账号体系与权限

### 5.1 注册与开户

- 不收集邮箱、手机号、姓名；账号只有用户名与密码。
- 用户名：3–32 字符，允许中文、字母、数字、`_`、`-`；`username_norm = username.normalize('NFKC').trim().toLowerCase()`（JS 侧计算）唯一，防止 `Admin` / `admin` / 全角字符重名。展示保留用户输入的大小写。
- 注册模式存 `setting.registration_mode`，三档：

| 模式 | 行为 | 适用 |
|---|---|---|
| `closed` | 仅管理员或 CLI 建号 | 最安全；成员固定的小团队可选 |
| `invite` | 管理员生成邀请码，凭码注册只读账号 | **公网默认** |
| `open` | 任何人可注册为只读 | 仅在明确需要时临时开启，页面显示风险提示 |

- 邀请码：`PB-XXXX-XXXX-XXXX`（Crockford Base32），24 字节随机；数据库只存 SHA-256。字段含 `role`（固定 `user`）、`max_uses`、`used_count`、`expires_at`、`created_by`。注册时在 `BEGIN IMMEDIATE` 内校验并原子递增；过期/用尽返回 400 `INVITE_INVALID`。明文只在创建响应中出现一次，创建与撤销均写审计。
- 注册限速：同 IP 10 次/小时；`open` 模式再叠加 3 次/小时；所有注册与失败尝试写审计。
- 首次部署：用 `node server/scripts/create-admin.js --username admin` 交互创建管理员（两次输入、强度校验、写审计）。**不再支持「第一个注册者自动成为管理员」**；M1 的该行为在 M6 移除，升级前必须先创建管理员。

### 5.2 密码策略

- 12–64 个字符（按码点），不能与用户名相同，不能全为空格，不能命中内置弱口令表（1000 条常见密码）；允许中文与特殊字符。
- 哈希：scrypt（N=32768、r=8、p=1，16 字节盐，64 字节派生，`maxmem=64MiB`），存为 `scrypt$N$r$p$saltB64$hashB64`，比较用 `timingSafeEqual`；登录时若参数低于当前标准则透明重算。
- 修改密码需要当前密码（启用 2FA 时还需要 TOTP），成功后吊销其他会话；管理员重置密码同样吊销目标用户全部会话。
- 登录失败统一文案「账号或密码错误」，不区分用户是否存在；账号不存在时也执行一次真实成本哈希，避免时间侧信道。

### 5.3 登录防护

- 失败记录持久化到 `login_attempt`（账号、IP 哈希、时间、结果），进程重启不清零。
- 规则：单账号 15 分钟内 5 次失败 → 锁定 15 分钟；单 IP 15 分钟内 20 次失败 → 拒绝登录 15 分钟；超限返回 429 + `Retry-After`，不暴露账号是否存在。
- 成功登录清空该账号失败计数；管理员可在成员管理中解锁。
- IP 只存 `HMAC-SHA256(APP_SECRET, ip)` 截断值；登录尝试保留 30 天并定时清理。
- 失败与锁定事件写审计并输出结构化日志，供 fail2ban 与监控消费。
- 不实现图形验证码；依赖 Cloudflare / 主机商的上游防护与应用内持久化限速。

### 5.4 两步验证（TOTP）

- 可选，但强烈建议管理员开启；设置页可开启「提醒管理员开启 2FA」，不硬锁以免失联。
- RFC 6238：30 秒步长、SHA-1、6 位、±1 步窗口；密钥 20 字节随机，Base32 展示。
- 密钥用 AES-256-GCM（由 `APP_SECRET` 派生）加密存储；`totp_last_step` 防重放。
- 开启流程：生成密钥 → 前端展示 `otpauth://` 链接与二维码（纯 JS `qrcode` 库）→ 输入一次验证码 → 启用并一次性展示 10 个恢复码（库中只存 SHA-256）。
- 登录：密码通过后如已启用 2FA，要求 6 位码或任一恢复码；恢复码用后作废；5 次失败 / 5 分钟限速。
- 关闭 2FA、重置恢复码需要重新验证密码（10 分钟内 reauth）。

### 5.5 会话

- 生产 Cookie：`__Host-partbin_sid`（`Secure; HttpOnly; SameSite=Lax; Path=/`，无 Domain）；HTTP 开发环境用 `partbin_dev_sid`。数据库只存 token 的 SHA-256。
- 双过期：空闲 7 天滑动续期 + 绝对 30 天硬上限；每次登录生成新 token。
- 会话记录 `ip_hash`、UA、创建与最后活动时间；用户可查看设备列表并单独/全部下线。
- 修改密码、禁用、降权、关闭 2FA 时吊销对应会话；管理员可强制下线任意用户。
- 敏感操作（改角色、禁用、重置密码、生成邀请码、修改安全设置、导出全量数据）要求 10 分钟内重新验证（`reauth_at`），否则 403 `REAUTH_REQUIRED`。
- 前端收到 401 自动跳转登录页并保留原路由。

### 5.6 角色与权限矩阵

服务端强制校验；前端只做按钮隐藏，不承担安全职责。

| 操作 | admin | user（只读） |
|---|:--:|:--:|
| 查看库存 / 详情 / 流水 / 借出 / 照片 / 统计 | ✓ | ✓ |
| 导出 CSV | ✓ | ✓ |
| 入库 / 出库 / 盘点 / 报废 / 丢失 | ✓ | ✗ |
| 物料、实例、分类、位置的增删改 | ✓ | ✗ |
| 借出 / 归还 / 撤销借出 | ✓ | ✗ |
| 照片上传删除、CSV 导入 | ✓ | ✗ |
| 用户管理、改角色、禁用、重置密码、解锁 | ✓ | ✗ |
| 邀请码管理、审计日志、注册模式与安全设置 | ✓ | ✗ |
| 查看/下线自己的会话、设置自己的 2FA | ✓ | ✓ |
| 强制下线他人会话 | ✓ | ✗ |
| 修改自己的密码、退出登录 | ✓ | ✓ |

保护规则：

1. 不能禁用自己；
2. 不能把最后一个启用状态的管理员降级或禁用（409 `LAST_ADMIN`）；
3. 用户只禁用不物理删除（保留流水外键与审计）；
4. 被禁用或降权账号的现有会话立即失效（鉴权时联查用户状态与角色）；
5. 管理员重置密码、用户自己改密后，目标用户的其他会话全部吊销；
6. 审计日志只增不改不删，没有删除接口。

### 5.7 审计

- `audit_log` 记录：登录成功/失败、退出、注册、邀请创建/撤销、角色与启用状态变更、密码重置、2FA 开关、会话吊销、物料/流水/借出关键写操作、CSV 导入导出、安全设置变更。
- 字段：`actor_id`、`action`、`target_type`、`target_id`、`detail`（JSON）、`ip_hash`、`created_at`；不可修改。
- 管理员在设置页按时间与动作筛选查看；保留 180 天；导出 CSV 仅管理员且需要 reauth。
- 日志中不写密码、TOTP、会话 token、完整 IP。

---

## 6. 数据模型

### 6.1 实体关系

```
user 1─n session
user 1─n movement          (操作人)
user 1─n loan              (创建人)
category 1─n item          (树，可置空)
location 1─n item          (树，可置空)
item 1─n item_instance     (仅 tracking_mode='instance')
item 1─n movement
item 1─n loan
item n─n photo             (item_photo)
item_instance 1─n movement (可选)
loan 1─n movement          (borrow / return)
```

### 6.2 约定

- 主键统一 `INTEGER PRIMARY KEY`（即 rowid）；对外只暴露数字 id。
- 时间统一 TEXT，UTC ISO-8601 毫秒，形如 `2026-10-29T17:30:00.123Z`；日期型字段（`purchase_date`）用 `YYYY-MM-DD`。
- 布尔用 `INTEGER` 0/1 + CHECK。
- 外键默认开启；`PRAGMA journal_mode = WAL`、`synchronous = NORMAL`、`busy_timeout = 5000`、`foreign_keys = ON`。
- 名称类唯一约束使用 `COLLATE NOCASE`，并分别对「根节点」和「子节点」建部分唯一索引（SQLite 的 `UNIQUE(parent_id, name)` 无法约束 `parent_id IS NULL` 的重复）。
- 迁移文件按版本号排序，单事务执行，记入 `schema_migration`；启动时自动执行，幂等。
- 001/002 已在 M1 落地；公网安全扩展见 6.7（迁移 003，M6 实施），不回改历史迁移。

### 6.3 完整 DDL（`server/src/db/migrations/001_init.sql`）

```sql
PRAGMA foreign_keys = ON;

-- 迁移版本
CREATE TABLE IF NOT EXISTS schema_migration (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- 键值配置（注册开关等）
CREATE TABLE setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 用户
CREATE TABLE user (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL,
  username_norm TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX idx_user_role ON user (role, is_active);

-- 会话（只存 token 哈希）
CREATE TABLE session (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX idx_session_user ON session (user_id);
CREATE INDEX idx_session_expires ON session (expires_at);

-- 分类（树）
CREATE TABLE category (
  id         INTEGER PRIMARY KEY,
  parent_id  INTEGER REFERENCES category (id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_category_root_name
  ON category (name COLLATE NOCASE) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX ux_category_child_name
  ON category (parent_id, name COLLATE NOCASE) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_category_parent ON category (parent_id, sort_order);

-- 位置（树：柜 → 层/抽屉 → 盒）
CREATE TABLE location (
  id         INTEGER PRIMARY KEY,
  parent_id  INTEGER REFERENCES location (id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  code       TEXT,
  note       TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_location_root_name
  ON location (name COLLATE NOCASE) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX ux_location_child_name
  ON location (parent_id, name COLLATE NOCASE) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_location_parent ON location (parent_id, sort_order);

-- 照片（文件落在 DATA_DIR/uploads/YYYYMM/）
CREATE TABLE photo (
  id         INTEGER PRIMARY KEY,
  rel_path   TEXT NOT NULL UNIQUE,
  mime       TEXT NOT NULL,
  byte_size  INTEGER NOT NULL CHECK (byte_size > 0),
  sha256     TEXT NOT NULL,
  width      INTEGER,
  height     INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_photo_sha256 ON photo (sha256);

-- 物料（SKU）
CREATE TABLE item (
  id            INTEGER PRIMARY KEY,
  code          TEXT,
  name          TEXT NOT NULL,
  category_id   INTEGER REFERENCES category (id) ON DELETE SET NULL,
  location_id   INTEGER REFERENCES location (id) ON DELETE SET NULL,
  manufacturer  TEXT,
  model         TEXT,
  spec          TEXT,
  unit          TEXT NOT NULL DEFAULT '个',
  tracking_mode TEXT NOT NULL DEFAULT 'quantity'
                 CHECK (tracking_mode IN ('quantity', 'instance')),
  quantity      INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  min_quantity  INTEGER NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  price_cents   INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  purchase_date TEXT,
  note          TEXT,
  is_archived   INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_by    INTEGER REFERENCES user (id) ON DELETE SET NULL,
  updated_by    INTEGER REFERENCES user (id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_item_code ON item (code) WHERE code IS NOT NULL;
CREATE INDEX idx_item_name ON item (name);
CREATE INDEX idx_item_model ON item (model);
CREATE INDEX idx_item_category ON item (category_id);
CREATE INDEX idx_item_location ON item (location_id);
CREATE INDEX idx_item_archived ON item (is_archived);

-- 实例（可选的单件管理）
CREATE TABLE item_instance (
  id          INTEGER PRIMARY KEY,
  item_id     INTEGER NOT NULL REFERENCES item (id) ON DELETE CASCADE,
  asset_no    TEXT,
  serial      TEXT,
  status      TEXT NOT NULL DEFAULT 'in_stock'
              CHECK (status IN ('in_stock', 'lent', 'broken', 'lost', 'retired')),
  location_id INTEGER REFERENCES location (id) ON DELETE SET NULL,
  photo_id    INTEGER REFERENCES photo (id) ON DELETE SET NULL,
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  note        TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_instance_asset_no
  ON item_instance (asset_no) WHERE asset_no IS NOT NULL;
CREATE INDEX idx_instance_item ON item_instance (item_id, status);

-- 借出
CREATE TABLE loan (
  id                INTEGER PRIMARY KEY,
  item_id           INTEGER NOT NULL REFERENCES item (id) ON DELETE CASCADE,
  instance_id       INTEGER REFERENCES item_instance (id) ON DELETE SET NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  returned_quantity INTEGER NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  borrower          TEXT NOT NULL,
  contact           TEXT,
  note              TEXT,
  borrowed_at       TEXT NOT NULL,
  due_at            TEXT,
  returned_at       TEXT,
  created_by        INTEGER NOT NULL REFERENCES user (id) ON DELETE RESTRICT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  CHECK (returned_quantity <= quantity)
);
CREATE INDEX idx_loan_item ON loan (item_id, returned_at);
CREATE INDEX idx_loan_due ON loan (returned_at, due_at);

-- 出入库流水（不可变；borrow/return 的 delta 为 0）
CREATE TABLE movement (
  id             INTEGER PRIMARY KEY,
  item_id        INTEGER NOT NULL REFERENCES item (id) ON DELETE CASCADE,
  instance_id    INTEGER REFERENCES item_instance (id) ON DELETE SET NULL,
  loan_id        INTEGER REFERENCES loan (id) ON DELETE SET NULL,
  user_id        INTEGER NOT NULL REFERENCES user (id) ON DELETE RESTRICT,
  type           TEXT NOT NULL
                 CHECK (type IN ('in', 'out', 'adjust', 'discard', 'lost', 'borrow', 'return')),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  quantity_delta INTEGER NOT NULL,
  balance_after  INTEGER NOT NULL CHECK (balance_after >= 0),
  note           TEXT,
  occurred_at    TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  CHECK (
    (type = 'in'     AND quantity_delta = quantity) OR
    (type IN ('out', 'discard', 'lost') AND quantity_delta = -quantity) OR
    (type = 'adjust' AND quantity_delta <> 0 AND abs(quantity_delta) = quantity) OR
    (type IN ('borrow', 'return') AND quantity_delta = 0)
  )
);
CREATE INDEX idx_movement_item ON movement (item_id, occurred_at DESC, id DESC);
CREATE INDEX idx_movement_time ON movement (occurred_at DESC, id DESC);
CREATE INDEX idx_movement_type ON movement (type, occurred_at DESC);
CREATE INDEX idx_movement_loan ON movement (loan_id);
CREATE INDEX idx_movement_instance ON movement (instance_id);

-- 物料相册
CREATE TABLE item_photo (
  item_id    INTEGER NOT NULL REFERENCES item (id) ON DELETE CASCADE,
  photo_id   INTEGER NOT NULL REFERENCES photo (id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, photo_id)
);
CREATE INDEX idx_item_photo_order ON item_photo (item_id, sort_order);

-- 初始配置
INSERT INTO setting (key, value, updated_at)
VALUES ('allow_registration', '1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
       ('site_name', 'PartBin', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
```

> 注：`schema_migration` 由迁移运行器在执行 001 前创建；上文的 `CREATE TABLE IF NOT EXISTS` 与之兼容。

### 6.4 数量语义（全系统唯一口径）

| `movement.type` | `quantity_delta` | 业务场景 | 影响可用量 |
|---|:--:|---|:--:|
| `in` 入库 | +q | 采购到货、回收入库 | +q |
| `out` 出库 | -q | 用掉、焊掉、送人 | -q |
| `adjust` 盘点调整 | ±q（非 0） | 账面与实物不符，必须填原因 | ±q |
| `discard` 报废 | -q | 损坏丢弃 | -q |
| `lost` 丢失 | -q | 遗失 | -q |
| `borrow` 借出 | 0 | 借给同学/实验室，所有权不变 | -q（由未还 loan 计算） |
| `return` 归还 | 0 | 归还（支持部分） | +q |

- **拥有量** `item.quantity = Σ(quantity_delta)`。
- **可用量** `available = quantity − Σ(loan.quantity − loan.returned_quantity)`（未结清借出）。
- **低库存**：`quantity = 0` 或（`min_quantity > 0` 且 `quantity <= min_quantity`）。

### 6.5 不变量（`pnpm db:check` 与单测共同保证）

1. 对每个 item：`quantity == SELECT COALESCE(SUM(quantity_delta),0) FROM movement WHERE item_id = ?`。
2. 实例制 item：`quantity == COUNT(*) FROM item_instance WHERE item_id = ? AND status NOT IN ('lost','retired')`。
3. 所有 item：`quantity >= 0`。
4. 每个未结清 loan：`quantity - returned_quantity > 0`；与 `item.quantity` 的关系满足「未还借出总量 ≤ 拥有量」。
5. `loan.returned_at IS NULL` ⇔ `returned_quantity < quantity`；`returned_at IS NOT NULL` ⇔ `returned_quantity = quantity`。
6. 至少存在一个 `role='admin' AND is_active=1` 的用户（仅在用户表非空时校验）。
7. 每条 `movement.balance_after` 与该物料按时间排序的累计值一致（可选深度校验，`--deep` 开启）。
8. 每条 `photo.rel_path` 在磁盘存在；`item_photo` 引用的 photo 存在。

`scripts/reconcile.js` 可按不变量 1 重算并修正 `item.quantity`（默认只报告，`--fix` 才写库，且写库前自动备份）。

### 6.6 删除与归档策略

| 对象 | 策略 |
|---|---|
| 物料 | 删除 = 归档（`is_archived=1`），列表默认不显示，`includeArchived` 可查；有流水也不物理删除 |
| 实例 | 状态置 `retired`/`lost`，不物理删除；`asset_no` 可复用由用户决定（唯一索引会拒绝重复） |
| 分类/位置 | 可物理删除；引用它的 item 的 `category_id/location_id` 置 NULL，接口返回受影响的物料数供前端提示 |
| 照片 | 从相册移除后，若无其他引用则删除磁盘文件与记录（服务层统一处理） |
| 用户 | 只禁用不删除 |

### 6.7 公网安全扩展（迁移 003，M6 实施）

M1 已落地 001/002。公网加固**不回改 001**，而是新增迁移 003，保证已有数据平滑升级。

```sql
-- 用户：两步验证、锁定与密码时间
ALTER TABLE user ADD COLUMN totp_secret TEXT;            -- AES-256-GCM 密文
ALTER TABLE user ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user ADD COLUMN totp_last_step INTEGER;      -- 防重放
ALTER TABLE user ADD COLUMN password_changed_at TEXT;
ALTER TABLE user ADD COLUMN locked_until TEXT;

-- 会话：IP 哈希、绝对过期、最近一次重认证
ALTER TABLE session ADD COLUMN ip_hash TEXT;
ALTER TABLE session ADD COLUMN absolute_expires_at TEXT;
ALTER TABLE session ADD COLUMN reauth_at TEXT;

-- 邀请码（只存哈希）
CREATE TABLE invite (
  id          INTEGER PRIMARY KEY,
  code_hash   TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  max_uses    INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count  INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= max_uses),
  note        TEXT,
  created_by  INTEGER NOT NULL REFERENCES user (id) ON DELETE RESTRICT,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_invite_expires ON invite (expires_at);

-- 登录尝试（持久化限速；IP 只存哈希）
CREATE TABLE login_attempt (
  id            INTEGER PRIMARY KEY,
  username_norm TEXT,
  ip_hash       TEXT NOT NULL,
  success       INTEGER NOT NULL CHECK (success IN (0, 1)),
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_login_attempt_user ON login_attempt (username_norm, created_at DESC);
CREATE INDEX idx_login_attempt_ip ON login_attempt (ip_hash, created_at DESC);

-- 恢复码（一次性）
CREATE TABLE recovery_code (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL UNIQUE,
  used_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_recovery_user ON recovery_code (user_id, used_at);

-- 审计（只增）
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER REFERENCES user (id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  detail      TEXT,
  ip_hash     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_audit_time ON audit_log (created_at DESC);
CREATE INDEX idx_audit_action ON audit_log (action, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_log (actor_id, created_at DESC);

-- 初始注册模式；仅在不存在时写入，避免覆盖管理员设置
INSERT INTO setting (key, value, updated_at)
SELECT 'registration_mode', 'invite', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM setting WHERE key = 'registration_mode');

-- 旧开关退役
UPDATE setting SET value = '0', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'allow_registration';
```

- 清理任务：启动与每日清理 30 天前的 `login_attempt`、过期会话、过期未用邀请码；`audit_log` 保留 180 天。
- 兼容：M6 上线时已有账号的密码不会强制失效（下次登录按新策略校验并透明重算哈希），但管理员界面会提示「密码强度可能不足，建议重置」。
- 兼容：旧会话的 `absolute_expires_at` 为 NULL 时按 `created_at + 30 天` 兜底；M6 首次启动为现有会话补齐该值。
- `allow_registration` 字段保留但不再读取，统一以 `registration_mode` 为准。
- 新增设置项：`registration_mode`（closed/invite/open）、`require_admin_totp`（0/1，默认 0）、`invite_ttl_hours`（默认 168）。

---

## 7. 接口设计

### 7.1 通用约定

- 前缀 `/api`（`/health` 例外），JSON 请求与响应，`Content-Type: application/json`。
- 鉴权：生产 Cookie `__Host-partbin_sid`，开发环境 `partbin_dev_sid`；除公开接口外全部要求登录；写接口要求 `role=admin`。
- 成功：直接返回资源对象（列表为 `{ data, page, pageSize, total }`）。
- 失败：HTTP 状态码 + `{ "error": { "code": "FORBIDDEN", "message": "只读账号，请联系管理员", "details": null } }`。
- 分页：`page` 从 1 开始，`pageSize` 默认 20、最大 100。
- 排序：`sort` 只接受白名单 `name | quantity | updated_at | created_at | code`，前缀 `-` 表示降序。
- 时间入参接受带时区偏移的 ISO 字符串，服务端转 UTC 存储；出参一律 UTC ISO。
- 金额入参 `price` 以「元」为单位（两位小数），存 `price_cents`；出参同时给 `price`。
- 请求来源：状态变更请求必须同源（Origin 或 `Sec-Fetch-Site: same-origin`），并与 `PUBLIC_ORIGIN` 一致，否则 403 `ORIGIN_MISMATCH`。
- 安全响应头：CSP、HSTS、`X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`、COOP/CORP，详见 12.5。
- 幂等：写接口不做重试幂等键（自托管手动操作），但 CSV 导入以 `code` 为幂等键。

### 7.2 公开接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | `{ status: "ok", db: "ok", version }`，不鉴权，供 systemd/Docker/Caddy 探活；不泄露配置 |
| GET | `/api/auth/config` | `{ registrationMode, hasUsers, siteName, requireAdminTotp }`，登录页据此显示注册入口与 2FA 提示 |
| POST | `/api/auth/register` | `{ username, password, inviteCode? }` → 201 `{ user }` + Set-Cookie；关闭注册 → 403 `REGISTRATION_CLOSED`；邀请码无效 → 400 `INVITE_INVALID` |
| POST | `/api/auth/login` | `{ username, password, totpCode?, recoveryCode? }` → 200 `{ user }` + Set-Cookie；需要 2FA 时 401 `{ code: "TOTP_REQUIRED", details: { totpRequired: true } }`；锁定 → 429 |

### 7.3 账号与用户

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/auth/logout` | 登录 | 删除当前会话，清 Cookie |
| GET | `/api/auth/me` | 登录 | `{ user: { id, username, role, lastLoginAt, totpEnabled }, registrationMode }` |
| POST | `/api/auth/password` | 登录 | `{ currentPassword, newPassword, totpCode? }`；成功后吊销其他会话 |
| POST | `/api/auth/reauth` | 登录 | `{ password, totpCode? }`；刷新 10 分钟重认证窗口，供敏感操作使用 |
| GET | `/api/auth/sessions` | 登录 | 自己的会话列表：设备、IP 哈希前 8 位、最后活动、当前会话标记 |
| DELETE | `/api/auth/sessions/:id` | 登录 | 下线自己的某个会话（不能删当前？允许，删除后需重新登录） |
| POST | `/api/auth/sessions/revoke-others` | 登录 | 下线除当前外的全部会话 |
| POST | `/api/auth/totp/setup` | 登录 + reauth | 生成 TOTP 密钥，返回 `{ secret, otpauthUri }`（前端用 `qrcode` 渲染二维码） |
| POST | `/api/auth/totp/enable` | 登录 + reauth | `{ code }` → `{ recoveryCodes: [...] }`，明文仅此一次 |
| POST | `/api/auth/totp/disable` | 登录 + reauth | `{ password, code }` → 204 |
| POST | `/api/auth/recovery-codes/regenerate` | 登录 + reauth | `{ password, code }` → 新恢复码，旧码全部作废 |
| GET | `/api/users` | admin | 用户列表：id、username、role、isActive、totpEnabled、lockedUntil、lastLoginAt、createdAt |
| PATCH | `/api/users/:id` | admin + reauth | `{ role?, isActive? }`；`LAST_ADMIN` / `CANNOT_DISABLE_SELF` 校验 |
| POST | `/api/users/:id/reset-password` | admin + reauth | `{ newPassword }`；吊销该用户全部会话 |
| POST | `/api/users/:id/unlock` | admin + reauth | 解除登录锁定，清空失败计数 |
| GET | `/api/invites` | admin | 邀请码列表（不含明文码，只显示前缀与使用情况） |
| POST | `/api/invites` | admin + reauth | `{ maxUses?, expiresInHours?, note? }` → `{ invite, code }`，`code` 只返回一次；邀请只能开只读账号 |
| DELETE | `/api/invites/:id` | admin + reauth | 撤销（已用码保留记录） |
| GET | `/api/audit` | admin | `action`、`actorId`、`from`、`to`、分页；只读 |
| GET | `/api/export/audit.csv` | admin + reauth | 审计导出，UTF-8 BOM，单元格做公式注入转义 |
| PATCH | `/api/settings` | admin + reauth | `{ registrationMode?, requireAdminTotp? }`，写 `setting` 并记审计 |

### 7.4 分类与位置

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/categories` | 登录 | 返回树：`[{ id, name, parentId, path: "开发板/单片机", sortOrder, children: [...] }]` |
| POST | `/api/categories` | admin | `{ name, parentId?, sortOrder? }` |
| PATCH | `/api/categories/:id` | admin | `{ name?, parentId?, sortOrder? }`；禁止把节点挂到自己子孙下（409 `TREE_CYCLE`） |
| DELETE | `/api/categories/:id` | admin | 返回 `{ detachedItems: n }` |
| — | `/api/locations` 同构 | — | 位置额外字段 `code`、`note`；`path` 形如 `A柜/抽屉3/盒12` |

### 7.5 物料

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/items` | 登录 | 查询参数：`q`（空格分词、AND、LIKE name/model/spec/code）、`categoryId`（含子孙）、`locationId`（含子孙）、`lowStock=1`、`archived=1`、`page`、`pageSize`、`sort`。返回项含 `categoryPath`、`locationPath`、`available`、`lowStock`、`instanceCount` |
| POST | `/api/items` | admin | 字段见下；`trackingMode='instance'` 时 `quantity` 忽略（由实例决定） |
| GET | `/api/items/:id` | 登录 | 基础信息 + 三张数量（拥有/借出/可用）+ 相册 + 分类位置路径 + 最近 20 条流水 |
| PATCH | `/api/items/:id` | admin | 不接收 `quantity`；改数量必须走流水 |
| DELETE | `/api/items/:id` | admin | = 归档 `is_archived=1` |
| POST | `/api/items/:id/restore` | admin | 取消归档 |
| GET | `/api/items/:id/movements` | 登录 | 分页，含操作人 `userName` |
| POST | `/api/items/:id/movements` | admin | 出入库/盘点/报废/丢失，见 7.9 |

**物料请求体**

```json
{
  "name": "STM32F103C8T6 最小系统板",
  "code": "U-STM32F103",
  "categoryId": 3,
  "locationId": 12,
  "manufacturer": "ST",
  "model": "STM32F103C8T6",
  "spec": "72MHz / 64KB Flash / 20KB RAM",
  "unit": "块",
  "trackingMode": "quantity",
  "minQuantity": 2,
  "price": 12.5,
  "purchaseDate": "2026-09-01",
  "note": "蓝色板，带 CH340"
}
```

**列表响应**

```json
{
  "data": [{
    "id": 1,
    "code": "U-STM32F103",
    "name": "STM32F103C8T6 最小系统板",
    "model": "STM32F103C8T6",
    "unit": "块",
    "trackingMode": "quantity",
    "quantity": 3,
    "lentQuantity": 1,
    "available": 2,
    "minQuantity": 2,
    "lowStock": true,
    "categoryId": 3,
    "categoryPath": "开发板/单片机",
    "locationId": 12,
    "locationPath": "A柜/抽屉3/盒12",
    "coverPhotoId": 7,
    "instanceCount": 0,
    "isArchived": false,
    "updatedAt": "2026-10-29T17:30:00.000Z"
  }],
  "page": 1,
  "pageSize": 20,
  "total": 1
}
```

### 7.6 实例

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/items/:id/instances` | 登录 | `[{ id, assetNo, serial, status, locationPath, photoId, note }]` |
| POST | `/api/items/:id/instances` | admin | `{ assetNo?, serial?, locationId?, note? }`，单件创建 |
| POST | `/api/items/:id/instances/batch` | admin | `{ count, prefix, startAt?, locationId? }`，生成 `prefix-001…` 并写一条 `in` 流水（delta=+count） |
| PATCH | `/api/instances/:id` | admin | `{ status?, locationId?, assetNo?, serial?, note? }`；状态变化按规则写流水。`lent` 只能由借出接口产生，本接口只允许维护 `in_stock`/`broken`/`retired`/`lost` |
| DELETE | `/api/instances/:id` | admin | 有借出记录时 409；否则置 `retired` 并写 `discard` 流水 |

实例状态迁移规则（服务层唯一入口）：

| 迁移 | 数量影响 | 流水 |
|---|---|---|
| 新建 → `in_stock` | +1 | `in`（delta +1） |
| `lent` → `in_stock`（归还） | 0 | `return`（由归还接口写） |
| `in_stock` → `lent`（借出） | 0 | `borrow`（由借出接口写） |
| `in_stock` → `broken` | 0 | 无流水（拥有量不变，界面标黄） |
| `broken` → `in_stock` | 0 | 无流水 |
| `*` → `retired` | -1 | `discard` |
| `*` → `lost` | -1 | `lost` |

### 7.7 流水

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/movements` | 登录 | `itemId`、`type`、`from`、`to`（按 `occurred_at`）、`page`、`pageSize`；返回含 `itemName`、`userName`、`balanceAfter`、`note` |

### 7.8 借出

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/loans` | 登录 | `status=open / closed / overdue`，分页；含 `itemName`、`borrower`、`quantity`、`returnedQuantity`、`dueAt`、`overdue`、`createdByName` |
| POST | `/api/loans` | admin | `{ itemId, quantity, borrower, contact?, dueAt?, note?, instanceIds? }`；实例制必须传且数量匹配；校验可用量 |
| POST | `/api/loans/:id/return` | admin | `{ quantity }`，校验不超过未还数量；写到账并写 `return` 流水 |
| DELETE | `/api/loans/:id` | admin | 仅未归还时撤销：删除 loan 与关联的 borrow 流水（若有 return 则 409） |

**借出响应**

```json
{
  "loan": {
    "id": 5, "itemId": 1, "quantity": 3, "returnedQuantity": 1,
    "borrower": "张三", "borrowedAt": "2026-10-20T02:00:00.000Z",
    "dueAt": "2026-10-27T02:00:00.000Z", "returnedAt": null, "overdue": true
  },
  "available": 2,
  "remaining": 2
}
```

### 7.9 出入库写接口

`POST /api/items/:id/movements`

```json
{
  "type": "out",
  "quantity": 2,
  "note": "焊到主控板上",
  "occurredAt": "2026-10-30T01:30:00+08:00",
  "instanceId": null
}
```

| type | 额外要求 | 校验 |
|---|---|---|
| `in` / `out` / `discard` / `lost` | 无 | `out/discard/lost` 需 `quantity <= 拥有量`；实例制物料只允许 `in`（走批量建实例） |
| `adjust` | `note` 必填、`direction` 必填 | `quantity` 传差额绝对值，`direction` 为 `up` / `down`；服务端换算成带符号 delta，并校验结果 ≥ 0（见下） |
| `borrow` / `return` | 通过 `/api/loans` 接口完成 | 不允许直接调用本接口 |

- `adjust` 请求体增加 `"direction": "up" | "down"`；服务端换算 `quantity_delta = ±quantity`，并校验结果 ≥ 0。

**盘点示例**

```json
{
  "type": "adjust",
  "quantity": 2,
  "direction": "down",
  "note": "盘点发现盒里实际只有 5 个",
  "occurredAt": "2026-10-30T02:00:00+08:00"
}
```

- 所有写操作返回 `{ movement: {...}, item: { id, quantity, available } }`。
- 库存不足、可用量不足统一 409 `INSUFFICIENT_STOCK`；负数量、类型非法 400 `VALIDATION`。

### 7.10 照片

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/photos` | admin | multipart（字段 `file`），JPEG/PNG/WebP，≤ 8MB；按魔数校验真实类型；sha256 去重，重复直接返回已有记录 |
| GET | `/api/photos/:id` | 登录 | 流式返回，`Cache-Control: private, max-age=31536000, immutable`；响应带 `ETag` |
| DELETE | `/api/photos/:id` | admin | 若被物料/实例引用则 409 |
| PUT | `/api/items/:id/photos` | admin | `{ photoIds: [7, 9] }` 全量排序，第一个为主图；被移出且不再被任何物料/实例引用的照片会自动删除文件与记录 |

### 7.11 导入导出

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/import/preview` | admin | multipart CSV；返回摘要与逐行错误，**不写库** |
| POST | `/api/import/commit` | admin | 同文件重新上传，单事务写入；返回写入统计 |
| GET | `/api/export/items.csv` | 登录 | 当前筛选条件导出（UTF-8 BOM） |
| GET | `/api/export/movements.csv` | 登录 | 按时间范围导出 |
| GET | `/api/export/loans.csv` | 登录 | 全量借出记录 |

**preview 响应**

```json
{
  "summary": { "rows": 42, "create": 18, "update": 20, "unchanged": 2, "error": 2 },
  "errors": [{ "line": 13, "field": "quantity", "message": "数量必须是非负整数" }],
  "preview": [
    { "line": 2, "action": "create", "name": "ESP32-S3-DevKitC", "quantityAfter": 2 },
    { "line": 3, "action": "update", "name": "电阻包", "quantityBefore": 50, "quantityAfter": 48, "delta": -2 }
  ]
}
```

### 7.12 统计

`GET /api/stats` → 登录即可：

```json
{
  "items": { "total": 128, "active": 121, "lowStock": 3, "outOfStock": 1 },
  "loans": { "open": 4, "overdue": 1 },
  "movements": { "inThisMonth": 12, "outThisMonth": 30 },
  "byCategory": [{ "name": "开发板", "count": 22 }]
}
```

「本月」按 `APP_TZ` 计算月初边界后转 UTC 查询。

### 7.13 错误码

| code | HTTP | 场景 |
|---|---|---|
| `VALIDATION` | 400 | 字段缺失/格式错/密码规则不符 |
| `AUTH_REQUIRED` | 401 | 未登录或会话不存在 |
| `SESSION_EXPIRED` | 401 | 会话过期 |
| `INVALID_CREDENTIALS` | 401 | 账号或密码错误（含已禁用） |
| `FORBIDDEN` | 403 | 只读账号写操作、非管理员访问管理接口 |
| `REGISTRATION_CLOSED` | 403 | 注册已关闭 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `USERNAME_TAKEN` | 409 | 用户名已存在 |
| `DUPLICATE` | 409 | 编号/资产编号/同级重名 |
| `LAST_ADMIN` | 409 | 降级或禁用最后一个管理员 |
| `CANNOT_DISABLE_SELF` | 409 | 禁用自己 |
| `INSUFFICIENT_STOCK` | 409 | 库存或可用量不足 |
| `TREE_CYCLE` | 409 | 分类/位置父子成环 |
| `LOAN_STATE` | 409 | 已归还的借出不能撤销/重复归还 |
| `PAYLOAD_TOO_LARGE` | 413 | 上传超 8MB |
| `UNSUPPORTED_MEDIA` | 415 | 图片类型不在白名单 |
| `INVITE_INVALID` | 400 | 邀请码不存在、过期或用尽 |
| `PASSWORD_TOO_WEAK` | 400 | 未达密码策略或命中弱口令表 |
| `TOTP_REQUIRED` | 401 | 已启用 2FA，但本次登录未提供验证码 |
| `TOTP_INVALID` | 401 | 验证码或恢复码错误/已使用 |
| `REAUTH_REQUIRED` | 403 | 敏感操作超出 10 分钟重认证窗口 |
| `ORIGIN_MISMATCH` | 403 | 状态变更请求的来源与 `PUBLIC_ORIGIN` 不一致 |
| `ACCOUNT_LOCKED` | 429 | 账号因连续失败被短暂锁定（文案不区分是否存在） |
| `RATE_LIMITED` | 429 | 登录/注册限速 |
| `INTERNAL` | 500 | 未预期错误（日志含 requestId） |

---

## 8. 界面设计

本章是界面实现的唯一依据：不依赖 Figma，所有数值直接落成 CSS token；后续页面改动先改本章再改代码。

### 8.1 设计原则

1. **像工具，不像后台**：一屏只留一个主操作，其余动作降级为次按钮或「更多」。
2. **查找优先**：搜索入口必须在首屏、手指可达的位置；结果固定呈现「名称 + 余量 + 位置 + 在借」四要素。
3. **桌面靠密度，移动靠层级**：两套信息结构，而不是同一套布局等比缩放。
4. **数字会说话**：数量、余额、逾期天数使用等宽数字（`tabular-nums`），变化时给一次简短动效。
5. **动效解释因果**：只做「从哪来、什么变了」的过渡，不做装饰性循环动画。
6. **玻璃只做容器**：导航、浮层、吸顶工具栏用毛玻璃；正文、表格、表单用实色底。
7. **可降级**：不支持 `backdrop-filter`、系统开启「减弱动态效果」、200% 缩放时都必须可用。
8. **只读也体面**：无权限的按钮直接不出现（而不是灰成一团），并在页面顶部说明原因。

### 8.2 视觉语言（Design Tokens）

风格关键词：**薄荷青 + 大量留白 + 细边框 + 轻玻璃 + 克制的动效**。不做深色大图、不做高饱和渐变按钮、不用纯黑。

#### 8.2.1 色彩

| Token | 值 | 用途 |
|---|---|---|
| `--bg-base` | `#F6F9F9` | 页面底色（叠加两层极淡径向渐变） |
| `--bg-elevated` | `#FFFFFF` | 卡片、表格、表单等实色容器 |
| `--ink-900` | `#0F172A` | 主文字、标题 |
| `--ink-600` | `#475569` | 次级文字、表格正文 |
| `--ink-400` | `#94A3B8` | 占位符、禁用文字（不承载关键信息） |
| `--line` | `rgba(15,23,42,.08)` | 分割线、表格边框 |
| `--primary` | `#0A7A7A` | 主按钮、选中态、链接（对白字对比度 ≈ 5.2:1） |
| `--primary-hover` | `#086565` | 悬停 |
| `--primary-soft` | `#E6F5F4` | 浅底徽章、选中行 |
| `--accent` | `#4FD1C5` | 进度、聚焦描边、装饰（不用于文字） |
| `--success` | `#067647` | 入库、已归还 |
| `--warning` | `#B45309` | 低库存、盘点 |
| `--danger` | `#B42318` | 出库、报废、逾期、危险操作 |
| `--glass-bg` | `rgba(255,255,255,.58)` | 毛玻璃容器 |
| `--glass-border` | `rgba(255,255,255,.65)` | 玻璃高光边 |

- 分类标签使用 6 色低饱和色板（青、天蓝、紫、琥珀、玫红、石板灰），底为 12% 透明度、文字用同色加深值；同一分类颜色稳定（由 `category.id % 6` 决定）。
- 数据语义固定：**入库/归还用绿，出库/报废用红，盘点用琥珀，借出用蓝**；颜色之外必须同时有 `+ / −` 符号与文字。
- 页面背景：`radial-gradient(1200px 600px at 10% -10%, rgba(79,209,197,.10), transparent 60%)` 叠加 `radial-gradient(900px 500px at 100% 0%, rgba(96,165,250,.08), transparent 55%)`，再加 2% 透明度的 24px 细网格；不使用背景大图。
- MVP 只做亮色；`tokens.css` 预留 `[data-theme="dark"]` 变量槽，不提供切换入口。

#### 8.2.2 字体与数字

- 字族：`-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif`；不下载第三方 webfont（离线可用、无隐私问题）。
- 字号：11（角标）/ 12（辅助）/ 13（表格、表单）/ 14（正文）/ 16（小标题、移动端输入框）/ 20（页面标题）/ 28（仪表盘数字）。
- 移动端输入框固定 16px，避免 iOS Safari 聚焦时自动放大页面。
- 数字统一 `font-variant-numeric: tabular-nums; letter-spacing: -0.01em;`，保证列表与流水纵向对齐。
- 行高 1.5（正文）/ 1.25（标题）；字重只用 400 / 500 / 600。

#### 8.2.3 圆角、阴影、间距、层级

| Token | 值 | 用途 |
|---|---|---|
| `--r-sm` | 8px | 按钮、输入框、标签 |
| `--r-md` | 12px | 普通卡片、筛选 chip 容器 |
| `--r-lg` | 16px | 大卡片、表格容器、KPI |
| `--r-xl` | 20px | 对话框、底部抽屉、移动端卡片 |
| `--r-pill` | 999px | 徽章、状态点、筛选 chip |
| `--shadow-1` | `0 1px 2px rgba(15,23,42,.04), 0 1px 3px rgba(15,23,42,.06)` | 卡片默认 |
| `--shadow-2` | `0 8px 24px rgba(15,23,42,.08)` | 玻璃栏、下拉、悬停 |
| `--shadow-3` | `0 24px 64px rgba(15,23,42,.16)` | 对话框、抽屉 |
| `--space-1` ~ `--space-8` | 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64px | 间距基数 |

- 层级：内容 0，吸顶工具栏 100，侧栏／底栏 200，下拉 300，对话框 400，Toast 500，灯箱 600。
- 桌面内容最大宽 1280px 居中，左右 padding 32；移动 padding 16，底部预留 `calc(64px + env(safe-area-inset-bottom))`。
- 卡片与按钮的边框、阴影都轻：阴影偏移保持 0，靠模糊半径与透明度做层次，不堆叠双层投影。

#### 8.2.4 图标与插画

- 只用 Element Plus Icons；尺寸 16 / 20 / 24，颜色继承文字色，不单独上色（语义图标除外）。
- 功能图标必须带 `aria-label` 与 tooltip（桌面）或文字按钮（移动）。
- 不使用 emoji 充当功能图标（分类名里的 emoji 由用户自填，不在此限）。
- 空状态用 CSS 绘制的极简线框图形（板子、元件盒、放大镜）＋ 一句话 ＋ 一个主操作，不引入图片资源。

### 8.3 毛玻璃（Glass）使用规范

| 位置 | 使用玻璃 | 说明 |
|---|:--:|---|
| 桌面侧边栏、顶栏、移动底栏 | ✓ | 弱玻璃，滚动内容从下方穿过 |
| 列表页吸顶工具栏、详情页吸底操作条 | ✓ | 弱玻璃，保证滚动时筛选可见 |
| 对话框、右侧抽屉、底部抽屉 | ✓ | 强玻璃，叠加 `--shadow-3` |
| Toast、下拉菜单、Spotlight 搜索 | ✓ | 强玻璃 |
| 仪表盘 KPI 卡、普通卡片 | ✗ | 实色白 + 细边，保证数字清晰 |
| 表格行、表单区域、正文段落 | ✗ | 实色底，正文对比度不得低于 4.5:1 |
| 图片灯箱遮罩 | ✓ | 深色玻璃 `rgba(15,23,42,.72)` + blur |

实现规则：

1. 玻璃最多两层叠加（顶栏 + 浮层），不出现三层同时 blur。
2. 玻璃容器下方必须有可感知的底色或滚动内容，否则 blur 看不出效果。
3. 统一类 `.glass` 与 `.glass-strong`：

```css
.glass {
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  backdrop-filter: blur(18px) saturate(140%);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-2);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass { background: rgba(255, 255, 255, .94); }
}
```

4. 不把 `backdrop-filter` 放进动画属性；玻璃出现/消失只动 `opacity` 与 `transform`。
5. 玻璃容器内部不放高密度表格；每屏玻璃元素 ≤ 3 个。
6. 深色玻璃只用于灯箱与危险确认遮罩，不用在常规页面。

### 8.4 双端差异总览

| 维度 | 桌面（≥1024px） | 移动（<768px） |
|---|---|---|
| 输入方式 | 鼠标 + 键盘，悬停可用 | 单手指触控，无悬停 |
| 导航 | 左侧固定侧栏，分组可见 | 底部 4 Tab；二级页面返回箭头 |
| 信息密度 | 表格 8–9 列，行高 48 | 卡片单列，每卡 4 个字段以内 |
| 主操作 | 页头主按钮 + 行内操作 | 右下 FAB / 详情页吸底操作条 |
| 表单 | 居中对话框，双列栅格 | 全屏页面，单列大控件 |
| 浮层 | 右侧抽屉、对话框 | 底部抽屉（可下滑关闭） |
| 筛选 | 一行工具栏 + 树选择 | 横向 chip + 底部筛选抽屉 |
| 反馈 | hover 高亮 + tooltip | 触感区域高亮 + Toast / 底部说明 |
| 效率手段 | 快捷键、Spotlight 搜索 | 相机直传、单字段最少步骤 |
| 信息取舍 | 展示更新时间、分类等次要列 | 隐藏次要字段，进详情看全量 |

### 8.5 桌面端界面逻辑（≥1024px）

```
┌───────────┬──────────────────────────────────────────────┐
│ 侧栏 232  │ 顶栏 56：⌘K 搜索 · 新建 · 用户菜单             │
│ 玻璃      ├──────────────────────────────────────────────┤
│           │ 页面头：标题 / 描述 / 主按钮                   │
│ 仪表盘    │ 吸顶工具栏（玻璃）：搜索 · 筛选 · 排序          │
│ 库存      │ 内容区（实色卡片 / 表格）                       │
│ 流水      │ 分页                                           │
│ 借出      │                                               │
│ 设置      │                                               │
│ 用户名    │                                               │
└───────────┴──────────────────────────────────────────────┘
```

- **侧栏**：232px，玻璃，分组「库存 / 协作 / 系统」；当前项左侧 3px 主色条 + `--primary-soft` 底；底部显示用户名、角色徽章、退出。可折叠为 72px 图标 rail 并记忆状态。
- **顶栏**：高 56px，玻璃；左侧面包屑（仅二级页出现），中间搜索框，右侧「新建物料」下拉与用户菜单。
- **Spotlight 搜索**：点击或 `⌘K` / `Ctrl+K` 打开居中浮层（宽 640px，强玻璃）；结果分「物料 / 借出 / 流水」三组，每项显示名称、型号、余量、位置；`↑ ↓` 选择、`Enter` 打开、`Esc` 关闭；无结果时给「新建物料」快捷入口。
- **页面结构**：页面头（标题 20px + 一行描述 + 右侧主按钮）→ 吸顶工具栏（玻璃，距顶 56px）→ 内容卡片。表格容器白底、圆角 16、细边框。
- **表格**：行高 48；首列为「缩略图 + 名称 + 型号」，其余为分类、位置、拥有、可用、状态、更新时间、操作；操作按钮在 hover 或键盘聚焦时显现；低库存行左侧 3px 琥珀条；数字列右对齐。
- **详情页**：左 8 列内容（照片、基础信息、流水），右 4 列 sticky 操作卡（玻璃，含拥有/借出/可用三个数字与主操作）；不用跳页，列表状态保留在 URL query 中。
- **表单**：对话框中完成，宽 560–720px，两列栅格；`Enter` 提交、`Esc` 关闭；有未保存改动时二次确认；错误显示在字段下方。
- **键盘**：`/` 聚焦列表搜索、`n` 新建物料、`Esc` 关闭浮层、`⌘K` 全局搜索；所有可点击元素可 Tab 聚焦，焦点环 2px 主色。
- **空态与加载**：表格加载显示 8 行骨架，工具栏保持可用；空列表给出「新建物料 / 导入 CSV」两个入口。

### 8.6 移动端界面逻辑（<768px）

```
┌──────────────────────────┐
│ 顶栏 56（玻璃） 标题   ⋯  │
│ [ 搜索物料 / 型号 ]       │
│ [全部][低库存][分类][位置] │
│ ┌──────────────────────┐ │
│ │ 缩略图   名称          │ │
│ │         位置 · 余量    │ │
│ └──────────────────────┘ │
│            ……             │
│                    (+)   │
├──────────────────────────┤
│ 首页   库存   借出   我的  │
└──────────────────────────┘
```

- **导航**：底部 4 Tab（首页 / 库存 / 借出 / 我的），高 56px + 安全区；当前 Tab 主色图标 + 文字；不出现侧边栏；二级页面（详情、设置子页）顶栏出现返回箭头，返回保留列表滚动位置。
- **顶栏**：玻璃，56px；列表页把搜索框放在顶栏下方固定区，滚动时保持可见；筛选为横向滚动 chip（全部 / 低库存 / 分类 / 位置），点击「更多筛选」打开底部抽屉。
- **列表**：单列卡片（高约 96px）：56px 方形缩略图或分类色占位图标、名称（最多两行）、位置路径（单行省略）、右侧数量徽章（低库存变琥珀）；整卡可点，卡内操作不超过 2 个。
- **主操作**：仅库存列表页使用右下 FAB（56px 主色圆钮），展开为入库 / 出库 / 盘点；选择后进入全屏操作页。仪表盘在页头放「+ 入库」，详情页用吸底操作条，这两处不使用 FAB。
- **详情页**：单列堆叠；照片横向滑动（每张 72vw 宽，圆角 16）；三数字横排（拥有 / 借出 / 可用）；吸底操作条高 64px（玻璃，入库主按钮 + 借出次按钮 + 更多）；内容底部留 96px。
- **表单**：全屏页面，单列；标签在上、输入框高 48；数量用 `inputmode="numeric"`，默认 1 并带 `− / +` 步进；底部 sticky 保存大按钮；返回时若有改动先确认。
- **浮层**：所有确认用底部抽屉（圆角 20、顶部拖拽条、可下滑关闭）；危险操作按钮红色实心，文案写清后果。
- **拍照上传**：`<input type="file" accept="image/*" capture="environment">`；先本地压缩并预览，再显示上传进度。
- **反馈**：操作成功顶部轻提示（2.4s）+ 对应数字徽章脉冲一次；失败用底部抽屉给出原因和下一步（如「库存不足：当前 5，请先盘点」）。
- **触控**：点击目标 ≥ 44×44、间距 ≥ 8px；不使用长按、滑动删除等隐藏手势；不做下拉刷新（避免与浏览器手势冲突），改为顶栏刷新按钮。
- **其他**：输入框 16px 防缩放；支持横屏但不做横屏专属布局；不实现离线。

### 8.7 响应式断点与平板

| 断点 | 范围 | 布局策略 |
|---|---|---|
| `sm` | < 480px | 移动单列；KPI 2×2；卡片内字段再精简 |
| `md` | 480–767px | 移动单列；KPI 2×2；可显示两列 chip |
| `lg` | 768–1023px | 侧栏折叠为 72px rail；表格显示主要列；表单用 640px 抽屉 |
| `xl` | 1024–1279px | 完整侧栏 + 表格全部列 |
| `2xl` | ≥ 1280px | 内容居中，最大宽 1280px |

- 用 `matchMedia` 封装 `useBreakpoint()`，不使用 User-Agent 判断。
- 平板（768–1023px）同时保留触控与鼠标两套反馈：hover 只在 `@media (hover: hover)` 内生效。
- 缩放 200% 时等同进入更窄断点，不得出现横向滚动或内容截断。

### 8.8 页面设计明细

#### 8.8.1 登录 / 注册 / 两步验证

- **桌面**：左右分栏。左侧 55% 为极淡薄荷渐变、PartBin 字标与「硬件出入库系统」副标题、极简线框示意（开发板与元件盒）+ 一句「先查一下，再下单」；右侧 45% 放 420px 玻璃卡片表单。左侧图形只做视觉，不承载信息。
- **移动**：单列。顶部品牌区 120px（字标 + 副标题），表单卡片从底部顶起（顶部圆角 24），登录/注册用分段控件切换。
- **登录**：用户名、密码、主按钮。密码通过但账号启用了 2FA 时，卡片**原地切换**为验证码步骤：6 位码输入 +「使用恢复码」链接，保留「返回上一步」。登录失败统一提示「账号或密码错误」，不区分账号是否存在。
- **注册**：登录页仅在 `registrationMode` 为 `invite` 或 `open` 时显示注册页签。`invite` 模式必填邀请码（自动大写、忽略空格与短横线），`open` 模式顶部显示琥珀色风险条「开放注册期间任何人可注册只读账号」。
- **密码提示**：实时显示「至少 12 位」与强度条；提交前不暴露服务端弱口令表。
- **交互**：`Enter` 提交；字段错误内联红字；认证失败卡片轻微左右抖动 240ms（减弱动效时取消）；成功后 180ms 淡出进入首页；登录中被锁定时显示「尝试过于频繁，请 N 分钟后再试」。
- **安全细节**：不显示「首个账号成为管理员」；首个管理员由服务器 CLI 创建，页面在无用户时显示「管理员尚未初始化，请联系部署者」。

#### 8.8.2 仪表盘

- **桌面 12 栅格**：
  1. 跨 12 列：「先查一下」玻璃搜索条（高 64px），聚焦时原地展开为 Spotlight 结果浮层；
  2. 4 张 KPI 卡（物料种类 / 低库存 / 未还借出 / 本月出库），数字 28px、下方一行说明；
  3. 左 7 列「低库存 Top6」列表 + 右 5 列「最近流水」；
  4. 左 7 列「逾期与待还」+ 右 5 列「分类分布」（CSS 横向条形，无图表库）。
- **移动**：搜索条 → 2×2 KPI → 低库存卡片（最多 5 条）→ 待还 → 最近流水（5 条）；本页不显示 FAB，页头提供「+ 入库」。
- **动效**：首次进入 KPI 数字 0→目标值 count-up 500ms；卡片按 40ms 间隔依次淡入；低库存行琥珀左条 pulse 一次。
- **空态**：无物料时展示线框插画 +「新建第一个物料」+「导入 CSV」次按钮。

#### 8.8.3 库存列表

- **桌面**：页头「库存 · 共 N 种」+ 主按钮「新建物料」；吸顶玻璃工具栏含搜索、分类树、位置树、低库存开关、归档开关、排序；表格列：物料（图+名+型号）、分类、位置、拥有、可用、状态、更新时间、操作；分页在右下。
- **移动**：固定搜索 + 筛选 chip + 卡片列表；卡片不显示更新时间与分类；点击进详情。
- **状态**：低库存徽章「缺 X」；零库存「缺货」；有借出显示「借出 1」小标；归档物料整行降透明度。
- **动效**：筛选变化列表 120ms 淡入；数量变化行背景闪一次（600ms 从浅青到透明）；翻页后滚动回列表顶部，不做整页刷新跳动。
- **只读**：页头下方细条「只读账号 · 可查看全部库存」，主按钮与行内操作全部不渲染；直接访问编辑路由被路由守卫拦回详情。

#### 8.8.4 物料详情

- **桌面**：左 8 列 = 标题区（名称、编号、分类/位置 chip、低库存提示）→ 照片区（主图 16:9 + 缩略图，点击灯箱）→ 流水时间线（每页 20 条）；右 4 列 = sticky 操作卡（玻璃）：三数字（拥有 / 借出 / 可用）、主按钮「入库」、次按钮「出库」「盘点」「借出」、实例数量入口；底部「编辑 / 归档」。
- **移动**：单列。大图横滑 → 标题与 chip → 三数字横排 → 实例折叠面板 → 按天分组的流水；吸底操作条（入库 / 借出 / 更多）。
- **实例区**：桌面表格（资产编号、状态、位置、备注、操作）；移动卡片 + 状态点。状态文案：在库（绿）、借出（蓝）、维修（琥珀）、丢失（红）、退役（灰）。
- **动效**：操作成功后数字滚动 400ms，同时绿色上浮提示「−2 · 剩余 48」；新照片淡入；灯箱打开 scale .96→1；时间线新增条目从上方滑入。

#### 8.8.5 流水台账

- **桌面**：页头 + 吸顶筛选（类型 chip 多选、日期范围、物料选择）；表格列：时间、物料、类型徽章、数量（带 +/− 与颜色）、操作后余额、操作人、备注；按天分组，日期头 sticky。
- **移动**：按天分组的时间轴；每条左侧类型图标与竖线，右侧物料名、变化数字、余额小字；点击展开备注与操作人。
- **动效**：加载更多时底部 spinner 至少显示 200ms，避免闪烁。

#### 8.8.6 借出管理

- **桌面**：分段 Tab「未还 N / 逾期 N / 已还」；表格列：借用人、物料、数量（已还/总数）、借出时间、预计归还、逾期天数、操作（归还 / 撤销）；逾期行左红条。
- **移动**：分段控件 + 卡片；卡片右上角「归还」，逾期显示红色「逾期 3 天」；归还打开底部抽屉选择数量。
- **动效**：归还完成后卡片滑出并收起高度（240ms）；「已还/总数」进度条用 `transform: scaleX()` 150ms 过渡。

#### 8.8.7 设置

- **桌面**：左侧竖向 Tab（账号与安全 / 分类 / 位置 / 数据 / 用户管理 / 邀请码 / 审计），右侧内容卡片；管理员可见后三组，只读账号只看到账号与安全。
- **移动**：设置列表 → 子页；分类与位置为可展开树，点节点进入编辑页；用户、邀请码在移动端改为卡片列表。
- **用户管理**：表格显示用户名、角色、状态、2FA、最近登录、锁定状态、操作；角色切换即时生效；禁用、重置密码、解除锁定用底部抽屉二次确认；重置后展示一次性提示；所有敏感操作要求 10 分钟内 reauth。
- **导入向导**：桌面 720px 对话框、三步进度；移动全屏三步页；错误行可下载 CSV；确认前再次给出「新建 / 更新 / 不变」数量。
- **分类 / 位置**：桌面左树右表单；新增子节点在行内；删除前提示受影响的物料数。

#### 8.8.8 安全与审计（M6）

- **两步验证卡**：显示「未开启 / 已开启」；开启向导三步——扫二维码（`qrcode` 本地渲染）或手动输入密钥 → 输入 6 位验证码 → 一次性展示 10 个恢复码（可复制/下载，离开后不再显示）。关闭或重置恢复码需要重新输入密码 + 当前验证码。
- **会话卡**：列表显示设备（UA 摘要）、IP 哈希前 8 位、最近活动、当前设备标记；支持下线单个会话或「下线其他所有设备」。
- **邀请码（admin）**：表格显示码前缀、剩余次数、过期时间、状态、创建人；「新建邀请码」对话框可选次数与有效期，成功后弹层展示完整码一次，附复制按钮与「请现场发给对方」提示；撤销需确认。
- **审计（admin）**：按时间、动作、操作人筛选；表格列：时间、操作人、动作、对象、IP 哈希前 8 位、详情（展开抽屉）；支持导出 CSV（公式注入转义）；只读，无删除入口。
- **注册模式（admin）**：分段控件 closed / invite / open；切到 open 时弹出高风险确认并要求 reauth，页面顶栏同时显示「开放注册中」警示 chip。
- **提示**：管理员未开启 2FA 时，仪表盘显示一条可关闭的提示条，不阻塞使用。

### 8.9 动效规范

| 场景 | 变化 | 时长 / 缓动 |
|---|---|---|
| 页面切换 | `opacity 0→1` + `translateY(8px)→0` | 180ms / `cubic-bezier(.22,1,.36,1)`，退出 120ms 仅淡出 |
| 对话框、抽屉 | 遮罩淡入；内容 `scale(.96)→1` + fade | 200ms 进入 / 120ms 退出 |
| 底部抽屉 | `translateY(100%)→0` | 240ms / 同 easing |
| 列表首次进入 | 每项 `translateY(6px)→0` + fade，间隔 20ms（最多 6 项） | 160ms |
| 数字变化 | count-up 到新值 | 400ms / ease-out |
| 数量徽章 | `scale 1→1.08→1` 一次 | 300ms |
| 低库存提示 | 琥珀左条 `opacity .4→1→.4` 一次 | 1200ms |
| Toast | 顶部 `translateY(-8px)→0` | 180ms 进入 / 160ms 退出 |
| 骨架屏 | shimmer 背景位移 | 1.2s 循环（减弱动效时静态） |
| 卡片悬停（仅桌面） | `translateY(-2px)`；阴影用伪元素透明度渐显 | 120ms |
| 按钮按下 | `scale(.97)` | 80ms |
| FAB 展开 | 子项依次 `scale(.9)→1` | 220ms，间隔 30ms |
| 表单校验失败 | 表单卡 `translateX(±4px)` 两次 | 240ms |
| 图片灯箱 | `scale(.96)→1` + 遮罩淡入 | 240ms |

规则：

1. 只动 `transform` 与 `opacity`；不动 `width/height/top/left`，不动 `backdrop-filter` 与 `box-shadow`（用伪元素透明度模拟）。
2. 同一屏同时最多 2 个动画；进入动画不阻塞点击与输入。
3. 统一 token：`--dur-fast: 120ms`、`--dur-base: 180ms`、`--dur-slow: 240ms`、`--ease-out: cubic-bezier(.22,1,.36,1)`、`--ease-in: cubic-bezier(.4,0,1,1)`。
4. 系统开启「减弱动态效果」时（`prefers-reduced-motion: reduce`），移除位移/缩放/循环计数，只保留 ≤120ms 的透明度切换。
5. 不做视差、不做无限呼吸灯、不做背景粒子；数字变化动画仅在数量与余额上使用。
6. 页面切换不阻塞数据请求；骨架屏先于动画出现。

### 8.10 状态设计

| 状态 | 表现 |
|---|---|
| 加载 | 与最终布局同形的骨架屏（表格 8 行 / 卡片 5 张），工具栏保持可用；按钮内联 loading，不用全屏遮罩 |
| 空 | 线框图标 + 一句事实 + 一个主操作；筛选无结果时给「清除筛选」 |
| 错误 | 区块级错误卡 + 重试按钮；表单错误内联在字段下方；断网保留当前数据并提示「网络不可用」 |
| 只读 | 顶部细条说明 + 写操作入口不渲染；越权请求 403 时提示「只读账号，请联系管理员」 |
| 提交中 | 按钮禁用 + spinner；数量类操作不做乐观更新，成功后再拉取，避免两处数字不一致 |
| 长文本 | 备注、规格超过 3 行折叠，点击展开；移动端用底部抽屉看全文 |
| 危险操作 | 归档、撤销借出、禁用用户、重置密码二次确认；按钮文案写后果 |

### 8.11 无障碍与性能约束

- WCAG 2.1 AA：正文对比 ≥ 4.5:1，大字 ≥ 3:1；状态不能只靠颜色（必须带图标或文字）。
- 焦点：`:focus-visible` 显示 2px 主色环，禁止无替代的 `outline: none`；浮层打开后焦点移入，关闭后回到触发元素。
- 触控：移动端目标 ≥ 44×44；桌面点击区域 ≥ 32×32。
- 语义：图标按钮带 `aria-label`；表单 `label` 关联；表格有可读标题；照片 `alt` 使用物料名。
- 键盘：Tab 可达全部操作；`Esc` 关闭浮层；灯箱支持左右方向键。
- 缩放：200% 下不截断、不横向滚动；容器用 `min-height` 而非固定高度。
- 性能预算：首屏 JS ≤ 350KB gzip（Element Plus 按需引入）；路由切换 < 100ms；单页 100 条列表渲染 < 50ms；每屏玻璃元素 ≤ 3；图片懒加载 + `decoding="async"`。
- 照片缩略图使用原图 + CSS 裁切（MVP 不做服务端缩图），列表限制单张 ≤ 400KB（前端压缩后）。

### 8.12 前端工程实现映射

- **样式组织**：
  - `web/src/styles/tokens.css`：颜色、字号、圆角、阴影、间距、动效 token；
  - `web/src/styles/glass.css`：`.glass` / `.glass-strong` 与 `@supports` 降级；
  - `web/src/styles/motion.css`：过渡类、列表 stagger、`reduce-motion`；
  - `web/src/styles/element.css`：Element Plus 变量覆盖（主色、圆角 8px、字体、输入框高度 40、表格行高 48）；
  - 组件样式一律 `scoped`，页面级布局样式跟随页面文件。
- **组件清单**：
  - `AppShell.vue`：按断点渲染桌面侧栏 + 顶栏 / 移动底栏，统一 `RouterView` 过渡；
  - `GlassPanel.vue`、`PageHeader.vue`、`SpotlightSearch.vue`；
  - `QuantityBadge.vue`：数字 + 单位 + 低库存态 + 变化脉冲；
  - `ItemTable.vue`（桌面）/ `ItemCard.vue`（移动）；
  - `SheetDialog.vue`：桌面 `el-dialog`、移动底部抽屉的统一封装；
  - `MovementTimeline.vue`、`LoanCard.vue`、`PhotoGallery.vue`、`TreePicker.vue`、`FilterChips.vue`、`EmptyState.vue`、`SkeletonList.vue`、`StatCard.vue`。
- **技术约定**：Vue 3 `<script setup>`；Vue Router history 模式；Pinia 两个 store（`auth`、`dictionary`）；`fetch` 封装统一处理 401/403 与 Toast；请求竞态用 `AbortController`；搜索 250ms 防抖；列表分页走服务端；`useBreakpoint()` 与 `useReducedMotion()` 两个 composable；动画只用 CSS 与 Vue `<Transition>`，不引入动画库；图表用 CSS 实现，不引入 ECharts。

### 8.13 界面验收清单

- [ ] 1280px：侧栏展开、表格 8 列、吸顶工具栏为玻璃且内容从下方穿过
- [ ] 768–1023px：表单改为抽屉，侧栏折叠为 72px rail，次要列隐藏；1024px 起恢复完整侧栏与全部列
- [ ] 375px：底栏 4 Tab、卡片列表、FAB / 吸底操作条，无横向滚动
- [ ] 只读账号：全站无写按钮、无 FAB，直接访问编辑路由被拦截
- [ ] 毛玻璃：Chrome / Safari 正常；禁用 `backdrop-filter` 后降级为实色，对比度仍合格
- [ ] 编辑未保存返回有确认；字段错误内联展示
- [ ] 系统开启「减弱动态效果」后无位移、缩放、循环动画
- [ ] 200% 缩放无截断、无横向滚动
- [ ] 键盘：Tab 覆盖全部操作，`Esc` 关闭浮层，`/` 与 `⌘K` 聚焦搜索
- [ ] iPhone Safari 聚焦输入框不放大页面（16px）
- [ ] 灯箱 `Esc` 关闭、方向键切换；照片 `alt` 为物料名
- [ ] 单屏玻璃元素 ≤ 3，滚动无明显掉帧

---

## 9. 关键流程

### 9.1 初始化与注册

```
部署后初始化（无 Web 自助）：
  node server/scripts/create-admin.js --username admin
    → 校验密码策略 → INSERT user(role=admin) → 写审计 → 退出

邀请制注册：
  管理员在设置页创建邀请码 → 明文只返回一次（PB-XXXX-XXXX-XXXX）
  用户 POST /api/auth/register { username, password, inviteCode }
    → 校验 registration_mode（closed 直接 403）
    → BEGIN IMMEDIATE
        → SHA-256(inviteCode) 查 invite：未过期且 used_count < max_uses
        → 规范化 username_norm、查重
        → INSERT user(role=user)
        → UPDATE invite SET used_count = used_count + 1
    → COMMIT
    → 创建 session、写 Cookie → 审计 register
```

### 9.2 登录、2FA 与鉴权

```
POST /api/auth/login
  → 规范化 username_norm 查 user
  → locked_until > now → 429（文案不暴露账号是否存在）
  → 账号不存在也执行一次 scrypt（时间侧信道防护）
  → 密码失败：写 login_attempt(success=0) → 计数/锁定 → 401 或 429
  → 密码正确且已启用 2FA：
       无 code → 401 TOTP_REQUIRED
       有 code → 校验 TOTP（±1 步、totp_last_step 防重放）或恢复码（一次性）
  → 清失败计数、写 login_attempt(success=1)
  → INSERT session（token 哈希、ip_hash、UA、idle 与 absolute 过期）
  → 更新 last_login_at、下发 __Host Cookie、审计 login.success
  → 返回 user

任意 /api/* 请求
  → onRequest 读 cookie → 查 session（idle 与 absolute 都未过期）
  → 联查 user（is_active=1），角色以数据库为准
  → 挂 request.user / request.session
  → 敏感路由再检查 reauth_at（10 分钟）
  → 滑动续期只延长 idle 过期，不突破 absolute
```

### 9.3 入库 / 出库 / 盘点（唯一入口）

```
services/movements.record({ itemId, type, quantity, direction?, note, occurredAt, instanceId?, loanId?, user })
  → BEGIN IMMEDIATE
  → 读 item（带 role 已由路由校验）
  → 计算 delta 与 newQuantity
  → newQuantity < 0 → 抛 INSUFFICIENT_STOCK（回滚）
  → UPDATE item SET quantity = newQuantity, updated_by = user.id, updated_at = now
  → INSERT movement（含 balance_after = newQuantity, user_id）
  → COMMIT
  → 返回 movement + item 摘要
```

### 9.4 实例批量创建

```
POST /api/items/:id/instances/batch { count: 5, prefix: "STM32-A" }
  → 校验 tracking_mode = 'instance' 且 1 <= count <= 100
  → BEGIN IMMEDIATE
  → 生成 asset_no: prefix-001 … prefix-005（冲突则整体失败并提示）
  → INSERT item_instance × count（status=in_stock）
  → INSERT movement(type=in, quantity=count, delta=+count, balance_after=新总量)
  → UPDATE item.quantity += count
  → COMMIT
```

### 9.5 借出与部分归还

```
POST /api/loans { itemId, quantity, borrower, ... }
  → available = quantity - 未还借出总量
  → quantity > available → INSUFFICIENT_STOCK
  → BEGIN IMMEDIATE
  → INSERT loan
  → 实例制：把指定实例 status 改为 lent
  → INSERT movement(type=borrow, quantity, delta=0, loan_id, balance_after=当前拥有量)
  → COMMIT

POST /api/loans/:id/return { quantity }
  → 校验 loan 未结清且 quantity <= 未还数量
  → BEGIN IMMEDIATE
  → returned_quantity += quantity
  → 若等于 quantity 则 returned_at = now
  → 实例制：把对应实例恢复 in_stock
  → INSERT movement(type=return, quantity, delta=0, balance_after)
  → COMMIT
```

### 9.6 CSV 导入

```
preview:
  解析（去 BOM、兼容 CRLF、支持引号内逗号/换行）
  → 逐行映射（中文表头 / 英文别名）
  → 校验必填、类型、长度
  → 匹配：code 唯一匹配 → 否则 (name, model, unit) 精确匹配
  → 输出 create/update/unchanged/error 与数量差
commit:
  → 同一文件重新解析（不信任 preview 结果）
  → BEGIN IMMEDIATE
  → 新建 item（数量作为一条 in 流水；实例制只建物料，数量须为 0）
  → 已存在 item：数量差生成 adjust 流水（备注「CSV 导入」）
  → 分类/位置不存在时按路径自动创建（父级用 / 分隔）
  → COMMIT
```

### 9.7 照片上传

```
前端：FileReader → canvas 缩放到最长边 1600px → toBlob('image/jpeg', 0.8)
  → POST /api/photos（multipart）
  → 服务端：大小/魔数校验 → sha256 → 命中已有则复用
      → 落盘 DATA_DIR/uploads/YYYYMM/<uuid>.jpg → INSERT photo
  → 返回 photoId → PUT /api/items/:id/photos 更新相册
```

### 9.8 启动与迁移

```
启动 → 读取并校验 env → mkdir -p DATA_DIR/{uploads,backups}
  → 打开数据库（WAL、外键、busy_timeout）
  → PRAGMA quick_check（失败则拒绝启动，提示从备份恢复）
  → 执行未应用的迁移（每个文件一个事务）
  → 清理过期会话
  → 注册 Fastify 插件/路由 → 监听 HOST:PORT
  → 打印访问地址与「尚无账号，请运行 create-admin.js」提示（user 表为空时）
SIGTERM → 停止接收新请求 → 等待进行中请求 → wal_checkpoint(TRUNCATE) → 关库 → 退出 0
```

### 9.9 两步验证

```
POST /api/auth/totp/setup（登录 + reauth）
  → 生成 20 字节随机密钥，AES-256-GCM 加密暂存
  → 返回 { secret（Base32）, otpauthUri }；前端本地渲染二维码

POST /api/auth/totp/enable（登录 + reauth）
  → 校验 6 位码（±1 步）→ 写入 totp_enabled、清空 totp_last_step
  → 生成 10 个恢复码，库中只存 SHA-256，明文一次性返回
  → 审计 totp.enable

登录时 2FA 校验
  → 先查恢复码（未使用、哈希匹配）→ 标记 used_at
  → 再校验 TOTP：允许当前步 ±1，且 step > totp_last_step
  → 成功后更新 totp_last_step

POST /api/auth/totp/disable（登录 + reauth）
  → 校验密码 + 当前验证码 → 清空 secret/恢复码 → 吊销其他会话 → 审计
```

### 9.10 邀请码与开户

```
POST /api/invites（admin + reauth）
  → 生成 24 字节随机 → 编码为 PB-XXXX-XXXX-XXXX
  → 存 SHA-256、role=user、max_uses、expires_at、created_by
  → 返回明文 code 一次 → 审计 invite.create

注册消费
  → BEGIN IMMEDIATE
  → 条件更新：UPDATE invite SET used_count = used_count + 1
      WHERE id = ? AND used_count < max_uses AND expires_at > now
  → changes = 0 则 400 INVITE_INVALID
  → INSERT user 后 COMMIT
```

### 9.11 敏感操作重认证

```
POST /api/auth/reauth { password, totpCode? }
  → 校验密码（启用 2FA 时还需 TOTP）
  → UPDATE session SET reauth_at = now
  → 返回 { reauthUntil }

管理端敏感路由 preHandler：
  → session.reauth_at 距今 < 10 分钟，否则 403 REAUTH_REQUIRED
  → 前端收到后弹出「确认身份」对话框，成功后重试原请求
```

### 9.12 审计与清理

- 每个写服务在**同一事务**内调用 `audit.record()`；审计写入失败则整个操作回滚。
- 启动与每日 03:10 清理：过期会话、30 天前 `login_attempt`、过期未用邀请码、180 天前 `audit_log`；记录清理条数。
- 备份前后写运维日志（journald），不写业务审计，避免与业务事务耦合。

---

## 10. 实现约定

### 10.1 目录细化

```
server/
├─ package.json                  # @partbin/server；scripts: dev/start/test
├─ src/
│  ├─ index.js                   # 装配：env → db → plugins → routes → listen
│  ├─ app.js                     # 构建 Fastify 实例（供测试 inject）
│  ├─ env.js                     # 读取/校验环境变量，给出默认值
│  ├─ db/
│  │  ├─ connection.js           # 打开数据库、PRAGMA、withTransaction()
│  │  ├─ migrate.js              # 迁移运行器
│  │  └─ migrations/{001_init,002_rename_site,003_security}.sql
│  ├─ lib/
│  │  ├─ errors.js  time.js  validate.js  tree.js
│  │  ├─ password.js             # scrypt 参数、策略与弱口令表
│  │  ├─ crypto.js               # AES-256-GCM / HMAC / 安全随机码
│  │  ├─ totp.js                 # RFC 6238 生成与校验
│  │  ├─ session.js              # token、Cookie 选项、reauth 判定
│  │  ├─ lockout.js              # 持久化登录失败计数与锁定
│  │  ├─ audit.js                # 事务内写审计
│  │  ├─ ip.js                   # IP 归一化与 HMAC 哈希
│  │  ├─ headers.js              # CSP / HSTS / COOP / Permissions-Policy
│  │  ├─ rate-limit.js           # 注册与普通接口限速
│  │  ├─ csv.js  image.js  invite-code.js
│  ├─ plugins/auth.js            # 会话解析 + requireAdmin + requireReauth
│  ├─ services/
│  │  ├─ users.js  sessions.js  invites.js  audit-log.js  totp.js
│  │  ├─ settings.js  categories.js  locations.js
│  │  ├─ items.js  movements.js  instances.js  loans.js
│  │  └─ photos.js  transfer.js  stats.js
│  └─ routes/
│     ├─ auth.routes.js  security.routes.js  users.routes.js  meta.routes.js
│     ├─ invites.routes.js  audit.routes.js  settings.routes.js
│     ├─ categories.routes.js  locations.routes.js
│     ├─ items.routes.js  instances.routes.js  movements.routes.js
│     └─ loans.routes.js  photos.routes.js  transfer.routes.js
├─ scripts/{seed,seed-demo,backup,restore-drill,check,reconcile,
│           create-admin,create-invite,unlock-user,reset-password,revoke-sessions,security-check}.js
└─ test/{security,totp,invites,audit,sessions,auth,users,items,movements,
         instances,loans,transfer,photos,migrations}.test.js
```

### 10.2 编码规则

- 路由层只做「鉴权 → 参数校验 → 调 service → 返回」，不写 SQL。
- 所有数量相关写操作必须经 `services/movements.record()`；实例状态变化经 `services/instances.transition()`。
- 事务统一用 `withTransaction(fn)`（`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`），事务内不 await 非数据库异步操作。
- SQL 一律预编译；排序/筛选字段走白名单映射。
- 错误抛 `AppError`，全局错误处理器转成统一 JSON；未知错误记日志（含 requestId）并返回 `INTERNAL`。
- 日志字段：`requestId`、`method`、`url`、`status`、`durationMs`、`userId`；不记录密码、Cookie、TOTP、完整 IP。
- 所有管理员写操作必须在同一事务内调用 `audit.record()`；审计失败则回滚。
- 敏感路由统一挂 `requireReauth` preHandler，不要在各路由里手写判断。
- 密码策略只有一处实现（`lib/password.js`），注册、改密、重置、CLI 共用。
- 登录失败计数与锁定只经 `lib/lockout.js`，禁止再用进程内 Map。
- IP 一律经 `lib/ip.js` 转成哈希后落库；日志与审计只写前 8 位用于关联。
- 安全响应头由 `lib/headers.js` 统一注入：`default-src 'self'`、`script-src 'self'`、`style-src 'self' 'unsafe-inline'`（Element Plus 运行时样式需要）、`img-src 'self' data:`、`connect-src 'self'`、`frame-ancestors 'none'`、`base-uri 'none'`、`form-action 'self'`。
- CSV 导出对以 `= + - @` 开头的单元格加 `'` 前缀，防公式注入。
- 上传图片响应附加 `Content-Security-Policy: default-src 'none'; sandbox` 与 `X-Content-Type-Options: nosniff`。
- 前端不写死接口地址；`/api` 相对路径，dev 由 Vite 代理。

---

## 11. 非功能需求

| 项 | 目标 |
|---|---|
| 性能 | 1000 物料 + 5 万流水：列表查询 < 100ms（P95），首屏 < 1s；单次写入 < 50ms |
| 容量 | 物料 ≤ 10 000，流水 ≤ 500 000，照片 ≤ 5 GB；超出后提示归档/备份 |
| 并发 | 公网 10–20 个在线客户端；写操作串行；登录/注册受持久化限速；SQLite `busy_timeout=5000` |
| 可用性 | 单机；systemd `Restart=on-failure`；重启后 3 秒内可用；月可用性目标 99.5% |
| 可维护性 | 本地快照 + restic 异地加密备份；恢复演练每月一次；升级前自动备份 |
| 兼容性 | Debian 12 / Ubuntu 22.04 / 24.04，x86_64；Node ≥ 22.19（推荐 24）；现代浏览器（Chrome/Edge/Safari 近两年） |
| 可观测性 | `/health`、JSON 日志、Uptime 监控、证书到期、磁盘空间、备份结果告警 |
| 安全 | 默认关闭注册；scrypt + 弱口令表；登录持久化限速与锁定；TOTP 2FA；CSP/HSTS；审计留存 180 天 |
| 数据保留 | `login_attempt` 30 天、`audit_log` 180 天、会话按过期清理；不收集邮箱 |
| 界面 | 375–1440px 无横向滚动；桌面与移动各自布局；毛玻璃、动效均可按系统能力降级；200% 缩放可用 |

---

## 12. 安全设计

定位：**公网可部署的自托管系统**。假设互联网上任何人都能访问 443，安全目标是「即使被持续扫描与撞库，账号与数据仍然安全」。

### 12.1 威胁模型与信任边界

| 项 | 内容 |
|---|---|
| 暴露面 | 443 公开；80 仅跳转/ACME；SSH 限来源或关闭；8787 与 SQLite 永不对外 |
| 主要对手 | 自动化扫描器、撞库与凭证填充、暴力破解、爬虫、依赖或配置漏洞利用、数据窃取/勒索、针对性 DDoS |
| 信任边界 | 浏览器不可信；Caddy/Cloudflare 只负责传输，应用是唯一授权点；SQLite 与服务器文件系统可信；备份介质不可信（必须加密） |
| 安全目标 | 保密性（库存、借出人、账号）；完整性（数量可由流水解释、审计不可篡改）；可用性（限速、备份、快速恢复） |
| 不在范围 | 大规模 DDoS 清洗、0day、物理接触、供应链投毒（只做缓解） |

### 12.2 认证

- **密码**：12–64 字符，禁止与用户名相同、纯空格与弱口令表命中项；scrypt（N=32768，r=8，p=1，64B，maxmem 64MiB），参数写在哈希串里，登录时透明升级；比较用 `timingSafeEqual`。
- **账号枚举**：登录失败一律 401「账号或密码错误」；账号不存在也跑一次真实成本哈希；锁定与限速文案不暴露账号是否存在。
- **持久化限速**（写入 `login_attempt`，重启不清零）：

| 维度 | 规则 | 超限 |
|---|---|---|
| 单账号 | 15 分钟内 5 次失败 | 锁定 15 分钟，429 + `Retry-After` |
| 单 IP | 15 分钟内 20 次失败 | 拒绝该 IP 登录 15 分钟 |
| 注册 | 每 IP 10 次/小时；open 模式 3 次/小时 | 429 |
| 2FA 验证 | 5 次/5 分钟 | 429，需重新登录 |
| reauth | 5 次/10 分钟 | 429 |

- **两步验证**：TOTP（RFC 6238，30 秒、SHA-1、6 位、±1 步），启用后登录必须验证；10 个一次性恢复码；`totp_last_step` 防重放。管理员登录后若未启用 2FA，界面持续提示。
- **注册**：默认 `invite`；邀请码 24 字节随机、库中只存 SHA-256、可限次数与有效期、创建时明文仅展示一次；`open` 模式必须管理员 reauth 后手动开启并显示风险警示。
- **引导**：无「首个注册者即管理员」；管理员只能由服务器 CLI 创建，避免公网抢注。
- **重认证**：敏感操作要求 10 分钟内通过密码（+ 2FA）重新验证，结果记在 `session.reauth_at`。

### 12.3 会话

- Cookie：生产 `__Host-partbin_sid`（`Secure`、`HttpOnly`、`SameSite=Lax`、`Path=/`、无 `Domain`）；纯 HTTP 开发环境降级为 `partbin_dev_sid`。
- 数据库只存 token 的 SHA-256；每次登录新 token；不把 token 放进 URL、localStorage 或日志。
- 双过期：空闲 7 天滑动续期，绝对 30 天硬上限；禁用、降权、改密、关闭 2FA 时吊销相关会话。
- 会话记录 `ip_hash`、UA（截断 255 字符）、创建与最后活动时间；用户可在设置里查看设备并单独/全部下线。
- 退出登录使用 POST + 同源校验，防 CSRF 强制登出。
- 鉴权失败统一 401；已登录但无权限统一 403，不泄露资源是否存在。

### 12.4 授权与审计

- 角色仅 `admin` / `user`；写接口与敏感接口在路由层统一挂 `requireAdmin` / `requireReauth`，服务层再做对象归属校验。
- 所有资源操作按 id 查询后再判定权限，禁止「只信前端传回的角色」。
- **审计**：`audit_log` 记录登录成功/失败、注册、邀请码、角色/状态变更、密码重置、2FA 变更、会话吊销、库存写入、导入导出、安全设置；同一事务写入，只增不改不删。
- 审计查看与导出仅管理员且需 reauth；保留 180 天；日志中不写密码、TOTP、token、完整 IP。

### 12.5 Web 应用防护

| 风险 | 措施 |
|---|---|
| CSRF | 仅 Cookie 鉴权；`SameSite=Lax`；状态变更校验 `Origin` 或 `Sec-Fetch-Site: same-origin` 且匹配 `PUBLIC_ORIGIN`；跨站来源直接 403 |
| XSS | Vue 默认转义；禁止 `v-html` 渲染用户数据；CSP `script-src 'self'`；上传文件不当作 HTML 解析 |
| 点击劫持 | `frame-ancestors 'none'` + `X-Frame-Options: DENY` |
| SQL 注入 | 全量预编译；LIKE 通配符转义；排序/筛选白名单 |
| 开放重定向 | 登录后跳转只接受站内相对路径，拒绝 `//` 与绝对 URL |
| CSV 公式注入 | 导出单元格以 `= + - @` 开头时前置 `'` |
| 上传 | 魔数 + 大小（≤8MB）+ 尺寸上限；仅 JPEG/PNG/WebP，拒绝 SVG；服务端随机文件名、非静态目录、鉴权流式返回；响应加 `nosniff` 与 `CSP: sandbox` |
| 请求滥用 | JSON body ≤ 1MB；multipart ≤ 8MB；写接口按 IP 限速（120 次/分钟）；请求超时与连接数上限由 Caddy 控制 |
| 信息泄露 | 统一错误 JSON；500 不回堆栈；安全响应头齐全；版本号只出现在 `/health` 的 `version` 字段 |

安全响应头基线：

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: same-origin
Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

> `style-src 'unsafe-inline'` 是 Element Plus 运行时内联样式的必要妥协；脚本侧不放开内联，也不使用 `unsafe-eval`。

### 12.6 网络与传输

- TLS 1.2+（优先 1.3），真实 CA 证书，Caddy 自动续期；上线首日 HSTS 先设 86400，稳定后加到 31536000；可选 preload（需谨慎）。
- 公网只开 443；80 仅跳转与 ACME；SSH 改端口或限制来源，禁用密码登录与 root 登录。
- 推荐 Cloudflare 代理或 Tunnel：隐藏源站 IP、吸收部分 DDoS；`TRUSTED_PROXIES` 只填其回源网段，禁止无条件信任 `X-Forwarded-For`。
- ufw 默认拒绝入站；fail2ban 监控 Caddy 与应用日志（401/429 模式），封禁 1 小时，白名单自己的管理 IP。
- Caddy 层设置请求体上限、超时、访问日志（不含 Cookie），并兜底 HSTS。
- 目标：SSL Labs A 级；securityheaders.com A 级。

### 12.7 数据保护

- `APP_SECRET` ≥32 字节随机值，仅存 `/etc/partbin/env`（0600）；用于 TOTP 加密、IP 哈希与一次性令牌。轮换后 TOTP 需重新绑定、旧 IP 哈希失效，属预期。
- 数据目录 0700、属主 `partbin`；建议服务器整盘 LUKS 加密；数据目录禁止放在 web 根或 NFS/SMB。
- 备份用 restic 加密后传到异地（另一台机器/NAS/对象存储），密码离线保管；本地快照仅作快速回滚。每月做一次恢复演练并记录结果。
- 数据最小化：不收集邮箱、手机、真实姓名；IP 只存哈希；UA 截断；`login_attempt` 30 天、`audit_log` 180 天。
- 照片：客户端压缩时重新编码，天然去除 EXIF；服务端仍做类型/大小校验，照片只能经鉴权接口读取，不生成公开直链。

### 12.8 监控、告警与应急

- 监控项：`/health` 可用性、证书剩余天数、磁盘使用率、备份最近成功时间、5xx 比例、登录失败与 429 突增、fail2ban 封禁事件。
- 告警渠道使用 Uptime Kuma / healthchecks.io 自带通知（邮件或推送），应用本身不集成 SMTP。
- 应急手册（写入 `docs/SECURITY.md`）：
  1. **隔离**：Cloudflare 开 Under Attack 或 ufw 封禁来源；必要时停服；
  2. **止血**：吊销全部会话（管理员界面一键 + CLI `scripts/revoke-sessions.js`）、禁用可疑账号、重置管理员密码；
  3. **取证**：导出 `audit_log` 与 journald 日志，保留现场；
  4. **恢复**：从最近一次通过校验的加密备份恢复，跑 `db:check` 与 `security-check`；
  5. **复盘**：确认入口（弱口令/依赖/配置）、打补丁、轮换 `APP_SECRET` 与所有密码、重新绑定 2FA。
- 每季度演练一次「备份恢复 + 会话吊销 + 证书续期」。

### 12.9 供应链与主机加固

- 锁定 `pnpm-lock.yaml`，CI/升级前跑 `pnpm audit`；生产只装必要依赖；禁用不必要的 postinstall。
- Node 跟随 LTS 安全更新；Caddy 用系统包自动更新；Docker 镜像按 digest 固定并定期重建。
- systemd：`NoNewPrivileges`、`PrivateTmp`、`ProtectSystem=strict`、`ProtectHome`、`RestrictAddressFamilies`、`CapabilityBoundingSet=`、`SystemCallFilter=@system-service`、`UMask=0077`。
- Docker：`read_only`、`cap_drop: ALL`、`no-new-privileges`、非 root、不发布 8787、tmpfs 仅 `/tmp`。
- 主机：SSH 仅密钥、禁 root、fail2ban、`unattended-upgrades`、时区与 NTP 正确（TOTP 依赖时间）、日志轮转。

### 12.10 安全测试与上线门槛

上线前必须全部通过：

- [ ] SSL Labs A 级、HSTS 生效、HTTP 自动跳转、证书自动续期演练成功
- [ ] 8787 从公网不可达；扫描仅见 443（与受限 SSH）
- [ ] 默认 `registration_mode=invite` 或 `closed`；无默认口令；管理员由 CLI 创建
- [ ] 管理员已启用 TOTP，恢复码已离线保存
- [ ] 连续失败触发锁定，换 IP 后仍受账号维度限制；重启服务后限制仍生效
- [ ] Cookie 为 `__Host-` 前缀，`Secure`、`HttpOnly`、`SameSite=Lax`
- [ ] `securityheaders.com` 与 CSP 检查通过；无 `unsafe-eval`
- [ ] Origin / `Sec-Fetch-Site` 跨站写请求被 403；开放重定向测试失败
- [ ] CSV 导出公式注入被转义；上传 SVG/HTML/超大文件被拒绝
- [ ] 审计日志覆盖登录、用户管理、邀请码、库存写操作；无敏感信息
- [ ] 备份加密、异地存储、恢复演练成功且 `db:check` 全绿
- [ ] fail2ban 生效；SSH 禁密码与 root；`unattended-upgrades` 开启
- [ ] `pnpm audit` 无高危；依赖与镜像已固定版本
- [ ] 监控告警（宕机、证书、磁盘、备份）实际触发过一次
- [ ] 应急手册与实际操作一致，管理员能在 30 分钟内完成「封禁 + 吊销会话 + 恢复」

可选：OWASP ZAP baseline 扫描、`nuclei` 模板扫描、外部渗透测试。

### 12.11 残余风险

| 风险 | 说明与缓解 |
|---|---|
| 无自建 DDoS 清洗/WAF | 依赖 Cloudflare 或主机商；应用只做限速与体积限制 |
| SQLite 单写者 | 写洪峰可能拖慢；写接口限速、事务短小、监控慢查询 |
| 共享库存对已登录用户可见 | 产品设计如此；只读账号按邀请发放，离职/离组及时禁用 |
| 无邮箱自助找回 | 账号失联需管理员或 CLI 介入；管理员丢失时用 `create-admin.js` 恢复 |
| TOTP 依赖设备与时间 | 提供恢复码；服务器 NTP 必须正常 |
| 照片 EXIF 清除依赖浏览器 canvas | 服务端只做类型与体积校验；敏感照片建议先本地处理 |
| 自托管供应链责任 | 锁文件、审计、固定镜像、及时打补丁 |

---

## 13. 测试策略

### 13.1 自动化（`pnpm test`，Vitest + `app.inject()`）

每个测试用独立临时数据目录 + 真实迁移，不 mock 数据库。

| 文件 | 覆盖 |
|---|---|
| `migrations.test.js` | 001/002/003 建表、重复执行幂等、ALTER 列存在、约束生效（重复编号、负数量、非法枚举） |
| `security.test.js` | CSP/HSTS/COOP 等响应头；`__Host-` Cookie 属性；Origin 与 `Sec-Fetch-Site` 跨站写请求 403；开放重定向拦截；CSV 公式注入转义；JSON/上传体积上限；日志不含密码与 token |
| `auth.test.js` | 三种注册模式；邀请码一次性/过期；无首人管理员；密码 12 位与弱口令表；登录成功/失败；锁定在进程重启后仍生效；退出；空闲与绝对过期；禁用即时失效 |
| `totp.test.js` | 开启流程、登录必须验证码、错误码、同窗口重放被拒、恢复码一次性、关闭需密码 + 验证码 |
| `invites.test.js` | 创建/撤销、剩余次数、过期、码哈希存储、明文只返回一次、并发消费不超发 |
| `audit.test.js` | 登录、用户管理、邀请码、库存写操作均落审计；审计不可更新/删除；筛选与导出；不含敏感字段 |
| `users.test.js` | 只读账号写接口 403；改角色/禁用/重置密码需要 reauth；最后一个管理员保护；不能禁用自己；解锁账号 |
| `sessions.test.js` | 会话列表、下线单个、下线其他、改密/降权后旧会话失效、`reauth_at` 超时拒绝敏感操作 |
| `items.test.js` | 增删改查、归档/恢复、分类与位置路径、搜索多关键字、低库存筛选、分页、排序白名单 |
| `movements.test.js` | 入库/出库/盘点/报废/丢失、超库存 409 且无流水、`balance_after`、操作人、并发两次出库总额正确、实例制拒绝批量出库 |
| `instances.test.js` | 批量创建 asset_no 递增与冲突、状态迁移与数量不变量、借出后标记丢失提示、退役写流水 |
| `loans.test.js` | 借出可用量校验、部分归还、还清 `returned_at`、逾期筛选、撤销仅限未归还、实例借还联动 |
| `transfer.test.js` | CSV BOM/CRLF/引号、preview 不写库、坏行错误定位、commit upsert 幂等、数量差生成 adjust、二次导入 unchanged |
| `photos.test.js` | 非图片魔数 415、超 8MB 413、SVG/HTML 伪装拒绝、sha256 去重、未登录不可读、删除被引用 409 |
| `check.test.js` | `db:check` 能发现人为制造的 `quantity` 漂移 |

另加一项性能冒烟（脚本而非单测）：seed 1000 物料 / 5 万流水，测列表与统计耗时并打印。

### 13.2 手工验收清单

**账号与安全**

- [ ] 空库启动 → 页面提示「管理员尚未初始化」；运行 `create-admin.js` 后可登录
- [ ] 用第二个账号尝试注册 → 默认模式下被拒绝
- [ ] 管理员生成邀请码 → 凭码注册成功 → 同一码再次使用失败
- [ ] 连续输错 5 次密码 → 429；重启服务后仍被锁定
- [ ] 管理员开启 2FA → 退出重登时要求验证码；用恢复码可登录一次，第二次失效
- [ ] 会话页可下线其他设备；改密后其他设备立即失效
- [ ] 修改角色 / 重置密码 / 生成邀请码在 10 分钟后要求重新输入密码
- [ ] 普通账号访问 `/api/users`、`/api/invites`、`/api/audit` → 403
- [ ] 审计页能看到上述操作，且不含密码、token、完整 IP
- [ ] 桌面 1280px 与手机 375px 分别走一遍 8.13 界面验收清单

**公网暴露**

- [ ] SSL Labs A 级；HTTP 自动跳转 HTTPS；HSTS 生效
- [ ] 从公网扫描只见 443（与受限 SSH）；8787 不可达
- [ ] 浏览器开发者工具确认 Cookie 为 `__Host-`、Secure、HttpOnly、SameSite=Lax
- [ ] 跨站 POST（curl 带错误 Origin）→ 403；正常站点操作不受影响
- [ ] 上传 SVG/HTML/超大文件被拒绝；照片必须登录后才能访问
- [ ] fail2ban 能封禁连续失败的来源；SSH 禁密码与 root
- [ ] 监控能对停机、证书到期、磁盘、备份失败发出告警

**业务功能**

- [ ] 手机访问 HTTPS → 登录 → 搜索 `STM32` → 看到余量与位置
- [ ] 新建物料并上传手机照片 → 详情页可看图
- [ ] 入库 10 → 出库 3 → 详情显示 7，流水两条各带操作人与余额
- [ ] 出库 999 → 提示库存不足，数量不变、流水不增
- [ ] 盘点调整到 5 → 生成 `adjust` 流水（差 -2）
- [ ] 借出 3 → 可用量减少；归还 1 → 未还 2；全部归还 → 出现在「已还」
- [ ] 实例制物料批量建 5 块板 → 拥有量 5，实例编号 `-001…-005`
- [ ] 低库存物料在列表显示琥珀色提示并出现在仪表盘
- [ ] 导出 `items.csv`，Excel 打开中文不乱码、危险公式被转义
- [ ] 导入含错误行的 CSV → 预览报错行号；修正后确认导入成功；重复导入显示 unchanged
- [ ] 管理员禁用某账号 → 该账号立即无法访问
- [ ] 重启服务器 → 服务自动恢复、数据完整
- [ ] 执行加密备份 → 在另一台机器 restic 恢复 → `db:check` 全绿

---

## 14. 部署与运维

> 完整命令、排错表与恢复演练步骤在实现阶段写入 `docs/DEPLOY.md` 与 `docs/SECURITY.md`；本节固定路径、端口、边界与上线顺序。

### 14.1 前置条件与方案选择

- 服务器：Debian 12 / Ubuntu 22.04+ x86_64，1 vCPU / 1GB 内存起步；能访问 npm 源（否则用 Docker 镜像导入）。
- 域名：**必须**。`partbin.example.com` 的 A/AAAA 记录指向服务器，Caddy 自动申请 Let's Encrypt 证书；也可用 DNS-01 不暴露 80。
- 备份目的地：另一台机器、NAS 或对象存储，用于 restic 加密仓库；**不要与数据盘同盘**。
- 公网入口二选一：

| 方案 | 适用 | 要点 |
|---|---|---|
| A. 公网 IP + Caddy | 云主机、有固定公网 IP | 只开 443；SSH 限制来源；ufw + fail2ban |
| B. Cloudflare Tunnel | 家庭宽带、无公网 IP | 无入站端口；源站隐藏；`TRUSTED_PROXIES` 填 Cloudflare 回源网段 |

- 无论哪种方案，应用只监听 `127.0.0.1:8787`，绝不直接暴露公网。

### 14.2 主机初始化与网络边界

```bash
# 基础软件与 Node
sudo apt update && sudo apt install -y curl git ufw fail2ban unattended-upgrades
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pnpm@11

# 专用用户与目录
sudo useradd --system --home /opt/partbin --shell /usr/sbin/nologin partbin
sudo mkdir -p /opt/partbin /etc/partbin \
  /var/lib/partbin/uploads /var/lib/partbin/backups
sudo chown -R partbin:partbin /opt/partbin /var/lib/partbin
sudo chmod 700 /var/lib/partbin

# SSH：仅密钥、禁 root（/etc/ssh/sshd_config.d/10-partbin.conf）
#   PasswordAuthentication no
#   PermitRootLogin no
sudo systemctl restart ssh

# 防火墙：默认拒绝，只开 443/80 与受限 SSH
sudo ufw default deny incoming
sudo ufw allow 443/tcp
sudo ufw allow 80/tcp
sudo ufw allow from <你的管理 IP> to any port 22 proto tcp
sudo ufw enable
```

- 使用 Cloudflare Tunnel 时可不开 80/443，只保留本机回环。
- 开启自动安全更新：`sudo dpkg-reconfigure --priority=low unattended-upgrades`。
- 时间同步：`sudo timedatectl set-ntp true`（TOTP 依赖准确时间）。

### 14.3 systemd 部署（主推）

```bash
# 代码与构建
sudo -u partbin git clone <repo-url> /opt/partbin
cd /opt/partbin
sudo -u partbin pnpm install --frozen-lockfile
sudo -u partbin pnpm build

# 环境变量
sudo install -m 600 -o root -g partbin deploy/env.example /etc/partbin/env
openssl rand -base64 48          # 生成 APP_SECRET，填入 env
sudoedit /etc/partbin/env        # PUBLIC_ORIGIN / APP_SECRET / DATA_DIR / COOKIE_SECURE / TRUSTED_PROXIES

# 单元与定时器
sudo cp deploy/partbin.service /etc/systemd/system/
sudo cp deploy/partbin-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now partbin
sudo systemctl enable --now partbin-backup.timer
```

`deploy/partbin.service` 要点（完整内容随仓库交付）：

```ini
[Unit]
Description=PartBin
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=partbin
Group=partbin
WorkingDirectory=/opt/partbin
EnvironmentFile=/etc/partbin/env
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/src/index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/partbin
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
SystemCallFilter=@system-service
UMask=0077
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
```

`partbin-backup.timer`：每日 03:30、`Persistent=true`、随机延迟 10 分钟；执行 `node server/scripts/backup.js`。

### 14.4 DNS、TLS 与 Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
  sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`：

```caddyfile
partbin.example.com {
    encode zstd gzip
    request_body {
        max_size 10MB
    }
    header {
        Strict-Transport-Security "max-age=86400; includeSubDomains"
        -Server
    }
    reverse_proxy 127.0.0.1:8787
    log {
        output file /var/log/caddy/partbin-access.log
        format json
    }
}
```

- 证书由 Caddy 自动申请与续期；首次上线 HSTS 用 86400，稳定后改为 31536000（并考虑 preload）。
- `sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy`。
- 验证 `curl -I https://partbin.example.com`，再用 SSL Labs 跑一次（目标 A）。
- 不开放 80 时改用 DNS-01（需 Caddy DNS 插件）；保持 80 时仅用于 ACME 与跳转。
- Caddy 访问日志只记录方法、路径、状态，不含 Cookie 与请求体。

### 14.5 Cloudflare Tunnel（可选，推荐家庭网络）

```bash
cloudflared tunnel login
cloudflared tunnel create partbin
cloudflared tunnel route dns partbin partbin.example.com
```

`/etc/cloudflared/config.yml`：

```yaml
tunnel: <tunnel-uuid>
credentials-file: /etc/cloudflared/<tunnel-uuid>.json
ingress:
  - hostname: partbin.example.com
    service: http://127.0.0.1:8787
  - service: http_status:404
```

- `sudo cloudflared service install`；无需开放 80/443，源站不可直连。
- `TRUSTED_PROXIES` 只能填 Cloudflare 回源网段或本机回环，否则 `X-Forwarded-For` 可被伪造。
- 可在 Cloudflare 侧再叠加 WAF、速率限制与 Access（零信任登录）；应用内登录仍然保留。

### 14.6 Docker 部署（备选）

```bash
# 开发机构建并导出（服务器无外网时）
docker buildx build --platform linux/amd64 -t partbin:1.0.0 .
docker save partbin:1.0.0 | gzip > partbin-1.0.0.tar.gz
scp partbin-1.0.0.tar.gz deploy/*.example deploy/docker-compose.yml user@server:/srv/partbin/

# 服务器
sudo apt install -y docker.io docker-compose-v2
sudo docker load < /srv/partbin/partbin-1.0.0.tar.gz
cd /srv/partbin
cp compose.env.example compose.env && vi compose.env
cp Caddyfile.example Caddyfile && vi Caddyfile
sudo docker compose up -d
```

`docker-compose.yml` 结构：

```yaml
services:
  partbin:
    image: partbin:1.0.0
    restart: unless-stopped
    env_file: ./compose.env
    environment:
      HOST: 0.0.0.0
      DATA_DIR: /data
    volumes:
      - partbin-data:/data
    expose: ["8787"]
    read_only: true
    tmpfs: ["/tmp"]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on: [partbin]
  # cloudflared: 可选，替代 80/443 映射
  #   image: cloudflare/cloudflared:latest
  #   command: tunnel --no-autoupdate run
  #   environment: [TUNNEL_TOKEN]
volumes:
  partbin-data:
  caddy-data:
  caddy-config:
```

- Caddy 容器内 `reverse_proxy partbin:8787`；应用容器不映射宿主端口。
- 容器环境同样需要 `PUBLIC_ORIGIN`、`APP_SECRET`、`COOKIE_SECURE=true`、`TRUSTED_PROXIES`。
- 生产镜像按 digest 固定；`docker compose pull` 前先备份。

### 14.7 首次初始化

```bash
sudo -u partbin bash -c 'set -a; . /etc/partbin/env; set +a; \
  cd /opt/partbin && node --disable-warning=ExperimentalWarning \
  server/scripts/create-admin.js --username admin'
```

1. 登录后**立即开启 2FA**，把 10 个恢复码离线保存。
2. 确认 `registration_mode=invite`（默认），需要时在设置页生成邀请码。
3. 可选演示数据：`pnpm db:seed && pnpm db:seed:demo`（同样以 `partbin` 用户、同一 `DATA_DIR` 执行）。
4. 按 12.10 的上线门槛逐项验收；**通过前不要公布域名或发放邀请码**。

### 14.8 备份与恢复

本地快照（`node server/scripts/backup.js`）：

1. `VACUUM INTO '<backups>/<ts>/inventory.db'`（一致性快照，不需要停服务）；
2. 复制 `uploads/` 到同目录（`fs.cp` 递归）；
3. 生成 `manifest.json`（时间、版本、文件列表、SHA-256、`integrity_check` 结果）；
4. 超过 `BACKUP_KEEP` 份时删除最旧目录；
5. 日志输出路径与大小。

异地加密备份（restic）：

```bash
export RESTIC_REPOSITORY='sftp:backup@nas:/srv/partbin'
export RESTIC_PASSWORD_FILE=/etc/partbin/restic.pass
restic init
node server/scripts/backup.js
restic backup /var/lib/partbin/backups/<ts> --tag partbin
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
sudo -u partbin node server/scripts/restore-drill.js   # 校验可恢复性并记录结果
```

恢复：

```bash
sudo systemctl stop partbin
restic restore latest --target /tmp/partbin-restore
sudo -u partbin cp /tmp/partbin-restore/var/lib/partbin/backups/<ts>/inventory.db /var/lib/partbin/inventory.db
sudo -u partbin rm -f /var/lib/partbin/inventory.db-wal /var/lib/partbin/inventory.db-shm
sudo -u partbin rsync -a --delete /tmp/partbin-restore/.../uploads/ /var/lib/partbin/uploads/
sudo systemctl start partbin
curl -fsS http://127.0.0.1:8787/health
sudo -u partbin node server/scripts/check.js
```

每月做一次完整恢复演练，记录耗时（RTO 目标 ≤ 1 小时）；restic 密码与仓库凭据分开离线保存。

### 14.9 监控与告警

- Uptime Kuma / healthchecks.io 每分钟探测 `GET /health`；连续 3 次失败告警。
- 证书剩余天数（Caddy 自动续期，但监控到期时间）；磁盘使用率 > 80%；`backups/` 最近成功时间 > 26 小时。
- fail2ban 封禁事件、登录失败与 429 突增、5xx 比例。
- 告警渠道使用监控工具自带通知；应用不集成 SMTP。
- 每月查看一次审计日志中的异常登录与权限变更。

### 14.10 升级与回滚

```bash
# 升级
sudo systemctl start partbin-backup.service          # 先做本地快照
sudo -u partbin git -C /opt/partbin pull
cd /opt/partbin
sudo -u partbin pnpm install --frozen-lockfile
sudo -u partbin pnpm audit --prod                    # 有高危先评估
sudo -u partbin pnpm build
sudo systemctl restart partbin
curl -fsS http://127.0.0.1:8787/health

# 回滚
sudo -u partbin git -C /opt/partbin checkout <prev-tag>
sudo -u partbin pnpm install --frozen-lockfile && sudo -u partbin pnpm build
sudo systemctl restart partbin
# 若迁移已执行且不向后兼容：停服 → 按 14.8 恢复快照
```

安全更新节奏：操作系统与 Caddy 跟随自动更新；应用依赖每月检查一次；Node 跟随 LTS 安全版本。

### 14.11 应急响应

按 12.8 的五个步骤执行，常用命令：

```bash
# 封禁来源（Cloudflare 方案则在控制台处理）
sudo ufw deny from <ip> to any

# 吊销所有会话（CLI 兜底，界面也有按钮）
sudo -u partbin bash -c 'set -a; . /etc/partbin/env; set +a; \
  cd /opt/partbin && node server/scripts/revoke-sessions.js --all'

# 重置管理员密码（会吊销该账号全部会话）
sudo -u partbin bash -c 'set -a; . /etc/partbin/env; set +a; \
  cd /opt/partbin && node server/scripts/reset-password.js --username admin'
```

### 14.12 排错速查

| 现象 | 排查 |
|---|---|
| 服务起不来 | `journalctl -u partbin -n 100 --no-pager`；检查 `/etc/partbin/env` 权限与 `DATA_DIR` 可写；缺 `APP_SECRET`/`PUBLIC_ORIGIN` 会拒绝启动 |
| 502/504 | Caddy 正常但后端挂了：`systemctl status partbin`；确认监听 `127.0.0.1:8787` |
| 证书失败 | DNS 未生效、80 被墙、或 Caddy 日志中的 ACME 错误；可改 DNS-01 |
| 登录后立刻掉线 | `COOKIE_SECURE=true` 但访问走 HTTP；或 `PUBLIC_ORIGIN` 与实际域名不一致 |
| 所有写请求 403 | `Origin`/`Sec-Fetch-Site` 与 `PUBLIC_ORIGIN` 不匹配；检查反代是否改写 Host |
| 登录总是 429 | 账号/IP 被锁定；管理员解锁或等待 `Retry-After` |
| TOTP 总是错误 | 服务器时间不同步；`timedatectl` 或 `chronyc tracking` |
| 数据库 locked | 是否有第二个进程打开同一 db；数据目录是否在 NFS/SMB；`busy_timeout` 是否生效 |
| 上传失败 | 磁盘满、`uploads` 权限、Caddy `max_size`、容器只读根目录 |
| 备份失败 | restic 仓库不可达、密码文件权限、磁盘空间；查看 `partbin-backup.service` 日志 |

---

## 15. 里程碑与验收

| # | 内容 | 交付文件（主要） | 验收 |
|---|---|---|---|
| **M0** | 设计文档（v1.3 公网安全版） | `PLAN.md` | 本文档评审通过 |
| M1 | 工程地基与账号体系（**内网版，已实现**）：workspace、env、迁移、user/session、注册/登录/退出/改密、首人管理员、权限 hook、用户管理、登录注册页、AppShell 双端导航、设计 token 与玻璃/动效样式、`/health`、生产单端口模式 | 根配置、`server/src/{index,app,env}.js`、`db/**`、`lib/{password,session,rate-limit}.js`、`plugins/auth.js`、`services/{users,sessions}.js`、`routes/{auth,users,meta}.routes.js`、`web/src/{main.js,router,stores/auth,views/Login,layouts/AppShell,styles/**}` | 首人=admin、次人=user；只读调写 403；禁用后立即失效；1280/375 两档导航正确；`pnpm test` 全绿。**公网发布前必须被 M6 替换** |
| M2 | 主数据：分类/位置树、物料 CRUD、搜索筛选分页、只读 UI、桌面表格与移动卡片两套展示 | `services/{categories,locations,items}.js`、对应路由、`views/{Items,ItemDetail}`、`components/{ItemDialog,ItemTable,ItemCard,TreePicker,FilterChips,QuantityBadge}` | 建 3 级位置；搜 `STM` 命中；只读账号无写按钮且接口 403；双端列表切换正常 |
| M3 | 出入库与流水：统一 `record()`、快捷入出库、盘点、台账、详情时间线、低库存 | `services/movements.js`、`routes/movements.routes.js`、`components/{MovementDialog,MovementTimeline,SheetDialog}`、`views/Movements` | 超库存 409 不写库；并发测试通过；`balance_after` 正确；数字动效与减弱动效降级正常 |
| M4 | 实例与借还：批量建实例、状态迁移、借出、部分归还、逾期 | `services/{instances,loans}.js`、`views/Loans`、`components/{InstanceTable,LoanCard,ReturnSheet}` | 数量不变量测试通过；仪表盘待还/逾期正确；移动端归还抽屉可用 |
| M5 | 照片与 CSV：压缩上传、相册、导入预览/确认、导出、去重 | `services/{photos,transfer}.js`、`lib/{csv,image}.js`、`components/PhotoGallery`、`views/Settings` 数据页 | Excel 无乱码；二次导入 unchanged；只读账号不能导入但能导出；灯箱交互正常 |
| **M6** | **公网安全加固**：迁移 003、邀请码/注册模式、CLI 初始化管理员、持久化限速与锁定、TOTP + 恢复码、会话双过期与重认证、审计日志、安全响应头、IP 哈希、CSV 注入防护 | `migrations/003_security.sql`、`lib/{crypto,totp,lockout,audit,ip,headers}.js`、`services/{invites,audit-log,totp}.js`、`routes/{security,invites,audit}.routes.js`、`views/Settings` 安全页、`scripts/{create-admin,create-invite,unlock-user,revoke-sessions}.js` | 默认 invite / closed；无首人管理员；锁定重启后仍生效；2FA 全流程；审计覆盖关键操作；安全头与 Cookie 检查通过；`pnpm test` 全绿 |
| M7 | 生产化与运维：优雅关闭、日志、静态缓存、本地快照 + restic 异地加密、恢复演练、监控、README、种子数据、界面打磨与 8.13 验收 | `scripts/{seed,seed-demo,backup,restore-drill,check,reconcile,security-check}.js`、`README.md`、`docs/DEPLOY.md`、`docs/SECURITY.md` | 备份可恢复且加密；`db:check` 全绿；监控告警实测触发；8.13 清单三档全过 |
| **M8** | **公网部署交付**：域名/TLS/HSTS、ufw + fail2ban、systemd 硬化、Docker 硬化、Cloudflare Tunnel 方案、上线安全清单、应急演练 | `Dockerfile`、`deploy/**`、`docs/DEPLOY.md`、`docs/SECURITY.md` | 12.10 清单全过；SSL Labs A；8787 不可达；真实公网完成注册/登录/2FA/入库/恢复演练 |

### 15.1 每个里程碑的完成定义（DoD）

1. 代码可运行，`pnpm dev` 与 `pnpm build && pnpm start` 均正常；
2. 该里程碑的自动化测试全部通过；
3. 手工验收项逐条走通并记录；
4. 无未处理的控制台报错与明显 N+1 查询；
5. 只读账号的越权路径已用接口测试覆盖；
6. 双端（375 / 1280）界面与 8.13 核心项每期回归通过，玻璃降级与减弱动效无回归；
7. 安全相关改动必须附带回归测试与审计覆盖，且不引入高危依赖（`pnpm audit` 无 high/critical）；
8. 涉及公网的里程碑（M6/M8）必须在真实公网环境完成 12.10 上线清单，未通过不得对外公布。

### 15.2 交付节奏

M1 已完成（内网可用）。后续顺序：**M2 → M3 → M4 → M5** 打通完整业务，然后 **M6 安全加固**、**M7 生产化**、**M8 公网部署**。M6 与 M8 完成前，代码与数据只能在内网使用，禁止直接暴露公网。每个里程碑结束后附：改动清单、测试结果、启动方式、下一步，并按 15.3 提交推送。

### 15.3 Git 提交与发布规则

- **关键节点自动上传**：里程碑完成、设计文档评审通过、安全修复完成、部署前，提交并推送到 `origin/main`（`git@github.com:bilibili-qindiebanran/PartBin.git`）。
- **上传前必须通过隐私检查**：`pnpm privacy:check`（等价于 `.githooks/pre-push`）；失败时禁止提交/推送。检查覆盖数据目录、`.env`、数据库、依赖与构建产物、私钥、个人邮箱、个人绝对路径与常见令牌格式。
- **禁止提交**：`data/`、`*.db`、`uploads/`、`backups/`、`.env`（仅允许 `.env.example`）、日志、含个人信息的截图/导出、真实密钥。
- **Commit message**：中文、简洁、`type: 概述`（`feat` / `fix` / `docs` / `chore` / `refactor` / `test`），一次提交只做一件事。
- **不改写已推送历史**：不 force push、不 rebase；推送后核对 `git status` 与远端 HEAD。
- **提交身份**：使用仓库本地配置，不把个人邮箱写入提交；不使用 `--author` 注入真实邮箱。
- 详细约束与执行步骤见 `AGENTS.md`，实现见 `scripts/privacy-scan.js` 与 `.githooks/pre-push`。

---

## 16. 风险与假设

### 16.1 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 公网扫描与撞库 | 账号被攻破、数据泄露 | 默认关注册、邀请码、12 位密码 + 弱口令表、持久化限速与锁定、可选 2FA、fail2ban |
| 针对账号的锁定 DoS | 他人故意输错使管理员无法登录 | 锁定按账号 + IP 双维度且只持续 15 分钟；管理员可用 CLI 解锁；关键操作不依赖单点 |
| 丢失 TOTP 设备且恢复码丢失 | 管理员无法登录 | 10 个一次性恢复码离线保存；CLI `create-admin.js` 兜底 |
| 无邮箱自助找回 | 用户需联系管理员 | 明确的产品取舍；管理员重置 + CLI 重置；文档写清 |
| 反向代理配置错误 | 伪造 `X-Forwarded-For` 绕过限速，或 8787 暴露 | `TRUSTED_PROXIES` 白名单；部署后扫描端口；Cloudflare 方案固定回源网段 |
| 备份文件泄露 | 库存与借出信息外泄 | restic 加密 + 密码离线；仓库权限最小化；不上传公开对象存储 |
| 依赖漏洞 / 供应链 | 远程代码执行或数据泄露 | 锁文件、`pnpm audit`、固定镜像 digest、跟随 LTS 安全更新、最小依赖 |
| SQLite 单写者被写洪峰拖慢 | 接口超时 | 写接口限速、事务短小、`busy_timeout`、监控慢请求 |
| 共享库存对全部登录用户可见 | 只读成员可看到借出人与备注 | 邀请制开户、离职/离组及时禁用、审计可追溯 |
| 域名/DNS/证书配置错误 | 站点不可用或降级为 HTTP | 上线清单含 SSL Labs 与跳转检查；Caddy 自动续期；监控证书到期 |
| Cloudflare/主机商依赖 | 上游故障导致不可用 | 单机 99.5% 目标；保留直接公网 IP 方案；文档给出切换步骤 |
| 管理后台暴露在公网 | 暴力破解与自动化探测 | 强口令 + 2FA + 限速 + 审计；管理员账号唯一且不共享 |
| `node:sqlite` 标记 experimental | 升级 Node 后需小改 | 数据库访问收敛在 `db/connection.js` + services，可切 `better-sqlite3` |
| 照片累积占满磁盘 | 写入失败 | 设置页显示占用、备份保留策略、监控磁盘 80% 告警 |
| 备份未验证导致「有备份不能恢复」 | 事故时丢数据 | 备份自动 `integrity_check` + 每月恢复演练并记录 RTO |

### 16.2 假设

1. 服务器为 Debian/Ubuntu x86_64，位于公网（或通过 Cloudflare Tunnel 暴露），可访问 npm 源；无外网时用 Docker 镜像导入。
2. 拥有一个可解析到该服务器的域名；Caddy 能完成 ACME（80 或 DNS-01）。
3. 管理员具备基本运维能力：能用 SSH 登录、执行命令、查看 journald 与配置防火墙。
4. 不提供邮件服务；密码找回与账号解锁由管理员或 CLI 完成。
5. 使用者为 1 名管理员 + 少量受邀只读成员；共享同一套库存。
6. 数据放在服务器本地磁盘，不做 NFS/SMB 挂载；建议整盘加密。
7. 单节点部署，不做高可用与读写分离；月可用性目标 99.5%。
8. 有可用的异地备份目的地（另一台机器、NAS 或对象存储）。
9. 上游 DDoS/WAF 防护依赖 Cloudflare 或主机商，应用只做限速、体积限制与审计。
10. 不做扫码；`code` 与 `asset_no` 预留。浏览器为近两年的 Chrome/Edge/Safari，不做 IE 兼容。

---

## 17. 附录

### A. 根脚本

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装所有依赖 |
| `pnpm dev` | 并行启动 server（`node --watch`，8787）与 web（Vite 5180，代理 `/api`） |
| `pnpm build` | 构建 `web/dist` |
| `pnpm start` | 生产模式：`node --disable-warning=ExperimentalWarning server/src/index.js` |
| `pnpm test` | 服务器测试（Vitest） |
| `pnpm db:seed` | 写入基础种子数据（分类、位置、数量为 0 的物料；不建用户） |
| `pnpm db:seed:demo` | 补演示库存：期初入库流水、实例、一条逾期借出（需先用 CLI 创建管理员） |
| `pnpm db:check` | 校验数据不变量 |
| `pnpm db:reconcile` | 报告（`--fix` 修复）数量漂移 |
| `pnpm db:backup` | 本地快照；配置了 restic 时同时推送到加密仓库 |
| `pnpm db:restore-drill` | 从最近备份恢复到临时目录并校验 |
| `pnpm admin:create` | CLI 创建管理员（公网部署的第一步） |
| `pnpm invite:create` | CLI 生成邀请码（等价于界面操作） |
| `pnpm admin:unlock` | 解除账号登录锁定 |
| `pnpm security:check` | 检查环境变量、Cookie、注册模式、备份与安全头配置 |
| `pnpm db:reset` | **危险**：删除本地开发库并重建（仅开发环境） |

### B. CSV 列定义

| 列 | 别名 | 必填 | 说明 |
|---|---|:--:|---|
| 名称 | name | ✓ | 物料名称 |
| 编号 | code | | 唯一；导入时作为幂等键 |
| 分类 | category | | 路径，如 `开发板/单片机`；不存在时自动创建 |
| 位置 | location | | 路径，如 `A柜/抽屉3/盒12`；不存在时自动创建 |
| 厂商 | manufacturer | | |
| 型号 | model | | |
| 规格 | spec | | 参数长文本 |
| 单位 | unit | | 默认「个」 |
| 数量 | quantity | | 新建时作为期初入库；已存在时生成盘点差额 |
| 低库存阈值 | minQuantity | | 默认 0（不提醒） |
| 价格 | price | | 元，可空 |
| 购买日期 | purchaseDate | | `YYYY-MM-DD` |
| 备注 | note | | |
| 追踪模式 | trackingMode | | `quantity`（默认）/ `instance`（数量必须为 0） |

- 文件编码 UTF-8（可带 BOM），分隔符逗号，支持引号转义与字段内换行。
- 错误行最多返回 100 条，附带行号与字段名。

### C. 种子数据

分两步，保证任何时刻都满足数据不变量（数量必须能由流水解释）：

1. **`pnpm db:seed`**（无需账号）
   - 分类树：开发板/单片机、传感器、通信模块、电源与电池、被动元件、连接线与接插件、工具与仪器、结构件与耗材、其他（部分带二级分类）；
   - 位置树：`工作台`、`A柜/抽屉1/元件盒01`…、`B柜/抽屉2/开发板盒`；
   - 约 25 条物料（STM32F103C8T6 最小系统板、STM32F407VET6 芯片、ESP32-S3-DevKitC、ESP8266-01S、Arduino Nano、树莓派 4B、0.96 寸 OLED、DHT22、MPU6050、L298N、继电器模块、USB 转 TTL、逻辑分析仪、万用表、电烙铁、热风枪、面包板、杜邦线、排针、电阻包、电容包、18650 电池、5V 电源、洞洞板、传感器套件），数量均为 0；
   - 不创建用户；管理员用 `create-admin.js` 创建（见 14.7）。
2. **`pnpm db:seed:demo`**（需已创建管理员）
   - 为种子物料补「期初入库」流水（`in`，操作人 = 第一个启用的管理员），写入数量与低库存阈值；
   - 为树莓派、逻辑分析仪各建 2–3 个实例（同事务写 `in` 流水）；
   - 生成 1 条逾期借出（`borrow` 流水 + loan），用于展示逾期提醒；
   - 没有管理员时明确报错并退出，提示先运行 `create-admin.js`。

管理员初始化与种子数据顺序无关：不变量始终自洽，「首个注册者自动成为管理员」的公网版本已废弃。

### D. `.env.example`

```dotenv
# 基础
HOST=127.0.0.1
PORT=8787
DATA_DIR=./data
# 公网必填（本地开发填 http://127.0.0.1:5180）
PUBLIC_ORIGIN=https://partbin.example.com

# 会话
SESSION_IDLE_DAYS=7
SESSION_ABSOLUTE_DAYS=30
# 生产 true；本地纯 HTTP 调试 false
COOKIE_SECURE=true
# 只填可信代理网段，不要无条件信任 X-Forwarded-For
TRUSTED_PROXIES=127.0.0.1/32,::1/128

# 安全
# openssl rand -base64 48 生成；TOTP 加密与 IP 哈希依赖它
APP_SECRET=replace-with-32-bytes-of-random
REGISTRATION_MODE=invite
INVITE_TTL_HOURS=168
LOGIN_MAX_ATTEMPTS=5
LOCKOUT_MINUTES=15
TOTP_ISSUER=PartBin
# 首次上线建议 86400，稳定后改 31536000
HSTS_MAX_AGE=86400

# 运维
APP_TZ=Asia/Shanghai
LOG_LEVEL=info
BACKUP_KEEP=14
# BACKUP_REPO=sftp:backup@nas:/srv/partbin
# BACKUP_PASSWORD_FILE=/etc/partbin/restic.pass
```

### E. `.gitignore`

```gitignore
node_modules/
data/
web/dist/
.env
*.log
.DS_Store
```

### F. 待办（非本期）

- 二维码标签打印与扫码出入库（已有 `code` / `asset_no`）；
- 借用人关联到系统账号；
- 物料价格汇总与年度消耗统计；
- 导入导出备份的 Web 端下载/上传；
- 多语言。
