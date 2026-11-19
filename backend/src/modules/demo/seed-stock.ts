import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Permission, Role } from '../../core/entities';
import { CountsService } from '../procurement/counts.service';
import { IssueRequestsService } from '../procurement/issue-requests.service';
import { PROCUREMENT_PERMISSIONS as P } from '../procurement/procurement.manifest';
import { ReceiptsService } from '../procurement/receipts.service';
import { StockDocsService } from '../procurement/stock-docs.service';
import { StockService } from '../procurement/stock.service';
import { DemoTeam, daysAgo, daysAhead } from './demo-context';

/**
 * المستودعات في الجمعية التجريبية (المرحلة الثالثة من المشتريات)، بعد دورة الشراء:
 * - حسابات قيود المستودعات في الإعدادات، وأرصدة افتتاحية للمستودع الرئيسي ومستودع المقر بتشغيلات وصلاحيات (منها دفعة تنتهي قريبًا).
 * - استلام جزئي لتعميد السلال الغذائية بمحضر لجنة فحص ورفض كمية تالفة، فيصبح التعميد «مستلمًا جزئيًا» ويُستهلك جزء الحجز من مصدر التمويل.
 * - تبرع عيني ببطانيات بالقيمة العادلة.
 * - طلب صرف معتمد ومصروف بالكامل على مركز تكلفة البرامج، وطلب معتمد بانتظار الصرف، وطلب بانتظار الاعتماد.
 * - تحويل إلى المستودع الميداني، ومحضر إتلاف لدفعة منتهية بانتظار اعتماد المالية، ومحضر جرد بعجز بانتظار الاعتماد.
 * كل العمليات عبر خدمات الوحدة نفسها، فتصدر سندات المخازن في النظام المالي وتبقى المطابقة مع الدليل سليمة.
 */
@Injectable()
export class StockSeed {
  constructor(
    private readonly db: DataSource, private readonly stock: StockService, private readonly receipts: ReceiptsService,
    private readonly issues: IssueRequestsService, private readonly docs: StockDocsService, private readonly counts: CountsService,
  ) {}

  private async grant(roleId: string, actor: OrgUser, list: string[]) {
    const role = await this.db.getRepository(Role).findOneOrFail({ where: { id: roleId }, relations: { permissions: true } });
    role.permissions = [...role.permissions, ...(await this.db.getRepository(Permission).find({ where: { code: In(list) } }))];
    await this.db.getRepository(Role).save(role);
    return { ...actor, permissions: [...new Set([...actor.permissions, ...list])] } as OrgUser;
  }

