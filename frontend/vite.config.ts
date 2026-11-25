import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { seoPrerender } from './seo-prerender';

export default defineConfig({
  plugins: [vue(), seoPrerender()],
  server: {
    port: 5173,
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
  },
});
