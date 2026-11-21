import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { calculatorResult, LeadsService } from './leads.service';
import { LeadSubmitDto } from './website.dto';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** نماذج الموقع العامة (طلب الاستشارة، إرسال نتيجة الحاسبة أو التقييم): كلها تصل كعملاء محتملين */
@Injectable()
export class FormsService {
  constructor(private readonly db: DataSource, private readonly leads: LeadsService) {}

  async submit(org: string, dto: LeadSubmitDto) {
    const result: Record<string, unknown> = {};
    const facts: { label: string; value: string }[] = [];
    let score: number | null = null;
    if (dto.calculator) {
      const c = calculatorResult(dto.calculator);
      result.calculator = c;
      facts.push({ label: 'نتيجة الحاسبة', value: `ميزانية ${fmt(c.budget)} ر.س، تحسن ${c.efficiency}٪ ← ${fmt(c.additionalBeneficiaries)} مستفيد إضافي سنويًا` });
    }
    if (dto.assessment) {
      const a = await this.leads.assessmentResult(org, dto.assessment);
      result.assessment = a;
      score = a.score;
      facts.push({ label: 'درجة الجاهزية', value: `${a.score} من 100` });
      if (a.gaps.length) facts.push({ label: 'المجالات الأضعف', value: a.gaps.map((g) => g.title).join('، ') });
    }
    if (dto.source === 'calculator' && !dto.calculator) return { ok: false };
    if (dto.source === 'assessment' && !dto.assessment) return { ok: false };
    const lead = await this.db.transaction((em) => this.leads.create(em, org, dto.source, dto, {
      serviceSlug: dto.serviceSlug ?? null, message: dto.message ?? null, result: Object.keys(result).length ? result : null, score,
    }));
    await this.leads.notifyTeam(org, lead, [...(dto.serviceSlug ? [{ label: 'الخدمة', value: dto.serviceSlug }] : []), ...facts]);
    if (dto.source === 'consultation') {
      await this.leads.confirmVisitor(org, lead, 'استلمنا طلبكم', ['شكرًا لتواصلكم مع رعاية وطن. سيتواصل معكم أحد مستشارينا خلال يومي عمل.'], facts);
    } else {
      await this.leads.confirmVisitor(org, lead, dto.source === 'assessment' ? 'نتيجة تقييم جاهزية منظمتكم' : 'تقدير مضاعف الأثر لمنظمتكم',
        ['هذه نسخة من نتيجتكم. يسعدنا مناقشتها معكم في جلسة تشخيص مجانية.'], facts);
    }
    return { ok: true, result };
  }
}
