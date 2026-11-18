import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { PendingTask } from '../../core/tasks/tasks.registry';
import { TasksRegistry } from '../../core/tasks/tasks.registry';
import { HrRequest } from './entities/hr.entity';
import { HR_PERMISSIONS as P } from './hr.manifest';
import { RequestsService } from './requests.service';
import { SeparationService } from './separation.service';

const DAY = 86400000;
const old = (d: Date | string, days: number) => Date.now() - new Date(d).getTime() > days * DAY;

/** مهام الموارد البشرية المعلقة في جرس الإشعارات */
@Injectable()
export class HrTasks implements OnModuleInit {
  constructor(
    private readonly registry: TasksRegistry, private readonly db: DataSource, private readonly requests: RequestsService, private readonly separations: SeparationService,
  ) {}

  onModuleInit() {
    this.registry.register({ module: 'hr', name: 'الموارد البشرية', color: '#ec4899', collect: (u) => this.collect(u) });
  }

  private can(u: OrgUser, p: string) {
    return u.isSuperadmin || u.permissions.includes(p);
  }

  private async roles(u: OrgUser) {
    const rows: { role_id: string }[] = await this.db.query('SELECT role_id FROM user_roles WHERE user_id = $1', [u.id]);
    return new Set(rows.map((r) => r.role_id));
  }

