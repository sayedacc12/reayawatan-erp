import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Permission, Role } from '../../core/entities';
import { OrdersService } from '../procurement/orders.service';
import { PROCUREMENT_PERMISSIONS as P } from '../procurement/procurement.manifest';
import { ProcurementCore } from '../procurement/procurement-core.service';
import { RequestsService } from '../procurement/requests.service';
import { RfqsService } from '../procurement/rfqs.service';
import { sourcingSettings } from '../procurement/sourcing-core.service';
import { SourcingPortalService } from '../procurement/sourcing-portal.service';
import { RequestDto } from '../procurement/sourcing.dto';
import { SupplierPortalUser } from '../procurement/supplier-portal.guard';
import { DemoTeam, daysAhead } from './demo-context';

const hoursAhead = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

/**
 * دورة الشراء في الجمعية التجريبية (المرحلة الثانية)، بعد الموازنة لأن التعميد يحجز من بنودها ومن مصادر التمويل:
 * - منافسة مكتملة: طلب ممول من مصدر تمويل برامجي، وعرض من بوابة المورد وآخر ورقي سجله الموظف، وفتح وتقييم لجنة وترسية،
 *   وتعميد معتمد حُجز مبلغه من مصدر التمويل، وأكد المورد استلامه وقبله من البوابة.
 * - تعميد مباشر معتمد على بند «صيانة وتجهيز المقر» (حجز فعلي في الموازنة)، وتعميد آخر بانتظار اعتماد المالية.
 * - منافسة مفتوحة للعروض فيها استفسار من المورد وجواب منشور، ليجربها المورد من البوابة.
 * - طلب بانتظار الاعتماد، وطلب معاد للاستكمال.
 * كل العمليات عبر خدمات الوحدة نفسها كما لو نفذها الموظفون والموردون.
 */
@Injectable()
export class SourcingSeed {
  constructor(
    private readonly db: DataSource, private readonly core: ProcurementCore, private readonly requests: RequestsService,
    private readonly rfqs: RfqsService, private readonly orders: OrdersService, private readonly portal: SourcingPortalService,
  ) {}

  /** صلاحيات دورة الشراء لأدوار الفريق التجريبي */
  private async grant(roleId: string, actor: OrgUser, list: string[]) {
    const role = await this.db.getRepository(Role).findOneOrFail({ where: { id: roleId }, relations: { permissions: true } });
    role.permissions = [...role.permissions, ...(await this.db.getRepository(Permission).find({ where: { code: In(list) } }))];
    await this.db.getRepository(Role).save(role);
    return { ...actor, permissions: [...new Set([...actor.permissions, ...list])] } as OrgUser;
  }

