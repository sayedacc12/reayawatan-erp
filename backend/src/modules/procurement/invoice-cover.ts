import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/**
 * لا يقل المستلم المقبول من بند التعميد عن صافي المفوتر منه: فلا يُلغى استلام ولا يُرجع للمورد ما فُوتر،
 * حتى يصدر المورد إشعارًا دائنًا بالكمية أولًا (وإلا بقي في حساب البضاعة المستلمة غير المفوترة رصيد بلا مقابل).
 * reduce: الكمية التي ستنقص من المستلم لكل بند تعميد.
 */
export async function assertInvoiceCover(em: EntityManager, org: string, orderId: string, reduce: Map<string, number>, descriptions: Map<string, string>) {
  if (![...reduce.values()].some((q) => q > 0)) return;
  const rows: { line_id: string; received: string; invoiced: string }[] = await em.query(
    `WITH rec AS (
       SELECT x.line_id, SUM(x.qty) AS qty FROM (
         SELECT l->>'orderLineId' AS line_id, (l->>'acceptedQty')::numeric AS qty
           FROM pr_receipts r, jsonb_array_elements(r.lines) l WHERE r.organization_id = $1 AND r.order_id = $2 AND r.status = 'posted'
         UNION ALL
         SELECT rl->>'orderLineId', -(dl->>'qty')::numeric
           FROM pr_stock_docs d JOIN pr_receipts r ON r.id = d.ref_id, jsonb_array_elements(d.lines) dl, jsonb_array_elements(r.lines) rl
          WHERE d.organization_id = $1 AND r.order_id = $2 AND d.kind = 'return_supplier' AND d.status = 'posted' AND rl->>'id' = dl->>'refLineId'
       ) x GROUP BY 1),
     inv AS (
       SELECT l->>'orderLineId' AS line_id, SUM(CASE WHEN i.kind = 'credit_note' THEN -1 ELSE 1 END * (l->>'qty')::numeric) AS qty
         FROM pr_invoices i, jsonb_array_elements(i.lines) l
        WHERE i.organization_id = $1 AND i.order_id = $2 AND i.status IN ('submitted', 'approved', 'posted', 'partial', 'paid') GROUP BY 1)
     SELECT inv.line_id, COALESCE(rec.qty, 0) AS received, inv.qty AS invoiced FROM inv LEFT JOIN rec ON rec.line_id = inv.line_id`, [org, orderId]);
  for (const r of rows) {
    const cut = reduce.get(r.line_id) ?? 0;
    if (cut > 0 && Number(r.received) - cut < Number(r.invoiced) - 0.0005) {
      throw new ConflictException(`فُوتر من «${descriptions.get(r.line_id) ?? 'البند'}» ${Number(r.invoiced)}، فلا ينقص المستلم عنه. يصدر المورد إشعارًا دائنًا بالكمية أولًا`);
    }
  }
}
