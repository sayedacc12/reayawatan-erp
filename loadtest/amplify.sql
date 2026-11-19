-- تضخيم بيانات جمعية واحدة لتحاكي جمعية كبيرة جدًا بعد سنوات من الاستخدام.
-- الاستخدام: psql -v org=lt-001 -v k=1 -f loadtest/amplify.sql
--   k = معامل الحجم: 1 = جمعية كبيرة جدًا (مئات الآلاف)، 0.1 = جمعية متوسطة
-- يتطلب تحميل clone.sql أولًا. للاختبار فقط، لا يُشغَّل أبدًا على قاعدة الإنتاج.
\set ON_ERROR_STOP on
\timing on
SELECT set_config('lt.k', :'k', false);

-- المساعدات الاجتماعية: ~120 ألف مستفيد، ~160 ألف طلب، ~580 ألف إجراء على الطلبات
SELECT lt_clone(ARRAY['beneficiaries','beneficiary_family_members','beneficiary_requests','beneficiary_request_actions','beneficiary_aids','beneficiary_tickets'],
  :'org', 1, greatest(1, (20000 * current_setting('lt.k')::numeric)::int));

-- النظام المالي: ~320 ألف قيد بأكثر من مليون سطر، و~230 ألف سند
SELECT lt_clone(ARRAY['acc_entries','acc_entry_lines'], :'org', 1, greatest(1, (3000 * current_setting('lt.k')::numeric)::int));
SELECT lt_clone(ARRAY['acc_vouchers','acc_voucher_actions'], :'org', 1, greatest(1, (3000 * current_setting('lt.k')::numeric)::int));

-- الموارد المالية: ~30 ألف متبرع و35 ألف فرصة تبرع ودفعاتها
SELECT lt_clone(ARRAY['fundraising_donors','fundraising_opportunities','fundraising_opportunity_actions','fundraising_pledge_collections','fundraising_batches'],
  :'org', 1, greatest(1, (5000 * current_setting('lt.k')::numeric)::int));
SELECT lt_clone(ARRAY['ledger_entries','ledger_lines'], :'org', 1, greatest(1, (3000 * current_setting('lt.k')::numeric)::int));

-- الموارد البشرية: ~1500 موظف وطلباتهم وإجازاتهم
SELECT lt_clone(ARRAY['hr_employees'], :'org', 1, greatest(1, (150 * current_setting('lt.k')::numeric)::int));
SELECT lt_clone(ARRAY['hr_requests'], :'org', 1, greatest(1, (500 * current_setting('lt.k')::numeric)::int));
SELECT lt_clone(ARRAY['hr_leave_requests'], :'org', 1, greatest(1, (500 * current_setting('lt.k')::numeric)::int));

-- بصمات الحضور: نكرر بصمات الشهر الموجود للخلف لثلاث سنوات (~ مليون بصمة للجمعية الكبيرة)
INSERT INTO hr_attendance_punches (organization_id, employee_id, attendance_code, punch_date, punch_time, source, device_id, import_id, note, created_by_name, created_at)
SELECT p.organization_id, p.employee_id, p.attendance_code, p.punch_date - (g * 31), p.punch_time, p.source, p.device_id, p.import_id, p.note, p.created_by_name, p.created_at - make_interval(days => g * 31)
FROM hr_attendance_punches p CROSS JOIN generate_series(1, greatest(1, (36 * current_setting('lt.k')::numeric)::int)) g
WHERE p.organization_id = (SELECT id FROM organizations WHERE slug = :'org')
ON CONFLICT DO NOTHING;

-- العضوية والتطوع والاتصالات والتبرعات الإلكترونية
SELECT lt_clone(ARRAY['mem_members'], :'org', 1, greatest(1, (1000 * current_setting('lt.k')::numeric)::int));
SELECT lt_clone(ARRAY['vol_volunteers'], :'org', 1, greatest(1, (1000 * current_setting('lt.k')::numeric)::int));
SELECT lt_clone(ARRAY['comms_transactions'], :'org', 1, greatest(1, (3000 * current_setting('lt.k')::numeric)::int));
SELECT lt_clone(ARRAY['comms_tasks'], :'org', 1, greatest(1, (1000 * current_setting('lt.k')::numeric)::int));
SELECT lt_clone(ARRAY['web_donations'], :'org', 1, greatest(1, (3000 * current_setting('lt.k')::numeric)::int));
SELECT lt_clone(ARRAY['web_activity'], :'org', 1, greatest(1, (500 * current_setting('lt.k')::numeric)::int));

-- الأصول الثابتة: ~8 آلاف أصل وحركاتها
SELECT lt_clone(ARRAY['acc_assets'], :'org', 1, greatest(1, (500 * current_setting('lt.k')::numeric)::int));

ANALYZE;