  async run(team: DemoTeam) {
    const admin = team.admin;
    const org = admin.organizationId;
    // مدير المشاريع يطلب، والمالية تعتمد طلبات المقر والتعميدات وتشارك في لجنة التقييم، ومدير النظام يعتمد طلبات البرامج ويدير التوريد
    const pm = await this.grant(team.roles.projectsManager, team.projectsManager, [P.requests, P.read]);
    const finance = await this.grant(team.roles.finance, team.finance, [P.approveOrders, P.approveRequests, P.evaluate, P.read]);
    const s = sourcingSettings(await this.core.settings(org));

    const sup = async (name: string) => ((await this.db.query('SELECT id FROM pr_suppliers WHERE organization_id = $1 AND name = $2', [org, name]))[0]?.id ?? null) as string | null;
    const wafa = await sup('شركة الوفاء للتموين الغذائي');
    const dafa = await sup('مؤسسة الدفء للملابس والمفروشات');
    const naql = await sup('فهد سعد الشمري (نقل وتوصيل)');
    if (!wafa || !dafa || !naql) return;
    const [wafaUser] = await this.db.query(`SELECT id, full_name AS "fullName", email FROM pr_supplier_users WHERE supplier_id = $1 AND role = 'owner' LIMIT 1`, [wafa]);
    const wafaPortal: SupplierPortalUser | null = wafaUser ? {
      userId: wafaUser.id, supplierId: wafa, organizationId: org, fullName: wafaUser.fullName, email: wafaUser.email, role: 'owner', supplierStatus: 'approved', mustChangePassword: false,
    } : null;

    const uoms: { id: string; name: string }[] = await this.db.query('SELECT id, name FROM pr_uoms WHERE organization_id = $1', [org]);
    const uom = (n: string) => uoms.find((u) => u.name === n)?.id ?? null;
    const [unit] = await this.db.query(`SELECT id FROM hr_units WHERE organization_id = $1 AND name LIKE '%البرامج%' LIMIT 1`, [org]).catch(() => []);
    const [office] = await this.db.query(`SELECT id FROM hr_units WHERE organization_id = $1 AND name LIKE '%التنفيذية%' LIMIT 1`, [org]).catch(() => []);
    const [warehouse] = await this.db.query(`SELECT id FROM pr_warehouses WHERE organization_id = $1 AND kind = 'main' ORDER BY code LIMIT 1`, [org]);

    // بند الموازنة الجارية المخصص للمقر، ومصدر تمويل برامجي متاح
    const Y = Number(daysAhead(0).slice(0, 4));
    const [maint] = await this.db.query(
      `SELECT l.id FROM plan_budget_lines l JOIN plan_budgets b ON b.id = l.budget_id
        WHERE l.organization_id = $1 AND b.fiscal_year = $2 AND b.status = 'approved' AND l.name = 'صيانة وتجهيز المقر' LIMIT 1`, [org, Y]);
    const [batch] = await this.db.query(
      `SELECT id, activity_id AS "activityId", target_kind AS kind FROM fundraising_batches
        WHERE organization_id = $1 AND status = 'active' AND target_kind IN ('program', 'operational') AND (conditions->>'endDate' IS NULL OR conditions->>'endDate' >= $2)
          AND amount - reserved_amount - spent_amount - transferred_amount >= 40000
        ORDER BY (target_kind = 'program' AND activity_id IS NOT NULL) DESC, amount - reserved_amount - spent_amount - transferred_amount DESC LIMIT 1`, [org, daysAhead(0)]);
    const line = maint?.id as string | undefined;
    // ربط بنود الطلب بدليل الأصناف: السلة الغذائية صنف مخزني يدخل المستودع عند الاستلام
    const [basketItem] = await this.db.query(`SELECT id FROM pr_items WHERE organization_id = $1 AND name = 'سلة غذائية متكاملة لأسرة' LIMIT 1`, [org]);

    const request = async (by: OrgUser, dto: Omit<RequestDto, 'priority'> & { priority?: RequestDto['priority'] }) =>
      this.requests.create(by, { priority: 'normal', unitId: unit?.id ?? null, ...dto } as RequestDto);

    // ---- 1) منافسة مكتملة حتى التعميد والقبول ----
    if (batch) {
      const r = await request(pm, {
        title: 'سلال غذائية لبرنامج إفطار رمضان', kind: 'goods', priority: 'high', neededBy: daysAhead(25), projectId: batch.kind === 'program' ? batch.activityId : null,
        justification: 'توزيع 200 سلة على الأسر المسجلة في البرنامج قبل بداية الشهر', method: 'quotes', fundingBatchId: batch.id,
        lines: [
          { itemId: basketItem?.id ?? null, description: 'سلة غذائية متكاملة', qty: 200, uomId: uom('سلة') ?? uom('حبة'), estPrice: 140, specs: 'أرز بسمتي 5 كجم، سكر 2 كجم، زيت 1.5 لتر، تمر 1 كجم، عدس 1 كجم' },
          { description: 'كيس تغليف قماشي بشعار الجمعية', qty: 200, uomId: uom('حبة'), estPrice: 5, specs: null },
        ],
      });
      await this.requests.submit(pm, r.id, true);
      await this.requests.decide(admin, r.id, 'approve', 'معتمد ضمن خطة البرنامج');
      let q = await this.rfqs.create(admin, {
        requestId: r.id, title: 'توريد سلال غذائية لبرنامج إفطار رمضان', method: 'quotes', scope: 'توريد 200 سلة غذائية متكاملة مع أكياس التغليف إلى المستودع الرئيسي.',
        terms: 'التوريد خلال 10 أيام من التعميد، والدفع بعد الاستلام والفحص، وصلاحية المواد الغذائية 6 أشهر على الأقل.',
        closesAt: hoursAhead(48), questionsUntil: hoursAhead(24), invitedIds: [wafa, dafa, naql], categoryIds: [],
        criteria: s.evalCriteria.map((c) => ({ ...c })), technicalPass: s.technicalPass, committeeIds: [admin.id, finance.id],
      });
      await this.rfqs.publish(admin, q.id, null);
      const lines = (q.lines as { id: string }[]);
      if (wafaPortal) {
        await this.portal.saveQuote(wafaPortal, q.id, {
          lines: [{ lineId: lines[0].id, unitPrice: 135, note: 'أرز بسمتي هندي، تمور القصيم' }, { lineId: lines[1].id, unitPrice: 4.5, note: null }],
          vatRate: 15, deliveryDays: 7, validityDays: 60, technicalNote: 'نوفر شهادة صلاحية لكل دفعة، والتوصيل بسياراتنا المبردة.', submit: true,
        });
      }
      await this.rfqs.staffQuote(admin, q.id, {
        supplierId: dafa, lines: [{ lineId: lines[0].id, unitPrice: 128, note: null }, { lineId: lines[1].id, unitPrice: 5, note: null }],
        vatRate: 15, deliveryDays: 14, validityDays: 30, technicalNote: 'عرض ورقي سُلّم باليد، والتوريد على دفعتين.', submit: true,
      });
      // مر موعد التقديم: تُفتح العروض وتقيمها اللجنة
      await this.db.query(`UPDATE pr_rfqs SET closes_at = now() - interval '1 hour', questions_until = now() - interval '1 day' WHERE id = $1`, [q.id]);
      await this.rfqs.open(admin, q.id);
      const quotes: { id: string; supplierId: string }[] = await this.db.query(`SELECT id, supplier_id AS "supplierId" FROM pr_quotes WHERE rfq_id = $1`, [q.id]);
      const marks: Record<string, [number, number][]> = { [wafa]: [[90, 85], [85, 80]], [dafa]: [[65, 70], [70, 60]] };
      for (const x of quotes) {
        const [a, b] = marks[x.supplierId] ?? [[70, 70], [70, 70]];
        await this.rfqs.score(admin, x.id, { scores: [{ key: 'quality', score: a[0] }, { key: 'delivery', score: a[1] }], note: null });
        await this.rfqs.score(finance, x.id, { scores: [{ key: 'quality', score: b[0] }, { key: 'delivery', score: b[1] }], note: x.supplierId === dafa ? 'مدة التوريد طويلة على موعد البرنامج' : null });
      }
      q = await this.rfqs.get(admin, q.id);
      const best = (q.quotes as { id: string; evaluation?: { rank: number | null } }[]).find((x) => x.evaluation?.rank === 1) ?? quotes[0];
      await this.rfqs.recommend(admin, q.id, {
        quoteId: best.id, recommendation: 'توصي اللجنة بالترسية على صاحب أعلى درجة إجمالية: اجتاز التقييم الفني بفارق واضح ومدة توريده تناسب موعد البرنامج، وفرق السعر محدود.',
      });
      const [o] = await this.db.query(`SELECT id FROM pr_orders WHERE rfq_id = $1 ORDER BY created_at DESC LIMIT 1`, [q.id]);
      if (o) {
        if (warehouse) await this.db.query('UPDATE pr_orders SET warehouse_id = $2 WHERE id = $1', [o.id, warehouse.id]);
        const issued = await this.orders.approve(finance, o.id, 'مصدر التمويل يغطي القيمة');
        if (issued.status === 'issued') {
          await this.orders.respond(org, o.id, wafa, 'acknowledge', null, 'خالد العتيبي (المورد)');
          await this.orders.respond(org, o.id, wafa, 'accept', 'سنورد على دفعة واحدة خلال أسبوع', 'خالد العتيبي (المورد)');
        }
      }
    }

    if (line) {
      // ---- 2) تعميد مباشر معتمد بحجز فعلي على بند الموازنة ----
      const r2 = await request(admin, {
        title: 'صيانة أجهزة التكييف في المقر', kind: 'services', unitId: office?.id ?? null, neededBy: daysAhead(10), method: 'direct', budgetLineId: line,
        justification: 'صيانة دورية قبل الصيف لعدد 12 جهازًا', lines: [{ description: 'صيانة شاملة لأجهزة التكييف (12 جهازًا)', qty: 1, uomId: null, estPrice: 8500, specs: 'تنظيف وتعبئة غاز وفحص الضواغط' }],
      });
      await this.requests.submit(admin, r2.id, true);
      await this.requests.decide(finance, r2.id, 'approve', null);
      const req2 = await this.requests.find(admin, r2.id);
      if (req2.status === 'approved') {
        const o2 = await this.orders.createDirect(admin, {
          requestId: r2.id, supplierId: naql, vatRate: 0, deliveryDate: daysAhead(10), deliveryPlace: 'مقر الجمعية',
          lines: [{ lineId: req2.lines[0].id, qty: 1, unitPrice: 8200 }],
        });
        await this.orders.submit(admin, o2.id);
        await this.orders.approve(finance, o2.id, null);
      }

      // ---- 3) تعميد بانتظار اعتماد المالية ----
      const r3 = await request(admin, {
        title: 'قرطاسية ومستلزمات مكتبية للربع القادم', kind: 'goods', unitId: office?.id ?? null, neededBy: daysAhead(14), method: 'direct', budgetLineId: line,
        lines: [
          { description: 'ورق تصوير A4 (كرتون 5 رزم)', qty: 20, uomId: uom('كرتون') ?? uom('حبة'), estPrice: 95, specs: null },
          { description: 'أحبار طابعات ليزر', qty: 6, uomId: uom('حبة'), estPrice: 320, specs: 'متوافقة مع طابعات المقر' },
          { description: 'ملفات وأدوات مكتبية متنوعة', qty: 1, uomId: null, estPrice: 900, specs: null },
        ],
      });
      await this.requests.submit(admin, r3.id, true);
      await this.requests.decide(finance, r3.id, 'approve', null);
      const req3 = await this.requests.find(admin, r3.id);
      if (req3.status === 'approved') {
        const o3 = await this.orders.createDirect(admin, {
          requestId: r3.id, supplierId: wafa, vatRate: 15, deliveryDate: daysAhead(14), warehouseId: warehouse?.id ?? null,
          lines: req3.lines.map((l) => ({ lineId: l.id, qty: l.qty, unitPrice: l.estPrice })),
        });
        await this.orders.submit(admin, o3.id);
      }

      // ---- 4) طلب بانتظار الاعتماد، وطلب معاد للاستكمال ----
      const r4 = await request(pm, {
        title: 'بطانيات شتوية لأسر الحي', kind: 'goods', neededBy: daysAhead(30), method: null, budgetLineId: line,
        justification: 'حملة الشتاء للأسر المسجلة', lines: [{ description: 'بطانية شتوية مزدوجة', qty: 150, uomId: uom('حبة'), estPrice: 60, specs: 'وزن 4 كجم على الأقل' }],
      });
      await this.requests.submit(pm, r4.id, true);
      const r5 = await request(pm, {
        title: 'جهاز عرض لقاعة التدريب', kind: 'assets', neededBy: daysAhead(20), method: null, budgetLineId: line,
        lines: [{ description: 'جهاز عرض (بروجكتر) مع شاشة', qty: 1, uomId: uom('حبة'), estPrice: 4500, specs: null }],
      });
      await this.requests.submit(pm, r5.id, true);
      await this.requests.decide(admin, r5.id, 'return', 'أرفق عرض سعر استرشاديًا ومواصفات الجهاز المطلوبة (الإضاءة والدقة)');
    }

    // ---- 5) منافسة مفتوحة للعروض يجربها المورد من البوابة ----
    if (!batch && !line) return;
    const r6 = await request(pm, {
      title: 'تمور لبرنامج إفطار صائم', kind: 'goods', neededBy: daysAhead(30), method: 'quotes', ...(batch ? { fundingBatchId: batch.id, projectId: batch.kind === 'program' ? batch.activityId : null } : { budgetLineId: line ?? null }),
      lines: [{ description: 'تمر سكري معبأ (عبوة 1 كجم)', qty: 600, uomId: uom('حبة'), estPrice: 25, specs: 'إنتاج الموسم الحالي، تعبئة محكمة' }],
    });
    await this.requests.submit(pm, r6.id, true);
    await this.requests.decide(admin, r6.id, 'approve', null);
    const q6 = await this.rfqs.create(admin, {
      requestId: r6.id, title: 'توريد تمور لبرنامج إفطار صائم', method: 'quotes', scope: 'توريد 600 عبوة تمر سكري إلى المستودع الرئيسي.', terms: 'التسليم دفعة واحدة، والدفع بعد الاستلام.',
      closesAt: hoursAhead(24 * 6), questionsUntil: hoursAhead(24 * 3), invitedIds: [wafa, dafa, naql], categoryIds: [],
      criteria: s.evalCriteria.map((c) => ({ ...c })), technicalPass: s.technicalPass, committeeIds: [admin.id, finance.id],
    });
    await this.rfqs.publish(admin, q6.id, null);
    if (wafaPortal) {
      await this.portal.ask(wafaPortal, q6.id, { question: 'هل يُقبل التمر الخلاص بدل السكري إن كان السعر أقل؟' });
      const [qq] = await this.db.query('SELECT id FROM pr_rfq_questions WHERE rfq_id = $1 LIMIT 1', [q6.id]);
      if (qq) await this.rfqs.answer(admin, q6.id, qq.id, { answer: 'المطلوب السكري حسب الكراسة، ويمكن ذكر البديل في الملاحظات دون احتسابه.', published: true });
    }
  }
}
