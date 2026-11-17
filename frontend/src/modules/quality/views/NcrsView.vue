<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { ISO_CLAUSES, NCR_SOURCES, P, STATUS_COLOR, errMsg, fmtDate, loadSettings, todayStr, type QSettings } from '../lib';
import '../../projects/projects.css';
import '../quality.css';

interface Ncr {
  id: string; code: string; source: string; sourceLabel: string; sourceRef: string | null; title: string; clause: string | null; severity: string; department: string;
  departmentName: string; detectedDate: string; detectedByName: string; dueDate: string | null; status: string; statusLabel: string; overdue: boolean;
  overdueActions: number; actions: number; actionsDone: number; daysOpen: number;
}
const session = useSession();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const rows = ref<Ncr[]>([]);
const settings = ref<QSettings | null>(null);
const f = reactive({ status: 'active', source: '', department: '' });
async function load() {
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v && v !== 'all') as [string, string][]);
  rows.value = await api<Ncr[]>(`/quality/ncrs?${q}`);
}
onMounted(async () => {
  settings.value = await loadSettings();
  await load();
});
watch(f, load);
const STAGES = [
  { v: 'active', l: 'المفتوحة' }, { v: 'open', l: 'بانتظار التصحيح' }, { v: 'analysis', l: 'تحليل السبب' }, { v: 'action', l: 'تنفيذ الإجراءات' },
  { v: 'verification', l: 'التحقق من الفاعلية' }, { v: 'closed', l: 'المغلقة' }, { v: 'all', l: 'الكل' },
];
const form = reactive({ show: route.query.new === '1', source: 'process', sourceRef: '', title: '', description: '', clause: '', severity: 'minor', department: 'QMS', detectedDate: todayStr(), dueDate: '' });
async function create() {
  try {
    const n = await api<{ id: string }>('/quality/ncrs', {
      method: 'POST', json: { source: form.source, sourceRef: form.sourceRef || null, title: form.title, description: form.description, clause: form.clause || null, severity: form.severity, department: form.department, detectedDate: form.detectedDate, dueDate: form.dueDate || null },
    });
    toast.success('سُجلت الحالة، ابدأ بالتصحيح الفوري');
    router.push(`/quality/ncr/${n.id}`);
  } catch (e) {
    toast.error(errMsg(e));
  }
}
</script>

<template>
  <div>
    <section class="pm-hero q-hero">
      <div><p class="pm-kicker">البندان 8.7 و10.2</p><h1>عدم المطابقة والإجراءات التصحيحية</h1>
        <p class="pm-sub">تسجيل الحالة ← التصحيح الفوري ← تحليل السبب الجذري ← الإجراءات التصحيحية ← التحقق من الفاعلية والإغلاق.</p></div>
      <div class="pm-actions"><button v-if="session.can(P.ncr)" class="btn q-glow" @click="form.show = true">تسجيل حالة</button></div>
    </section>
    <section class="card pm-panel">
      <div class="q-tabs"><button v-for="s in STAGES" :key="s.v" :class="['q-tab', { on: f.status === s.v }]" @click="f.status = s.v">{{ s.l }}</button></div>
      <div class="q-toolbar">
        <select v-model="f.source" class="input"><option value="">كل المصادر</option><option v-for="s in NCR_SOURCES" :key="s.value" :value="s.value">{{ s.label }}</option></select>
        <select v-model="f.department" class="input"><option value="">كل الإدارات</option><option v-for="d in settings?.departments" :key="d.code" :value="d.code">{{ d.code }} · {{ d.name }}</option></select>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الرقم</th><th>الحالة</th><th>المصدر</th><th>الإدارة</th><th>الجسامة</th><th>الاكتشاف / الموعد</th><th>الإجراءات</th><th>المرحلة</th></tr></thead>
        <tbody>
          <tr v-for="n in rows" :key="n.id" class="q-row" @click="router.push(`/quality/ncr/${n.id}`)">
            <td><span class="q-code">{{ n.code }}</span></td>
            <td><b>{{ n.title }}</b><span class="pm-muted">{{ n.clause ? `البند ${n.clause} · ` : '' }}سجّلها {{ n.detectedByName }}</span></td>
            <td>{{ n.sourceLabel }}<span v-if="n.sourceRef" class="pm-muted">{{ n.sourceRef }}</span></td>
            <td><span class="pm-tag">{{ n.department }}</span></td>
            <td><span class="pm-pill" :style="{ '--c': n.severity === 'major' ? '#ef4444' : '#f59e0b' }">{{ n.severity === 'major' ? 'جسيمة' : 'بسيطة' }}</span></td>
            <td class="q-num">{{ fmtDate(n.detectedDate) }}<span class="pm-muted" :style="{ color: n.overdue ? 'var(--danger)' : '' }">{{ n.status === 'closed' ? `أُغلقت بعد ${n.daysOpen} يوم` : `الإغلاق ${fmtDate(n.dueDate)}` }}</span></td>
            <td class="q-num">{{ n.actionsDone }}/{{ n.actions }}<span v-if="n.overdueActions" class="pm-muted" style="color: var(--danger)">{{ n.overdueActions }} متأخر</span></td>
            <td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[n.status] }">{{ n.statusLabel }}</span></td>
          </tr>
          <tr v-if="!rows.length"><td colspan="8" class="pm-empty">لا توجد حالات</td></tr>
        </tbody>
      </table></div>
    </section>
    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" style="max-width: 620px" @submit.prevent="create">
        <h2>تسجيل حالة عدم مطابقة</h2>
        <label class="field"><span>العنوان</span><input v-model="form.title" class="input" required /></label>
        <label class="field"><span>وصف عدم المطابقة (ماذا حدث، وأين، والمتطلب المخالف)</span><textarea v-model="form.description" class="input" rows="4" required /></label>
        <div class="q-fields">
          <label class="field"><span>المصدر</span><select v-model="form.source" class="input"><option v-for="s in NCR_SOURCES" :key="s.value" :value="s.value">{{ s.label }}</option></select></label>
          <label class="field"><span>مرجع المصدر</span><input v-model="form.sourceRef" class="input" placeholder="اختياري" /></label>
          <label class="field"><span>الإدارة المعنية</span><select v-model="form.department" class="input"><option v-for="d in settings?.departments" :key="d.code" :value="d.code">{{ d.code }} · {{ d.name }}</option></select></label>
          <label class="field"><span>الجسامة</span><select v-model="form.severity" class="input"><option value="minor">بسيطة</option><option value="major">جسيمة</option></select></label>
          <label class="field"><span>البند</span><select v-model="form.clause" class="input"><option value="">—</option><option v-for="c in ISO_CLAUSES" :key="c" :value="c">{{ c }}</option></select></label>
          <label class="field"><span>تاريخ الاكتشاف</span><input v-model="form.detectedDate" type="date" class="input" required /></label>
          <label class="field"><span>موعد الإغلاق</span><input v-model="form.dueDate" type="date" class="input" /><small class="pm-muted">افتراضيًا بعد {{ settings?.ncrDays }} يومًا</small></label>
        </div>
        <div class="modal-actions"><button class="btn btn-primary">تسجيل</button><button type="button" class="btn" @click="form.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
