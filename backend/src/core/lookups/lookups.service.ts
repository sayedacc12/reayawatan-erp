import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Organization } from '../entities';
import { DEFAULT_NATIONALITIES } from './nationalities';

/**
 * قوائم مرجعية مشتركة لكل وحدات الشركة (حاليًا: الجنسيات).
 * القيم أسماء عربية تُحفظ كما هي في السجلات، والشركة تعدّل القائمة من الإعدادات.
 */
@Injectable()
export class LookupsService {
  constructor(private readonly db: DataSource) {}

  async nationalities(orgId: string, m?: EntityManager): Promise<string[]> {
    const org = await (m ?? this.db.manager).findOne(Organization, { where: { id: orgId }, select: { id: true, nationalities: true } });
    return org?.nationalities?.length ? org.nationalities : [...DEFAULT_NATIONALITIES];
  }

  async setNationalities(orgId: string, list: string[]): Promise<string[]> {
    const clean = [...new Set(list.map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean))].map((x) => x.slice(0, 60));
    if (!clean.length) throw new BadRequestException('أضف جنسية واحدة على الأقل');
    await this.db.getRepository(Organization).update({ id: orgId }, { nationalities: clean });
    return clean;
  }

  /** يرفض أي جنسية ليست في قائمة الشركة */
  async assertNationalities(orgId: string, values: (string | null | undefined)[], m?: EntityManager) {
    const given = values.filter((v): v is string => !!v && !!v.trim());
    if (!given.length) return;
    const list = new Set(await this.nationalities(orgId, m));
    const bad = given.filter((v) => !list.has(v.trim()));
    if (bad.length) throw new BadRequestException(`الجنسية غير موجودة في قائمة الجنسيات المعتمدة: ${bad.join('، ')}. اختر من القائمة أو أضفها من الإعدادات`);
  }
}
