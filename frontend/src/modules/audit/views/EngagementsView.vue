<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import EngagementForm from '../components/EngagementForm.vue';
import { ENG_STEPS, LEVEL_COLOR, P, STATUS_COLOR, fmtDate, thisYear, type EngRow, type Plan } from '../lib';
import '../../../shared/module.css';
import '../audit.css';

const session = useSession();
const router = useRouter();
const rows = ref<EngRow[]>([]);
const plans = ref<(Plan & { subs: Plan[] })[]>([]);
const error = ref('');
const f = reactive({ year: thisYear(), status: '', mine: false, q: '' });
const showNew = ref(false);
async function load() {
  try {
    const qs = new URLSearchParams({ year: String(f.year), ...(f.status ? { status: f.status } : {}), ...(f.mine ? { mine: '1' } : {}) });
    [rows.value, plans.value] = await Promise.all([api<EngRow[]>(`/audit/engagements?${qs}`), api<(Plan & { subs: Plan[] })[]>(`/audit/plans?year=${f.year}`)]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(() => [f.year, f.status, f.mine], load);
const shown = computed(() => rows.value.filter((r) => !f.q || `${r.code} ${r.title} ${r.scopeLabel} ${r.leadName ?? ''}`.includes(f.q)));
const planOpts = computed(() => plans.value.flatMap((m) => [m, ...m.subs]).filter((p) => p.status !== 'closed').map((p) => ({ id: p.id, code: p.code, title: p.title, periodFrom: p.periodFrom, periodTo: p.periodTo })));
const count = (s: string) => rows.value.filter((r) => r.status === s).length;
</script>

<template>
  <div>
    <section class="pm-hero au-hero">
      <div><p class="pm-kicker">التنفيذ</p><h1>مهام المراجعة</h1>
        <p class="pm-sub">كل مهمة موزعة على قائد وفريق، تُنفَّذ ببرنامج عمل من بنود المراجعة، وتنتهي بتقرير تتحول توصياته إلى مهام متابعة مزمنة للجهات المسؤولة.</p></div>
      <div class="pm-actions"><button v-if="session.can(P.engagements) && planOpts.length" class="btn au-glow" @click="showNew = true">مهمة جديدة</button></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="pm-tabs">
      <button :class="['pm-tab', { on: !f.status }]" @click="f.status = ''">الكل <b>{{ rows.length }}</b></button>
      <button v-for="s in ENG_STEPS" :key="s.value" :class="['pm-tab', { on: f.status === s.value }]" @click="f.status = s.value">{{ s.label }}<b v-if="!f.status">{{ count(s.value) }}</b></button>
    </div>
    <div class="au-toolbar">
      <input v-model="f.q" class="input grow" placeholder="ابحث بالرمز أو العنوان أو الجهة أو القائد" />
      <select v-model.number="f.year" class="input"><option v-for="y in [thisYear() - 1, thisYear(), thisYear() + 1]" :key="y" :value="y">{{ y }}</option></select>
      <label class="check"><input v-model="f.mine" type="checkbox" /> المسندة إليّ</label>
    </div>
    <section class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>المهمة</th><th>الجهة</th><th>الأولوية</th><th>المدة المخططة</th><th>الفريق</th><th>إنجاز البرنامج</th><th>التوصيات</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="e in shown" :key="e.id" class="au-row" @click="router.push(`/audit/engagements/${e.id}`)">
              <td><b>{{ e.title }}</b><span class="pm-muted"><span class="au-code">{{ e.code }}</span> · {{ e.planCode }}</span></td>
              <td>{{ e.scopeLabel }}<span class="pm-muted">{{ e.scopeType === 'outside' ? 'خارج الهيكل' : '' }}</span></td>
              <td><span class="au-lvl" :style="{ '--c': LEVEL_COLOR[e.priority] }">{{ e.priorityLabel }}</span></td>
              <td class="au-num">{{ fmtDate(e.plannedStart) }}<span class="pm-muted" :style="{ color: e.late ? 'var(--danger)' : '' }">إلى {{ fmtDate(e.plannedEnd) }}{{ e.late ? ' · متأخرة' : '' }}</span></td>
              <td>{{ e.leadName ?? '—' }}<span class="pm-muted">{{ e.team.map((t) => t.name).join('، ') }}</span></td>
              <td style="min-width: 120px"><div class="au-track"><i :style="{ width: e.progress + '%' }" /></div><span class="pm-muted">{{ e.tested }} من {{ e.items }} بند · {{ e.findings }} ملاحظة</span></td>
              <td><template v-if="e.actions.total">{{ e.actions.closed }} من {{ e.actions.total }} مغلقة<span v-if="e.actions.overdue" class="pm-muted" style="color: var(--danger)">{{ e.actions.overdue }} متأخرة</span></template><span v-else class="pm-muted">—</span></td>
              <td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[e.status] }">{{ e.statusLabel }}</span></td>
            </tr>
            <tr v-if="!shown.length"><td colspan="8" class="pm-empty">لا توجد مهام</td></tr>
          </tbody>
        </table>
      </div>
    </section>
    <EngagementForm v-if="showNew" :plans="planOpts" @close="showNew = false" @saved="(id) => router.push(`/audit/engagements/${id}`)" />
  </div>
</template>
