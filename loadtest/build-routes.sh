#!/bin/bash
# يبني قائمة الشاشات المقاسة: كل طلبات GET بلا معاملات + صفحات التفاصيل بمعرفات حقيقية من جمعية الاختبار
# الاستخدام: bash loadtest/build-routes.sh <org-slug> > loadtest/routes.txt
ORG=$1; DB=${DATABASE_URL:-postgres://erp:erp@localhost/charity_erp}
DIR=$(dirname "$0")
cat "$DIR/routes-static.txt"
q() { psql "$DB" -Atc "select $1 from $2 where organization_id=(select id from organizations where slug='$ORG') ${3:-order by created_at desc} limit 1"; }
echo "# صفحات التفاصيل"
echo "/api/beneficiaries/$(q id beneficiaries)"
echo "/api/beneficiaries/requests/$(q id beneficiary_requests)"
echo "/api/fundraising/donors/$(q id fundraising_donors)"
echo "/api/fundraising/opportunities/$(q id fundraising_opportunities)"
echo "/api/fundraising/batches/$(q id fundraising_batches)"
echo "/api/projects/$(q activity_id project_profiles 'order by project_no')"
echo "/api/accounting/entries/$(q id acc_entries)"
echo "/api/accounting/voucher/$(q id acc_vouchers)"
for k in $(psql "$DB" -Atc "select distinct kind from acc_vouchers"); do echo "/api/accounting/vouchers/$k"; done
Y=$(q id acc_fiscal_years 'order by start_date desc')
echo "/api/accounting/periods/$Y"
echo "/api/accounting/inventory/$Y"
echo "/api/accounting/reports/ledger/$(psql "$DB" -Atc "select account_id from acc_entry_lines where organization_id=(select id from organizations where slug='$ORG') group by 1 order by count(*) desc limit 1")"
echo "/api/accounting/reports/partner/$(psql "$DB" -Atc "select partner_id from acc_entry_lines where partner_id is not null and organization_id=(select id from organizations where slug='$ORG') group by 1 order by count(*) desc limit 1")"
echo "/api/accounting/assets/$(q id acc_assets)"
E=$(q id hr_employees 'order by employee_no')
echo "/api/hr/employees/$E"; echo "/api/hr/employees/$E/balances"; echo "/api/hr/attendance/employees/$E"
echo "/api/hr/payroll-runs/$(q id hr_payroll_runs)"
echo "/api/volunteers/volunteers/$(q id vol_volunteers)"
echo "/api/members/members/$(q id mem_members)"
echo "/api/comms/transactions/$(q id comms_transactions)"
echo "/api/meetings/m/$(q id mtg_meetings)"
echo "/api/risk/risks/$(q id risk_register)"
echo "/api/partnerships/partners/$(q id pt_partners)"
echo "/api/website/donations/$(q id web_donations)"
