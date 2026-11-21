import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Permission, Role } from '../../core/entities';
import { ContractsService } from '../procurement/contracts.service';
import { DEFAULT_GRADE_LIMITS, DEFAULT_SUPPLIER_CRITERIA } from '../procurement/entities/contract.entity';
import { EvaluationsService } from '../procurement/evaluations.service';
import { PROCUREMENT_PERMISSIONS as P } from '../procurement/procurement.manifest';
import { DemoTeam, daysAgo } from './demo-context';

const inDays = (n: number) => daysAgo(-n);

/**
 * العقود وتقييم الموردين في الجمعية التجريبية (المرحلة الخامسة من المشتريات):
 * - اتفاقية إطارية سارية مع مورد السلال بأسعار تعاقدية وضمان نهائي ومؤشر خدمة وغرامة تأخير،
 *   أعدّها مدير المشاريع واعتمدها مدير النظام، ومرتبطة بعقد الشراكة إن وُجد (عقد مشترك).
 * - قراءة مؤشر الخدمة للشهر الماضي، وجزاء تأخير بانتظار اعتماد المالية.
 * - تقييم دوري معتمد للمورد يحدّث تقديره في سجل الموردين.
 */
@Injectable()
export class ContractsSeed {
  constructor(private readonly db: DataSource, private readonly contracts: ContractsService, private readonly evaluations: EvaluationsService) {}

  private async grant(roleId: string, actor: OrgUser, list: string[]) {
    const role = await this.db.getRepository(Role).findOneOrFail({ where: { id: roleId }, relations: { permissions: true } });
    role.permissions = [...role.permissions, ...(await this.db.getRepository(Permission).find({ where: { code: In(list) } }))];
    await this.db.getRepository(Role).save(role);
    return { ...actor, permissions: [...new Set([...actor.permissions, ...list])] } as OrgUser;
  }

  async run(team: DemoTeam) {
    const admin = team.admin;
    const org = admin.organizationId;
    const pm = await this.grant(team.roles.projectsManager, team.projectsManager, [P.contracts, P.evaluations]);
    await this.grant(team.roles.finance, team.finance, [P.contractsApprove, P.evaluationsApprove]);
    await this.evaluations.saveSettings(admin, {
      criteria: DEFAULT_SUPPLIER_CRITERIA.map((c) => ({ ...c })), gradeA: DEFAULT_GRADE_LIMITS.A, gradeB: DEFAULT_GRADE_LIMITS.B, gradeC: DEFAULT_GRADE_LIMITS.C,
      blockWeak: false, auditAreaIds: [],
    } as never);

    const [order] = await this.db.query(
      `SELECT o.id, o.supplier_id AS "supplierId", o.budget_line_id AS "budgetLineId" FROM pr_orders o WHERE o.organization_id = $1 AND o.status IN ('partial', 'accepted', 'issued') ORDER BY o.created_at LIMIT 1`, [org]);
    if (!order) return;
    const items: { id: string; name: string; price: number }[] = await this.db.query(
      `SELECT DISTINCT ON (l->>'itemId') l->>'itemId' AS id, l->>'description' AS name, (l->>'unitPrice')::float AS price
         FROM pr_orders o, jsonb_array_elements(o.lines) l WHERE o.organization_id = $1 AND o.id = $2 AND l->>'itemId' IS NOT NULL`, [org, order.id]);
    const [pt] = await this.db.query(`SELECT id FROM pt_contracts WHERE organization_id = $1 ORDER BY created_at LIMIT 1`, [org]).catch(() => []);

    // ---- 1) اتفاقية إطارية سارية ----
    const c = await this.contracts.create(pm, {
      kind: 'framework', supplierId: order.supplierId, reference: 'FA-2026-007', title: 'اتفاقية إطارية لتوريد السلال الغذائية',
      scope: 'توريد السلال الغذائية والمواد التموينية حسب التعميدات الصادرة خلال مدة الاتفاقية، والتسليم في المستودع الرئيس.',
      terms: 'الأسعار ثابتة طوال المدة. التسليم خلال 5 أيام عمل من التعميد. السداد خلال 30 يومًا من الفاتورة المطابقة.',
      startsOn: daysAgo(30), endsOn: inDays(335), value: 250000, alertPct: 80, alertDays: 45, budgetLineId: order.budgetLineId ?? null,
      ptContractId: pt?.id ?? null,
      prices: items.map((i) => ({ itemId: i.id, description: i.name, unit: null, unitPrice: i.price, maxQty: null })),
      guarantees: [{ kind: 'final', amount: 12500, ref: 'LG-2026-3381', issuer: 'مصرف الراجحي', expiresOn: inDays(365) }],
      slas: [{ name: 'التسليم في الموعد', target: 95, unit: '%', direction: 'min' }, { name: 'نسبة المرفوض في الفحص', target: 2, unit: '%', direction: 'max' }],
      penaltyRules: [{ name: 'غرامة التأخير في التسليم', basis: 'per_day', rate: 250, capPct: 10 }],
      requiredDocs: ['خطاب الضمان النهائي', 'شهادة الزكاة والدخل سارية'], shareWithSupplier: true,
    } as never);
    await this.contracts.submit(pm, c.id);
    const active = await this.contracts.decide(admin, c.id, 'approve', 'مطابقة لنتيجة المنافسة وشروط الترسية');
    await this.contracts.kpi(pm, c.id, { slaKey: active.slas[0].key, period: daysAgo(30).slice(0, 7), value: 92, note: 'تأخرت دفعة واحدة يومين' });
    await this.contracts.kpi(pm, c.id, { slaKey: active.slas[1].key, period: daysAgo(30).slice(0, 7), value: 1.5, note: null });
    await this.contracts.penalty(pm, c.id, {
      ruleKey: active.penaltyRules[0].key, date: daysAgo(3), days: 2, reason: 'تأخر توريد دفعة السلال يومين عن موعد التعميد', orderId: null,
    } as never);

    // ---- 2) تقييم دوري معتمد ----
    const e = await this.evaluations.create(pm, { supplierId: order.supplierId, kind: 'periodic', periodFrom: daysAgo(90), periodTo: daysAgo(0) } as never);
    const scores = e.scores.map((s: { key: string; auto: number | null; score: number }) => (s.auto === null ? { key: s.key, score: 85, note: 'سرعة الرد على الاستفسارات' } : { key: s.key, score: s.score, note: null }));
    await this.evaluations.update(pm, e.id, {
      scores, strengths: 'جودة السلال والتزام بالأسعار التعاقدية', weaknesses: 'تأخر محدود في بعض الدفعات', recommendation: 'الاستمرار مع المتابعة الشهرية لمؤشر التسليم', shareWithSupplier: true,
    } as never);
    await this.evaluations.submit(pm, e.id);
    await this.evaluations.decide(admin, e.id, 'approve', 'معتمد');
  }
}
