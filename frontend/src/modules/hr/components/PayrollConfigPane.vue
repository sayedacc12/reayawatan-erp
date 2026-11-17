<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import type { AccLookups } from '../lib';

/** الربط المحاسبي لمسير الرواتب ومراحل اعتماده */
interface Config { payableAccountId: string | null; gosiPayableAccountId: string | null; deductionsAccountId: string | null; defaultCashAccountId: string | null; stages: { name: string; roleId: string | null }[] }
const toast = useToast();
const lk = ref<AccLookups | null>(null);
const f = reactive({ payableAccountId: '', gosiPayableAccountId: '', deductionsAccountId: '', defaultCashAccountId: '', stages: [] as { name: string; roleId: string }[] });
function fill(r: AccLookups & { config: Config }) {
  lk.value = r;
  const c = r.config;
  Object.assign(f, {
    payableAccountId: c.payableAccountId ?? '', gosiPayableAccountId: c.gosiPayableAccountId ?? '',
    deductionsAccountId: c.deductionsAccountId ?? '', defaultCashAccountId: c.defaultCashAccountId ?? '', stages: c.stages.map((s) => ({ name: s.name, roleId: s.roleId ?? '' })),
  });
}
onMounted(async () => {
  try {
    fill(await api('/hr/payroll-config'));
  } catch (e) {
    toast.error((e as Error).message);
  }
});
const by = (n: string) => computed(() => lk.value?.accounts.filter((a) => a.nature === n) ?? []);
const liabilities = by('liabilities');
async function save() {
  try {
    const n = (v: string) => v || null;
    fill(await api('/hr/payroll-config', {
      method: 'PUT',
      json: {
        payableAccountId: n(f.payableAccountId), gosiPayableAccountId: n(f.gosiPayableAccountId),
        deductionsAccountId: n(f.deductionsAccountId), defaultCashAccountId: n(f.defaultCashAccountId),
        stages: f.stages.filter((s) => s.name.trim()).map((s) => ({ name: s.name.trim(), roleId: s.roleId || null })),
      },
    }));
    toast.success('حُفظ الربط المحاسبي ومراحل الاعتماد');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function move(i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= f.stages.length) return;
  [f.stages[i], f.stages[j]] = [f.stages[j], f.stages[i]];
}
</script>

<template>
  <div class="hr-grid">
    <section class="card pm-panel">
      <h2>الربط المحاسبي للرواتب</h2>
      <p class="pm-muted">عند الاعتماد النهائي لكشف الرواتب يصدر قيد في النظام المالي: مصروف كل بند على الحساب المحدد لفئة وظيفة الموظف (تبويب حسابات المصروف للوظائف)، محمّلًا على الحساب التحليلي لوحدته، مقابل الرواتب المستحقة والتأمينات والاستقطاعات. بنوك الصرف وحسابات الاستحقاق لكل بند في تبويب البدلات.</p>
      <label class="field"><span>الرواتب المستحقة (لكل بند ليس له حساب استحقاق خاص)</span>
        <select v-model="f.payableAccountId" class="input"><option value="">—</option><option v-for="a in liabilities" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select></label>
      <label class="field"><span>التأمينات الاجتماعية المستحقة (حصة الموظف والجمعية)</span>
        <select v-model="f.gosiPayableAccountId" class="input"><option value="">—</option><option v-for="a in liabilities" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select></label>
      <label class="field"><span>الاستقطاعات الأخرى (أقساط السلف والجزاءات)</span>
        <select v-model="f.deductionsAccountId" class="input"><option value="">—</option><option v-for="a in lk?.accounts ?? []" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select></label>
      <label class="field"><span>البنك الافتراضي لصرف الرواتب</span>
        <select v-model="f.defaultCashAccountId" class="input"><option value="">—</option><option v-for="c in lk?.cashAccounts ?? []" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
    </section>
    <section class="card pm-panel">
      <h2>مراحل اعتماد كشف الرواتب</h2>
      <p class="pm-muted">يمر الكشف بهذه المراحل بالترتيب، ولكل مرحلة دور مسؤول عنها (فارغ = أي مستخدم معه صلاحية اعتماد المسير). بدون مراحل يعتمده صاحب الصلاحية مباشرة عند الرفع.</p>
      <div v-for="(s, i) in f.stages" :key="i" style="display: grid; grid-template-columns: 28px 1fr 1fr auto auto auto; gap: 6px; margin-bottom: 8px; align-items: center">
        <span class="pm-tag" style="text-align: center">{{ i + 1 }}</span>
        <input v-model="s.name" class="input" placeholder="اسم المرحلة" />
        <select v-model="s.roleId" class="input"><option value="">أي معتمد</option><option v-for="r in lk?.roles ?? []" :key="r.id" :value="r.id">{{ r.name }}</option></select>
        <button type="button" class="btn btn-sm" :disabled="i === 0" @click="move(i, -1)">▲</button>
        <button type="button" class="btn btn-sm" :disabled="i === f.stages.length - 1" @click="move(i, 1)">▼</button>
        <button type="button" class="btn btn-sm" @click="f.stages.splice(i, 1)">✕</button>
      </div>
      <button type="button" class="btn btn-sm" :disabled="f.stages.length >= 8" @click="f.stages.push({ name: '', roleId: '' })">+ مرحلة</button>
      <p class="pm-muted" style="margin-top: 12px">بعد الاعتماد النهائي تُنشأ سندات الصرف في النظام المالي وتمر بمراحل اعتماد سندات الصرف المعرّفة هناك.</p>
      <div class="modal-actions"><button class="btn btn-primary" @click="save">حفظ</button></div>
    </section>
  </div>
</template>
