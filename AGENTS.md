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

## Git 分支与发布规则（必须遵守）

### 分支模型

- `main`：稳定分支，**只接收经过验证的里程碑合并**，禁止日常直接提交。
- `cyan-dev`：日常开发分支，所有小改动先提交并推送到这里。
- 开始工作先确认 `git branch --show-current` 为 `cyan-dev`；不是则 `git switch cyan-dev`。
- 远端：`git@github.com:bilibili-qindiebanran/PartBin.git`。

### 日常提交（小改动）

1. 提交前运行 `pnpm privacy:check`（pre-push 钩子还会再检查一次）；失败即停止。
2. Commit message 用中文、简洁：`type: 概述`，type 取 `feat` / `fix` / `docs` / `chore` /
   `refactor` / `test`；一次提交只做一件事。
3. `git push origin cyan-dev`。
4. 关键节点（里程碑完成、设计评审通过、安全修复、部署前）同样提交并推送，保证远端有记录。

### 合并到 main（关键大节点）

1. 在 `cyan-dev` 上完成验证：
   - `pnpm test`
   - UI 改动：`pnpm build`
   - `pnpm privacy:check`
   - 对应里程碑的手工验收；M6/M8 必须完成 `PLAN.md` 12.10 上线清单
2. 合并并推送：

   ```bash
   git switch main
   git pull --ff-only origin main
   git merge --no-ff cyan-dev -m "merge: 合并 Mx <名称>"
   git push origin main
   git switch cyan-dev
   ```

3. 建议在 main 上打里程碑 tag：`git tag -a m2 -m "M2 库存主数据" && git push origin m2`。

### 禁止与约束

- 不 force push、不 rebase 已推送分支、不改写历史。
- 不直接在 main 改代码；例外需用户明确同意。
- 禁止上传的内容：
  - `data/`、`*.db`、`*.sqlite*`、`uploads/`、`backups/`；
  - `.env`、`.env.*`（仅允许 `.env.example`）、任何真实密钥/令牌；
  - `node_modules/`、`.pnpm-store/`、`web/dist/`、日志、`.DS_Store`；
  - 含个人信息的截图、录屏、导出数据；
  - 个人主目录绝对路径、个人邮箱、手机号等隐私信息。
- 提交身份沿用本机 git 全局配置（用户已确认作者信息无需隐藏）；不使用 `--author` 伪造他人身份。
- 推送后核对 `git status` 与远端 HEAD；发现疑似隐私内容立即停止推送并告知用户。
- 本项目代码公开托管，任何新增文件都按「会被所有人看到」来检查。

## 安全底线

- 生产环境必须设置 `APP_SECRET` 与 `PUBLIC_ORIGIN`；缺一拒绝启动。
- 不在日志、审计、错误响应中输出密码、TOTP、会话 token、完整 IP。
- 任何新增写接口都要考虑权限（admin/user）、审计与限速。
- 涉及认证、会话、上传、导出的改动，必须补测试后再提交。
