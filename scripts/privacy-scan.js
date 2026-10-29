#!/usr/bin/env node
/**
 * 隐私检查：扫描即将进入版本库的文件（已跟踪 + 未跟踪且未被忽略），
 * 阻止数据目录、环境变量、数据库、密钥与个隐私信息进入远端仓库。
 *
 * 用法：node scripts/privacy-scan.js
 * 退出码：0 通过；1 发现需要处理的内容。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

function listFiles(args) {
  const out = execFileSync('git', args, { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
  return out.toString('utf8').split('\0').filter(Boolean);
}

const tracked = listFiles(['ls-files', '-z']);
const untracked = listFiles(['ls-files', '--others', '--exclude-standard', '-z']);
const files = [...new Set([...tracked, ...untracked])].sort();

const PATH_RULES = [
  { label: '运行时数据目录', test: (rel) => rel.startsWith('data/') },
  {
    label: '环境变量文件',
    test: (rel) => {
      const base = path.basename(rel);
      return base === '.env' || (base.startsWith('.env.') && base !== '.env.example');
    },
  },
  { label: '数据库文件', test: (rel) => /\.(db|sqlite|sqlite3)(-(wal|shm))?$/i.test(rel) },
  { label: '依赖目录', test: (rel) => rel.includes('node_modules/') },
  { label: 'pnpm store', test: (rel) => rel.startsWith('.pnpm-store/') },
  { label: '构建产物', test: (rel) => rel.startsWith('web/dist/') },
  { label: '上传或备份目录', test: (rel) => /(^|\/)(uploads|backups)\//.test(rel) },
  { label: '系统元数据', test: (rel) => /(^|\/)(\.DS_Store|Thumbs\.db)$/.test(rel) },
  {
    label: '私钥或证书文件',
    test: (rel) =>
      /(^|\/)(id_rsa|id_ed25519)(\.pub)?$/.test(rel) || /\.(pem|key|p12|pfx)$/i.test(rel),
  },
];

const CONTENT_RULES = [
  { label: '私钥块', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { label: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { label: 'GitHub 细粒度 token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { label: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: '类 OpenAI 密钥', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'Google API Key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    label: '真实 APP_SECRET',
    re: /\bAPP_SECRET=(?!replace|your|change|please|example)[A-Za-z0-9+/=]{20,}/,
  },
  { label: '个人主目录绝对路径', re: /\/Users\/[A-Za-z0-9._-]+\// },
  { label: 'Windows 个人目录', re: /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+/ },
  {
    label: '个人邮箱',
    re: /[\w.+-]+@(?:qq|163|126|gmail|outlook|hotmail|foxmail|icloud)\.(?:com|cn)/i,
  },
];

// 规则文件本身包含特征串，跳过自身
const SKIP_CONTENT_SCAN = new Set(['scripts/privacy-scan.js']);

const issues = [];

for (const rel of files) {
  for (const rule of PATH_RULES) {
    if (rule.test(rel)) issues.push({ file: rel, line: 0, label: rule.label });
  }
  if (issues.some((item) => item.file === rel)) continue;
  if (SKIP_CONTENT_SCAN.has(rel)) continue;

  const abs = path.join(ROOT, rel);
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > 1024 * 1024) continue;

  const buffer = readFileSync(abs);
  if (buffer.includes(0)) continue; // 二进制文件跳过

  const lines = buffer.toString('utf8').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    for (const rule of CONTENT_RULES) {
      if (rule.re.test(lines[index])) {
        issues.push({ file: rel, line: index + 1, label: rule.label });
      }
    }
  }
}

if (issues.length > 0) {
  console.error(`\n隐私检查未通过：发现 ${issues.length} 处需要处理的内容。\n`);
  for (const issue of issues) {
    const where = issue.line > 0 ? `${issue.file}:${issue.line}` : issue.file;
    console.error(`  ✗ ${where}  —— ${issue.label}`);
  }
  console.error('\n请移除或加入 .gitignore 后重试；不要把这些内容提交到远端。\n');
  process.exit(1);
}

console.log(`隐私检查通过：扫描 ${files.length} 个文件，未发现敏感内容。`);
