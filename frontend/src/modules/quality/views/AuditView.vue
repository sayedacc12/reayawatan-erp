<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { AUDIT_RESULTS, P, RESULT_COLOR, STATUS_COLOR, errMsg, fmtDate, todayStr } from '../lib';
import '../../../shared/module.css';
import '../quality.css';

interface Item { clause: string; question: string; result: string | null; evidence: string | null }
interface Audit {
  id: string; code: string; title: string; scope: string; department: string; departmentName: string; clauses: string[]; leadAuditor: string; auditors: string | null;
  auditeeName: string | null; plannedDate: string; actualDate: string | null; status: string; statusLabel: string; checklist: Item[]; summary: string | null; completedByName: string | null;
  findings: Record<string, number>; ncrs: { id: string; ncrNo: number; title: string; severity: string; status: string; statusLabel: string }[];
}
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const a = ref<Audit | null>(null);
const list = ref<Item[]>([]);
const summary = ref('');
const actualDate = ref(todayStr());
async function load() {
  a.value = await api<Audit>(`/quality/audits/${props.id}`);
  list.value = a.value.checklist.map((x) => ({ ...x }));
  summary.value = a.value.summary ?? '';
  actualDate.value = a.value.actualDate ?? todayStr();
}
onMounted(load);
const open = computed(() => a.value && a.value.status !== 'completed' && a.value.status !== 'cancelled' && session.can(P.audits));
async function save(complete = false) {
  if (complete && !confirm('إنهاء المراجعة؟ ستُصدر حالة عدم مطابقة لكل نتيجة غير مطابقة، ولا يمكن تعديل النتائج بعدها.')) return;
  try {
    a.value = await api<Audit>(`/quality/audits/${props.id}/execute`, { method: 'POST', json: { checklist: list.value, summary: summary.value || null, actualDate: actualDate.value, complete } });
    list.value = a.value.checklist.map((x) => ({ ...x }));
    toast.success(complete ? `اكتملت المراجعة وصدرت ${a.value.ncrs.length} حالة عدم مطابقة` : 'حُفظت النتائج');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
async function cancel() {
  if (!confirm('إلغاء هذه المراجعة من البرنامج؟')) return;
  try {
    a.value = await api<Audit>(`/quality/audits/${props.id}/cancel`, { method: 'POST' });
  } catch (e) {
    toast.error(errMsg(e));
  }
}
const label = (v: string | null) => AUDIT_RESULTS.find((r) => r.value === v)?.label ?? 'لم تُسجل';
</script>

<template>
  <div v-if="a">
    <section class="pm-hero q-hero no-print">
      <div><p class="pm-kicker"><span class="q-code" style="background: rgba(255,255,255,.12); color: #fcd34d">{{ a.code }}</span> · {{ a.departmentName }}</p><h1>{{ a.title }}</h1>
        <p class="pm-sub">{{ a.scope }} · الموعد {{ fmtDate(a.plannedDate) }} · رئيس الفريق {{ a.leadAuditor }}<template v-if="a.auditors">، {{ a.auditors }}</template></p></div>
      <div class="pm-actions">
        <span class="pm-pill" :style="{ '--c': STATUS_COLOR[a.status], background: 'rgba(255,255,255,.9)' }">{{ a.statusLabel }}</span>
        <template v-if="open"><button class="btn q-ghost" @click="save(false)">حفظ النتائج</button><button class="btn q-glow" @click="save(true)">إنهاء المراجعة</button><button class="btn q-ghost" @click="cancel">إلغاء</button></template>
      </div>
    </section>
    <div class="pm-kpis">
      <div v-for="r in AUDIT_RESULTS.filter((x) => x.value !== 'na')" :key="r.value" class="pm-kpi" :style="{ '--a': RESULT_COLOR[r.value] }">
        <span>{{ r.label }}</span><strong>{{ (open ? list : a.checklist).filter((x) => x.result === r.value).length }}</strong>
      </div>
    </div>
    <section class="card pm-panel">
      <h2>قائمة التحقق <button v-if="open" class="btn btn-sm" @click="list.push({ clause: a.clauses[0] ?? '', question: '', result: null, evidence: null })">+ سؤال</button></h2>
      <div v-if="open" class="pm-grid2" style="max-width: 420px; margin-bottom: 12px"><label class="field"><span>تاريخ التنفيذ</span><input v-model="actualDate" type="date" class="input" /></label></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th style="width: 70px">البند</th><th>سؤال التحقق</th><th style="width: 190px">النتيجة</th><th>الدليل الموضوعي</th><th v-if="open" /></tr></thead>
        <tbody>
          <tr v-for="(x, i) in (open ? list : a.checklist)" :key="i" :style="{ borderInlineStart: `4px solid ${x.result ? RESULT_COLOR[x.result] : 'transparent'}` }">
            <td><input v-if="open" v-model="x.clause" class="input" dir="ltr" style="width: 64px" /><span v-else class="pm-tag">{{ x.clause }}</span></td>
            <td><textarea v-if="open" v-model="x.question" class="input" rows="2" /><template v-else>{{ x.question }}</template></td>
            <td>
              <select v-if="open" v-model="x.result" class="input"><option :value="null">لم تُسجل</option><option v-for="r in AUDIT_RESULTS" :key="r.value" :value="r.value">{{ r.label }}</option></select>
              <span v-else class="pm-pill" :style="{ '--c': x.result ? RESULT_COLOR[x.result] : '#94a3b8' }">{{ label(x.result) }}</span>
            </td>
            <td><textarea v-if="open" v-model="x.evidence" class="input" rows="2" :placeholder="x.result === 'minor' || x.result === 'major' ? 'إلزامي لعدم المطابقة' : ''" /><template v-else>{{ x.evidence ?? '—' }}</template></td>
            <td v-if="open"><button class="btn btn-sm" @click="list.splice(i, 1)">✕</button></td>
          </tr>
        </tbody>
      </table></div>
      <label class="field" style="margin-top: 12px"><span>ملخص المراجعة والاستنتاج</span>
        <textarea v-if="open" v-model="summary" class="input" rows="3" /><p v-else class="q-pre">{{ a.summary ?? '—' }}</p></label>
      <p v-if="a.completedByName" class="pm-muted">أنهاها {{ a.completedByName }} بتاريخ {{ fmtDate(a.actualDate) }}</p>
    </section>
    <section v-if="a.ncrs.length" class="card pm-panel" style="margin-top: 16px">
      <h2>حالات عدم المطابقة الصادرة عن المراجعة</h2>
      <div class="q-alerts">
        <RouterLink v-for="n in a.ncrs" :key="n.id" :to="`/quality/ncr/${n.id}`" class="q-alert" :style="{ '--c': n.severity === 'major' ? '#ef4444' : '#f59e0b' }">
          <span class="dot" /><span style="flex: 1">{{ n.title }}<span class="pm-muted">{{ n.severity === 'major' ? 'جسيمة' : 'بسيطة' }}</span></span>
          <span class="pm-pill" :style="{ '--c': STATUS_COLOR[n.status] }">{{ n.statusLabel }}</span>
        </RouterLink>
      </div>
    </section>
  </div>
</template>
