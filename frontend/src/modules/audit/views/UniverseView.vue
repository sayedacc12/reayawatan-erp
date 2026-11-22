<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import RiskChips from '../components/RiskChips.vue';
import RiskPicker from '../components/RiskPicker.vue';
import { CATEGORIES, CONTROLS, LEVEL_COLOR, LEVELS, P, fmtDate, levelOf, loadLookups, unitOptions, type Area, type Lookups, type RiskRef } from '../lib';
import '../../../shared/module.css';
import '../audit.css';

const session = useSession();
const toast = useToast();
const rows = ref<Area[]>([]);
const lookups = ref<Lookups | null>(null);
const error = ref('');
const filter = reactive({ q: '', level: '', due: false });
async function load() {
  try {
    rows.value = await api<Area[]>('/audit/areas');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await load();
  lookups.value = await loadLookups().catch(() => null);
});
const shown = computed(() => rows.value.filter((a) => (!filter.q || `${a.code} ${a.name} ${a.unitName ?? ''} ${a.outsideLabel ?? ''}`.includes(filter.q))
  && (!filter.level || a.level === filter.level) && (!filter.due || (a.isDue && a.isActive))));
const units = computed(() => unitOptions(lookups.value));

const editing = ref<Area | null>(null);
const form = reactive({
  show: false, code: '', name: '', category: 'operational', scopeType: 'unit' as 'unit' | 'outside', unitId: '', outsideLabel: '', description: '',
  likelihood: 3, impact: 3, controlRating: 'unknown', lastAuditDate: '', isActive: true, riskRefs: [] as RiskRef[],
});
const formScore = computed(() => form.likelihood * form.impact);
const formLevel = computed(() => levelOf(lookups.value?.riskBands, formScore.value));
function openNew() {
  editing.value = null;
  Object.assign(form, { show: true, code: '', name: '', category: 'operational', scopeType: 'unit', unitId: '', outsideLabel: '', description: '', likelihood: 3, impact: 3, controlRating: 'unknown', lastAuditDate: '', isActive: true, riskRefs: [] });
}
function openEdit(a: Area) {
  editing.value = a;
  Object.assign(form, {
    show: true, code: a.code, name: a.name, category: a.category, scopeType: a.scopeType, unitId: a.unitId ?? '', outsideLabel: a.outsideLabel ?? '', description: a.description ?? '',
    likelihood: a.likelihood, impact: a.impact, controlRating: a.controlRating, lastAuditDate: a.lastAuditDate ?? '', isActive: a.isActive,
    riskRefs: a.riskRefs.map((r) => ({ id: r.id, code: r.code, title: r.title, level: r.level, score: r.score })),
  });
}
/** أخذ الاحتمال والأثر من أعلى خطر مرتبط في سجل المخاطر */
function fromRegister() {
  const linked = (lookups.value?.risks ?? []).filter((r) => form.riskRefs.some((x) => x.id === r.id) && r.likelihood && r.impact);
  if (!linked.length) return toast.error('اربط خطرًا له تقييم احتمال وأثر في سجل المخاطر أولًا');
  const top = linked.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  form.likelihood = top.likelihood!;
  form.impact = top.impact!;
  toast.success(`أُخذ التقييم من ${top.code}`);
}
async function save() {
  try {
    const body = {
      code: form.code, name: form.name, category: form.category, scopeType: form.scopeType, unitId: form.scopeType === 'unit' ? form.unitId || null : null,
      outsideLabel: form.scopeType === 'outside' ? form.outsideLabel : null, description: form.description || null, likelihood: form.likelihood, impact: form.impact,
      controlRating: form.controlRating, lastAuditDate: form.lastAuditDate || null, isActive: form.isActive, riskRefs: form.riskRefs,
    };
    if (editing.value) await api(`/audit/areas/${editing.value.id}`, { method: 'PATCH', json: body });
    else await api('/audit/areas', { method: 'POST', json: body });
    form.show = false;
    toast.success('حُفظ المجال');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove() {
  if (!editing.value || !confirm('حذف المجال؟')) return;
  try {
    await api(`/audit/areas/${editing.value.id}`, { method: 'DELETE' });
    form.show = false;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <section class="pm-hero au-hero">
      <div><p class="pm-kicker">التخطيط المبني على المخاطر</p><h1>مجالات المراجعة وتقييم مخاطرها</h1>
        <p class="pm-sub">كل مجال قابل للمراجعة داخل الهيكل التنظيمي أو خارجه، بدرجة خطر (الاحتمال × الأثر) وتقييم للضوابط، وتكرار مراجعة حسب مستواه. الأعلى أولوية يظهر أولًا ويُقترح للخطة.</p></div>
      <div class="pm-actions"><button v-if="session.can(P.universe)" class="btn au-glow" @click="openNew">مجال جديد</button></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="au-toolbar">
      <input v-model="filter.q" class="input grow" placeholder="ابحث بالرمز أو الاسم أو الجهة" />
      <select v-model="filter.level" class="input"><option value="">كل المستويات</option><option v-for="l in LEVELS" :key="l.value" :value="l.value">{{ l.label }}</option></select>
      <label class="check"><input v-model="filter.due" type="checkbox" /> المستحقة للمراجعة فقط</label>
    </div>
    <section class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الدرجة</th><th>المجال</th><th>الجهة</th><th>المستوى</th><th>الضوابط</th><th>الأولوية</th><th>آخر مراجعة</th><th>المخاطر المرتبطة</th></tr></thead>
          <tbody>
            <tr v-for="a in shown" :key="a.id" :class="{ 'au-row': session.can(P.universe) }" :style="{ opacity: a.isActive ? 1 : 0.5 }" @click="session.can(P.universe) && openEdit(a)">
              <td><span class="au-score" :style="{ '--c': LEVEL_COLOR[a.level] }" :title="`الاحتمال ${a.likelihood} × الأثر ${a.impact}`">{{ a.score }}</span></td>
              <td><b>{{ a.name }}</b><span class="pm-muted"><span class="au-code">{{ a.code }}</span> · {{ a.categoryLabel }}{{ a.isActive ? '' : ' · موقوف' }}</span></td>
              <td>{{ a.unitName ?? a.outsideLabel }}<span class="pm-muted">{{ a.scopeType === 'unit' ? 'من الهيكل' : 'خارج الهيكل' }}</span></td>
              <td><span class="au-lvl" :style="{ '--c': LEVEL_COLOR[a.level] }">{{ a.levelLabel }}</span><span class="pm-muted">كل {{ a.frequencyMonths }} شهرًا</span></td>
              <td>{{ a.controlLabel }}</td>
              <td class="au-num"><b>{{ a.priority }}</b></td>
              <td>{{ fmtDate(a.lastAuditDate) }}<span class="pm-muted" :style="{ color: a.isDue ? 'var(--danger)' : '' }">{{ a.nextDue ? `القادمة ${fmtDate(a.nextDue)}` : 'لم يُراجع' }}{{ a.isDue ? ' · مستحق' : '' }}</span></td>
              <td style="max-width: 280px"><RiskChips :risks="a.riskRefs" empty="—" /></td>
            </tr>
            <tr v-if="!shown.length"><td colspan="8" class="pm-empty">لا توجد مجالات</td></tr>
          </tbody>
        </table>
      </div>
      <p class="pm-muted" style="margin-top: 10px">الأولوية = درجة الخطر × أثر الضوابط (قوية 0.8، مقبولة 1، غير مقيّمة 1.1، ضعيفة 1.25). المجال «مستحق» إذا لم يُراجع أو يحين موعد مراجعته خلال 90 يومًا.</p>
    </section>

    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal modal-wide" @submit.prevent="save">
        <h2>{{ editing ? 'تعديل مجال المراجعة' : 'مجال مراجعة جديد' }}</h2>
        <div class="pm-grid2">
          <label class="field"><span>الرمز</span><input v-model="form.code" class="input" required placeholder="FIN-01" /></label>
          <label class="field"><span>التصنيف</span><select v-model="form.category" class="input"><option v-for="c in CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</option></select></label>
        </div>
        <label class="field"><span>اسم المجال</span><input v-model="form.name" class="input" required /></label>
        <div class="field"><span>الجهة</span>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <div class="au-seg"><button type="button" :class="{ on: form.scopeType === 'unit' }" @click="form.scopeType = 'unit'">من الهيكل</button><button type="button" :class="{ on: form.scopeType === 'outside' }" @click="form.scopeType = 'outside'">خارج الهيكل</button></div>
            <select v-if="form.scopeType === 'unit'" v-model="form.unitId" class="input" style="flex: 1; min-width: 200px" required><option value="" disabled>اختر الوحدة</option><option v-for="u in units" :key="u.id" :value="u.id">{{ u.label }}</option></select>
            <input v-else v-model="form.outsideLabel" class="input" style="flex: 1; min-width: 200px" placeholder="مثل: الشركاء المنفذون" required />
          </div>
        </div>
        <label class="field"><span>الوصف والنطاق</span><textarea v-model="form.description" class="input" rows="2" /></label>
        <p class="au-sec">تقييم الخطر</p>
        <div style="display: flex; gap: 20px; flex-wrap: wrap; align-items: center">
          <div><span class="pm-muted">الاحتمال</span><div class="au-dots"><button v-for="n in 5" :key="n" type="button" :class="{ on: form.likelihood === n }" :style="{ '--c': '#6366f1' }" @click="form.likelihood = n">{{ n }}</button></div></div>
          <div><span class="pm-muted">الأثر</span><div class="au-dots"><button v-for="n in 5" :key="n" type="button" :class="{ on: form.impact === n }" :style="{ '--c': '#e11d48' }" @click="form.impact = n">{{ n }}</button></div></div>
          <div style="text-align: center"><span class="au-score" :style="{ '--c': LEVEL_COLOR[formLevel] }">{{ formScore }}</span><div class="pm-muted">{{ LEVELS.find((l) => l.value === formLevel)?.label }}</div></div>
          <label class="field" style="margin: 0"><span>تقييم الضوابط</span><select v-model="form.controlRating" class="input"><option v-for="c in CONTROLS" :key="c.value" :value="c.value">{{ c.label }}</option></select></label>
          <label class="field" style="margin: 0"><span>تاريخ آخر مراجعة</span><input v-model="form.lastAuditDate" type="date" class="input" /></label>
        </div>
        <p class="au-sec">الربط بسجل المخاطر <button v-if="lookups?.registerAvailable" type="button" class="btn btn-sm" @click="fromRegister">أخذ التقييم من الخطر الأعلى</button></p>
        <RiskPicker v-model="form.riskRefs" :lookups="lookups" :unit-id="form.scopeType === 'unit' ? form.unitId : null" />
        <label v-if="editing" class="check" style="margin-top: 10px"><input v-model="form.isActive" type="checkbox" /> مجال نشط</label>
        <div class="modal-actions">
          <button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="form.show = false">إلغاء</button>
          <button v-if="editing" type="button" class="btn btn-danger" style="margin-inline-start: auto" @click="remove">حذف</button>
        </div>
      </form>
    </div>
  </div>
</template>
