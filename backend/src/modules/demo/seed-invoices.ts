import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Permission, Role } from '../../core/entities';
import { ACC_PERMISSIONS as ACC } from '../accounting/accounting.manifest';
import { InvoicesService } from '../procurement/invoices.service';
import { SupplierPortalUser } from '../procurement/supplier-portal.guard';
import { DemoTeam, daysAgo } from './demo-context';

/**
 * فواتير الموردين في الجمعية التجريبية (المرحلة الرابعة من المشتريات)، بعد الاستلام الجزئي لتعميد السلال:
 * - المورد يرفع فاتورته من البوابة على الكميات المقبولة، فتُطابق آليًا وتعتمد المشتريات مطابقتها.
 * - المالية تسجل قيد المستحق، ثم تنشئ سند صرف جزئي بانتظار الاعتماد.
 * - فاتورة ورقية ثانية سجلها موظف بسعر أعلى من التعميد، فتظهر استثناء مطابقة بانتظار القرار.
 */
@Injectable()
export class InvoicesSeed {
  constructor(private readonly db: DataSource, private readonly invoices: InvoicesService) {}

  private async grant(roleId: string, actor: OrgUser, list: string[]) {
    const role = await this.db.getRepository(Role).findOneOrFail({ where: { id: roleId }, relations: { permissions: true } });
    role.permissions = [...role.permissions, ...(await this.db.getRepository(Permission).find({ where: { code: In(list) } }))];
    await this.db.getRepository(Role).save(role);
    return { ...actor, permissions: [...new Set([...actor.permissions, ...list])] } as OrgUser;
  }

  async run(team: DemoTeam) {
    const admin = team.admin;
    const org = admin.organizationId;
    // المالية تسجل المستحقات وتسددها (ولا تعتمد المطابقة: فصل المهام)
    const finance = await this.grant(team.roles.finance, team.finance, [ACC.payables, ACC.payments]);
    await this.invoices.saveSettings(admin, { matchTolerancePct: 2, vatInputAccountId: null, paymentDays: 30 });

    const [order] = await this.db.query(
      `SELECT o.id, o.supplier_id AS "supplierId" FROM pr_orders o WHERE o.organization_id = $1 AND o.status = 'partial' ORDER BY o.created_at LIMIT 1`, [org]);
    if (!order) return;
    const [u] = await this.db.query(`SELECT id, full_name AS "fullName", email FROM pr_supplier_users WHERE supplier_id = $1 AND role IN ('owner', 'finance') ORDER BY role LIMIT 1`, [order.supplierId]);
    if (!u) return;
    const portal: SupplierPortalUser = {
      userId: u.id, supplierId: order.supplierId, organizationId: org, fullName: u.fullName, email: u.email, role: 'owner', supplierStatus: 'approved', mustChangePassword: false,
    };
    const b = await this.invoices.billableForStaff(admin, order.id);
    const monthStart = `${daysAgo(0).slice(0, 8)}01`;
    const d = (n: number) => (daysAgo(n) < monthStart ? monthStart : daysAgo(n));
    // نُبقي جزءًا من البند الأول للفاتورة الورقية الثانية
    const held = 20;
    const lines = b.lines.filter((l) => l.left > 0).map((l, i) => ({ orderLineId: l.orderLineId, qty: i === 0 ? Math.max(0, l.left - held) : l.left, unitPrice: l.unitPrice })).filter((l) => l.qty > 0);
    if (!lines.length) return;

    // ---- 1) فاتورة من البوابة: مطابقة، تُعتمد وتُسجل وتُسدد جزئيًا ----
    const inv = await this.invoices.portalSave(portal, {
      kind: 'invoice', orderId: order.id, supplierInvoiceNo: 'WF-2026-0418', invoiceDate: d(2), dueDate: null, vatRate: b.order.vatRate,
      extraAmount: 0, notes: 'فاتورة الدفعة الأولى من السلال حسب محضر الاستلام', lines,
    } as never, null);
    await this.invoices.portalAddFile(portal, inv.id, demoPdf('WF-2026-0418.pdf'));
    await this.invoices.portalMessage(portal, inv.id, 'نرفق الفاتورة الضريبية للدفعة الأولى، ونأمل السداد خلال مدة الاتفاق.');
    await this.invoices.portalSubmit(portal, inv.id);
    await this.invoices.approve(admin, inv.id, { note: 'مطابقة للتعميد والاستلام المعتمد' });
    await this.invoices.post(finance, inv.id, { date: d(1) });
    const [cash] = await this.db.query(`SELECT id FROM acc_cash_accounts WHERE organization_id = $1 AND is_active AND kind = 'bank' ORDER BY name LIMIT 1`, [org]);
    if (cash) {
      const full = await this.invoices.get(finance, inv.id);
      await this.invoices.pay(finance, inv.id, { date: d(0), method: 'bank', cashAccountId: cash.id, amount: Math.round(full.total * 50) / 100, note: 'الدفعة الأولى (50%)' });
    }

    // ---- 2) فاتورة ورقية بسعر أعلى من التعميد: استثناء مطابقة بانتظار القرار ----
    const first = b.lines.find((l) => l.left > 0);
    if (first) {
      const paper = await this.invoices.create(admin, {
        kind: 'invoice', orderId: order.id, supplierInvoiceNo: 'WF-2026-0431', invoiceDate: d(0), dueDate: null, vatRate: b.order.vatRate, extraAmount: 0,
        notes: 'وصلت ورقيًا مع المندوب', lines: [{ orderLineId: first.orderLineId, qty: held, unitPrice: Math.round(first.unitPrice * 1.08 * 100) / 100 }],
      } as never);
      await this.invoices.addFile(admin, paper.id, demoPdf('WF-2026-0431.pdf'));
      await this.invoices.submit(admin, paper.id);
    }
  }
}

/** صورة فاتورة PDF صغيرة لتجربة المرفقات */
function demoPdf(name: string) {
  const buffer = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  return { buffer, size: buffer.length, originalname: name, mimetype: 'application/pdf' } as Express.Multer.File;
}
