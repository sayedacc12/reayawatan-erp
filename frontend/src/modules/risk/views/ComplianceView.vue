
<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import WorkflowBar from '../components/WorkflowBar.vue';
import { EFFECTIVENESS, fmtDate, FREQUENCIES, loadConfig, loadLookups, P, RESULTS, todayStr, type Lookups, type RiskConfig } from '../lib';
import '../../projects/projects.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const toast = useToast();
const route = useRoute();
const rows = ref<any[]>([]);
const cfg = ref<RiskConfig | null>(null);
const lk = ref<Lookups | null>(null);
const f = reactive({ authority: '', result: '' });
const sel = ref<any>(null);
const blank = () => ({ id: '', title: '', authority: '', reference: '', description: '', ownerName: '', frequency: 'annual', nextDueDate: '', riskId: '', isActive: true });
const form = reactive({ show: false, ...blank() });
const asm = reactive({ show: false, id: '', assessmentDate: todayStr(), result: 'compliant', evidence: '', gaps: '', correctiveAction: '', actionOwner: '', actionDueDate: '', actionDone: false });
async function load() {
  rows.value = await api<any[]>(`/risk/obligations?${new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][])}`);
}
onMounted(async () => {
  [cfg.value, lk.value] = await Promise.all([loadConfig().then((c) => c.config), loadLookups()]);
  await load();
  if (route.query.id) await openSel(String(route.query.id));
});
watch(f, load);
const authorities = computed(() => [...new Set([...(cfg.value?.authorities ?? []), ...rows.value.map((r) => r.authority)])]);
const rate = computed(() => {
  const a = rows.value.filter((r) => r.lastResult && r.lastResult !== 'not_applicable');
  return a.length ? Math.round((a.reduce((s, r) => s + (r.lastResult === 'compliant' ? 1 : r.lastResult === 'partial' ? 0.5 : 0), 0) / a.length) * 100) : null;
});
async function openSel(id: string) { sel.value = await api(`/risk/obligations/${id}`); }
function edit(o?: any) {
  Object.assign(form, blank(), o ? { ...o, reference: o.reference ?? '', description: o.description ?? '', ownerName: o.ownerName ?? '', nextDueDate: o.nextDueDate ?? '', riskId: o.riskId ?? '' } : {}, { show: true });
}
async function save() {
  try {
    const { show: _s, id, ...json } = form;
    const o = await api<any>(id ? `/risk/obligations/${id}` : '/risk/obligations', { method: id ? 'PATCH' : 'POST', json: { ...json, nextDueDate: json.nextDueDate || null, riskId: json.riskId || null } });
    form.show = false;
    sel.value = o;
    toast.success('حُفظ المتطلب');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function openAsm(a?: any) {
  Object.assign(asm, { show: true, id: '', assessmentDate: todayStr(), result: 'compliant', evidence: '', gaps: '', correctiveAction: '', actionOwner: '', actionDueDate: '', actionDone: false },
    a ? { ...a, evidence: a.evidence ?? '', gaps: a.gaps ?? '', correctiveAction: a.correctiveAction ?? '', actionOwner: a.actionOwner ?? '', actionDueDate: a.actionDueDate ?? '' } : {});
}
async function saveAsm() {
  try {
    const { show: _s, id, ...json } = asm;
    sel.value = await api(id ? `/risk/assessments/${id}` : `/risk/obligations/${sel.value.id}/assessments`, { method: id ? 'PATCH' : 'POST', json: { ...json, actionDueDate: json.actionDueDate || null } });
    asm.show = false;
    toast.success('حُفظ التقييم');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function afterWf(o: any) { sel.value = o; await load(); }
const gap = computed(() => asm.result === 'partial' || asm.result === 'non_compliant');
</script>

<template>
  <div>
    <section class="pm-hero rk-hero">
      <div><p class="pm-kicker">الالتزام</p><h1>سجل الالتزام والامتثال</h1>
        <p class="pm-sub">المتطلبات النظامية والتعاقدية والداخلية بمراجعها ومالكيها ودوريتها، وتقييمات امتثال معتمدة بالدليل، وإجراءات تصحيحية لكل فجوة.</p></div>
      <div class="pm-actions"><span class="pm-pill" style="--c: #10b981; background: rgba(255,255,255,.92)">نسبة الامتثال {{ rate ?? '—' }}{{ rate !== null ? '%' : '' }}</span>
        <button v-if="session.can(P.compliance)" class="btn rk-glow" @click="edit()">متطلب جديد</button></div>
    </section>
    <div class="pm-filters">
      <select v-model="f.authority" class="input"><option value="">كل الجهات والمراجع</option><option v-for="a in authorities" :key="a" :value="a">{{ a }}</option></select>
      <select v-model="f.result" class="input"><option value="">كل النتائج</option><option value="not_assessed">لم يُقيّم</option><option v-for="(r, k) in RESULTS" :key="k" :value="k">{{ r.label }}</option></select>
    </div>
    <div class="rk-grid">
      <section class="card">
        <p v-if="!rows.length" class="pm-empty">لا توجد متطلبات</p>
        <div v-else class="table-wrap"><table class="table">
          <thead><tr><th>الرمز</th><th>المتطلب</th><th>الدورية</th><th>آخر نتيجة</th><th>التقييم القادم</th></tr></thead>
          <tbody><tr v-for="o in rows" :key="o.id" class="rk-row" :style="{ opacity: o.isActive ? 1 : 0.5, background: sel?.id === o.id ? 'var(--primary-soft)' : '' }" @click="openSel(o.id)">
            <td class="rk-code">{{ o.code }}</td>
            <td style="white-space: normal; min-width: 220px"><b>{{ o.title }}</b><span class="pm-muted">{{ o.authority }}{{ o.reference ? ` · ${o.reference}` : '' }}</span></td>
            <td>{{ FREQUENCIES[o.frequency] }}</td>
            <td><span v-if="o.lastResult" class="pm-pill" :style="{ '--c': RESULTS[o.lastResult].color }">{{ RESULTS[o.lastResult].label }}</span><span v-else class="pm-muted">لم يُقيّم</span>
              <span v-if="o.openGaps" class="pm-muted" style="color: var(--danger)">{{ o.openGaps }} فجوة مفتوحة</span></td>
            <td :style="{ color: o.due ? 'var(--danger)' : '' }">{{ fmtDate(o.nextDueDate) }}</td>
          </tr></tbody>
        </table></div>
      </section>
      <div v-if="sel" style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2><span><span class="rk-code">{{ sel.code }}</span> {{ sel.title }}</span><button v-if="session.can(P.compliance)" class="btn btn-sm" @click="edit(sel)">تعديل</button></h2>
          <dl class="pm-dl">
            <div><dt>الجهة / المرجع</dt><dd>{{ sel.authority }}</dd></div><div><dt>المادة</dt><dd>{{ sel.reference ?? '—' }}</dd></div>
            <div><dt>المالك</dt><dd>{{ sel.ownerName ?? '—' }}</dd></div><div><dt>الدورية</dt><dd>{{ FREQUENCIES[sel.frequency] }}</dd></div>
          </dl>
          <p v-if="sel.description" class="rk-pre pm-muted" style="margin-top: 10px">{{ sel.description }}</p>
          <div v-if="sel.risk" class="rk-sec">خطر عدم الامتثال</div>
          <RouterLink v-if="sel.risk" :to="`/risk/register/${sel.risk.id}`" class="rk-chip"><span class="rk-code">{{ sel.risk.code }}</span>{{ sel.risk.title }}</RouterLink>
          <template v-if="sel.controls.length"><div class="rk-sec">الضوابط</div>
            <div v-for="c in sel.controls" :key="c.id" class="rk-chip" style="margin-bottom: 4px"><span class="rk-code">{{ c.code }}</span>{{ c.name }}<span class="pm-pill" :style="{ '--c': EFFECTIVENESS[c.effectiveness].color }">{{ EFFECTIVENESS[c.effectiveness].label }}</span></div></template>
        </section>
        <section class="card pm-panel">
          <h2>تقييمات الامتثال <button v-if="session.can(P.compliance) && sel.isActive" class="btn btn-sm btn-primary" @click="openAsm()">تقييم جديد</button></h2>
          <p v-if="!sel.assessments.length" class="pm-muted">لم يُقيّم بعد</p>
          <div v-for="a in sel.assessments" :key="a.id" style="border: 1px solid var(--border); border-radius: 12px; padding: 10px; margin-bottom: 10px">
            <div style="display: flex; justify-content: space-between; gap: 8px; align-items: center">
              <span><span class="pm-pill" :style="{ '--c': RESULTS[a.result].color }">{{ RESULTS[a.result].label }}</span> {{ fmtDate(a.assessmentDate) }} · {{ a.createdByName }}</span>
              <button v-if="session.can(P.compliance) && a.status !== 'in_review' && a.status !== 'rejected'" class="btn btn-sm" @click="openAsm(a)">{{ a.status === 'approved' ? 'تحديث الإجراء' : 'تعديل' }}</button>
            </div>
            <p v-if="a.evidence" class="pm-muted">الدليل: {{ a.evidence }}</p>
            <p v-if="a.gaps" class="pm-muted">الفجوة: {{ a.gaps }} · الإجراء: {{ a.correctiveAction }} ({{ a.actionOwner ?? '—' }}، {{ fmtDate(a.actionDueDate) }}) <b :style="{ color: a.actionDone ? 'var(--success)' : 'var(--danger)' }">{{ a.actionDone ? 'منجز' : 'مفتوح' }}</b></p>
            <WorkflowBar :item="a" :base="`/risk/assessments/${a.id}`" :can-submit="session.can(P.compliance)" @changed="afterWf" />
          </div>
        </section>
      </div>
    </div>

    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal modal-wide" @submit.prevent="save">
        <h2>{{ form.id ? 'تعديل المتطلب' : 'متطلب التزام جديد' }}</h2>
        <label class="field"><span>نص المتطلب</span><input v-model="form.title" class="input" /></label>
        <div class="rk-fields">
          <label class="field"><span>الجهة أو المرجع</span><input v-model="form.authority" class="input" list="rk-auth" /></label>
          <label class="field"><span>رقم المادة أو البند</span><input v-model="form.reference" class="input" /></label>
          <label class="field"><span>المالك</span><input v-model="form.ownerName" class="input" /></label>
          <label class="field"><span>دورية التقييم</span><select v-model="form.frequency" class="input"><option v-for="(l, k) in FREQUENCIES" :key="k" :value="k">{{ l }}</option></select></label>
          <label class="field"><span>التقييم القادم</span><input v-model="form.nextDueDate" type="date" class="input" /></label>
          <label class="field"><span>خطر عدم الامتثال</span><select v-model="form.riskId" class="input"><option value="">—</option><option v-for="r in lk?.risks" :key="r.id" :value="r.id">{{ r.code }} — {{ r.title }}</option></select></label>
        </div>
        <datalist id="rk-auth"><option v-for="a in authorities" :key="a" :value="a" /></datalist>
        <label class="field"><span>الوصف</span><textarea v-model="form.description" class="input" rows="3" /></label>
        <label v-if="form.id" class="check"><input v-model="form.isActive" type="checkbox" /> متطلب نشط</label>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="form.show = false">إلغاء</button></div>
      </form>
    </div>
    <div v-if="asm.show" class="modal-backdrop" @click.self="asm.show = false">
      <form class="card modal" @submit.prevent="saveAsm">
        <h2>تقييم الامتثال</h2>
        <div class="pm-grid2">
          <label class="field"><span>تاريخ التقييم</span><input v-model="asm.assessmentDate" type="date" class="input" /></label>
          <label class="field"><span>النتيجة</span><select v-model="asm.result" class="input"><option v-for="(r, k) in RESULTS" :key="k" :value="k">{{ r.label }}</option></select></label>
        </div>
        <label class="field"><span>الدليل</span><textarea v-model="asm.evidence" class="input" rows="2" /></label>
        <template v-if="gap">
          <label class="field"><span>الفجوة</span><textarea v-model="asm.gaps" class="input" rows="2" /></label>
          <label class="field"><span>الإجراء التصحيحي</span><textarea v-model="asm.correctiveAction" class="input" rows="2" /></label>
          <div class="pm-grid2">
            <label class="field"><span>المسؤول</span><input v-model="asm.actionOwner" class="input" /></label>
            <label class="field"><span>الموعد</span><input v-model="asm.actionDueDate" type="date" class="input" /></label>
          </div>
          <label class="check"><input v-model="asm.actionDone" type="checkbox" /> أُنجز الإجراء التصحيحي</label>
        </template>
        <p class="pm-muted">بعد اعتماد التقييم تُحدّث نتيجة المتطلب وموعد تقييمه القادم حسب دوريته.</p>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="asm.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
