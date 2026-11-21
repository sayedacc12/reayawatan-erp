import { Injectable } from '@nestjs/common';
import { ZatcaEnv } from './zatca-crypto';

/**
 * الاتصال بمنصة «فاتورة» (واجهة الهيئة الإصدار 2). العناوين ثابتة في الكود ولا تُقبل من المستخدم.
 * يُستبدل في الاختبارات بمنصة وهمية لأن الاختبارات لا تتصل بالإنترنت.
 */
export const ZATCA_BASE: Record<ZatcaEnv, string> = {
  sandbox: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  simulation: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
};

export interface CsidResponse { requestID: string; binarySecurityToken: string; secret: string; dispositionMessage?: string }
export interface ValidationResults {
  status?: string;
  infoMessages?: { code?: string; message?: string }[];
  warningMessages?: { code?: string; message?: string }[];
  errorMessages?: { code?: string; message?: string }[];
}
export interface CheckResponse { validationResults?: ValidationResults; reportingStatus?: string; clearanceStatus?: string }

export class ZatcaApiError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(detail);
  }
}

@Injectable()
export class ZatcaApi {
  private async call<T>(env: ZatcaEnv, path: string, body: unknown, headers: Record<string, string>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${ZATCA_BASE[env]}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Version': 'V2', 'Accept-Language': 'ar', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      });
    } catch {
      throw new ZatcaApiError(0, 'تعذر الاتصال بمنصة «فاتورة». تحقق من اتصال السيرفر بالإنترنت ثم أعد المحاولة');
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    // فحص الامتثال يعيد 400 مع نتائج التحقق، فتُعاد النتائج لتظهر أسبابها
    if (res.ok || (res.status === 400 && json && typeof json === 'object' && 'validationResults' in json)) return json as T;
    throw new ZatcaApiError(res.status, describe(json) || `ردت المنصة برمز ${res.status}`);
  }

  private basic(token: string, secret: string) {
    return { Authorization: `Basic ${Buffer.from(`${token}:${secret}`).toString('base64')}` };
  }

  /** طلب شهادة الامتثال برمز التحقق (OTP) من بوابة «فاتورة» */
  complianceCsid(env: ZatcaEnv, csrPem: string, otp: string) {
    return this.call<CsidResponse>(env, '/compliance', { csr: Buffer.from(csrPem).toString('base64') }, { OTP: otp });
  }

  /** إرسال مستند تجريبي لفحص الامتثال */
  complianceCheck(env: ZatcaEnv, token: string, secret: string, doc: { invoiceHash: string; uuid: string; invoice: string }) {
    return this.call<CheckResponse>(env, '/compliance/invoices', doc, this.basic(token, secret));
  }

  /** طلب شهادة الإنتاج بعد نجاح فحوص الامتثال */
  productionCsid(env: ZatcaEnv, token: string, secret: string, complianceRequestId: string) {
    return this.call<CsidResponse>(env, '/production/csids', { compliance_request_id: complianceRequestId }, this.basic(token, secret));
  }
}

/** نص مختصر لأخطاء المنصة (بلا أسرار) */
function describe(json: unknown): string {
  if (!json || typeof json !== 'object') return '';
  const o = json as Record<string, unknown>;
  const errs = (o.errors ?? (o.validationResults as ValidationResults | undefined)?.errorMessages) as { code?: string; message?: string }[] | string[] | undefined;
  if (Array.isArray(errs) && errs.length) return errs.map((e) => (typeof e === 'string' ? e : [e.code, e.message].filter(Boolean).join(': '))).join('، ').slice(0, 1000);
  for (const k of ['message', 'dispositionMessage', 'error']) if (typeof o[k] === 'string') return (o[k] as string).slice(0, 1000);
  return '';
}
