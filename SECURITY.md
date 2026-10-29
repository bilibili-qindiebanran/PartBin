# PartBin 安全说明

> 当前进度：M6 认证与安全加固已完成；公网部署仍须完成 M8 的上线清单。

## 初始化管理员

空数据库不再有默认账号，也不会把第一个注册者设为管理员。首次部署执行：

```bash
pnpm admin:create -- --username <用户名> --password '<至少 12 位密码>'
```

密码也可通过 `ADMIN_PASSWORD` 传入，避免出现在 shell 历史里。

## 注册策略

设置页由管理员切换，默认 `invite`：

- `closed`：关闭注册，只能由管理员建号；
- `invite`：必须持邀请码，邀请码只在创建时显示一次；
- `open`：任何人可注册为只读账号，仅建议受信网络临时使用。

邀请码创建、撤销、成员角色/禁用/重置密码、注册策略修改都需要重新验证密码（10 分钟窗口）。

## 登录与双因素

- 密码 12–64 位，拒绝常见弱密码与重复字符；
- 连续 5 次失败锁定账号 15 分钟；同一 IP 20 次失败限流；记录持久化在 SQLite；
- 支持任意 TOTP 验证器；启用时生成 10 枚一次性恢复码；
- 登录时需要动态码或恢复码；时间步防重放；
- 会话 7 天空闲过期 + 30 天绝对过期，HTTPS 下使用 `__Host-partbin_sid`。

## 响应头与网络

- CSP、HSTS、COOP/CORP、Permissions-Policy、nosniff；
- 写请求校验 `Origin` 与 `Sec-Fetch-Site`；
- 照片按魔数校验 JPEG/PNG/WebP，上限 8MB；SVG/HTML 会被拒绝；
- CSV 导出对公式注入做前缀转义。

## 审计

登录、注册、邀请码、TOTP、用户管理、注册策略均有显式审计；其他写接口由响应后钩子记录 `api.write`（方法 + 路径 + 状态），不记录请求体、密码或会话 token。

## 部署要求

- 必须设置 `APP_SECRET` 与 `PUBLIC_ORIGIN`，否则拒绝启动；
- 应用只监听 `127.0.0.1`，公网入口交给 Caddy / Cloudflare Tunnel；
- 启用 HTTPS 后再设 `COOKIE_SECURE=true`；
- 完整上线清单见 `PLAN.md` 12.10。

## 报告问题

请通过仓库的 GitHub Security Advisory 私下报告，不要在公开 Issue 中粘贴账号、密钥或数据库内容。
