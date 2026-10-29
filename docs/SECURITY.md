# 安全运维手册

## 密钥与账号

- `APP_SECRET`：至少 32 字节随机值，用于 TOTP 加密与 IP 哈希；丢失将导致 TOTP 不可用。
- `BACKUP_PASSPHRASE`：与 APP_SECRET 分开，离线保管；丢失则备份无法恢复。
- 管理员只能通过 `pnpm admin:create` 创建；不存在默认口令。
- 邀请码只在创建时显示一次，数据库只存 SHA-256。

## 日常检查

```bash
pnpm security:check      # 配置/权限/TOTP/备份时效
pnpm db:check            # 完整性、外键、数量与流水一致
pnpm audit --prod        # 依赖漏洞
```

## 会话与账号

- 用户被禁用、改密、重置密码后，相关会话立即失效；
- 管理员可在设置页查看并撤销自己的登录设备；
- 敏感操作需要 10 分钟内重新验证密码；
- 登录失败 5 次锁定 15 分钟，重启服务不会解除；解锁：

```bash
# 直接修改数据库前先停服务并备份
sqlite3 /var/lib/partbin/inventory.db \
  "UPDATE user SET locked_until = NULL WHERE username_norm = 'admin';"
```

（若没有 sqlite3，可用 `pnpm db:reconcile` 的同目录 Node 环境执行等价 SQL。）

## 双因素

- 启用后必须输入 TOTP 或一次性恢复码；
- 恢复码只在启用/轮换时显示一次，建议打印离线保存；
- 丢失设备且恢复码也丢失时，可由 CLI 创建新管理员，再停用旧账号。

## 审计

- 登录、注册、邀请码、TOTP、用户管理、注册策略有显式审计；
- 其他写接口由 `api.write` 兜底记录方法与路径；
- 审计不记录请求体、密码、TOTP、会话 token、完整 IP；
- 审计表不提供更新/删除接口。

## 备份与恢复

- 备份必须加密，密码离线；备份目录权限 700；
- 每月执行 `pnpm backup:verify` 并记录 RTO；
- 恢复前停止服务；`restore` 会保留恢复前数据库副本；
- 恢复后必须 `pnpm db:check` 并验证登录/库存。

## 事件响应（30 分钟目标）

1. **确认**：查看 `/health`、journald、审计与 fail2ban；
2. **封禁**：禁用账号或撤销全部会话（停服务后可删除 `session` 表全部行）；
3. **隔离**：保留服务器/容器，抓取日志，不覆盖磁盘；
4. **恢复**：从最近通过校验的备份恢复，跑 `db:check`；
5. **复盘**：轮换 APP_SECRET（TOTP 需重新绑定）、所有密码、备份密码；检查暴露端口与依赖。

## 公网底线

- 8787 只监听 `127.0.0.1` 或容器内网；
- 只开放 443（与受限 SSH）；80 仅用于 ACME/跳转；
- SSH 禁密码、禁 root；开启 unattended-upgrades；
- HSTS、CSP、`__Host-` Cookie 必须验证；
- 上线清单见 [DEPLOY.md](DEPLOY.md) 第 9 节与 [PLAN.md](../PLAN.md) 12.10。
