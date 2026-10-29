# PartBin 开发约定

> 面向后续维护者与 AI 协作代理。修改代码前先读 `PLAN.md`。

## 项目概况

- **PartBin · 硬件出入库系统**：Node 24 + Fastify 5 + 内置 `node:sqlite` + Vue 3。
- 计划、数据模型与里程碑见 `PLAN.md`。
- **M6（公网安全加固）与 M8（公网部署交付）完成前，禁止把服务暴露到公网。**

## 常用命令

```bash
pnpm dev          # Vite http://127.0.0.1:5180 + API 8787
pnpm build        # 构建 web/dist
pnpm start        # 单端口生产模式 8787
pnpm test         # 服务端测试
pnpm privacy:check
```

## Git 提交与发布规则（必须遵守）

1. **关键节点自动上传**：里程碑完成、设计文档评审通过、安全修复完成、部署前，自动提交并推送到
   `git@github.com:bilibili-qindiebanran/PartBin.git` 的 `main` 分支。
2. **先检查再上传**：提交前必须运行 `pnpm privacy:check`；失败时停止提交与推送。仓库已配置
   `.githooks/pre-push`，安装钩子用 `git config core.hooksPath .githooks`。
3. **禁止上传的内容**：
   - `data/`、`*.db`、`*.sqlite*`、`uploads/`、`backups/`；
   - `.env`、`.env.*`（仅允许 `.env.example`）、任何真实密钥/令牌；
   - `node_modules/`、`.pnpm-store/`、`web/dist/`、日志、`.DS_Store`；
   - 含个人信息的截图、录屏、导出数据；
   - 个人主目录绝对路径、个人邮箱、手机号等隐私信息。
4. **Commit message 用中文、简洁**：`type: 概述`，type 取 `feat` / `fix` / `docs` / `chore` /
   `refactor` / `test`；一次提交只做一件事，不加无意义前缀。
5. **不改写历史**：不 force push、不 rebase 已推送的提交，除非用户明确要求。
6. **提交身份**：沿用本机 git 全局配置（用户已确认作者信息无需隐藏）；不使用 `--author` 伪造他人身份。
7. **推送后核对**：确认 `git status` 干净、`git log -1` 与远端 HEAD 一致。
8. **发现疑似隐私内容**：立即停止推送并告知用户，不要自行删除证据或改写历史。
9. 本项目代码会公开托管，任何新增文件都按「会被所有人看到」来检查。

## 安全底线

- 生产环境必须设置 `APP_SECRET` 与 `PUBLIC_ORIGIN`；缺一拒绝启动。
- 不在日志、审计、错误响应中输出密码、TOTP、会话 token、完整 IP。
- 任何新增写接口都要考虑权限（admin/user）、审计与限速。
- 涉及认证、会话、上传、导出的改动，必须补测试后再提交。
