import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      // التطبيق (index.html) والصفحة التعريفية العامة على الجذر (landing.html)
      input: { main: resolve(__dirname, 'index.html'), landing: resolve(__dirname, 'landing.html') },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
  },
});
