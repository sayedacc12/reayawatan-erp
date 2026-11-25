import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';
import { canonicalUrl, fullTitle, SEO_PAGES, type SeoPage } from './src/web/seo';

/**
 * بعد البناء: يكتب لكل صفحة عامة ملف HTML بعنوانها ووصفها ورابطها المعتمد، ونصاً أولياً
 * (العنوان والوصف وروابط الصفحات وبيانات التواصل) يقرؤه الزاحف قبل تشغيل JavaScript.
 * يستبدل Vue هذا النص عند التحميل. ويولد sitemap.xml من القائمة نفسها.
 * dist/_spa.html نسخة بلا نص أولي ولا رابط معتمد لشاشات النظام (nginx.conf).
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function setMeta(html: string, attr: 'name' | 'property', key: string, value: string) {
  const re = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`);
  if (!re.test(html)) throw new Error(`seo-prerender: وسم ${key} غير موجود في index.html`);
  return html.replace(re, `$1${esc(value)}$2`);
}

function fallback(page: SeoPage) {
  const links = SEO_PAGES.map((p) => `<li><a href="${p.path}">${esc(p.h1)}</a></li>`).join('');
  return `<div class="seo-fallback" style="max-width:860px;margin:40px auto;padding:0 16px;font-family:'IBM Plex Sans Arabic',sans-serif;color:#2c3e33;line-height:1.8">`
    + `<p><a href="/"><img src="/brand/logo.png" alt="رعاية وطن National Care" width="160"></a></p>`
    + `<h1 style="color:#164e38">${esc(page.h1)}</h1><p>${esc(page.description)}</p>`
    + `<nav aria-label="صفحات الموقع"><ul>${links}</ul></nav>`
    + `<address style="font-style:normal">شركة رعاية وطن للاستثمار، الرياض، حي الرحمانية، شارع الوليد التميمي 12341 · `
    + `<a href="mailto:info@reayawatan.com">info@reayawatan.com</a> · <a href="tel:+966564355564" dir="ltr">+966 56 435 5564</a></address></div>`;
}

export function renderPage(template: string, page: SeoPage) {
  const url = canonicalUrl(page.path);
  const title = fullTitle(page.title);
  let html = template.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  html = setMeta(html, 'name', 'description', page.description);
  html = setMeta(html, 'property', 'og:title', title);
  html = setMeta(html, 'property', 'og:description', page.description);
  html = setMeta(html, 'property', 'og:url', url);
  html = html.replace('</head>', `    <link rel="canonical" href="${url}" />\n  </head>`);
  if (!html.includes('<div id="app"></div>')) throw new Error('seo-prerender: لم يُعثر على <div id="app"></div>');
  return html.replace('<div id="app"></div>', `<div id="app">${fallback(page)}</div>`);
}

export function sitemap(lastmod: string) {
  const urls = SEO_PAGES.map((p) => `  <url><loc>${canonicalUrl(p.path)}</loc><lastmod>${lastmod}</lastmod><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function seoPrerender(): Plugin {
  let outDir = 'dist';
  return {
    name: 'rw-seo-prerender',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const template = readFileSync(join(outDir, 'index.html'), 'utf8');
      writeFileSync(join(outDir, '_spa.html'), template);
      for (const page of SEO_PAGES) {
        const file = page.path === '/' ? join(outDir, 'index.html') : join(outDir, page.path.slice(1), 'index.html');
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, renderPage(template, page));
      }
      writeFileSync(join(outDir, 'sitemap.xml'), sitemap(new Date().toISOString().slice(0, 10)));
    },
  };
}
