import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86_400_000;

export const REPORTS = ['by-target', 'pledges', 'banks', 'zakat', 'managers', 'levels', 'donors', 'batches'] as const;
export type ReportName = (typeof REPORTS)[number];

/** لوحة المعلومات والتقارير. الفترة حسب تاريخ الفرصة، والمبالغ للفرص المعتمدة نهائيًا */
@Injectable()
export class FundraisingReportsService {
  constructor(private readonly db: DataSource) {}

  private range(from?: string, to?: string) {
    const now = new Date();
    const f = from && /^\d{4}-\d{2}-\d{2}/.test(from) ? from.slice(0, 10) : `${now.getFullYear()}-01-01`;
    const t = to && /^\d{4}-\d{2}-\d{2}/.test(to) ? to.slice(0, 10) : iso(now);
    if (f > t) throw new BadRequestException('بداية الفترة يجب أن تكون قبل نهايتها');
    return { from: f, to: t };
  }

  /** الفترة السابقة بنفس الطول، أو نفس الفترة من العام الماضي */
  private compareRange(from: string, to: string, mode: string) {
    if (mode === 'last_year') {
      const shift = (s: string) => `${Number(s.slice(0, 4)) - 1}${s.slice(4)}`;
      return { from: shift(from), to: shift(to) };
    }
    const len = (Date.parse(to) - Date.parse(from)) / DAY + 1;
    const end = new Date(Date.parse(from) - DAY);
    return { from: iso(new Date(end.getTime() - (len - 1) * DAY)), to: iso(end) };
  }

  private async kpis(org: string, from: string, to: string) {
    const [k] = await this.db.query(
      `SELECT COALESCE(SUM(total_amount), 0)::float AS total, COUNT(*)::int AS count,
              COALESCE(AVG(total_amount), 0)::float AS average, COUNT(DISTINCT donor_id)::int AS donors,
              COALESCE(SUM(total_amount) FILTER (WHERE is_zakat), 0)::float AS zakat,
              COALESCE(SUM(total_amount) FILTER (WHERE kind = 'cash'), 0)::float AS cash,
              COALESCE(SUM(total_amount) FILTER (WHERE kind = 'in_kind'), 0)::float AS "inKind",
              COALESCE(SUM(total_amount) FILTER (WHERE kind = 'pledge'), 0)::float AS pledge
         FROM fundraising_opportunities
        WHERE organization_id = $1 AND status = 'approved' AND opportunity_date BETWEEN $2 AND $3`,
      [org, from, to],
    );
    const [n] = await this.db.query(
      'SELECT COUNT(*)::int AS "newDonors" FROM fundraising_donors WHERE organization_id = $1 AND created_at::date BETWEEN $2 AND $3',
      [org, from, to],
    );
    return { ...k, ...n };
  }

