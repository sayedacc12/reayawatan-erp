import { Injectable } from '@nestjs/common';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { OrgUser } from '../../../core/auth/decorators';
import { CommsCore } from '../../comms/comms-core.service';
import { CommsSettings } from '../../comms/entities/comms.entity';
import { KnCategory } from '../../knowledge/entities/knowledge.entity';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { MemSettings } from '../../members/entities/members.entity';
import { MemCore } from '../../members/mem-core.service';
import { PtSettings } from '../../partnerships/entities/partnerships.entity';
import { PartnershipsService } from '../../partnerships/partnerships.service';
import { FormulasService } from '../../planning/budget/formulas.service';
import { defaultConfig } from '../../planning/planning-defaults';
import { PlanningCore } from '../../planning/planning-core.service';
import { VolSettings } from '../../volunteers/entities/volunteers.entity';
import { VolCore } from '../../volunteers/vol-core.service';
import { StarterPack, StarterStep, StepOutcome, added, existing } from '../starter.types';

/**
 * خطوة لنظام يهيّئ إعداداته المقترحة عند أول فتح لشاشته: إن لم تُهيّأ بعد تُهيّأ الآن،
 * وإن هُيّئت (فتح المستخدم الشاشة قبل الزر) لا يتغير شيء.
 */
function initStep(db: DataSource, o: {
  key: string; label: string; detail: string;
  entity: EntityTarget<ObjectLiteral>; done?: Record<string, unknown>;
  init: (org: string) => Promise<unknown>; count: (org: string) => Promise<number>;
}): StarterStep {
  return {
    key: o.key, label: o.label, detail: o.detail,
    run: async (a: OrgUser): Promise<StepOutcome> => {
      if (await db.getRepository(o.entity).exists({ where: { organizationId: a.organizationId, ...(o.done ?? {}) } })) return existing('مضافة مسبقًا عند أول فتح للنظام');
      await o.init(a.organizationId);
      return added(await o.count(a.organizationId));
    },
  };
}

const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);

/**
 * التطوع: قوائم التسجيل والفرص ومراحل اعتمادها والاستبانات والشهادات والعقود.
 * لائحة التطوع وميثاقه يظهران بالنص المقترح دون حفظ إصدار، حتى لا يُسجَّل اعتماد باسم من ضغط الزر.
 */
@Injectable()
export class VolunteersStarter implements StarterPack {
  readonly module = 'volunteers';
  readonly steps: StarterStep[];

  constructor(db: DataSource, core: VolCore) {
    this.steps = [
      initStep(db, {
        key: 'lists', label: 'قوائم التطوع ونماذجه',
        detail: 'حقول نموذج تسجيل المتطوع والفرص التطوعية، وأنواع المتطوعين ومجالاتهم، وتصنيفات الفرص ومراحل اعتمادها، وأسئلة الاستبانات، وبنود عقد التطوع، وقوالب الشهادات.',
        entity: VolSettings, done: { initialized: true },
        init: (org) => core.settings(org),
        count: async (org) => {
          const s = await core.settings(org);
          return len(s.registrationFields) + len(s.eventFields) + len(s.volunteerTypes) + len(s.volunteerFields) + len(s.eventCategories) + len(s.eventStages) + len(s.contractClauses);
        },
      }),
    ];
  }
}

/** العضويات: فئات العضوية وشروطها ولائحتها والمستندات المطلوبة ومراحل اعتماد الطلبات والدفع والتجديد والبطاقة */
@Injectable()
export class MembersStarter implements StarterPack {
  readonly module = 'members';
  readonly steps: StarterStep[];

  constructor(db: DataSource, core: MemCore) {
    this.steps = [initStep(db, {
      key: 'settings', label: 'إعدادات العضوية',
      detail: 'فئات العضوية (عاملة، منتسبة، شرفية...) وشروطها، ولائحة العضوية، والمستندات المطلوبة، ومراحل اعتماد طلبات العضوية، وإعدادات الرسوم والتجديد وبطاقة العضوية.',
      entity: MemSettings, done: { initialized: true },
      init: (org) => core.settings(org),
      count: async (org) => {
        const s = await core.settings(org);
        return len(s.types) + len(s.conditions) + len(s.documents) + len(s.stages);
      },
    })];
  }
}

/** الشراكات: أنواع الشراكة وتصنيفات الشركاء ومعايير التقييم وبنود العقود */
@Injectable()
export class PartnershipsStarter implements StarterPack {
  readonly module = 'partnerships';
  readonly steps: StarterStep[];

