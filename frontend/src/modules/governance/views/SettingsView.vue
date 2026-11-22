<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import type { FigureDef } from '../lib';
import '../../../shared/module.css';
import '../gov.css';
import StarterSettings from '../../../components/StarterSettings.vue';

type Rule = { code: string; sign?: 1 | -1 };
interface Settings {
  mapping: Record<string, Rule[]>; overrides: Record<string, Rule[]>; defaults: Record<string, Rule[]>; figures: FigureDef[];
  facts: Record<string, unknown>; alertDays: number; targetScore: number; accounting: { chart: boolean; years: number };
}
const TABS = ['facts', 'mapping', 'alerts', 'permissions'] as const;
type Tab = (typeof TABS)[number];
const route = useRoute();
const toast = useToast();
const tab = ref<Tab>((TABS as readonly string[]).includes(String(route.query.tab)) ? (route.query.tab as Tab) : 'facts');
const s = ref<Settings | null>(null);
const facts = reactive<Record<string, unknown>>({});
const mapping = reactive<Record<string, { code: string; sign: 1 | -1 }[]>>({});
const general = reactive({ alertDays: 30, targetScore: 90 });
const tri = (v: unknown) => (v === true ? 'yes' : v === false ? 'no' : '');
const fromTri = (v: string) => (v === 'yes' ? true : v === 'no' ? false : null);
const triState = reactive<Record<string, string>>({});
const BOOLS = ['hasBranches', 'branchesApproved', 'hasCommittees', 'ctfObliged'];

