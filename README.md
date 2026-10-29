# PartBin · 硬件出入库系统

自托管的硬件库存与借还管理：开发板、模块、元件存在哪个柜子、还剩几个、借给了谁，打开浏览器就能查到。

## 功能

- 物料主数据、多级分类、柜 / 抽屉 / 盒位置树
- 入库、出库、盘点、报废、丢失，全程流水可追溯
- 唯一实例编号、借出、部分归还、逾期提醒
- 照片上传（浏览器压缩、服务端魔数校验）、CSV 导入导出
- 低库存与仪表盘统计
- 邀请码注册、TOTP 双因素、持久化登录锁定、审计日志
- 桌面表格与手机卡片两套交互，毛玻璃视觉与减弱动效降级

## 技术栈

Node 24 + Fastify 5 + 内置 `node:sqlite`；Vue 3 + Vite + Element Plus + Pinia。单进程、单 SQLite 文件，备份就是加密快照。

## 本地开发

```bash
pnpm install
pnpm admin:create -- --username admin --password '<至少 12 位密码>'
pnpm dev
```

- 前端：http://127.0.0.1:5180
- API：http://127.0.0.1:8787
- 数据：`./data`（SQLite、照片、备份，不入库）

## 生产运行

```bash
cp .env.example .env
# 必填 APP_SECRET / PUBLIC_ORIGIN；HTTPS 下 COOKIE_SECURE=true
pnpm build
pnpm start
```

应用只应监听 `127.0.0.1`，由 Caddy 或 Cloudflare Tunnel 提供 HTTPS。完整步骤见 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm test` | 服务端测试 |
| `pnpm build` | 构建前端到 `web/dist` |
| `pnpm admin:create` | 初始化管理员（空库必须） |
| `pnpm backup` | 加密数据库快照到 `data/backups` |
| `pnpm backup:verify -- --file ...` | 恢复演练（临时目录） |
| `pnpm restore -- --file ...` | 离线恢复数据库 |
| `pnpm db:check` | 完整性 / 外键 / 数量一致性检查 |
| `pnpm db:reconcile -- --fix` | 按流水重算数量 |
| `pnpm security:check` | 部署配置体检 |

## 安全

默认邀请制注册，管理员由 CLI 创建；登录失败持久化锁定；支持 TOTP 与恢复码；写操作审计；安全响应头与 `__Host-` Cookie。详见 [SECURITY.md](SECURITY.md)、[docs/SECURITY.md](docs/SECURITY.md) 与 [PLAN.md](PLAN.md) 第 12 章。

> M8 公网部署清单完成前，请勿把 8787 直接暴露到公网。
