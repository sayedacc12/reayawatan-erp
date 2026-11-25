import { EntityManager } from 'typeorm';

/**
 * مزامنة بيانات الشخص (الاسم، والجوال والبريد في الاجتماعات) مع كل السجلات الجارية في الأنظمة الأخرى
 * عند تعديلها في ملف الموظف أو حساب الدخول.
 *
 * ما يُحدَّث: خانات «المسؤول/المكلف/الحائز/المعتمد المحدد» في السجلات القائمة، المربوطة برقم المستخدم،
 * أو (بيد مدير النظام) المكتوبة نصاً بالاسم القديم نفسه ما لم يشترك فيه شخص آخر في الشركة.
 * ما لا يُحدَّث عمداً: سجل التدقيق (من أنشأ/اعتمد/نفّذ، والأحداث)، والمستندات المالية المرحّلة،
 * ومسيرات الرواتب، وحضور الاجتماعات بعد انعقادها؛ فهي توثيق لما جرى باسم صاحبه وقتها.
 *
 * أسماء الجداول والأعمدة ثوابت داخلية هنا، وكل القيم معاملات $n، وكل استعلام مقيّد بالمنشأة.
 */

/** سجلات مربوطة برقم المستخدم: [الجدول، عمود المستخدم، عمود الاسم، شرط إضافي ثابت] */
const LINKED: readonly [string, string, string, string][] = [
  ['plan_items', 'owner_user_id', 'owner_name', ''],
  ['risk_tasks', 'assignee_user_id', 'assignee_name', ''],
  ['mtg_recommendations', 'owner_user_id', 'owner_name', ''],
  ['audit_engagements', 'lead_user_id', 'lead_name', ''],
  ['audit_actions', 'assignee_user_id', 'assignee_name', ''],
  ['comms_transactions', 'holder_user_id', 'holder_name', ''],
  ['comms_tasks', 'owner_user_id', 'owner_name', ''],
  // المعتمِد المحدد للاجتماع قبل الاعتماد فقط؛ بعده هو توقيع على ما جرى
  ['mtg_meetings', 'approver_user_id', 'approver_name', `AND status IN ('draft', 'pending_approval')`],
];

/** سجلات يُكتب فيها المسؤول نصاً دون ربط: تُحدَّث بمطابقة الاسم القديم تماماً */
const BY_NAME: readonly [string, string][] = [
  ['quality_documents', 'owner_name'],
  ['quality_risks', 'owner_name'],
  ['quality_objectives', 'owner_name'],
  ['plan_plans', 'owner_name'],
  ['plan_kpis', 'owner_name'],
  ['gov_actions', 'owner_name'],
  ['risk_register', 'owner_name'],
  ['risk_controls', 'owner_name'],
  ['risk_obligations', 'owner_name'],
  ['risk_continuity', 'owner_name'],
  ['risk_procedures', 'owner_name'],
  ['kn_documents', 'owner_name'],
];

/** الاجتماعات التي لم تُعقد بعد: حضورها قائمة دعوة جارية (بعد الانعقاد والتوقيع لا يُمس) */
const OPEN_MEETING = `sign_status = 'none' AND meeting_id IN (SELECT m.id FROM mtg_meetings m WHERE m.organization_id = $1 AND m.status IN ('draft', 'pending_approval', 'scheduled'))`;

