#!/usr/bin/env bash
# 在目标服务器以 root 执行；SSH 端口/来源请按需修改
set -euo pipefail

SSH_PORT="${SSH_PORT:-22}"
ufw default deny incoming
ufw default allow outgoing
ufw allow "${SSH_PORT}/tcp" comment 'SSH'
ufw allow 80/tcp comment 'ACME / redirect'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
ufw status verbose