  async dashboard(user: OrgUser, q: { from?: string; to?: string; compare?: string }) {
    const org = user.organizationId;
    const { from, to } = this.range(q.from, q.to);
    const prev = this.compareRange(from, to, q.compare ?? 'previous');
    const days = (Date.parse(to) - Date.parse(from)) / DAY + 1;
    const bucket = days <= 62 ? 'day' : 'month';
    const fmt = bucket === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';
    const P = [org, from, to];
    const approved = `o.organization_id = $1 AND o.status = 'approved' AND o.opportunity_date BETWEEN $2 AND $3`;
    const [current, previous, series, byTarget, byKind, byLevel, topDonors, byManager, recent, [batches], [pipeline]] = await Promise.all([
      this.kpis(org, from, to),
      this.kpis(org, prev.from, prev.to),
      this.db.query(
        `SELECT to_char(o.opportunity_date, '${fmt}') AS period, SUM(o.total_amount)::float AS amount, COUNT(*)::int AS count,
                COALESCE(SUM(o.total_amount) FILTER (WHERE o.is_zakat), 0)::float AS zakat
           FROM fundraising_opportunities o WHERE ${approved} GROUP BY 1 ORDER BY 1`, P,
      ),
      this.db.query(
        `SELECT CASE WHEN b.is_zakat THEN 'zakat' ELSE b.target_kind END AS key, SUM(b.amount)::float AS amount, COUNT(*)::int AS count
           FROM fundraising_batches b JOIN fundraising_opportunities o ON o.id = b.opportunity_id
          WHERE ${approved} AND b.parent_batch_id IS NULL GROUP BY 1 ORDER BY 2 DESC`, P,
      ),
      this.db.query(`SELECT o.kind AS key, SUM(o.total_amount)::float AS amount, COUNT(*)::int AS count FROM fundraising_opportunities o WHERE ${approved} GROUP BY 1`, P),
      this.db.query(
        `SELECT COALESCE(l.name, 'بدون مستوى') AS name, l.color, SUM(o.total_amount)::float AS amount, COUNT(DISTINCT o.donor_id)::int AS donors
           FROM fundraising_opportunities o JOIN fundraising_donors d ON d.id = o.donor_id LEFT JOIN fundraising_donor_levels l ON l.id = d.level_id
          WHERE ${approved} GROUP BY l.name, l.color, l.sort_order ORDER BY l.sort_order NULLS LAST`, P,
      ),
      this.db.query(
        `SELECT d.id, d.name, d.donor_no AS "donorNo", SUM(o.total_amount)::float AS amount, COUNT(*)::int AS count
           FROM fundraising_opportunities o JOIN fundraising_donors d ON d.id = o.donor_id
          WHERE ${approved} GROUP BY d.id ORDER BY amount DESC LIMIT 7`, P,
      ),
      this.db.query(
        `SELECT COALESCE(m.name, 'بدون مدير دعم') AS name, SUM(o.total_amount)::float AS amount, COUNT(*)::int AS count
           FROM fundraising_opportunities o LEFT JOIN fundraising_support_managers m ON m.id = o.support_manager_id
          WHERE ${approved} GROUP BY m.name ORDER BY amount DESC LIMIT 8`, P,
      ),
      this.db.query(
        `SELECT o.id, o.opportunity_no AS "opportunityNo", o.kind, o.status, o.opportunity_date AS date, o.total_amount::float AS "totalAmount",
                o.is_zakat AS "isZakat", d.name AS "donorName"
           FROM fundraising_opportunities o JOIN fundraising_donors d ON d.id = o.donor_id
          WHERE o.organization_id = $1 ORDER BY o.created_at DESC LIMIT 6`, [org],
      ),
      this.db.query(
        `SELECT COALESCE(SUM(amount), 0)::float AS amount, COALESCE(SUM(reserved_amount), 0)::float AS reserved,
                COALESCE(SUM(spent_amount), 0)::float AS spent, COALESCE(SUM(transferred_amount), 0)::float AS transferred,
                COUNT(*) FILTER (WHERE status = 'active')::int AS active
           FROM fundraising_batches WHERE organization_id = $1 AND status IN ('active', 'closed')`, [org],
      ),
      this.db.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'in_progress')::int AS "inProgress",
                COUNT(*) FILTER (WHERE status = 'returned')::int AS returned,
                COALESCE(SUM(total_amount) FILTER (WHERE status IN ('in_progress', 'returned')), 0)::float AS "pendingAmount",
                COALESCE(SUM(total_amount - collected_amount) FILTER (WHERE status = 'approved' AND kind = 'pledge'), 0)::float AS "pledgeOutstanding"
           FROM fundraising_opportunities WHERE organization_id = $1`, [org],
      ),
    ]);
    return { range: { from, to }, compareRange: prev, bucket, current, previous, series, byTarget, byKind, byLevel, topDonors, byManager, recent, batches, pipeline };
  }

  /** التقارير التفصيلية: كل تقرير يرجع صفوفًا تعرضها الواجهة وتطبعها وتصدّرها */
  async report(user: OrgUser, name: string, q: { from?: string; to?: string }) {
    const org = user.organizationId;
    const { from, to } = this.range(q.from, q.to);
    const P = [org, from, to];
    const approved = `o.organization_id = $1 AND o.status = 'approved' AND o.opportunity_date BETWEEN $2 AND $3`;
    let rows: unknown[];
    switch (name as ReportName) {
      case 'by-target':
        rows = await this.db.query(
          `SELECT b.target_kind AS "targetKind", b.target_name AS "targetName", bool_or(b.is_zakat) AS "isZakat", COUNT(*)::int AS batches,
                  SUM(b.amount)::float AS amount, SUM(b.reserved_amount)::float AS reserved, SUM(b.spent_amount)::float AS spent,
                  SUM(b.transferred_amount)::float AS transferred,
                  SUM(b.amount - b.reserved_amount - b.spent_amount - b.transferred_amount)::float AS net
             FROM fundraising_batches b JOIN fundraising_opportunities o ON o.id = b.opportunity_id
            WHERE ${approved} GROUP BY b.target_kind, b.target_name ORDER BY amount DESC`, P,
        );
        break;
      case 'pledges':
        rows = await this.db.query(
          `SELECT o.id, o.opportunity_no AS "opportunityNo", d.name AS "donorName", o.opportunity_date AS date, o.total_amount::float AS amount,
                  o.collected_amount::float AS collected, (o.total_amount - o.collected_amount)::float AS outstanding,
                  o.conditions->>'endDate' AS "endDate"
             FROM fundraising_opportunities o JOIN fundraising_donors d ON d.id = o.donor_id
            WHERE ${approved} AND o.kind = 'pledge' ORDER BY outstanding DESC`, P,
        );
        break;
      case 'banks':
        rows = await this.db.query(
          `SELECT a.bank_name AS "bankName", a.account_number AS "accountNumber",
                  COALESCE(SUM(x.amount) FILTER (WHERE x.src = 'cash'), 0)::float AS donations,
                  COALESCE(SUM(x.amount) FILTER (WHERE x.src = 'pledge'), 0)::float AS "pledgeCollections",
                  COALESCE(SUM(x.amount), 0)::float AS total, COUNT(x.amount)::int AS count
             FROM fundraising_bank_accounts a
             LEFT JOIN (
               SELECT o.bank_account_id AS bank, o.total_amount AS amount, 'cash' AS src FROM fundraising_opportunities o
                WHERE ${approved} AND o.kind = 'cash'
               UNION ALL
               SELECT c.bank_account_id, c.amount, 'pledge' FROM fundraising_pledge_collections c
                WHERE c.organization_id = $1 AND c.collected_on BETWEEN $2 AND $3
             ) x ON x.bank = a.id
            WHERE a.organization_id = $1 GROUP BY a.id ORDER BY total DESC`, P,
        );
        break;
      case 'zakat':
        rows = await this.db.query(
          `SELECT o.id, o.opportunity_no AS "opportunityNo", d.name AS "donorName", o.opportunity_date AS date, b.batch_no AS "batchNo",
                  b.target_name AS "targetName", b.amount::float AS amount, b.spent_amount::float AS spent,
                  (b.amount - b.reserved_amount - b.spent_amount - b.transferred_amount)::float AS net
             FROM fundraising_batches b JOIN fundraising_opportunities o ON o.id = b.opportunity_id JOIN fundraising_donors d ON d.id = o.donor_id
            WHERE ${approved} AND b.is_zakat ORDER BY o.opportunity_no DESC, b.batch_no`, P,
        );
        break;
      case 'managers':
        rows = await this.db.query(
          `SELECT COALESCE(m.name, 'بدون مدير دعم') AS name, m.kind, COUNT(DISTINCT o.donor_id)::int AS donors, COUNT(o.id)::int AS count,
                  COALESCE(SUM(o.total_amount), 0)::float AS amount, COALESCE(AVG(o.total_amount), 0)::float AS average
             FROM fundraising_opportunities o LEFT JOIN fundraising_support_managers m ON m.id = o.support_manager_id
            WHERE ${approved} GROUP BY m.name, m.kind ORDER BY amount DESC`, P,
        );
        break;
      case 'levels':
        rows = await this.db.query(
          `SELECT COALESCE(l.name, 'بدون مستوى') AS name, COUNT(DISTINCT o.donor_id)::int AS donors, COUNT(o.id)::int AS count,
                  COALESCE(SUM(o.total_amount), 0)::float AS amount
             FROM fundraising_opportunities o JOIN fundraising_donors d ON d.id = o.donor_id LEFT JOIN fundraising_donor_levels l ON l.id = d.level_id
            WHERE ${approved} GROUP BY l.name, l.sort_order ORDER BY l.sort_order NULLS LAST`, P,
        );
        break;
      case 'donors':
        rows = await this.db.query(
          `SELECT d.id, d.donor_no AS "donorNo", d.name, l.name AS "levelName", COUNT(o.id)::int AS count,
                  COALESCE(SUM(o.total_amount), 0)::float AS amount, COALESCE(SUM(o.total_amount) FILTER (WHERE o.is_zakat), 0)::float AS zakat,
                  MAX(o.opportunity_date) AS "lastDonation"
             FROM fundraising_opportunities o JOIN fundraising_donors d ON d.id = o.donor_id LEFT JOIN fundraising_donor_levels l ON l.id = d.level_id
            WHERE ${approved} GROUP BY d.id, l.name ORDER BY amount DESC`, P,
        );
        break;
      case 'batches':
        rows = await this.db.query(
          `SELECT b.id, b.batch_no AS "batchNo", o.opportunity_no AS "opportunityNo", d.name AS "donorName", b.target_kind AS "targetKind",
                  b.target_name AS "targetName", b.is_zakat AS "isZakat", b.status, b.amount::float AS amount, b.reserved_amount::float AS reserved,
                  b.spent_amount::float AS spent, b.transferred_amount::float AS transferred,
                  (b.amount - b.reserved_amount - b.spent_amount - b.transferred_amount)::float AS net
             FROM fundraising_batches b JOIN fundraising_opportunities o ON o.id = b.opportunity_id JOIN fundraising_donors d ON d.id = o.donor_id
            WHERE ${approved} ORDER BY b.batch_no DESC`, P,
        );
        break;
      default:
        throw new BadRequestException('التقرير غير موجود');
    }
    return { range: { from, to }, rows };
  }
}
