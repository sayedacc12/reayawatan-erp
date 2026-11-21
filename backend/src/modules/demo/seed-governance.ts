import { Injectable } from '@nestjs/common';
import { allItems } from '../governance/catalog';
import { suggestChoices, SignalStatus } from '../governance/gov-signals.service';
import { GovernanceService } from '../governance/governance.service';
import { DemoTeam, daysAgo, daysAhead } from './demo-context';

/**
 * بيانات الحوكمة التجريبية: بيانات نظامية تولّد إنذارات قريبة، تقويم التزامات لسنتين،
 * تقييم تجريبي معتمد للنصف الأول، وتقييم ربعي مسودة مبني عليه، وخطة تحسين من الفجوات.
 * أي تغيير في واجهات وحدة الحوكمة يستلزم تحديث هذا الملف.
 */
@Injectable()
export class GovernanceSeed {
  constructor(private readonly gov: GovernanceService) {}

  async run(team: DemoTeam) {
    const a = team.admin;
    const year = Number(daysAgo(0).slice(0, 4));

    await this.gov.saveSettings(a, {
      facts: {
        licenseNo: '1234', licenseExpiry: daysAhead(70), boardFormedOn: daysAgo(4 * 365 - 200), boardTermEnd: daysAhead(200), boardMembers: 7,
        externalAuditor: 'مكتب الراية للمراجعة والتدقيق', auditorContractEnd: daysAhead(160), hasBranches: false, branchesApproved: null,
        hasCommittees: true, openViolations: 0, websiteUrl: 'https://demo.sanabelerp.com', ctfObliged: true,
      },
      alertDays: 30, targetScore: 90,
    });

    // تقويم السنتين: كل ما حل موعده أُنجز، عدا التقرير الربعي الأخير ليظهر إنذار التأخر
    const t = daysAgo(0);
    for (const fy of [year - 1, year]) {
      const { items } = await this.gov.generateCalendar(a, { fiscalYear: fy });
      const due = items.filter((o) => o.dueDate < t);
      const lateReport = due.filter((o) => o.kind === 'quarterly_report').at(-1);
      for (const o of due) {
        if (o.id === lateReport?.id && fy === year) continue;
        const done = o.dueDate < daysAgo(3) ? o.dueDate : daysAgo(1);
        await this.gov.updateObligation(a, o.id, { kind: o.kind, title: o.title, dueDate: o.dueDate, doneDate: done, evidence: 'محضر/خطاب الرفع محفوظ في الأرشيف', note: o.note });
      }
    }

    // التقييم التجريبي للنصف الأول: نمط ثابت يجعل نحو 80% من البنود متحققة
    const prev = await this.gov.createAssessment(a, {
      title: `التقييم التجريبي للنصف الأول ${year}`, kind: 'mock', periodType: 'semiannual', periodFrom: `${year}-01-01`, periodTo: `${year}-06-30`,
      opinion: 'unqualified', notes: 'تقييم تجريبي قبل التقييم الرسمي للمركز الوطني',
    });
    const items = allItems();
    const pattern: SignalStatus[] = ['met', 'met', 'met', 'partial', 'met', 'met', 'missing', 'met', 'met', 'partial', 'met', 'met', 'met'];
    for (const [i, f] of items.entries()) {
      const choices = suggestChoices(f.item, pattern[i % pattern.length]) ?? suggestChoices(f.item, 'met') ?? [0];
      await this.gov.answer(a, prev.assessment.id, f.item.code, { choices, evidence: 'مراجعة لجنة الحوكمة', note: null });
    }
    await this.gov.submit(a, prev.assessment.id);
    await this.gov.approve(a, prev.assessment.id);

    // التقييم الربعي الحالي: منقول من السابق ثم تحسين بعض البنود، وبقيت بنود لم يُجب عليها
    const cur = await this.gov.createAssessment(a, {
      title: `التقييم الذاتي للربع الثالث ${year}`, kind: 'self', periodType: 'quarterly', periodFrom: `${year}-07-01`, periodTo: `${year}-09-30`,
      opinion: 'unqualified', copyPrevious: true,
    });
    const id = cur.assessment.id;
    let improved = 0;
    for (const [i, f] of items.entries()) {
      if (pattern[i % pattern.length] === 'met') continue;
      if (i % 3 === 0) {
        await this.gov.clearAnswer(a, id, f.item.code);
      } else if (improved < 12) {
        const choices = suggestChoices(f.item, 'met');
        if (choices) { await this.gov.answer(a, id, f.item.code, { choices, evidence: 'تم الاستيفاء خلال الربع', note: 'تحسن بعد خطة التحسين' }); improved++; }
      }
    }
    await this.gov.applySuggestions(a, id);
    // اترك بعض البنود بلا إجابة لتظهر نسبة الاكتمال
    for (const f of items.filter((_, i) => i % 41 === 5)) await this.gov.clearAnswer(a, id, f.item.code);

    // خطة التحسين من أعلى الفجوات أثراً
    const ops = await this.gov.opportunities(a, id);
    const codes = ops.items.filter((o) => !o.code.startsWith('FIN')).slice(0, 5).map((o) => o.code);
    const { items: actions } = await this.gov.actionsFromGaps(a, { codes, ownerName: 'مسؤول الحوكمة', dueDate: daysAhead(45) });
    const states: { status: 'done' | 'in_progress' | 'planned'; progress: number; due: string }[] = [
      { status: 'done', progress: 100, due: daysAgo(10) },
      { status: 'in_progress', progress: 60, due: daysAhead(20) },
      { status: 'in_progress', progress: 30, due: daysAgo(5) },
    ];
    for (const [i, s] of states.entries()) {
      const x = actions[i];
      if (!x) break;
      await this.gov.updateAction(a, x.id, {
        title: x.title, description: x.description, ownerName: x.ownerName, dueDate: s.due, priority: x.priority, status: s.status, progress: s.progress, note: x.note,
      });
    }

    // تأجيل إنذار واحد بملاحظة
    const { items: alerts } = await this.gov.alerts(a);
    const fin = alerts.find((x) => x.key.endsWith(':edge')) ?? alerts.find((x) => x.level === 'info');
    if (fin) await this.gov.ack(a, fin.key, { days: 30, note: 'تمت مناقشته في لجنة المراجعة ويُتابع الشهر القادم' });
  }
}
