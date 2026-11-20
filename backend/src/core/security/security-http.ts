import { ArgumentsHost, CallHandler, Catch, ExecutionContext, HttpException, Injectable, NestInterceptor, NestMiddleware } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { AuthUser } from '../auth/decorators';
import { SecurityMonitor } from './security-monitor.service';

/** مسارات لا تُسجّل ولا تُحظر: فحص الصحة فقط */
const SKIP = /^\/api\/health(\/|$)/;
/** دخول الموظفين: يُسجل اسم الدخول المستخدم (لا كلمة المرور أبدًا) */
const STAFF_LOGIN = '/api/auth/login';
/** دخول البوابات: لا يُسجل المعرف لأنه قد يكون رقم هوية */
const PORTAL_LOGIN = /\/login$/;
/** التصدير والتنزيل الجماعي للبيانات */
const EXPORT_RE = /\/export(\/|$)|\/(pdf|xlsx|csv)$/;
/** تغييرات إدارية حساسة: المستخدمون والأدوار والصلاحيات والجمعيات والإعدادات */
const ADMIN_RE = /^\/api\/(users|roles|platform\/(organizations|settings|mail|security|lifecycle))(\/|$)|\/(settings|permissions)(\/|$)/;

export const routeOf = (req: Request) => {
  const path = (req.route as { path?: string } | undefined)?.path;
  return path ? (req.baseUrl ?? '') + path : null;
};
const pathOf = (req: Request) => (req.originalUrl ?? req.url ?? '').split('?')[0];
/**
 * المسار الفعلي لا يُحفظ أبدًا: بعض الروابط العامة تحمل رمزًا سريًا (الدفع، التوقيع، الاستبيانات).
 * يُحفظ نمط المسار (مثل /api/beneficiaries/:id)، ولمسار غير موجود أول جزأين فقط.
 */
const unknownRoute = (path: string) => path.split('/').filter(Boolean).slice(0, 2).map((x) => x.slice(0, 60)).join('/').replace(/^/, '/');
/** بصمة غير قابلة للعكس للمسار الفعلي: تكفي لعدّ السجلات المختلفة المطلوبة دون حفظ أي معرف أو رمز */
const pathRef = (path: string) => createHash('sha256').update(path).digest('hex').slice(0, 16);
const loginName = (req: Request) => {
  const b = req.body as { login?: unknown; email?: unknown } | undefined;
  const v = typeof b?.login === 'string' ? b.login : typeof b?.email === 'string' ? b.email : null;
  return v ? v.trim().toLowerCase().slice(0, 160) : null;
};

/**
 * مرشح الأخطاء العام: يترك الرد كما هو تمامًا (BaseExceptionFilter)، ويسجل قبله الحدث الأمني:
 * دخول فاشل، طلب بلا جلسة، رفض صلاحية، سجل أو مسار غير موجود، تجاوز الحد، أو خطأ خادم.
 */
@Catch()
export class SecurityExceptionFilter extends BaseExceptionFilter {
  constructor(private readonly monitor: SecurityMonitor) {
    super();
  }

  catch(exception: unknown, host: ArgumentsHost) {
    try {
      if (host.getType() === 'http') this.observe(exception, host.switchToHttp().getRequest<Request>());
    } catch {
      // التسجيل لا يؤثر على الرد أبدًا
    }
    super.catch(exception, host);
  }

