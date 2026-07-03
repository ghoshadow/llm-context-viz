import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const API_PORT = process.env.PORT || '4137';
const DEV_SERVER_PORT = parseInt(process.env.VITE_PORT || '5173');
const isTauriBuild = !!process.env.TAURI_ENV_TARGET_TRIPLE;

export default defineConfig({
  plugins: [react()],
  define: {
    __API_BASE__: JSON.stringify(isTauriBuild ? `http://localhost:${API_PORT}/api` : '/api'),
  },
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
        // SSE extraction requests can stay quiet while an LLM shard is running.
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
});
