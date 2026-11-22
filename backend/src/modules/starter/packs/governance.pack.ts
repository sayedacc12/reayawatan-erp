import { Injectable } from '@nestjs/common';
import { OrgUser } from '../../../core/auth/decorators';
import { ObligationKind } from '../../governance/entities/governance.entity';
import { addDays, addMonths, GovFinance } from '../../governance/gov-finance.service';
import { GovernanceService } from '../../governance/governance.service';
import { StarterPack, StarterStep, StepOutcome, added, existing } from '../starter.types';

const thisYear = () => Number(new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 4));
const Q = ['الأول', 'الثاني', 'الثالث', 'الرابع'];
const CHECK = 'موعد مقترح، فتحقق من انطباقه على الشركة وعدّله أو احذفه';

/**
 * الحوكمة والامتثال: تقويم الالتزامات الدورية لشركة للسنة الحالية (اجتماعات مجلس المديرين، التقارير المالية الربعية،
 * إقرارات ضريبة القيمة المضافة، القوائم المالية والإقرار الزكوي، قرار المالك، الموازنة). لا يستخدم تقويم الجمعيات
 * (رفع التقارير للمركز الوطني والجمعية العمومية) لأنه لا ينطبق على الشركة.
 */
@Injectable()
export class GovernanceStarter implements StarterPack {
  readonly module = 'governance';
  readonly steps: StarterStep[];

  constructor(private readonly gov: GovernanceService, private readonly finance: GovFinance) {
    this.steps = [
      {
        key: 'calendar', label: 'تقويم الالتزامات الدورية للسنة الحالية',
        detail: 'اجتماعات مجلس المديرين الربعية، والتقارير المالية الربعية للإدارة والمالك، وإقرارات ضريبة القيمة المضافة الربعية، والقوائم المالية المدققة والإقرار الزكوي، وقرار المالك باعتماد القوائم، والموازنة التقديرية للسنة التالية، بمواعيد مقترحة وفق السنة المالية تعدّلها أو تحذف ما لا ينطبق.',
        run: (a) => this.calendar(a),
      },
    ];
  }

  private async calendar(a: OrgUser): Promise<StepOutcome> {
    const year = thisYear();
    const fy = (await this.finance.years(a.organizationId)).find((y) => y.name === year);
    const start = fy?.startDate ?? `${year}-01-01`;
    const end = fy?.endDate ?? `${year}-12-31`;
    const items: { kind: ObligationKind; title: string; dueDate: string; note: string }[] = [];
    for (let i = 0; i < 4; i++) {
      const qEnd = addDays(addMonths(start, (i + 1) * 3), -1);
      items.push(
        { kind: 'board_meeting', title: `اجتماع مجلس المديرين للربع ${Q[i]} ${year}`, dueDate: qEnd, note: 'اجتماع كل 3 أشهر لمتابعة الأداء والمشاريع والتحصيل' },
        { kind: 'quarterly_report', title: `التقرير المالي للربع ${Q[i]} ${year} وعرضه على الإدارة والمالك`, dueDate: addDays(qEnd, 30), note: 'موعد داخلي مقترح: 30 يومًا بعد نهاية الربع' },
        // آخر يوم من الشهر التالي لنهاية الربع
        { kind: 'other', title: `إقرار ضريبة القيمة المضافة للربع ${Q[i]} ${year}`, dueDate: addDays(addMonths(addDays(qEnd, 1), 1), -1), note: `للشركة المسجلة في ضريبة القيمة المضافة بإقرار ربعي. ${CHECK}` },
      );
    }
    const after4 = addMonths(end, 4);
    items.push(
      { kind: 'annual_statements', title: `القوائم المالية المدققة لسنة ${year}`, dueDate: after4, note: `تُعد وتُدقق قبل الإقرار الزكوي. ${CHECK}` },
      { kind: 'other', title: `الإقرار الزكوي أو الضريبي لسنة ${year}`, dueDate: addDays(end, 120), note: `خلال 120 يومًا من نهاية السنة المالية. ${CHECK}` },
      { kind: 'ga_meeting', title: `قرار المالك باعتماد القوائم المالية لسنة ${year}`, dueDate: after4, note: CHECK },
      { kind: 'budget', title: `الموازنة التقديرية لسنة ${year + 1} معتمدة من مجلس المديرين`, dueDate: addDays(end, -30), note: 'تُعتمد قبل بداية السنة المالية التالية' },
    );
    const have = new Set((await this.gov.obligations(a)).map((o: { kind: string; title: string }) => `${o.kind}|${o.title}`));
    let n = 0;
    for (const it of items) {
      if (have.has(`${it.kind}|${it.title}`)) continue;
      await this.gov.createObligation(a, it);
      n++;
    }
    return n ? added(n) : existing('التقويم مضاف');
  }
}
