import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, SEO_PAGES, seoFor } from './seo.ts';

test('كل صفحة عامة لها مسار فريد ووصف بطول يناسب نتائج البحث', () => {
  const paths = SEO_PAGES.map((p) => p.path);
  assert.equal(new Set(paths).size, paths.length);
  for (const p of SEO_PAGES) {
    assert.ok(p.description.length >= 70 && p.description.length <= 230, `${p.path}: ${p.description.length}`);
    assert.ok(p.h1.trim());
  }
});

test('الرابط المعتمد مطلق وبلا شرطة أخيرة', () => {
  assert.equal(canonicalUrl('/'), 'https://reayawatan.com/');
  assert.equal(canonicalUrl('/about/'), 'https://reayawatan.com/about');
  assert.equal(seoFor('/services/gov/')?.title, 'الحوكمة والامتثال');
});
