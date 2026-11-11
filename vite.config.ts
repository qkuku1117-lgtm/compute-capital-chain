import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 前端 5173，账本 API 8790（server/index.ts）。开发时 /api 走代理。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? 8790}` },
  },
  build: { target: 'esnext', outDir: 'dist' },
});
