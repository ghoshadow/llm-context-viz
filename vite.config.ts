import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const API_PORT = process.env.PORT || '4137';
const DEV_SERVER_PORT = parseInt(process.env.VITE_PORT || '5173');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: DEV_SERVER_PORT,
    watch: {
      ignored: [
        '**/data/extractions/**',
        '**/data/*.db',
        '**/data/*.db-*',
        '**/.claude/**',
        '**/.claude-trace/**',
      ],
    },
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
        // 代理超时：防止长时间挂起的请求占用资源
        timeout: 60_000,
      },
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
});
