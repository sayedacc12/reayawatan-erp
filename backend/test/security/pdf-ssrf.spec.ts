import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { ReportPdfService } from '../../src/core/reports/report-pdf.service';

/**
 * بوابة أمنية: متصفح تصدير PDF لا يطلب أي عنوان شبكي (حماية من SSRF، مثل عنوان metadata في السحابة).
 * يحتاج Chromium (موجود في صورة Docker وفي GitHub Actions). بدونه يُتخطى الاختبار مع رسالة واضحة.
 */
describe('Security gate: PDF rendering cannot reach the network', () => {
  const pdf = new ReportPdfService();
  let server: Server;
  let hits: string[] = [];
  let base = '';

  beforeAll(async () => {
    server = createServer((req, res) => { hits.push(req.url ?? ''); res.end('x'); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await pdf.onModuleDestroy?.();
    await new Promise<void>((r) => server.close(() => r()));
  });

  (new ReportPdfService().available ? it : it.skip)('blocks images, styles, frames, fonts and scripts pointing to internal URLs', async () => {
    hits = [];
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="${base}/css">
      <style>@font-face{font-family:x;src:url(${base}/font)} body{background:url(${base}/bg)}</style>
      <script src="${base}/js"></script></head>
      <body style="font-family:x">تقرير<img src="${base}/img"><iframe src="${base}/frame"></iframe>
      <object data="${base}/obj"></object><script>fetch('${base}/fetch')</script></body></html>`;
    const out = await pdf.render(html, { landscape: false, footerLeft: 'test' });
    expect(out.subarray(0, 4).toString()).toBe('%PDF');
    expect(hits).toEqual([]);
  }, 120000);
});