  async collect(u: OrgUser): Promise<PendingTask[]> {
    const org = u.organizationId;
    const out: PendingTask[] = [];
    const me = await this.requests.me(u);
    const names = await this.requests.names(org);

    // طلبات الموظفين التي تنتظر قراري
    for (const r of await this.requests.awaiting(me)) {
      const step = r.steps[r.stepIndex!];
      out.push({
        id: `req:${r.id}`, group: 'طلبات للاعتماد', link: `/me/requests/${r.id}`, at: r.updatedAt, urgent: old(r.updatedAt, 2),
        title: `${r.typeName} من ${names.get(r.employeeId)?.fullName ?? ''}`, subtitle: `${r.summary} · خطوة: ${step.name}`,
      });
    }
    // طلباتي المعادة للتعديل
    if (me.employee) {
      const mine = await this.db.getRepository(HrRequest).find({ where: { organizationId: org, employeeId: me.employee.id, status: 'returned' } });
      for (const r of mine) {
        const ret = [...r.steps].reverse().find((s) => s.status === 'returned');
        out.push({ id: `mine:${r.id}`, group: 'طلباتي المعادة', link: `/me/requests/${r.id}`, at: r.updatedAt, title: `عدّل ${r.typeName} رقم ${r.requestNo}`, subtitle: ret?.note ?? r.summary });
      }
    }
    // إجازات مسجلة من شؤون الموظفين مباشرة بانتظار الاعتماد
    if (this.can(u, P.approveLeaves)) {
      const rows: { id: string; name: string; start: string; created: Date }[] = await this.db.query(
        `SELECT l.id, e.full_name AS name, l.start_date::text AS start, l.created_at AS created FROM hr_leave_requests l JOIN hr_employees e ON e.id = l.employee_id
          WHERE l.organization_id = $1 AND l.status = 'pending' AND l.request_id IS NULL ORDER BY l.start_date`, [org],
      );
      for (const r of rows) out.push({ id: `leave:${r.id}`, group: 'إجازات للاعتماد', link: '/hr/leaves', at: r.created, title: `إجازة ${r.name}`, subtitle: `تبدأ ${r.start}`, urgent: r.start <= new Date().toISOString().slice(0, 10) });
    }
    // مسير الرواتب في مرحلة اعتمادي
    if (this.can(u, P.approvePayroll)) {
      const roles = await this.roles(u);
      const [s] = await this.db.query('SELECT payroll_config AS cfg, development_config AS dev FROM hr_settings WHERE organization_id = $1', [org]);
      const stages: { name: string; roleId: string | null }[] = s?.cfg?.stages ?? [];
      const runs: { id: string; month: string; stage_index: number; updated_at: Date }[] = await this.db.query(
        `SELECT id, month, stage_index, updated_at FROM hr_payroll_runs WHERE organization_id = $1 AND status = 'pending'`, [org],
      );
      for (const r of runs) {
        const st = stages[r.stage_index];
        if (st?.roleId && !u.isSuperadmin && !roles.has(st.roleId)) continue;
        out.push({ id: `run:${r.id}`, group: 'مسير الرواتب', link: `/hr/payroll/${r.id}`, at: r.updated_at, title: `كشف رواتب ${r.month}`, subtitle: st ? `مرحلة: ${st.name}` : null });
      }
    }
    // خطط التطوير في مرحلة اعتمادي
    if (this.can(u, P.approveDevelopment)) {
      const roles = await this.roles(u);
      const [s] = await this.db.query('SELECT development_config AS dev FROM hr_settings WHERE organization_id = $1', [org]);
      const stages: { name: string; roleId: string | null }[] = s?.dev?.stages ?? [];
      const plans: { id: string; name: string; stage_index: number | null; updated_at: Date }[] = await this.db.query(
        `SELECT p.id, e.full_name AS name, p.stage_index, p.updated_at FROM hr_dev_plans p JOIN hr_employees e ON e.id = p.employee_id
          WHERE p.organization_id = $1 AND p.status = 'pending'`, [org],
      );
      for (const p of plans) {
        const st = p.stage_index !== null ? stages[p.stage_index] : undefined;
        if (st?.roleId && !u.isSuperadmin && !roles.has(st.roleId)) continue;
        out.push({ id: `dev:${p.id}`, group: 'خطط التطوير', link: `/hr/development/plans/${p.id}`, at: p.updated_at, title: `خطة تطوير ${p.name}`, subtitle: st ? `مرحلة: ${st.name}` : null });
      }
    }
    // تقييمات الأداء بانتظار الاعتماد النهائي
    if (this.can(u, P.approvePerformance)) {
      const cards: { id: string; name: string; year: number; updated_at: Date }[] = await this.db.query(
        `SELECT c.id, e.full_name AS name, c.year, COALESCE(c.evaluated_at, c.created_at) AS updated_at FROM hr_performance_cards c JOIN hr_employees e ON e.id = c.employee_id
          WHERE c.organization_id = $1 AND c.status = 'evaluated'`, [org],
      );
      for (const c of cards) out.push({ id: `card:${c.id}`, group: 'تقييمات الأداء', link: `/hr/performance/${c.id}`, at: c.updated_at, title: `اعتماد تقييم ${c.name}`, subtitle: `سنة ${c.year}` });
    }
    // خطط التعيين والأوصاف الوظيفية بانتظار الاعتماد
    if (this.can(u, P.approvePlans)) {
      const plans: { id: string; title: string; year: number; updated_at: Date }[] = await this.db.query(
        `SELECT p.id, j.title, p.year, p.created_at AS updated_at FROM hr_staffing_plans p JOIN hr_jobs j ON j.id = p.job_id WHERE p.organization_id = $1 AND p.status = 'submitted'`, [org],
      );
      for (const p of plans) out.push({ id: `plan:${p.id}`, group: 'خطط التعيين', link: '/hr/plans', at: p.updated_at, title: `خطة تعيين: ${p.title}`, subtitle: `سنة ${p.year}` });
    }
    if (this.can(u, P.approveJobs)) {
      const jobs: { id: string; title: string; updated_at: Date }[] = await this.db.query(
        `SELECT id, title, updated_at FROM hr_jobs WHERE organization_id = $1 AND status = 'draft' AND is_active`, [org],
      );
      for (const j of jobs) out.push({ id: `job:${j.id}`, group: 'أوصاف وظيفية', link: `/hr/jobs/${j.id}`, at: j.updated_at, title: `اعتماد الوصف الوظيفي: ${j.title}` });
    }
    // إخلاء الطرف ونهاية الخدمة: بنود تنتظر مسؤولها، وبيانات مستحقات للإعداد أو الاعتماد أو الصرف
    out.push(...(await this.separations.pendingFor(u)));
    return out;
  }
}
