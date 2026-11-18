<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import type { AccLookups } from '../lib';

/** إعدادات إخلاء الطرف ونهاية الخدمة: البنود ومسؤولوها، مراحل اعتماد المستحقات، الربط المحاسبي */
type Approver = 'direct_manager' | 'second_manager' | 'unit_head' | 'top_manager' | 'role' | 'hr';
interface Item { code: string; name: string; description: string; approver: Approver; level: number; roleId: string; allowDeduction: boolean }
interface Config {
  items: { code: string; name: string; description: string | null; approver: Approver; level?: number; roleId?: string; allowDeduction: boolean }[];
  stages: { name: string; roleId: string | null }[];
  eosAccountId: string | null; leaveAccountId: string | null; otherAccountId: string | null; payableAccountId: string | null; cashAccountId: string | null; encashLeave: boolean;
}
const APPROVERS: { v: Approver; l: string }[] = [
  { v: 'direct_manager', l: 'المدير المباشر' }, { v: 'second_manager', l: 'مدير المدير المباشر' }, { v: 'unit_head', l: 'رئيس وحدة في مستوى محدد' },
  { v: 'top_manager', l: 'المدير التنفيذي' }, { v: 'role', l: 'دور محدد في النظام' }, { v: 'hr', l: 'شؤون الموظفين' },
];
const toast = useToast();
const lk = ref<(AccLookups & { structureLevels: string[] }) | null>(null);
const f = reactive({ items: [] as Item[], stages: [] as { name: string; roleId: string }[], eosAccountId: '', leaveAccountId: '', otherAccountId: '', payableAccountId: '', cashAccountId: '', encashLeave: true });
function fill(r: AccLookups & { structureLevels: string[]; config: Config }) {
  lk.value = r;
  const c = r.config;
  Object.assign(f, {
    items: c.items.map((i) => ({ code: i.code, name: i.name, description: i.description ?? '', approver: i.approver, level: i.level ?? 0, roleId: i.roleId ?? '', allowDeduction: i.allowDeduction })),
    stages: c.stages.map((s) => ({ name: s.name, roleId: s.roleId ?? '' })),
    eosAccountId: c.eosAccountId ?? '', leaveAccountId: c.leaveAccountId ?? '', otherAccountId: c.otherAccountId ?? '', payableAccountId: c.payableAccountId ?? '',
    cashAccountId: c.cashAccountId ?? '', encashLeave: c.encashLeave,
  });
}
onMounted(async () => {
  try {
    fill(await api('/hr/separation-config'));
  } catch (e) {
    toast.error((e as Error).message);
  }
});
const expenses = computed(() => lk.value?.accounts.filter((a) => a.nature === 'expenses') ?? []);
const liabilities = computed(() => lk.value?.accounts.filter((a) => a.nature === 'liabilities') ?? []);
async function save() {
  try {
    const n = (v: string) => v || null;
    fill(await api('/hr/separation-config', {
      method: 'PUT',
      json: {
        items: f.items.map((i) => ({
          code: i.code || undefined, name: i.name.trim(), description: i.description.trim() || null, approver: i.approver, allowDeduction: i.allowDeduction,
          ...(i.approver === 'unit_head' ? { level: Number(i.level) } : {}), ...(i.approver === 'role' ? { roleId: i.roleId } : {}),
        })),
        stages: f.stages.filter((s) => s.name.trim()).map((s) => ({ name: s.name.trim(), roleId: s.roleId || null })),
        eosAccountId: n(f.eosAccountId), leaveAccountId: n(f.leaveAccountId), otherAccountId: n(f.otherAccountId), payableAccountId: n(f.payableAccountId),
        cashAccountId: n(f.cashAccountId), encashLeave: f.encashLeave,
      },
    }));
    toast.success('حُفظت إعدادات إخلاء الطرف ونهاية الخدمة');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function move<T>(arr: T[], i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}
</script>

<template>
  <div>
    <section class="card pm-panel">
      <h2>بنود إخلاء الطرف</h2>
      <p class="pm-muted">تُنسخ هذه البنود إلى كل ملف إنهاء خدمة عند فتحه، ويصل كل بند لمسؤوله في جرس المهام. يُحدَّد المسؤول من خط الإشراف الفعلي للموظف، وإن لم يوجد (أو كان الموظف نفسه) يُحال البند إلى شؤون الموظفين. البند الذي يسمح بالخصم يمكن لمسؤوله تسجيل مبلغ مع ذكر السبب، ويُخصم من المستحقات.</p>
      <div v-for="(it, i) in f.items" :key="i" class="sep-cfg-item">
        <span class="pm-tag" style="text-align: center">{{ i + 1 }}</span>
        <div class="sep-cfg-fields">
          <input v-model="it.name" class="input" placeholder="اسم البند، مثل: تسليم العهد" />
          <select v-model="it.approver" class="input"><option v-for="a in APPROVERS" :key="a.v" :value="a.v">{{ a.l }}</option></select>
          <select v-if="it.approver === 'unit_head'" v-model.number="it.level" class="input">
            <option v-for="(l, li) in lk?.structureLevels ?? []" :key="li" :value="li">رئيس {{ l }}</option>
          </select>
          <select v-else-if="it.approver === 'role'" v-model="it.roleId" class="input">
            <option value="" disabled>اختر الدور</option><option v-for="r in lk?.roles ?? []" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
          <span v-else />
          <label class="field sep-check"><input v-model="it.allowDeduction" type="checkbox" /> يسمح بالخصم</label>
          <input v-model="it.description" class="input sep-cfg-wide" placeholder="وصف ما يجب التحقق منه (اختياري)" />
        </div>
        <div class="sep-cfg-btns">
          <button type="button" class="btn btn-sm" :disabled="i === 0" @click="move(f.items, i, -1)">▲</button>
          <button type="button" class="btn btn-sm" :disabled="i === f.items.length - 1" @click="move(f.items, i, 1)">▼</button>
          <button type="button" class="btn btn-sm" @click="f.items.splice(i, 1)">✕</button>
        </div>
      </div>
      <button type="button" class="btn btn-sm" :disabled="f.items.length >= 20" @click="f.items.push({ code: '', name: '', description: '', approver: 'hr', level: 0, roleId: '', allowDeduction: false })">+ بند</button>
    </section>
    <div class="hr-grid" style="margin-top: 16px">
      <section class="card pm-panel">
        <h2>مراحل اعتماد بيان المستحقات</h2>
        <p class="pm-muted">بعد إخلاء كل البنود يُعد شؤون الموظفين بيان المستحقات، ثم يمر بهذه المراحل بالترتيب. لا يعتمد معدّ البيان ولا الموظف نفسه أي مرحلة. فارغ = أي مستخدم معه صلاحية اعتماد المستحقات. وعند الاعتماد النهائي تنتهي الخدمة ويصدر القيد.</p>
        <div v-for="(s, i) in f.stages" :key="i" style="display: grid; grid-template-columns: 28px 1fr 1fr auto auto auto; gap: 6px; margin-bottom: 8px; align-items: center">
          <span class="pm-tag" style="text-align: center">{{ i + 1 }}</span>
          <input v-model="s.name" class="input" placeholder="اسم المرحلة" />
          <select v-model="s.roleId" class="input"><option value="">أي معتمد</option><option v-for="r in lk?.roles ?? []" :key="r.id" :value="r.id">{{ r.name }}</option></select>
          <button type="button" class="btn btn-sm" :disabled="i === 0" @click="move(f.stages, i, -1)">▲</button>
          <button type="button" class="btn btn-sm" :disabled="i === f.stages.length - 1" @click="move(f.stages, i, 1)">▼</button>
          <button type="button" class="btn btn-sm" @click="f.stages.splice(i, 1)">✕</button>
        </div>
        <button type="button" class="btn btn-sm" :disabled="f.stages.length >= 6" @click="f.stages.push({ name: '', roleId: '' })">+ مرحلة</button>
        <label class="field sep-check" style="margin-top: 14px"><input v-model="f.encashLeave" type="checkbox" /> صرف بدل رصيد الإجازة السنوية المتبقي ضمن المستحقات</label>
      </section>
      <section class="card pm-panel">
        <h2>الربط المحاسبي للمستحقات</h2>
        <p class="pm-muted">القيد عند الاعتماد النهائي: مصروف المكافأة وبدل الإجازة والإضافات (محمّلًا على الحساب التحليلي لوحدة الموظف)، مقابل السلف المتبقية والخصومات، والصافي على حساب المستحقات. ثم يُنشأ سند صرف بالصافي.</p>
        <label class="field"><span>مصروف مكافأة نهاية الخدمة</span>
          <select v-model="f.eosAccountId" class="input"><option value="">—</option><option v-for="a in expenses" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select></label>
        <label class="field"><span>مصروف بدل الإجازات</span>
          <select v-model="f.leaveAccountId" class="input"><option value="">—</option><option v-for="a in expenses" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select></label>
        <label class="field"><span>مصروف المستحقات الأخرى (الإضافات اليدوية)</span>
          <select v-model="f.otherAccountId" class="input"><option value="">—</option><option v-for="a in expenses" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select></label>
        <label class="field"><span>مستحقات نهاية الخدمة (فارغ = حساب الرواتب المستحقة)</span>
          <select v-model="f.payableAccountId" class="input"><option value="">—</option><option v-for="a in liabilities" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select></label>
        <label class="field"><span>بنك الصرف الافتراضي</span>
          <select v-model="f.cashAccountId" class="input"><option value="">—</option><option v-for="c in lk?.cashAccounts ?? []" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
        <p class="pm-muted">السلف والخصومات تُقيد على حسابي السلف والاستقطاعات المحددين في تبويب «الربط المحاسبي واعتماد المسير».</p>
      </section>
    </div>
    <div style="margin-top: 16px"><button class="btn btn-primary" @click="save">حفظ الإعدادات</button></div>
  </div>
</template>

<style scoped>
.sep-cfg-item { display: grid; grid-template-columns: 28px 1fr auto; gap: 8px; align-items: start; padding: 10px 0; border-bottom: 1px dashed var(--border); }
.sep-cfg-fields { display: grid; grid-template-columns: 1.3fr 1fr 1fr auto; gap: 6px; align-items: center; }
.sep-cfg-wide { grid-column: 1 / -1; }
.sep-cfg-btns { display: flex; gap: 4px; }
.sep-check { flex-direction: row; gap: 8px; align-items: center; margin: 0; }
@media (max-width: 760px) { .sep-cfg-fields { grid-template-columns: 1fr; } }
</style>