async function exists(em: EntityManager, table: string) {
  const [r] = await em.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${table}`]);
  return !!r?.ok;
}

export interface PersonChange {
  org: string;
  userId: string;
  newName: string;
  /** الأسماء السابقة (من ملف الموظف ومن الحساب)، للسجلات المكتوبة نصاً */
  oldNames: string[];
  /**
   * مطابقة السجلات المكتوبة نصاً بالاسم القديم: لمدير النظام فقط، لأنها تغيّر سجلات أنظمة لا يملك غيره
   * صلاحيتها كلها، ولأن تغيير الاسم مرتين قد يجعل اسم شخص آخر «اسماً قديماً».
   */
  byName: boolean;
  /** الجوال والبريد من ملف الموظف (لا يُمس بريد الدخول) */
  mobile?: string | null;
  email?: string | null;
}

/** يطبّق التعديل على السجلات المرتبطة في المعاملة نفسها، ويعيد عدد الصفوف التي تغيّرت */
export async function propagatePerson(em: EntityManager, c: PersonChange): Promise<number> {
  let n = 0;
  const run = async (sql: string, params: unknown[]) => {
    const r = await em.query(sql, params);
    n += Array.isArray(r) && typeof r[1] === 'number' ? r[1] : 0;
  };
  const olds = !c.byName ? [] : [...new Set(c.oldNames.map((s) => s?.trim()).filter((s): s is string => !!s && s !== c.newName))];
  // الاسم القديم يُعتمد للمطابقة النصية فقط إن لم يحمله شخص آخر في الشركة
  const safeOlds: string[] = [];
  for (const old of olds) {
    const [{ k }] = await em.query(
      `SELECT (SELECT COUNT(*) FROM users WHERE organization_id = $1 AND id <> $2 AND full_name = $3)
            + (SELECT COUNT(*) FROM hr_employees WHERE organization_id = $1 AND user_id IS DISTINCT FROM $2 AND full_name = $3) AS k`,
      [c.org, c.userId, old],
    );
    if (Number(k) === 0) safeOlds.push(old);
  }

  for (const [table, idCol, nameCol, extra] of LINKED) {
    if (!(await exists(em, table))) continue;
    await run(
      `UPDATE ${table} SET ${nameCol} = $3
        WHERE organization_id = $1 ${extra}
          AND (${idCol} = $2 OR (${idCol} IS NULL AND ${nameCol} = ANY($4::text[])))
          AND ${nameCol} IS DISTINCT FROM $3`,
      [c.org, c.userId, c.newName, safeOlds],
    );
  }
  if (safeOlds.length) {
    for (const [table, nameCol] of BY_NAME) {
      if (!(await exists(em, table))) continue;
      await run(`UPDATE ${table} SET ${nameCol} = $2 WHERE organization_id = $1 AND ${nameCol} = ANY($3::text[])`, [c.org, c.newName, safeOlds]);
    }
  }

  if (await exists(em, 'mtg_attendees')) {
    await run(
      `UPDATE mtg_attendees SET name = $3,
              mobile = CASE WHEN $4::boolean THEN $5 ELSE mobile END,
              email = CASE WHEN $6::boolean THEN $7 ELSE email END
        WHERE organization_id = $1 AND user_id = $2 AND ${OPEN_MEETING}
          AND (name IS DISTINCT FROM $3 OR ($4::boolean AND mobile IS DISTINCT FROM $5) OR ($6::boolean AND email IS DISTINCT FROM $7))`,
      [c.org, c.userId, c.newName, c.mobile !== undefined, c.mobile ?? null, c.email !== undefined, c.email ?? null],
    );
  }
  if (await exists(em, 'mtg_bodies')) {
    // أعضاء المجالس واللجان (قائمة JSON): يُحدَّث العضو المربوط بالمستخدم
    await run(
      `UPDATE mtg_bodies b SET members = (
          SELECT jsonb_agg(CASE WHEN x->>'userId' = $2::text
                   THEN x || jsonb_build_object('name', $3::text)
                          || CASE WHEN $4::boolean THEN jsonb_build_object('mobile', $5::text) ELSE '{}'::jsonb END
                          || CASE WHEN $6::boolean THEN jsonb_build_object('email', $7::text) ELSE '{}'::jsonb END
                   ELSE x END ORDER BY o)
            FROM jsonb_array_elements(b.members) WITH ORDINALITY AS t(x, o))
        WHERE b.organization_id = $1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(b.members) x WHERE x->>'userId' = $2::text)`,
      [c.org, c.userId, c.newName, c.mobile !== undefined, c.mobile ?? null, c.email !== undefined, c.email ?? null],
    );
  }
  return n;
}