  async run(team: DemoTeam) {
    const admin = team.admin;
    const org = admin.organizationId;
    // المالية تعتمد طلبات الصرف والإتلاف وفروقات الجرد، ومدير المشاريع يطلب الصرف لبرامجه
    const finance = await this.grant(team.roles.finance, team.finance, [P.issueApprove, P.stockApprove, P.read]);
    const pm = await this.grant(team.roles.projectsManager, team.projectsManager, [P.issueRequest]);

    // ---- الحسابات ----
    const acc = async (...names: string[]) => {
      for (const n of names) {
        const [x] = await this.db.query(`SELECT id FROM acc_accounts WHERE organization_id = $1 AND kind = 'sub' AND is_active AND name = $2 ORDER BY code LIMIT 1`, [org, n]);
        if (x) return x.id as string;
      }
      return null;
    };
    const cc = async (code: string) => ((await this.db.query('SELECT id FROM acc_analytic_accounts WHERE organization_id = $1 AND code = $2', [org, code]))[0]?.id ?? null) as string | null;
    const grni = await acc('موردون ــ متنوعون');
    const adjust = await acc('مستهلكات أخرى', 'مصاريف الضيافة');
    const donation = await acc('تبرعات عينية ــ أسر محتاجة', 'تبرعات وهبات غير مقيدة ــ عينية');
    const opening = await acc('صافي الأصول غير المقيدة');
    const expense = await acc('مستلزمات مكتبية');
    const ccAdmin = await cc('CC01');
    const ccPrograms = await cc('CC02');
    if (!grni || !adjust || !donation || !opening) return;
    await this.stock.saveSettings(admin, {
      grniAccountId: grni, adjustAccountId: adjust, adjustAnalyticId: ccAdmin, donationAccountId: donation, openingAccountId: opening, defaultExpenseAccountId: expense,
      expiryAlertDays: 60, overReceiptPct: 5, vatInCost: true, requireInspection: false,
    });

    // ---- الأصناف والمستودعات ----
    const items: { id: string; name: string }[] = await this.db.query('SELECT id, name FROM pr_items WHERE organization_id = $1', [org]);
    const it = (name: string) => items.find((x) => x.name === name)?.id ?? null;
    const whs: { id: string; kind: string; name: string }[] = await this.db.query('SELECT id, kind, name FROM pr_warehouses WHERE organization_id = $1 AND is_active ORDER BY code', [org]);
    const main = whs.find((w) => w.kind === 'main');
    const office = whs.find((w) => w.kind === 'sub');
    const field = whs.find((w) => w.kind === 'field');
    if (!main) return;
    const [shelf] = await this.db.query(`SELECT id FROM pr_locations WHERE warehouse_id = $1 AND code = 'A-01-R1'`, [main.id]);
    // التواريخ داخل الشهر الجاري أو السابق (الفترات الأقدم مغلقة في المالي)
    const monthStart = `${daysAgo(0).slice(0, 8)}01`;
    const d = (n: number) => (daysAgo(n) < monthStart ? monthStart : daysAgo(n));

    // ---- 1) الأرصدة الافتتاحية ----
    const lines = [
      { itemId: it('أرز بسمتي كيس 10 كجم'), qty: 180, unitPrice: 82, lot: 'RB-2611', expiryDate: daysAhead(300), locationId: shelf?.id ?? null },
      { itemId: it('أرز بسمتي كيس 10 كجم'), qty: 40, unitPrice: 80, lot: 'RB-2605', expiryDate: daysAhead(35), locationId: shelf?.id ?? null },
      { itemId: it('سكر أبيض ناعم 5 كجم'), qty: 150, unitPrice: 21.5, expiryDate: daysAhead(500) },
      { itemId: it('زيت دوار الشمس 1.5 لتر'), qty: 90, unitPrice: 18, expiryDate: daysAhead(200) },
      { itemId: it('تمر سكري معبأ 3 كجم'), qty: 70, unitPrice: 44, expiryDate: daysAhead(150) },
      { itemId: it('بطانية شتوية مزدوجة'), qty: 25, unitPrice: 115 },
      { itemId: it('مياه شرب معبأة 330 مل'), qty: 12, unitPrice: 13, expiryDate: d(1) },
    ].filter((l) => l.itemId);
    await this.receipts.create(admin, { kind: 'opening', warehouseId: main.id, date: d(10), deliveryRef: 'جرد بدء التشغيل', notes: 'أرصدة المستودع الرئيسي عند بدء العمل بالنظام', lines } as never);
    if (office) {
      const ol = [
        { itemId: it('ورق تصوير A4'), qty: 60, unitPrice: 18.5 },
        { itemId: it('حبر طابعة ليزر أسود'), qty: 5, unitPrice: 235 },
        { itemId: it('مناديل ورقية'), qty: 14, unitPrice: 52 },
      ].filter((l) => l.itemId);
      if (ol.length) await this.receipts.create(admin, { kind: 'opening', warehouseId: office.id, date: d(10), deliveryRef: 'جرد بدء التشغيل', lines: ol } as never);
    }
    // دفعة المياه انتهت صلاحيتها أثناء التخزين (تظهر في التنبيهات وتنتظر الإتلاف)
    const water = it('مياه شرب معبأة 330 مل');
    if (water) {
      await this.db.query(`UPDATE pr_stock_layers SET expiry_date = $3 WHERE organization_id = $1 AND item_id = $2`, [org, water, daysAgo(2)]);
      await this.db.query(`UPDATE pr_stock_moves SET expiry_date = $3 WHERE organization_id = $1 AND item_id = $2`, [org, water, daysAgo(2)]);
    }

    // ---- 2) استلام جزئي لتعميد السلال بمحضر فحص ----
    const [order] = await this.db.query(
      `SELECT id FROM pr_orders WHERE organization_id = $1 AND status IN ('accepted', 'acknowledged', 'issued') AND warehouse_id IS NOT NULL ORDER BY created_at LIMIT 1`, [org]);
    if (order) {
      const rec = await this.receipts.receivable(admin, order.id);
      const rl = rec.lines.map((l) => {
        const first = l.description.includes('سلة');
        const qty = first ? Math.min(l.remaining, 130) : Math.min(l.remaining, 120);
        return {
          orderLineId: l.orderLineId, qty, rejectedQty: first ? 10 : 0, rejectReason: first ? 'عبوات زيت مسربة في 10 سلال، أُعيدت مع السائق' : null,
          lot: l.trackBatch ? 'RMD-01' : null, expiryDate: l.trackExpiry ? daysAhead(180) : null,
        };
      });
      await this.receipts.create(admin, {
        kind: 'order', orderId: order.id, date: d(3), deliveryRef: 'DN-44871', analyticId: ccPrograms, extraCost: 600, extraNote: 'أجرة نقل من مستودع المورد',
        inspection: { committee: ['مدير المستودع', 'ممثل الإدارة المالية', 'منسق برنامج إفطار رمضان'], result: 'partial', note: 'طابقت السلال المواصفات عدا عشر سلال تسربت فيها عبوات الزيت، ويُستكمل الباقي في دفعة ثانية.' },
        notes: 'الدفعة الأولى من التوريد', lines: rl,
      } as never);
    }

    // ---- 3) تبرع عيني بالقيمة العادلة ----
    const blanket = it('بطانية شتوية مزدوجة');
    if (blanket) {
      await this.receipts.create(admin, {
        kind: 'donation', warehouseId: main.id, date: d(2), donorName: 'مؤسسة البر الخيرية', deliveryRef: 'خطاب تبرع 1447/233',
        inspection: { committee: ['مدير المستودع', 'ممثل الإدارة المالية'], result: 'accepted', note: 'بطانيات جديدة بتغليفها الأصلي' },
        lines: [{ itemId: blanket, qty: 100, unitPrice: 110 }],
      } as never);
    }

    // ---- 4) طلبات الصرف ----
    const basket = it('سلة غذائية متكاملة لأسرة');
    const [project] = await this.db.query(
      `SELECT a.id FROM activities a JOIN project_profiles p ON p.activity_id = a.id WHERE a.organization_id = $1 ORDER BY p.project_no LIMIT 1`, [org]).catch(() => []);
    const isr = (by: OrgUser, dto: Record<string, unknown>, submit = true) =>
      this.issues.create(by, { warehouseId: main.id, analyticId: ccPrograms, projectId: project?.id ?? null, ...dto } as never, submit);
    if (basket) {
      const r1 = await isr(pm, { purpose: 'توزيع السلال على أسر برنامج إفطار رمضان (الدفعة الأولى)', receiverName: 'فريق التوزيع الميداني', neededBy: daysAhead(2), lines: [{ itemId: basket, qty: 60 }] });
      await this.issues.decide(finance, r1.id, 'approve', 'وفق كشف الأسر المعتمد');
      await this.docs.issue(admin, { issueRequestId: r1.id, date: d(1), receiverName: 'فريق التوزيع الميداني', notes: 'سُلّمت بموجب كشف التوزيع', lines: [{ itemId: basket, qty: 60, refLineId: r1.lines[0].id }] } as never);
    }
    if (blanket) {
      const r2 = await isr(pm, { purpose: 'حملة الشتاء: بطانيات لأسر الحي', receiverName: 'منسق الحملة', neededBy: daysAhead(5), lines: [{ itemId: blanket, qty: 40 }] });
      await this.issues.decide(finance, r2.id, 'approve', null);
    }
    const rice = it('أرز بسمتي كيس 10 كجم');
    if (rice) {
      await isr(pm, { purpose: 'سلال إضافية لأسر الحالات الطارئة', neededBy: daysAhead(7), lines: [{ itemId: rice, qty: 25, note: 'من التشغيلة الأقرب انتهاءً' }] });
    }

    // ---- 5) تحويل إلى المستودع الميداني ----
    const target = field ?? office;
    const sugar = it('سكر أبيض ناعم 5 كجم');
    if (target && sugar) {
      await this.docs.transfer(admin, { warehouseId: main.id, toWarehouseId: target.id, date: d(1), notes: 'تجهيز مخزون نقطة التوزيع', lines: [{ itemId: sugar, qty: 30 }] } as never);
    }

    // ---- 6) محضر إتلاف بانتظار اعتماد المالية ----
    if (water) {
      await this.docs.writeoff(admin, {
        warehouseId: main.id, date: d(0), reason: 'expired', notes: 'انتهت صلاحية دفعة المياه. أُتلفت بحضور لجنة من المستودع والمالية، ويُرفق محضر الإتلاف الموقع.',
        lines: [{ itemId: water, qty: 12 }],
      } as never);
    }

    // ---- 7) جرد مستودع المقر بعجز بانتظار الاعتماد ----
    if (office) {
      const c = await this.counts.create(admin, { kind: 'periodic', warehouseId: office.id, date: d(0), committeeIds: [admin.id, finance.id], notes: 'الجرد الدوري لمستودع المقر' } as never);
      const paper = it('ورق تصوير A4');
      await this.counts.saveLines(admin, c.id, {
        lines: c.lines.map((l: { index: number; itemId: string; systemQty: number }) => ({
          index: l.index, countedQty: l.itemId === paper ? l.systemQty - 3 : l.systemQty, note: l.itemId === paper ? 'نقص 3 رزم دون سند صرف' : null,
        })),
      } as never);
      await this.counts.submit(admin, c.id);
    }
  }
}
