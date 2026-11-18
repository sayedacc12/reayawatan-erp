import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';

/** إعدادات البوابة: يكفي مزوّد الخدمة والمفتاح السري */
export interface GatewayConfig { provider: 'sandbox' | 'moyasar'; secretKey: string | null }
const shortCode = () => randomBytes(5).toString('hex').toUpperCase();

export interface GatewayCheckout { id: string; url: string }
export interface GatewayStatus { paid: boolean; amount: number | null; reference: string | null }

const MOYASAR = 'https://api.moyasar.com/v1';

/**
 * بوابة الدفع الإلكتروني المشتركة (العضوية والموقع الإلكتروني)، قابلة للضبط من إعدادات كل نظام:
 * - sandbox: بيئة تجريبية تحاكي صفحة الدفع داخل سنابل (للتجربة والتدريب، لا تحصّل مالًا حقيقيًا).
 * - moyasar: بوابة ميسر (مدى وفيزا وماستركارد وآبل باي): تُنشأ فاتورة في ميسر ويُحوَّل العضو لصفحتها،
 *   ثم يُتحقق من حالة السداد من ميسر نفسها قبل اعتماده.
 */
export class PaymentGateway {
  constructor(private readonly cfg: GatewayConfig) {}

  async checkout(p: { amount: number; description: string; invoiceNo: string; returnUrl: string; backUrl: string; metadata?: Record<string, string> }): Promise<GatewayCheckout> {
    if (this.cfg.provider === 'sandbox') {
      const id = `SBX-${shortCode()}`;
      return { id, url: `${p.backUrl}?sandbox=${id}` };
    }
    const res = await this.call('POST', '/invoices', {
      amount: Math.round(p.amount * 100), currency: 'SAR', description: p.description,
      success_url: p.returnUrl, back_url: p.backUrl, metadata: { invoice_no: p.invoiceNo, ...(p.metadata ?? {}) },
    });
    if (!res?.id || !res?.url) throw new BadGatewayException('تعذر إنشاء عملية الدفع لدى البوابة، حاول لاحقًا');
    return { id: String(res.id), url: String(res.url) };
  }

  async status(id: string): Promise<GatewayStatus> {
    if (this.cfg.provider === 'sandbox') throw new BadRequestException('البيئة التجريبية لا تحتاج تحققًا من البوابة');
    const res = await this.call('GET', `/invoices/${encodeURIComponent(id)}`);
    const paid = res?.status === 'paid';
    const payment = Array.isArray(res?.payments) ? res.payments.find((x: { status?: string }) => x.status === 'paid') : null;
    return { paid, amount: typeof res?.amount === 'number' ? res.amount / 100 : null, reference: payment?.id ? String(payment.id) : id };
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown) {
    if (!this.cfg.secretKey) throw new BadRequestException('بوابة الدفع غير مضبوطة: المفتاح السري غير موجود');
    let res: Response;
    try {
      res = await fetch(`${MOYASAR}${path}`, {
        method,
        headers: { Authorization: `Basic ${Buffer.from(`${this.cfg.secretKey}:`).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new BadGatewayException('تعذر الاتصال ببوابة الدفع، حاول لاحقًا');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.message ? `: ${String(data.message).slice(0, 200)}` : '';
      throw new BadGatewayException(`رفضت بوابة الدفع الطلب${msg}`);
    }
    return data;
  }
}
