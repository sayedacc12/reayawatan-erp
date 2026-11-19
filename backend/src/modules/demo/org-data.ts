import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/**
 * أدوات عامة على بيانات جمعية واحدة عبر كل جداول الأنظمة (كل جدول يحمل organization_id).
 * تُستخدم لأخذ «لقطة» من سجلات الجمعية قبل إضافة البيانات التجريبية، ثم حذف ما سواها عند التحويل لجمعية فعلية.
 */

/** جداول لا تُمس أبدًا: اشتراك الجمعية وعقودها ووحداتها وتذاكر الدعم الفني مع المنصة */
export const PROTECTED_TABLES = new Set(['organization_sample_data', 'organization_modules', 'subscription_applications', 'subscription_contracts', 'support_tickets']);

/** جداول يُحذف منها التجريبي فقط ويبقى ما أنشأته الجمعية بنفسها (حسابات الموظفين وأدوارهم) */
export const PEOPLE_TABLES = new Set(['users', 'roles']);

export interface OrgTable {
  name: string;
  /** عمود المفتاح الأساسي (id غالبًا، أو organization_id لجداول الإعدادات ذات الصف الواحد) */
  pk: string;
  /** جدول إعدادات بصف واحد لكل جمعية: يُحفظ محتواه كاملًا ويُعاد كما كان */
  settings: boolean;
}

export interface Snapshot {
  /** معرفات السجلات لكل جدول */
  ids: Record<string, string[]>;
  /** صفوف جداول الإعدادات كما هي */
  settings: Record<string, Record<string, unknown>>;
}

const q = (name: string) => `"${name.replace(/"/g, '')}"`;

export async function orgTables(em: EntityManager): Promise<OrgTable[]> {
  const rows: { table_name: string; pk: string | null }[] = await em.query(`
    SELECT c.table_name,
      (SELECT string_agg(a.attname, ',') FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = format('public.%I', c.table_name)::regclass AND i.indisprimary) AS pk
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'
     ORDER BY c.table_name`);
  return rows
    .filter((r) => !PROTECTED_TABLES.has(r.table_name) && r.pk && !r.pk.includes(','))
    .map((r) => ({ name: r.table_name, pk: r.pk!, settings: r.pk === 'organization_id' }));
}

export async function snapshot(em: EntityManager, orgId: string, tables?: OrgTable[]): Promise<Snapshot> {
  const out: Snapshot = { ids: {}, settings: {} };
  for (const t of tables ?? await orgTables(em)) {
    if (t.settings) {
      const [row] = await em.query(`SELECT to_jsonb(x) AS row FROM ${q(t.name)} x WHERE organization_id = $1`, [orgId]);
      if (row) out.settings[t.name] = row.row;
    } else {
      const rows: { id: string }[] = await em.query(`SELECT ${q(t.pk)}::text AS id FROM ${q(t.name)} WHERE organization_id = $1`, [orgId]);
      if (rows.length) out.ids[t.name] = rows.map((r) => r.id);
    }
  }
  return out;
}

/** السجلات الموجودة في after وليست في before */
export function diff(after: Snapshot, before: Snapshot): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [t, ids] of Object.entries(after.ids)) {
    const old = new Set(before.ids[t] ?? []);
    const added = ids.filter((id) => !old.has(id));
    if (added.length) out[t] = added;
  }
  return out;
}

export const countOf = (m: Record<string, string[]>) => Object.values(m).reduce((s, ids) => s + ids.length, 0);

/**
 * حذف كل سجلات الجمعية عدا keep، وإعادة جداول الإعدادات لما كانت عليه في settings.
 * بعض العلاقات تمنع حذف سجل قبل السجلات المعتمدة عليه، فيُحذف كل جدول بعد الجداول المعتمدة عليه بالمحاولة المتكررة.
 * تُنفَّذ داخل معاملة واحدة: إن تعذر أي جزء لا يُحذف شيء.
 */
export async function purgeExcept(
  em: EntityManager, orgId: string, keep: Record<string, string[]>, settings: Snapshot['settings'], tables?: OrgTable[],
): Promise<Record<string, number>> {
  const all = tables ?? await orgTables(em);
  const deleted: Record<string, number> = {};
  let pending = all;
  while (pending.length) {
    const failed: OrgTable[] = [];
    for (const t of pending) {
      await em.query('SAVEPOINT org_purge');
      try {
        const res = t.settings
          ? await em.query(`DELETE FROM ${q(t.name)} WHERE organization_id = $1`, [orgId])
          : await em.query(`DELETE FROM ${q(t.name)} WHERE organization_id = $1 AND NOT (${q(t.pk)}::text = ANY($2::text[]))`, [orgId, keep[t.name] ?? []]);
        const n = Array.isArray(res) ? Number(res[1] ?? 0) : 0;
        if (n && !t.settings) deleted[t.name] = n;
        await em.query('RELEASE SAVEPOINT org_purge');
      } catch {
        await em.query('ROLLBACK TO SAVEPOINT org_purge');
        failed.push(t);
      }
    }
    if (failed.length === pending.length) {
      throw new ConflictException(`تعذر حذف البيانات من: ${failed.map((t) => t.name).join('، ')}. لم يُحذف شيء.`);
    }
    pending = failed;
  }
  // إعادة الإعدادات كما كانت قبل البيانات التجريبية
  for (const [table, row] of Object.entries(settings)) {
    await em.query(`INSERT INTO ${q(table)} SELECT * FROM jsonb_populate_record(NULL::${q(table)}, $1::jsonb)`, [JSON.stringify(row)]);
  }
  return deleted;
}

/** اسم النظام الذي يتبعه الجدول، لعرض ملخص مفهوم قبل الحذف */
const SYSTEMS: [RegExp, string][] = [
  [/^(users|roles)$/, 'المستخدمون والأدوار'],
  [/^(activities|beneficiar|dynamic_forms|workflow)/, 'المساعدات الاجتماعية'],
  [/^fundraising_|^opportunity_/, 'تنمية الموارد المالية'],
  [/^project_/, 'إدارة المشاريع'],
  [/^acc_asset/, 'الأصول الثابتة'],
  [/^(acc_|ledger_)/, 'النظام المالي'],
  [/^hr_/, 'الموارد البشرية'],
  [/^risk_/, 'المخاطر والالتزام'],
  [/^vol_/, 'التطوع'],
  [/^quality_/, 'الجودة'],
  [/^audit_/, 'المراجعة الداخلية'],
  [/^mem_/, 'العضوية'],
  [/^gov_/, 'الحوكمة'],
  [/^kn_/, 'أرشيف المعرفة'],
  [/^(web_|org_identity)/, 'الموقع الإلكتروني'],
  [/^pt_/, 'الشراكات'],
  [/^comms_/, 'الاتصالات الإدارية'],
  [/^mtg_/, 'الاجتماعات واللجان'],
];
export const systemOf = (table: string) => SYSTEMS.find(([re]) => re.test(table))?.[1] ?? 'أخرى';

export function bySystem(m: Record<string, string[] | number>) {
  const out: Record<string, number> = {};
  for (const [t, v] of Object.entries(m)) {
    const n = typeof v === 'number' ? v : v.length;
    if (n) out[systemOf(t)] = (out[systemOf(t)] ?? 0) + n;
  }
  return Object.entries(out).map(([system, count]) => ({ system, count })).sort((a, b) => b.count - a.count);
}
