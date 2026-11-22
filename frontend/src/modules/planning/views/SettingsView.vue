<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { errMsg, loadConfig, loadLookups, money, type ConfigPayload, type Lookups, type PlanningConfig } from '../lib';
import '../../../shared/module.css';
import '../../risk/risk.css';
import '../planning.css';
import StarterSettings from '../../../components/StarterSettings.vue';

type Tab = 'structure' | 'lists' | 'fields' | 'routes' | 'scope' | 'permissions';
const TABS: Tab[] = ['structure', 'lists', 'fields', 'routes', 'scope', 'permissions'];
const toast = useToast();
const route = useRoute();
const tab = ref<Tab>((TABS.includes(route.query.tab as Tab) ? route.query.tab : 'structure') as Tab);
const payload = ref<ConfigPayload | null>(null);
const cfg = ref<PlanningConfig | null>(null);
const lookups = ref<Lookups | null>(null);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 36).toString(36)}`;
onMounted(async () => {
  const [p, l] = await Promise.all([loadConfig(true), loadLookups()]);
  payload.value = p;
  cfg.value = clone(p.config);
  lookups.value = l;
});
const dirty = computed(() => !!cfg.value && JSON.stringify(cfg.value) !== JSON.stringify(payload.value?.config));
async function save() {
  try {
    await api('/planning/config', { method: 'PUT', json: { config: cfg.value } });
    const p = await loadConfig(true);
    payload.value = p;
    cfg.value = clone(p.config);
    toast.success('حُفظت الإعدادات');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
function reset(part: keyof PlanningConfig) {
  if (!cfg.value || !payload.value || !confirm('استعادة القيم المقترحة لهذا الجزء؟')) return;
  (cfg.value as unknown as Record<string, unknown>)[part] = clone(payload.value.defaults[part]);
}
function addLevel(list: PlanningConfig['strategicLevels']) {
  const used = new Set(list.map((l) => l.prefix));
  list.push({ key: uid('l'), name: '', prefix: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((c) => !used.has(c)) ?? 'Z' });
}
const unitName = (id: string | null) => lookups.value?.units.find((u) => u.id === id)?.name ?? 'كل الإدارات';
const KIND_OPT = { any: 'كل الخطط', strategic: 'الاستراتيجية', operational: 'التشغيلية', budget: 'الموازنات التقديرية', transfer: 'مناقلات الموازنة' } as const;
</script>

<template>
  <div v-if="cfg && payload">
    <div class="page-head">
      <div><h1>إعدادات التخطيط والموازنات</h1>
        <p class="muted">مستويات هيكل الخطط، والقوائم وحدود الألوان، والحقول الإضافية، ومسارات الاعتماد، والصلاحيات. أي تعديل هنا ينطبق على الخطط الجديدة، والخطط القائمة تحتفظ بهيكلها.</p></div>
      <button v-if="tab !== 'permissions' && tab !== 'scope'" class="btn btn-primary" :disabled="!dirty" @click="save">حفظ الإعدادات</button>
    </div>
    <StarterSettings module="planning" />
    <div class="rk-tabs pl-tabs">
      <button :class="['rk-tab', { on: tab === 'structure' }]" @click="tab = 'structure'">مستويات الهيكل</button>
      <button :class="['rk-tab', { on: tab === 'lists' }]" @click="tab = 'lists'">القوائم والحدود</button>
      <button :class="['rk-tab', { on: tab === 'fields' }]" @click="tab = 'fields'">حقول إضافية</button>
      <button :class="['rk-tab', { on: tab === 'routes' }]" @click="tab = 'routes'">مسارات الاعتماد</button>
      <button :class="['rk-tab', { on: tab === 'scope' }]" @click="tab = 'scope'">ما يمكن ضبطه</button>
      <button :class="['rk-tab', { on: tab === 'permissions' }]" @click="tab = 'permissions'">الصلاحيات</button>
    </div>

    <div v-if="tab === 'structure'" class="rk-grid" style="grid-template-columns: 1fr 1fr">
      <section v-for="part in (['strategicLevels', 'operationalLevels'] as const)" :key="part" class="card pm-panel">
        <h2>{{ part === 'strategicLevels' ? 'الخطة الاستراتيجية' : 'الخطة التشغيلية' }} <button class="btn btn-sm" @click="reset(part)">القيم المقترحة</button></h2>
        <div class="rk-wf" style="margin-bottom: 10px">
          <template v-for="(l, i) in cfg[part]" :key="l.key"><span v-if="i" class="ln" /><span class="st"><i>{{ i + 1 }}</i>{{ l.name || '—' }}</span></template>
        </div>
        <div v-for="(l, i) in cfg[part]" :key="l.key" style="display: flex; gap: 6px; margin-bottom: 6px">
          <input v-model="l.name" class="input" placeholder="اسم المستوى" />
          <input v-model="l.prefix" class="input" maxlength="3" style="width: 70px; direction: ltr" @input="l.prefix = l.prefix.toUpperCase()" />
          <button class="btn btn-sm" :disabled="cfg[part].length === 1" @click="cfg[part].splice(i, 1)">✕</button>
        </div>
        <button class="btn btn-sm" :disabled="cfg[part].length >= 6" @click="addLevel(cfg[part])">+ مستوى</button>
        <p class="pm-muted" style="margin-top: 10px">الرمز حروف إنجليزية كبيرة (1 إلى 3) تُكوّن أكواد العناصر، مثل P1 ثم P1-G2 ثم P1-G2-I1. لكل خطة أن تعدل مستوياتها عند إنشائها.</p>
      </section>
    </div>

    <div v-else-if="tab === 'lists'" class="rk-grid" style="grid-template-columns: 1fr 1fr">
      <section class="card pm-panel">
        <h2>أنواع العلاقات بين العناصر <button class="btn btn-sm" @click="reset('relationTypes')">المقترحة</button></h2>
        <div v-for="(r, i) in cfg.relationTypes" :key="r.code" style="display: flex; gap: 6px; margin-bottom: 6px">
          <input v-model="r.name" class="input" placeholder="مثل: يسهم في تحقيق" /><button class="btn btn-sm" :disabled="cfg.relationTypes.length === 1" @click="cfg.relationTypes.splice(i, 1)">✕</button>
        </div>
        <button class="btn btn-sm" @click="cfg.relationTypes.push({ code: uid('r'), name: '' })">+ نوع</button>
      </section>
      <section class="card pm-panel">
        <h2>وحدات قياس المؤشرات <button class="btn btn-sm" @click="reset('kpiUnits')">المقترحة</button></h2>
        <div class="pl-flex">
          <span v-for="(u, i) in cfg.kpiUnits" :key="i" class="pl-flex" style="gap: 4px"><input v-model="cfg.kpiUnits[i]" class="input" style="width: 110px" /><button class="btn btn-sm" @click="cfg.kpiUnits.splice(i, 1)">✕</button></span>
          <button class="btn btn-sm" @click="cfg.kpiUnits.push('')">+ وحدة</button>
        </div>
      </section>
      <section class="card pm-panel">
        <h2>ألوان تحقق المؤشرات <button class="btn btn-sm" @click="reset('thresholds')">المقترحة</button></h2>
        <div class="rk-fields">
          <label class="field"><span>أخضر (محقق) من نسبة %</span><input v-model.number="cfg.thresholds.green" type="number" min="1" max="150" class="input" /></label>
          <label class="field"><span>أصفر (قريب) من نسبة %</span><input v-model.number="cfg.thresholds.amber" type="number" min="1" max="150" class="input" /></label>
        </div>
        <div class="pm-legend"><span style="--c: #10b981">من {{ cfg.thresholds.green }}%</span><span style="--c: #f59e0b">{{ cfg.thresholds.amber }}% إلى {{ cfg.thresholds.green }}%</span><span style="--c: #ef4444">أقل من {{ cfg.thresholds.amber }}%</span></div>
      </section>
      <section class="card pm-panel">
        <h2>هامش التأخر المسموح <button class="btn btn-sm" @click="reset('delayTolerance')">المقترح</button></h2>
        <label class="field"><span>نقاط مئوية بين الإنجاز المخطط والفعلي</span><input v-model.number="cfg.delayTolerance" type="number" min="0" max="50" class="input" style="width: 120px" /></label>
        <p class="pm-muted">إذا قلّ الإنجاز الفعلي عن المخطط بأقل من هذا الهامش فالعنصر «حسب الخطة»، وحتى ضعفه «في خطر»، وأكثر من ذلك «متأخر». الإنجاز المخطط يُحسب خطيًا بين تاريخي البداية والنهاية.</p>
      </section>
    </div>

    <section v-else-if="tab === 'fields'" class="card pm-panel">
      <h2>حقول إضافية لعناصر الخطط</h2>
      <p class="pm-muted">حقول تضيفها الشركة لكل عنصر (مثل الفئة المستهدفة أو رقم المبادرة في الخطة الوطنية) دون تطوير.</p>
      <p v-if="!cfg.customFields.length" class="pm-empty">لا توجد حقول إضافية</p>
      <div v-else class="table-wrap"><table class="table">
        <thead><tr><th>اسم الحقل</th><th>النوع</th><th>يظهر في</th><th>خيارات القائمة (افصل بفاصلة)</th><th /></tr></thead>
        <tbody><tr v-for="(f, i) in cfg.customFields" :key="f.key">
          <td><input v-model="f.label" class="input" /></td>
          <td><select v-model="f.type" class="input"><option value="text">نص</option><option value="number">رقم</option><option value="date">تاريخ</option><option value="select">قائمة</option></select></td>
          <td><select v-model="f.appliesTo" class="input"><option value="all">كل الخطط</option><option value="strategic">الاستراتيجية</option><option value="operational">التشغيلية</option></select></td>
          <td><input v-if="f.type === 'select'" :value="f.options.join('، ')" class="input" @change="f.options = ($event.target as HTMLInputElement).value.split(/[،,]/).map((o) => o.trim()).filter(Boolean)" /></td>
          <td><button class="btn btn-sm" @click="cfg.customFields.splice(i, 1)">✕</button></td>
        </tr></tbody>
      </table></div>
      <button class="btn btn-sm" style="margin-top: 10px" @click="cfg.customFields.push({ key: uid('f'), label: '', type: 'text', options: [], appliesTo: 'all' })">+ حقل</button>
    </section>

    <div v-else-if="tab === 'routes'" class="rk-grid" style="grid-template-columns: 1fr 1fr">
      <p class="rk-note wide">عند رفع الخطة يُختار المسار الأدق انطباقًا: حسب نوع الخطة، ثم الإدارة، ثم أعلى حد تكلفة تبلغه الخطة. إذا حددت دورًا للمرحلة فلا يقرر فيها إلا من يحمله، وإلا فمن لديه صلاحية اعتماد الخطط. المسار بلا مراحل يعني اعتمادًا مباشرًا.
        <button class="btn btn-sm" @click="reset('routes')">المسارات المقترحة</button></p>
      <section v-for="(r, ri) in cfg.routes" :key="r.key" class="card pm-panel">
        <h2><input v-model="r.name" class="input" placeholder="اسم المسار" /><button class="btn btn-sm" :disabled="cfg.routes.length === 1" @click="cfg.routes.splice(ri, 1)">✕</button></h2>
        <div class="rk-fields">
          <label class="field"><span>نوع الخطة</span><select v-model="r.planKind" class="input"><option v-for="(l, k) in KIND_OPT" :key="k" :value="k">{{ l }}</option></select></label>
          <label class="field"><span>الإدارة</span><select v-model="r.unitId" class="input"><option :value="null">كل الإدارات</option><option v-for="u in lookups?.units ?? []" :key="u.id" :value="u.id">{{ u.name }}</option></select></label>
          <label class="field"><span>عندما تبلغ التكلفة (ر.س)</span><input v-model.number="r.minCost" type="number" min="0" class="input" placeholder="أي تكلفة" @change="r.minCost = (r.minCost as unknown) === '' ? null : r.minCost" /></label>
        </div>
        <p class="pm-muted">{{ KIND_OPT[r.planKind] }} · {{ unitName(r.unitId) }}{{ r.minCost ? ` · من ${money(r.minCost)}` : '' }}</p>
        <div class="rk-wf" style="margin-bottom: 10px">
          <template v-for="(s, i) in r.stages" :key="i"><span v-if="i" class="ln" /><span class="st"><i>{{ i + 1 }}</i>{{ s.name || '—' }}</span></template>
          <span v-if="!r.stages.length" class="pm-muted">اعتماد مباشر</span>
        </div>
        <div v-for="(s, i) in r.stages" :key="i" style="display: flex; gap: 6px; margin-bottom: 6px">
          <b style="min-width: 18px">{{ i + 1 }}</b>
          <input v-model="s.name" class="input" placeholder="اسم المرحلة" />
          <select v-model="s.roleId" class="input" style="max-width: 190px"><option :value="null">أي معتمد مخول</option><option v-for="x in lookups?.roles ?? []" :key="x.id" :value="x.id">{{ x.name }}</option></select>
          <button class="btn btn-sm" @click="r.stages.splice(i, 1)">✕</button>
        </div>
        <button class="btn btn-sm" :disabled="r.stages.length >= 8" @click="r.stages.push({ name: '', roleId: null })">+ مرحلة</button>
      </section>
      <button class="btn" style="align-self: start" @click="cfg.routes.push({ key: uid('w'), name: '', planKind: 'any', unitId: null, minCost: null, stages: [{ name: 'اعتماد المدير التنفيذي', roleId: null }] })">+ مسار اعتماد</button>
    </div>

    <div v-else-if="tab === 'scope'" class="rk-grid" style="grid-template-columns: 1fr 1fr">
      <section class="card pm-panel">
        <h2>تضبطه الشركة بنفسها من الإعدادات</h2>
        <ul class="rk-log"><li v-for="x in payload.configurable" :key="x"><b style="color: #10b981">✓</b><span>{{ x }}</span></li></ul>
      </section>
      <section class="card pm-panel">
        <h2>يحتاج تطويرًا (ضمن المراحل القادمة)</h2>
        <ul class="rk-log"><li v-for="x in payload.needsDevelopment" :key="x"><b style="color: #f59e0b">○</b><span>{{ x }}</span></li></ul>
      </section>
    </div>

    <ModulePermissionsPane v-else module="planning" />
  </div>
</template>