  private observe(exception: unknown, req: Request) {
    const path = pathOf(req);
    if (SKIP.test(path) || req.method === 'OPTIONS') return;
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const route = routeOf(req);
    const user = (req as Request & { user?: AuthUser }).user;
    const base = { ip: req.ip, method: req.method, status, route: route ?? unknownRoute(path), userId: user?.id ?? null, orgId: user?.organizationId ?? null };

    if (req.method === 'POST' && route && PORTAL_LOGIN.test(route) && (status === 401 || status === 429)) {
      const staff = route === STAFF_LOGIN;
      this.monitor.record({
        ...base, type: status === 401 ? 'login_failed' : 'login_throttled', severity: 'low',
        actor: staff ? loginName(req) : null, detail: staff ? null : { portal: true },
      });
      return;
    }
    if (status === 401) this.monitor.record({ ...base, type: 'auth_required' });
    else if (status === 403) {
      // صاحب كلمة المرور المؤقتة يُرفض طلبه حتى يغيّرها: هذا سلوك طبيعي لا يُحتسب
      if (user?.mustChangePassword) return;
      this.monitor.record({ ...base, type: 'forbidden', severity: 'low', actor: user?.email ?? null });
    } else if (status === 404) {
      if (!route) this.monitor.record({ ...base, type: 'unknown_route', detail: { ref: pathRef(path) } });
      else this.monitor.record({ ...base, type: 'not_found', actor: user?.email ?? null, detail: route.includes(':') ? { ref: pathRef(path) } : null });
    } else if (status === 429) this.monitor.record({ ...base, type: 'rate_limited', severity: 'low' });
    else if (status >= 500) {
      // نوع الخطأ فقط: رسائل قاعدة البيانات قد تحمل قيمًا من بيانات الجمعية
      const kind = exception instanceof Error ? exception.constructor.name.slice(0, 60) : typeof exception;
      this.monitor.record({ ...base, type: 'server_error', severity: 'medium', detail: { error: kind } });
    }
  }
}

/** يسجل العمليات الناجحة المهمة أمنيًا: الدخول، والتغييرات الإدارية، والتصدير */
@Injectable()
export class SecurityInterceptor implements NestInterceptor {
  constructor(private readonly monitor: SecurityMonitor) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    return next.handle().pipe(
      tap((body) => {
        try {
          this.observe(req, body);
        } catch {
          // لا يؤثر على الرد
        }
      }),
    );
  }

  private observe(req: Request & { user?: AuthUser }, body: unknown) {
    const route = routeOf(req);
    if (!route) return;
    if (req.method === 'POST' && route === STAFF_LOGIN) {
      const u = (body as { user?: Partial<AuthUser> } | undefined)?.user;
      if (!u?.id) return;
      this.monitor.record({
        type: 'login_success', ip: req.ip, userId: u.id, orgId: u.organizationId ?? null, actor: loginName(req), method: 'POST', route, status: 200,
        detail: { privileged: !!(u.isPlatformAdmin || u.isSuperadmin), platformAdmin: !!u.isPlatformAdmin },
      });
      return;
    }
    const user = req.user;
    if (!user) return;
    const base = { ip: req.ip, userId: user.id, orgId: user.organizationId, actor: user.email, method: req.method, route, status: 200 };
    if (req.method === 'GET' && EXPORT_RE.test(route)) this.monitor.record({ ...base, type: 'export' });
    else if (req.method !== 'GET' && ADMIN_RE.test(route)) this.monitor.record({ ...base, type: 'admin_change', severity: 'low' });
  }
}

/**
 * الحظر المؤقت: عنوان حظره المراقب (أو المدير) يتلقى «طلبات كثيرة» دون أن يصل طلبه للنظام.
 * يقرأ من الذاكرة فقط، فلا يضيف أي تأخير لبقية المستخدمين.
 * موظف دخل قبل الحظر من نفس العنوان (شبكة جوال أو مكتب مشتركة) يكمل عمله: رمز دخول موظف صالح يتجاوز حظر العنوان،
 * وحارس الدخول يتحقق بعدها من الجلسة والصلاحيات كالمعتاد.
 */
@Injectable()
export class SecurityBlockMiddleware implements NestMiddleware {
  constructor(private readonly monitor: SecurityMonitor, private readonly jwt: JwtService) {}

  use(req: Request, res: Response, next: NextFunction) {
    if (!SKIP.test(req.originalUrl ?? req.url) && this.monitor.isBlocked(req.ip) && !this.staffSession(req)) {
      res.status(429).json({ statusCode: 429, message: 'طلبات كثيرة، حاول بعد قليل' });
      return;
    }
    next();
  }

  private staffSession(req: Request) {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return false;
    try {
      const p = this.jwt.verify<{ sub?: string; typ?: string }>(h.slice(7));
      return !!p.sub && !p.typ;
    } catch {
      return false;
    }
  }
}
