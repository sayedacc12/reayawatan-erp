
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { loadConfig, loadLookups, type ConfigPayload, type RiskConfig } from '../lib';
import '../../../shared/module.css';
import '../risk.css';

type Tab = 'matrix' | 'lists' | 'workflows' | 'permissions';
const toast = useToast();
const route = useRoute();
const tab = ref<Tab>((['matrix', 'lists', 'workflows', 'permissions'].includes(String(route.query.tab)) ? route.query.tab : 'matrix') as Tab);
const payload = ref<ConfigPayload | null>(null);
const cfg = ref<RiskConfig | null>(null);
const roles = ref<{ id: string; name: string }[]>([]);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
onMounted(async () => {
  const [p, l] = await Promise.all([loadConfig(true), loadLookups()]);
  payload.value = p;
  cfg.value = clone(p.config);
  roles.value = l.roles;
});
const dirty = computed(() => !!cfg.value && JSON.stringify(cfg.value) !== JSON.stringify(payload.value?.config));
/** معاينة المصفوفة بالمستويات الحالية قبل الحفظ */
const levelFor = (score: number) => [...(cfg.value?.levels ?? [])].sort((a, b) => b.min - a.min).find((l) => score >= l.min);
async function save() {
  try {
    const res = await api<{ config: RiskConfig }>('/risk/config', { method: 'PUT', json: { config: cfg.value } });
    const p = await loadConfig(true);
    payload.value = p;
    cfg.value = clone(res.config ?? p.config);
    toast.success('حُفظت الإعدادات');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function reset(part: keyof RiskConfig) {
  if (!cfg.value || !payload.value || !confirm('استعادة القيم المقترحة لهذا الجزء؟')) return;
  (cfg.value as unknown as Record<string, unknown>)[part] = clone(payload.value.defaults[part]);
}
function addLevel() {
  cfg.value!.levels.push({ key: `l${Date.now().toString(36)}`, name: '', min: 20, color: '#7c3aed', action: '', reviewDays: 30 });
}
const slug = (s: string, i: number) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `c${i + 1}`;
</script>

<template>
  <div v-if="cfg && payload">
    <div class="page-head">
      <div><h1>إعدادات المخاطر والتغيير والالتزام</h1>
        <p class="muted">مقاييس المصفوفة ومستويات الخطر وحد القابلية، والقوائم، ومراحل اعتماد كل إجراء، والصلاحيات. نصوص السياسة في <RouterLink to="/risk/policy" class="pm-link">السياسة</RouterLink> والمنهجيات في <RouterLink to="/risk/methodologies" class="pm-link">سجل المنهجيات</RouterLink>.</p></div>
      <button v-if="tab !== 'permissions'" class="btn btn-primary" :disabled="!dirty" @click="save">حفظ الإعدادات</button>
    </div>
    <div class="rk-tabs">
      <button :class="['rk-tab', { on: tab === 'matrix' }]" @click="tab = 'matrix'">مصفوفة المخاطر</button>
      <button :class="['rk-tab', { on: tab === 'lists' }]" @click="tab = 'lists'">التصنيفات والقوائم</button>
      <button :class="['rk-tab', { on: tab === 'workflows' }]" @click="tab = 'workflows'">مراحل الاعتماد</button>
      <button :class="['rk-tab', { on: tab === 'permissions' }]" @click="tab = 'permissions'">الصلاحيات</button>
    </div>

    <div v-if="tab === 'matrix'" class="rk-grid">
      <div style="display: grid; gap: 16px; align-content: start">
        <section v-for="sc in (['likelihood', 'impact'] as const)" :key="sc" class="card pm-panel">
          <h2>مقياس {{ sc === 'likelihood' ? 'الاحتمالية' : 'الأثر' }} <button class="btn btn-sm" @click="reset(sc)">القيم المقترحة</button></h2>
          <table class="table"><thead><tr><th>الدرجة</th><th>الاسم</th><th>الوصف والمعيار</th></tr></thead>
            <tbody><tr v-for="s in cfg[sc]" :key="s.value"><td><b>{{ s.value }}</b></td><td><input v-model="s.name" class="input" style="min-width: 110px" /></td><td><input v-model="s.description" class="input" /></td></tr></tbody></table>
        </section>
        <section class="card pm-panel">
          <h2>مستويات الخطر <button class="btn btn-sm" @click="reset('levels')">القيم المقترحة</button></h2>
          <p class="pm-muted">الدرجة = الاحتمالية × الأثر (1 إلى 25). كل مستوى يبدأ من درجة، ويحدد الإجراء المطلوب ومدة المراجعة الدورية للمخاطر فيه.</p>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>الاسم</th><th>من درجة</th><th>اللون</th><th>الإجراء المطلوب</th><th>المراجعة كل (يوم)</th><th /></tr></thead>
            <tbody><tr v-for="(l, i) in cfg.levels" :key="l.key">
              <td><input v-model="l.name" class="input" style="min-width: 90px" /></td><td><input v-model.number="l.min" type="number" min="1" max="25" class="input" style="width: 70px" /></td>
              <td><input v-model="l.color" type="color" style="width: 42px; height: 32px; border: 0; background: none" /></td>
              <td><input v-model="l.action" class="input" style="min-width: 200px" /></td><td><input v-model.number="l.reviewDays" type="number" min="1" class="input" style="width: 80px" /></td>
              <td><button class="btn btn-sm" :disabled="cfg.levels.length === 1" @click="cfg.levels.splice(i, 1)">✕</button></td>
            </tr></tbody>
          </table></div>
          <button class="btn btn-sm" :disabled="cfg.levels.length >= 6" @click="addLevel">+ مستوى</button>
          <div class="rk-sec">حد القابلية للمخاطر (Risk Appetite)</div>
          <label class="field" style="max-width: 360px"><span>أعلى درجة متبقية تقبلها الشركة دون معالجة إضافية: <b>{{ cfg.appetite }}</b></span><input v-model.number="cfg.appetite" type="range" min="1" max="25" /></label>
        </section>
      </div>
      <section class="card pm-panel" style="align-self: start">
        <h2>معاينة المصفوفة</h2>
        <div class="rk-heat">
          <template v-for="l in [5, 4, 3, 2, 1]" :key="l">
            <span class="ax">{{ l }}</span>
            <span v-for="i in [1, 2, 3, 4, 5]" :key="i" class="cell" :style="{ '--c': levelFor(l * i)?.color ?? '#94a3b8', outline: l * i > cfg.appetite ? '' : '2px dashed rgba(255,255,255,.7)', outlineOffset: '-5px' }"
              :title="levelFor(l * i)?.name">{{ l * i }}</span>
          </template>
          <span />
          <span v-for="i in [1, 2, 3, 4, 5]" :key="`x${i}`" class="ax">{{ i }}</span>
        </div>
        <div class="rk-heat-title"><span>↑ الاحتمالية</span><span>الأثر ←</span></div>
        <p class="pm-muted" style="margin-top: 8px">الخانات ذات الإطار المنقط ضمن حد القابلية.</p>
        <div class="rk-chips"><span v-for="l in cfg.levels" :key="l.key" class="pm-pill" :style="{ '--c': l.color }">{{ l.name || '—' }} من {{ l.min }}</span></div>
      </section>
    </div>

    <div v-else-if="tab === 'lists'" class="rk-grid3">
      <section class="card pm-panel">
        <h2>تصنيفات المخاطر <button class="btn btn-sm" @click="reset('categories')">المقترحة</button></h2>
        <div v-for="(c, i) in cfg.categories" :key="i" style="display: flex; gap: 6px; margin-bottom: 6px">
          <input v-model="c.name" class="input" @change="c.code = c.code || slug(c.name, i)" /><input v-model="c.code" class="input rk-code" style="max-width: 120px" dir="ltr" />
          <button class="btn btn-sm" @click="cfg.categories.splice(i, 1)">✕</button>
        </div>
        <button class="btn btn-sm" @click="cfg.categories.push({ code: `cat${cfg.categories.length + 1}`, name: '' })">+ تصنيف</button>
        <p class="pm-muted">الرمز ثابت ويُستخدم في الربط والمراجعة الداخلية، فلا تغيّره بعد الاستخدام.</p>
      </section>
      <section class="card pm-panel">
        <h2>أنواع طلبات التغيير <button class="btn btn-sm" @click="reset('changeTypes')">المقترحة</button></h2>
        <div v-for="(c, i) in cfg.changeTypes" :key="i" style="display: flex; gap: 6px; margin-bottom: 6px">
          <input v-model="c.name" class="input" /><input v-model="c.code" class="input rk-code" style="max-width: 120px" dir="ltr" />
          <button class="btn btn-sm" @click="cfg.changeTypes.splice(i, 1)">✕</button>
        </div>
        <button class="btn btn-sm" @click="cfg.changeTypes.push({ code: `type${cfg.changeTypes.length + 1}`, name: '' })">+ نوع</button>
      </section>
      <section class="card pm-panel">
        <h2>الجهات والمراجع التنظيمية <button class="btn btn-sm" @click="reset('authorities')">المقترحة</button></h2>
        <div v-for="(a, i) in cfg.authorities" :key="i" style="display: flex; gap: 6px; margin-bottom: 6px">
          <input v-model="cfg.authorities[i]" class="input" /><button class="btn btn-sm" @click="cfg.authorities.splice(i, 1)">✕</button>
        </div>
        <button class="btn btn-sm" @click="cfg.authorities.push('')">+ جهة</button>
      </section>
    </div>

    <div v-else-if="tab === 'workflows'" class="rk-grid" style="grid-template-columns: 1fr 1fr">
      <p class="rk-note wide">لكل إجراء مراحل اعتماد متتابعة. إذا حددت دورًا للمرحلة فلا يقرر فيها إلا من يحمل هذا الدور، وإلا فيقرر من لديه صلاحية الاعتماد الخاصة بهذا الإجراء. بدون مراحل يُعتمد العنصر مباشرة عند رفعه.</p>
      <section v-for="(name, key) in payload.processes" :key="key" class="card pm-panel">
        <h2>{{ name }} <button class="btn btn-sm" @click="cfg.workflows[key] = clone(payload.defaults.workflows[key] ?? [])">المقترحة</button></h2>
        <div class="rk-wf" style="margin-bottom: 10px">
          <template v-for="(s, i) in cfg.workflows[key] ?? []" :key="i"><span v-if="i" class="ln" /><span class="st"><i>{{ i + 1 }}</i>{{ s.name || '—' }}</span></template>
          <span v-if="!(cfg.workflows[key] ?? []).length" class="pm-muted">اعتماد مباشر</span>
        </div>
        <div v-for="(s, i) in cfg.workflows[key] ?? []" :key="i" style="display: flex; gap: 6px; margin-bottom: 6px">
          <b style="min-width: 18px">{{ i + 1 }}</b>
          <input v-model="s.name" class="input" placeholder="اسم المرحلة" />
          <select v-model="s.roleId" class="input" style="max-width: 190px"><option :value="null">أي معتمد مخول</option><option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option></select>
          <button class="btn btn-sm" @click="cfg.workflows[key].splice(i, 1)">✕</button>
        </div>
        <button class="btn btn-sm" :disabled="(cfg.workflows[key] ?? []).length >= 6" @click="(cfg.workflows[key] ??= []).push({ name: '', roleId: null })">+ مرحلة</button>
      </section>
    </div>

    <ModulePermissionsPane v-else module="risk" />
  </div>
</template>
