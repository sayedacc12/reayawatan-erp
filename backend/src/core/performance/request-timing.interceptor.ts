import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, finalize } from 'rxjs';
import { PerfCollector } from './perf-collector.service';

/** يقيس زمن كل طلب API ويسجله باسم المسار العام (مثل /api/beneficiaries/:id) لا بالرابط الفعلي */
@Injectable()
export class RequestTimingInterceptor implements NestInterceptor {
  constructor(private readonly collector: PerfCollector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    const started = process.hrtime.bigint();
    return next.handle().pipe(
      finalize(() => {
        const route = (req.baseUrl ?? '') + ((req.route as { path?: string } | undefined)?.path ?? '');
        if (!route) return;
        this.collector.record(req.method, route, Number(process.hrtime.bigint() - started) / 1e6);
      }),
    );
  }
}
