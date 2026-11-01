import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

/**
 * 本地开发用自签证书（由 `pnpm cert:dev` 生成）。
 * 浏览器只在 HTTPS 或 localhost 下允许 getUserMedia，真机测扫码必须走 HTTPS。
 * 证书不存在时保持普通 HTTP，不影响日常开发与构建。
 */
const CERT_DIR = fileURLToPath(new URL('./.cert/', import.meta.url));
const CERT_FILE = path.join(CERT_DIR, 'dev-cert.pem');
const KEY_FILE = path.join(CERT_DIR, 'dev-key.pem');

function readDevHttps() {
  if (!fs.existsSync(CERT_FILE) || !fs.existsSync(KEY_FILE)) return undefined;
  return {
    cert: fs.readFileSync(CERT_FILE),
    key: fs.readFileSync(KEY_FILE),
  };
}

export default defineConfig(({ command }) => {
  const https = command === 'serve' ? readDevHttps() : undefined;
  if (https) console.log('[vite] 已启用自签 HTTPS（web/.cert）');

  return {
    plugins: [
      vue(),
      Components({
        resolvers: [ElementPlusResolver({ importStyle: false, directives: true })],
        dts: false,
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      // 监听所有网卡：同一局域网用 http(s)://<本机IP>:5180 调试手机端。
      // API 仍由本进程代理到 127.0.0.1:8787，不需要把 8787 暴露出去。
      host: true,
      port: 5180,
      strictPort: true,
      https,
      proxy: {
        '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
        '/health': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/element-plus') || id.includes('node_modules/@element-plus')) {
              return 'element-plus';
            }
            if (id.includes('node_modules/vue') || id.includes('node_modules/pinia')) {
              return 'vue-vendor';
            }
            return undefined;
          },
        },
      },
    },
  };
});