  constructor(db: DataSource, pt: PartnershipsService) {
    this.steps = [initStep(db, {
      key: 'settings', label: 'أنواع الشراكة ومعايير التقييم وبنود العقود',
      detail: 'أنواع الشراكة ومددها، وتصنيفات الشركاء، ومستويات الشراكة، ومعايير تقييم الشريك، ومكتبة بنود عقود الشراكة.',
      entity: PtSettings,
      init: (org) => pt.settings(org),
      count: async (org) => Number((await db.query(
        `SELECT (SELECT count(*) FROM pt_types WHERE organization_id = $1) + (SELECT count(*) FROM pt_classes WHERE organization_id = $1)
              + (SELECT count(*) FROM pt_criteria WHERE organization_id = $1) + (SELECT count(*) FROM pt_clauses WHERE organization_id = $1) AS n`, [org]))[0].n),
    })];
  }
}

/** الاتصالات الإدارية: تصنيفات المعاملات ومهل إنجازها */
@Injectable()
export class CommsStarter implements StarterPack {
  readonly module = 'comms';
  readonly steps: StarterStep[];

  constructor(db: DataSource, core: CommsCore) {
    this.steps = [initStep(db, {
      key: 'categories', label: 'تصنيفات المعاملات ومهلها',
      detail: 'تصنيفات المعاملات الإدارية والمالية الشائعة، ولكل تصنيف مهلة إنجاز مقترحة.',
      entity: CommsSettings,
      init: (org) => core.settings(org),
      count: async (org) => len((await core.settings(org)).categories),
    })];
  }
}

/** مركز المعرفة: تصنيفات الوثائق */
@Injectable()
export class KnowledgeStarter implements StarterPack {
  readonly module = 'knowledge';
  readonly steps: StarterStep[];

  constructor(db: DataSource, kn: KnowledgeService) {
    this.steps = [{
      key: 'categories', label: 'تصنيفات الوثائق',
      detail: 'تصنيفات مقترحة لوثائق الشركة (اللوائح والسياسات، التقارير، الأدلة والإجراءات...). تُضاف فقط إن لم تكن هناك تصنيفات أو وثائق.',
      run: async (a) => {
        if (await db.getRepository(KnCategory).exists({ where: { organizationId: a.organizationId } })) return existing('التصنيفات موجودة');
        const n = (await kn.categories(a.organizationId)).length;
        return n ? added(n) : { added: 0, note: 'توجد وثائق بلا تصنيفات، فأضف التصنيفات من الإعدادات' };
      },
    }];
  }
}

/** التخطيط والموازنات: مستويات الخطط ومسارات الاعتماد ووحدات المؤشرات، والمعادلات الأساسية للموازنة */
@Injectable()
export class PlanningStarter implements StarterPack {
  readonly module = 'planning';
  readonly steps: StarterStep[];

  constructor(private readonly db: DataSource, private readonly core: PlanningCore, private readonly formulas: FormulasService) {
    this.steps = [
      {
        key: 'config', label: 'مستويات الخطط ومسارات الاعتماد',
        detail: 'مستويات الخطة الاستراتيجية والتشغيلية، وأنواع العلاقات، ووحدات المؤشرات وحدود ألوان التحقق، ومسارات اعتماد الخطط والموازنة والمناقلات (مع مسار أعلى للمبالغ الكبيرة).',
        run: async (a) => {
          const s = await this.core.settings(a.organizationId);
          if (s.config && Object.keys(s.config).length) return existing('الإعدادات محفوظة');
          const cfg = defaultConfig();
          await this.core.saveConfig(a, cfg as unknown as Record<string, unknown>);
          return added(cfg.strategicLevels.length + cfg.operationalLevels.length + cfg.routes.length);
        },
      },
      {
        key: 'formulas', label: 'المعادلات الأساسية للموازنة',
        detail: 'معادلات احتساب بنود الموازنة (الرواتب والبدلات والتأمينات والمصروفات التشغيلية) بإصدارها الأول، وتعدّلها بإصدارات لاحقة.',
        run: async (a) => {
          const q = async () => (await this.db.query('SELECT count(*)::int AS n FROM plan_formulas WHERE organization_id = $1', [a.organizationId]))[0].n as number;
          const before = await q();
          await this.formulas.ensure(a.organizationId);
          const n = (await q()) - before;
          return n ? added(n) : existing('المعادلات موجودة');
        },
      },
    ];
  }
}
