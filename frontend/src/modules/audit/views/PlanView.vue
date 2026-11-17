<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import EngagementForm from '../components/EngagementForm.vue';
import PlanForm from '../components/PlanForm.vue';
import RiskChips from '../components/RiskChips.vue';
import { LEVEL_COLOR, P, STATUS_COLOR, fmtDate, fmtDateTime, type Area, type Plan } from '../lib';
import '../../projects/projects.css';
import '../audit.css';

interface Detail extends Plan {
  parent: { id: string; code: string; title: string; status: string } | null;
  subs: Plan[];
  engagements: { id: string; code: string; planId: string; title: string; priority: string; priorityLabel: string; status: string; statusLabel: string; scopeLabel: string; plannedStart: string; plannedEnd: string; leadName: string | null; budgetHours: number; riskRefs: number }[];
}
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const router = useRouter();
const plan = ref<Detail | null>(null);
const error = ref('');
const editPlan = ref(false);
const newEng = ref(false);
const suggest = ref<{ show: boolean; areas: Area[]; picked: string[] }>({ show: false, areas: [], picked: [] });
async function load() {
  try {
    plan.value = await api<Detail>(`/audit/plans/${props.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(() => props.id, load);
const planOpts = computed(() => (plan.value ? [plan.value, ...plan.value.subs].filter((p) => p.status !== 'closed').map((p) => ({ id: p.id, code: p.code, title: p.title, periodFrom: p.periodFrom, periodTo: p.periodTo })) : []));
const agg = computed(() => {
  const all = plan.value ? [plan.value, ...plan.value.subs] : [];
  const total = all.reduce((a, p) => a + p.stats.total, 0);
  const done = all.reduce((a, p) => a + p.stats.done, 0);
  return { done, findings: all.reduce((a, p) => a + p.stats.findings, 0), progress: total ? Math.round((done / total) * 100) : 0 };
});
const hoursUsed = computed(() => plan.value?.engagements.reduce((s, e) => s + e.budgetHours, 0) ?? 0);

async function act(action: 'submit' | 'approve' | 'return' | 'close' | 'delete') {
  const p = plan.value!;
  try {
    if (action === 'submit') await api(`/audit/plans/${p.id}/submit`, { method: 'POST' });
    else if (action === 'close') {
      const note = prompt('ملاحظة الإغلاق (اختياري)');
      if (note === null) return;
      await api(`/audit/plans/${p.id}/close`, { method: 'POST', json: { note: note || null } });
    } else if (action === 'delete') {
      if (!confirm('حذف الخطة؟')) return;
      await api(`/audit/plans/${p.id}`, { method: 'DELETE' });
      return router.push('/audit/plans');
    } else {
      const note = action === 'return' ? prompt('سبب الإعادة للتعديل') : prompt('ملاحظة الاعتماد (اختياري)') ?? '';
      if (action === 'return' && !note) return;
      await api(`/audit/plans/${p.id}/decision`, { method: 'POST', json: { decision: action, note: note || null } });
    }
    toast.success('تم');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function openSuggest() {
  const areas = (await api<Area[]>('/audit/areas')).filter((a) => a.isActive && (plan.value!.scopeType !== 'unit' || a.unitId === plan.value!.unitId) && (plan.value!.scopeType !== 'outside' || a.scopeType === 'outside'));
  suggest.value = { show: true, areas, picked: areas.filter((a) => a.isDue && !a.openEngagements).map((a) => a.id) };
}
async function runSuggest() {
  try {
    const r = await api<{ created: number }>(`/audit/plans/${props.id}/suggest`, { method: 'POST', json: { areaIds: suggest.value.picked } });
    toast.success(`أُضيفت ${r.created} مهمة للخطة حسب أولوية المخاطر`);
    suggest.value.show = false;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div v-if="plan">
    <section class="pm-hero au-hero">
      <div>
        <p class="pm-kicker">{{ plan.kind === 'master' ? 'الخطة الرئيسية' : 'خطة فرعية' }} · <span class="au-code" style="color: #fdba74">{{ plan.code }}</span></p>
        <h1>{{ plan.title }}</h1>
        <p class="pm-sub">{{ plan.scopeType === 'outside' ? 'خارج الهيكل: ' : '' }}{{ plan.scopeLabel }} · {{ fmtDate(plan.periodFrom) }} ← {{ fmtDate(plan.periodTo) }}
          <template v-if="plan.parent"> · تتبع <RouterLink :to="`/audit/plans/${plan.parent.id}`" style="color: #fdba74">{{ plan.parent.code }}</RouterLink></template></p>
      </div>
      <div class="pm-actions">
        <span class="pm-pill" :style="{ '--c': STATUS_COLOR[plan.status], background: 'rgba(255,255,255,.9)' }">{{ plan.statusLabel }}</span>
        <template v-if="session.can(P.plans) && plan.status === 'draft'">
          <button class="btn au-glow" @click="act('submit')">إرسال للاعتماد</button>
          <button class="btn au-ghost" @click="editPlan = true">تعديل</button>
          <button class="btn au-ghost" @click="act('delete')">حذف</button>
        </template>
        <template v-if="session.can(P.approvePlans) && plan.status === 'submitted'">
          <button class="btn au-glow" @click="act('approve')">اعتماد الخطة</button>
          <button class="btn au-ghost" @click="act('return')">إعادة للتعديل</button>
        </template>
        <button v-if="session.can(P.approvePlans) && plan.status === 'approved'" class="btn au-ghost" @click="act('close')">إغلاق الخطة</button>
      </div>
    </section>
    <div v-if="plan.decisionNote && plan.status === 'draft'" class="alert alert-error">أُعيدت للتعديل: {{ plan.decisionNote }}</div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #6366f1; --i: 0"><span>المهام</span><strong>{{ plan.engagements.length }}</strong><small>منها {{ agg.done }} صدر تقريرها</small></div>
      <div class="pm-kpi" style="--a: #0ea5e9; --i: 1"><span>نسبة التنفيذ</span><strong>{{ agg.progress }}%</strong><small>{{ plan.subs.length ? 'شاملة الخطط الفرعية' : 'من مهام الخطة' }}</small></div>
      <div class="pm-kpi" :style="{ '--a': hoursUsed > plan.availableHours && plan.availableHours ? '#e11d48' : '#10b981', '--i': 2 }"><span>الساعات المقدرة من المتاحة</span><strong>{{ hoursUsed }} من {{ plan.availableHours }}</strong><small>{{ hoursUsed > plan.availableHours && plan.availableHours ? 'تتجاوز الموارد المتاحة' : 'ضمن الموارد المتاحة' }}</small></div>
      <div class="pm-kpi" style="--a: #f97316; --i: 3"><span>ملاحظات صدرت</span><strong>{{ agg.findings }}</strong><small>في تقارير مهام الخطة</small></div>
    </div>

    <div class="au-grid">
      <section class="card pm-panel">
        <h2>مهام المراجعة
          <span v-if="session.can(P.engagements) && plan.status !== 'closed'" style="display: flex; gap: 6px">
            <button class="btn btn-sm" @click="openSuggest">اقتراح من تقييم المخاطر</button>
            <button class="btn btn-sm btn-primary" @click="newEng = true">+ مهمة</button>
          </span>
        </h2>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>المهمة</th><th>الجهة</th><th>الأولوية</th><th>المدة</th><th>القائد</th><th>الحالة</th></tr></thead>
            <tbody>
              <tr v-for="e in plan.engagements" :key="e.id" class="au-row" @click="router.push(`/audit/engagements/${e.id}`)">
                <td><b>{{ e.title }}</b><span class="pm-muted"><span class="au-code">{{ e.code }}</span><template v-if="e.planId !== plan.id"> · <span class="au-code">{{ plan.subs.find((s) => s.id === e.planId)?.code }}</span></template><template v-if="e.riskRefs"> · مرتبطة بـ{{ e.riskRefs }} من المخاطر</template></span></td>
                <td>{{ e.scopeLabel }}</td>
                <td><span class="au-lvl" :style="{ '--c': LEVEL_COLOR[e.priority] }">{{ e.priorityLabel }}</span></td>
                <td class="au-num" style="white-space: nowrap">{{ fmtDate(e.plannedStart) }}<span class="pm-muted">إلى {{ fmtDate(e.plannedEnd) }}</span><span class="pm-muted">{{ e.budgetHours }} ساعة</span></td>
                <td>{{ e.leadName ?? '—' }}</td>
                <td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[e.status] }">{{ e.statusLabel }}</span></td>
              </tr>
              <tr v-if="!plan.engagements.length"><td colspan="6" class="pm-empty">لا توجد مهام بعد. ابدأ باقتراح المهام من تقييم المخاطر.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="card pm-panel">
        <h2>بيانات الخطة</h2>
        <p class="au-sec">الأهداف</p><p class="au-text">{{ plan.objectives || '—' }}</p>
        <p class="au-sec">المنهجية</p><p class="au-text">{{ plan.methodology || '—' }}</p>
        <p class="au-sec">المخاطر المستهدفة</p><RiskChips :risks="plan.riskRefs" />
        <template v-if="plan.kind === 'master'">
          <p class="au-sec">الخطط الفرعية</p>
          <RouterLink v-for="s in plan.subs" :key="s.id" :to="`/audit/plans/${s.id}`" class="au-sub" style="display: block; margin-bottom: 8px">
            <span class="au-code">{{ s.code }}</span> <b>{{ s.title }}</b> <span class="pm-pill" :style="{ '--c': STATUS_COLOR[s.status] }">{{ s.statusLabel }}</span>
            <span class="pm-muted">{{ s.scopeLabel }} · {{ s.stats.total }} مهمة</span>
          </RouterLink>
          <p v-if="!plan.subs.length" class="pm-muted">لا توجد خطط فرعية</p>
        </template>
        <p class="au-sec">السجل</p>
        <ul class="au-timeline">
          <li v-for="(h, k) in [...plan.history].reverse()" :key="k"><b>{{ h.action }}</b><span class="pm-muted">{{ h.by }} · {{ fmtDateTime(h.at) }}</span><span v-if="h.note" class="pm-muted">{{ h.note }}</span></li>
        </ul>
      </section>
    </div>

    <PlanForm v-if="editPlan" :initial="plan" :masters="plan.parent ? [{ id: plan.parent.id, code: plan.parent.code, title: plan.parent.title, year: plan.year, periodFrom: plan.periodFrom, periodTo: plan.periodTo }] : []"
      @close="editPlan = false" @saved="editPlan = false; load()" />
    <EngagementForm v-if="newEng" :plans="planOpts" :plan-id="plan.id" @close="newEng = false" @saved="(id) => router.push(`/audit/engagements/${id}`)" />
    <div v-if="suggest.show" class="modal-backdrop" @click.self="suggest.show = false">
      <div class="card modal modal-wide">
        <h2>اقتراح مهام من تقييم المخاطر</h2>
        <p class="pm-muted">المجالات مرتبة حسب الأولوية. المختارة مسبقًا هي المستحقة للمراجعة وليس عليها مهمة مفتوحة. تُوزع المهام على فترة الخطة بالترتيب، ويمكن تعديل كل مهمة بعد ذلك.</p>
        <div class="au-pick" style="max-height: 380px">
          <label v-for="a in suggest.areas" :key="a.id">
            <input v-model="suggest.picked" type="checkbox" :value="a.id" />
            <span class="au-score" :style="{ '--c': LEVEL_COLOR[a.level], minWidth: '28px', height: '28px' }">{{ a.score }}</span>
            <span style="flex: 1"><b>{{ a.name }}</b> <span class="pm-muted">{{ a.code }} · {{ a.unitName ?? a.outsideLabel }} · أولوية {{ a.priority }} · {{ a.nextDue ? `القادمة ${fmtDate(a.nextDue)}` : 'لم يُراجع' }}</span></span>
            <span v-if="a.isDue" class="pm-pill" style="--c: #e11d48">مستحق</span>
          </label>
          <p v-if="!suggest.areas.length" class="pm-empty">لا توجد مجالات ضمن نطاق هذه الخطة. أضفها من «مجالات المراجعة والمخاطر».</p>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="!suggest.picked.length" @click="runSuggest">إضافة {{ suggest.picked.length }} مهمة</button><button class="btn" @click="suggest.show = false">إلغاء</button></div>
      </div>
    </div>
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
</template>
