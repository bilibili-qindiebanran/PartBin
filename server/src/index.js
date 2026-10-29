import os from 'node:os';
import { loadConfig } from './env.js';
import { buildApp } from './app.js';

const config = loadConfig();
const app = await buildApp(config);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ err: error }, '启动失败');
  process.exit(1);
}

const urls = [`http://127.0.0.1:${config.port}`];
if (config.host === '0.0.0.0' || config.host === '::') {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const item of addresses ?? []) {
      if (item.family === 'IPv4' && !item.internal) {
        urls.push(`http://${item.address}:${config.port}`);
      }
    }
  }
}
for (const url of urls) app.log.info(`访问地址：${url}`);
if (config.host === '127.0.0.1') {
  app.log.info('当前只监听本机：开发用 Vite(5173) 代理；生产由 Caddy 反代 127.0.0.1:8787');
}

const userCount = Number(app.db.prepare('SELECT COUNT(*) AS c FROM user').get().c);
if (userCount === 0) {
  app.log.info('还没有任何账号：请运行 pnpm admin:create 初始化管理员');
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`收到 ${signal}，正在关闭…`);
  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, '关闭失败');
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