async function load() {
  s.value = await api<Settings>('/governance/settings');
  Object.assign(facts, s.value.facts);
  for (const k of BOOLS) triState[k] = tri(s.value.facts[k]);
  for (const f of s.value.figures) mapping[f.key] = (s.value.mapping[f.key] ?? []).map((r) => ({ code: r.code, sign: r.sign ?? 1 }));
  Object.assign(general, { alertDays: s.value.alertDays, targetScore: s.value.targetScore });
}
onMounted(load);
async function save(part: 'facts' | 'mapping' | 'alerts') {
  const json: Record<string, unknown> = {};
  if (part === 'facts') json.facts = { ...facts, ...Object.fromEntries(BOOLS.map((k) => [k, fromTri(triState[k])])) };
  if (part === 'mapping') json.mapping = Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, v.filter((r) => r.code.trim()).map((r) => ({ code: r.code.trim(), ...(r.sign === -1 ? { sign: -1 } : {}) }))]));
  if (part === 'alerts') Object.assign(json, { alertDays: Number(general.alertDays), targetScore: Number(general.targetScore) });
  try {
    await api('/governance/settings', { method: 'PUT', json });
    await load();
    toast.success('حُفظت الإعدادات');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function resetFigure(key: string) {
  mapping[key] = (s.value?.defaults[key] ?? []).map((r) => ({ code: r.code, sign: r.sign ?? 1 }));
}
const custom = (key: string) => !!s.value?.overrides[key];
</script>

<template>
  <div>
    <section class="pm-hero gv-hero">
      <div>
        <p class="pm-kicker">إعدادات الحوكمة</p>
        <h1>بيانات الشركة وربط الحسابات</h1>
        <p class="pm-sub">البيانات النظامية يستخدمها الإنذار المبكر والإشارات الآلية، وربط الحسابات يحدد من أين تُستخرج أرقام مؤشرات الأداء المالي في دليل الحسابات الموحد.</p>
      </div>
    </section>
    <StarterSettings module="governance" />
    <div class="gv-tabs">
      <button :class="['gv-tab', { on: tab === 'facts' }]" @click="tab = 'facts'">البيانات النظامية</button>
      <button :class="['gv-tab', { on: tab === 'mapping' }]" @click="tab = 'mapping'">ربط الحسابات بالمؤشرات المالية</button>
      <button :class="['gv-tab', { on: tab === 'alerts' }]" @click="tab = 'alerts'">الإنذار والمستهدف</button>
      <button :class="['gv-tab', { on: tab === 'permissions' }]" @click="tab = 'permissions'">الصلاحيات</button>
    </div>

    <section v-if="tab === 'facts' && s" class="card pm-panel">
      <div class="rk-fields" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 0 14px">
        <label class="field"><span>رقم شهادة التسجيل</span><input v-model="facts.licenseNo" class="input" /></label>
        <label class="field"><span>تاريخ انتهاء شهادة التسجيل</span><input v-model="facts.licenseExpiry" type="date" class="input" /></label>
        <label class="field"><span>تاريخ تشكيل مجلس الإدارة</span><input v-model="facts.boardFormedOn" type="date" class="input" /></label>
        <label class="field"><span>نهاية دورة مجلس الإدارة</span><input v-model="facts.boardTermEnd" type="date" class="input" /></label>
        <label class="field"><span>عدد أعضاء مجلس الإدارة</span><input v-model.number="facts.boardMembers" type="number" min="0" class="input" /></label>
        <label class="field"><span>المحاسب القانوني (المراجع الخارجي)</span><input v-model="facts.externalAuditor" class="input" /></label>
        <label class="field"><span>نهاية عقد المراجع الخارجي</span><input v-model="facts.auditorContractEnd" type="date" class="input" /></label>
        <label class="field"><span>مخالفات أو إنذارات لم تُصحح</span><input v-model.number="facts.openViolations" type="number" min="0" class="input" /></label>
        <label class="field"><span>الموقع الإلكتروني للشركة</span><input v-model="facts.websiteUrl" class="input" dir="ltr" /></label>
        <label class="field"><span>للشركة فروع أو مكاتب</span><select v-model="triState.hasBranches" class="input"><option value="">غير محدد</option><option value="yes">نعم</option><option value="no">لا</option></select></label>
        <label v-if="triState.hasBranches === 'yes'" class="field"><span>الفروع معتمدة من المركز</span><select v-model="triState.branchesApproved" class="input"><option value="">غير محدد</option><option value="yes">نعم</option><option value="no">لا</option></select></label>
        <label class="field"><span>للمجلس لجان منبثقة</span><select v-model="triState.hasCommittees" class="input"><option value="">غير محدد</option><option value="yes">نعم</option><option value="no">لا</option></select></label>
        <label class="field"><span>تنطبق متطلبات مكافحة غسل الأموال وتمويل الإرهاب</span><select v-model="triState.ctfObliged" class="input"><option value="">غير محدد</option><option value="yes">نعم</option><option value="no">لا</option></select></label>
      </div>
      <p class="gv-note">ينذر النظام قبل انتهاء شهادة التسجيل بـ 90 يوماً، وقبل نهاية دورة المجلس بخطوات الانتخاب المطلوبة، وقبل انتهاء عقد المراجع الخارجي.</p>
      <button class="btn btn-primary" @click="save('facts')">حفظ</button>
    </section>

    <section v-if="tab === 'mapping' && s" class="card pm-panel">
      <p v-if="!s.accounting.chart" class="gv-warn">دليل الحسابات الموحد غير مثبت في النظام المالي. الربط أدناه افتراضي على رموز الدليل الموحد.</p>
      <p class="gv-note">كل رقم يُجمع من الحسابات المذكورة وكل ما تحتها في الشجرة. اختر «استبعاد» لطرح حساب فرعي من حساب أعلى. الأرقام من نوع «حركة» تُحسب من قيود الفترة، ومن نوع «رصيد» من الرصيد في نهاية الفترة شاملاً الافتتاحي.</p>
      <table class="table">
        <thead><tr><th>الرقم المالي</th><th>الحسابات</th><th /></tr></thead>
        <tbody><tr v-for="f in s.figures" :key="f.key">
          <td style="white-space: normal; max-width: 340px"><b>{{ f.label }}</b> <span class="gv-pill" :style="{ '--c': f.kind === 'flow' ? '#0ea5e9' : '#a78bfa' }">{{ f.kind === 'flow' ? 'حركة' : 'رصيد' }}</span>
            <div class="pm-muted">{{ f.source }}</div></td>
          <td>
            <div style="display: flex; flex-wrap: wrap; gap: 6px">
              <span v-for="(r, i) in mapping[f.key]" :key="i" style="display: inline-flex; gap: 4px; align-items: center">
                <select v-model.number="r.sign" class="input" style="width: auto; padding: 2px 6px"><option :value="1">+</option><option :value="-1">استبعاد</option></select>
                <input v-model="r.code" class="input" style="width: 110px" dir="ltr" placeholder="رمز الحساب" />
                <button class="btn btn-sm btn-ghost" @click="mapping[f.key].splice(i, 1)">×</button>
              </span>
              <button class="btn btn-sm" @click="mapping[f.key].push({ code: '', sign: 1 })">+ حساب</button>
            </div>
          </td>
          <td><button v-if="custom(f.key)" class="btn btn-sm btn-ghost" @click="resetFigure(f.key)">الافتراضي</button></td>
        </tr></tbody>
      </table>
      <button class="btn btn-primary" @click="save('mapping')">حفظ الربط</button>
    </section>

    <section v-if="tab === 'alerts' && s" class="card pm-panel">
      <div class="pm-grid2" style="max-width: 560px">
        <label class="field"><span>ابدأ الإنذار قبل الموعد بـ (يوم)</span><input v-model.number="general.alertDays" type="number" min="7" max="120" class="input" /></label>
        <label class="field"><span>الدرجة المستهدفة (%)</span><input v-model.number="general.targetScore" type="number" min="50" max="100" class="input" /></label>
      </div>
      <p class="gv-note">ينذر النظام إذا كانت الدرجة المتوقعة أقل من المستهدف، ويظهر خط المستهدف على مؤشرات المحاور.</p>
      <button class="btn btn-primary" @click="save('alerts')">حفظ</button>
    </section>

    <ModulePermissionsPane v-if="tab === 'permissions'" module="governance" />
  </div>
</template>
