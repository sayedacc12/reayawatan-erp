import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { existsSync, readdirSync } from 'fs';
import type { Browser } from 'puppeteer-core';
import { esc, reportFontCss } from './report-html';

/** مسارات متصفح Chromium المعتادة (Docker alpine، Debian، بيئة التطوير) */
function findChromium(): string | null {
  const env = process.env.CHROMIUM_PATH;
  if (env) return existsSync(env) ? env : null;
  const fixed = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
  for (const p of fixed) if (existsSync(p)) return p;
  // بيئة التطوير: Playwright
  const pw = '/opt/pw-browsers';
  if (existsSync(pw)) {
    for (const d of readdirSync(pw).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
      for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const p = `${pw}/${d}/${sub}`;
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

/**
 * تحويل HTML إلى PDF بمتصفح Chromium بدون واجهة، فيظهر النص العربي متصلًا
 * وباتجاه صحيح من اليمين لليسار وقابلًا للنسخ والبحث.
 * متصفح واحد يعاد استخدامه، وصفحة جديدة لكل ملف، وحد أقصى لعدد الملفات المتزامنة.
 */
@Injectable()
export class ReportPdfService implements OnModuleDestroy {
  private readonly log = new Logger('ReportPdf');
  private browser: Promise<Browser> | null = null;
  private active = 0;
  private readonly queue: (() => void)[] = [];
  private static readonly MAX_PARALLEL = 2;

  get available() {
    return !!findChromium();
  }

  private async launch(): Promise<Browser> {
    const executablePath = findChromium();
    if (!executablePath) throw new ServiceUnavailableException('تصدير PDF غير متاح على الخادم حاليًا، استخدم زر الطباعة واختر «حفظ كملف PDF»');
    const puppeteer = await import('puppeteer-core');
    const b = await puppeteer.launch({
      executablePath,
      headless: true,
      // لا نعترض إشارات إيقاف الخادم، فالمتصفح يُغلق مع إغلاق الوحدة
      handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none', '--no-zygote'],
    });
    b.on('disconnected', () => {
      this.browser = null;
    });
    this.log.log(`Chromium ready: ${executablePath}`);
    return b;
  }

  private getBrowser() {
    if (!this.browser) {
      this.browser = this.launch().catch((e) => {
        this.browser = null;
        throw e;
      });
    }
    return this.browser;
  }

  private async slot() {
    if (this.active >= ReportPdfService.MAX_PARALLEL) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
  }

  private release() {
    this.active--;
    this.queue.shift()?.();
  }

  async render(html: string, opts: { landscape: boolean; footerLeft: string }): Promise<Buffer> {
    await this.slot();
    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();
      try {
        // التقرير مكتمل داخل HTML (الخط مضمّن). نمنع أي طلب شبكي أو ملف حتى لا يصبح المتصفح
        // وسيلة للوصول لعناوين داخلية (SSRF) لو تسرب نص غير مُهرّب، ونعطّل JavaScript.
        await page.setJavaScriptEnabled(false);
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const url = req.url();
          if (url.startsWith('data:') || url === 'about:blank') void req.continue().catch(() => undefined);
          else void req.abort('blockedbyclient').catch(() => undefined);
        });
        await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });
        await page.evaluate('document.fonts.ready');
        const footer = `<style>${reportFontCss()}</style>
          <div style="width:100%;padding:0 10mm;font-family:'Plex Arabic',sans-serif;font-size:8px;color:#94a3b8;direction:rtl;display:flex;justify-content:space-between;">
            <span>صفحة <span class="pageNumber"></span> من <span class="totalPages"></span></span><span>${esc(opts.footerLeft)}</span>
          </div>`;
        const pdf = await page.pdf({
          format: 'A4', landscape: opts.landscape, printBackground: true, preferCSSPageSize: false,
          margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
          displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footer, timeout: 120_000,
        });
        return Buffer.from(pdf);
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      this.release();
    }
  }

  async onModuleDestroy() {
    if (this.browser) await (await this.browser.catch(() => null))?.close().catch(() => undefined);
  }
}
