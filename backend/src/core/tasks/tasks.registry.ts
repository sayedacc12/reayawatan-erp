import { Injectable, Logger } from '@nestjs/common';
import { OrgUser } from '../auth/decorators';

/** مهمة معلقة عند المستخدم: إجراء ينتظره (اعتماد، مراجعة، تعديل طلب مرتجع ...) */
export interface PendingTask {
  /** معرّف فريد داخل النظام */
  id: string;
  title: string;
  subtitle?: string | null;
  /** مسار صفحة الإجراء في الواجهة */
  link: string;
  /** وقت وصول المهمة (لترتيبها) */
  at?: string | Date | null;
  /** تصنيف قصير داخل النظام، مثل: طلبات الموظفين، سندات الصرف */
  group?: string | null;
  /** المهمة متأخرة أو عاجلة */
  urgent?: boolean;
}

/** مصدر مهام في نظام معيّن. يُسجل من الوحدة نفسها عند التشغيل */
export interface TaskSource {
  /** كود النظام (الوحدة) مثل hr أو accounting */
  module: string;
  /** اسم النظام بالعربي كما يظهر في تبويبات الإشعارات */
  name: string;
  /** لون تبويب النظام */
  color?: string;
  collect: (user: OrgUser) => Promise<PendingTask[]>;
}

/**
 * سجل المهام المعلقة: كل نظام يسجل مصدرًا يعيد ما ينتظر المستخدم من إجراءات،
 * والسجل يجمعها في استدعاء واحد لجرس الإشعارات مقسمة حسب الأنظمة.
 */
@Injectable()
export class TasksRegistry {
  private readonly log = new Logger('Tasks');
  private readonly sources: TaskSource[] = [];

  register(source: TaskSource) {
    this.sources.push(source);
  }

  async collect(user: OrgUser) {
    const groups = await Promise.all(this.sources.map(async (s) => {
      try {
        const items = await s.collect(user);
        return { module: s.module, name: s.name, color: s.color ?? '#6366f1', items };
      } catch (e) {
        // تعطل مصدر واحد لا يوقف جرس الإشعارات كله
        this.log.warn(`Task source ${s.module} failed: ${(e as Error).message}`);
        return { module: s.module, name: s.name, color: s.color ?? '#6366f1', items: [] as PendingTask[] };
      }
    }));
    const merged = new Map<string, { module: string; name: string; color: string; items: PendingTask[] }>();
    for (const g of groups) {
      const cur = merged.get(g.module);
      if (cur) cur.items.push(...g.items);
      else merged.set(g.module, { ...g, items: [...g.items] });
    }
    const out = [...merged.values()].filter((g) => g.items.length).map((g) => ({
      ...g,
      count: g.items.length,
      urgent: g.items.filter((i) => i.urgent).length,
      items: g.items
        .map((i) => ({ ...i, at: i.at ? new Date(i.at).toISOString() : null }))
        .sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || (a.at ?? '').localeCompare(b.at ?? ''))
        .slice(0, 50),
    }));
    return { total: out.reduce((s, g) => s + g.count, 0), groups: out };
  }
}
