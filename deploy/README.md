# 部署文件

| 文件 | 用途 |
| --- | --- |
| `Dockerfile` / `docker-compose.yml` | 单机容器运行，非 root、只读根、健康检查 |
| `docker-compose.caddy.yml` | 追加 Caddy 容器，自动申请证书 |
| `docker-compose.cloudflared.yml` | 追加 Cloudflare Tunnel，无需公网入站 |
| `caddy/Caddyfile` | 宿主机 Caddy 反代 `127.0.0.1:8787` |
| `systemd/partbin.service` | systemd 硬化单元 |
| `systemd/partbin-backup.*` | 每日加密备份 timer |
| `cloudflared/config.yml.example` | Tunnel 本地配置示例 |
| `fail2ban/*` | 监控 journald 401/429 的 jail/filter |
| `ufw.sh` | 防火墙基线（按需修改 SSH 来源） |
| `preflight.sh` | 部署后本机预检 |
| `verify-public.sh` | 公网 TLS/HSTS/端口/证书检查 |

完整步骤见 [docs/DEPLOY.md](../docs/DEPLOY.md)。
