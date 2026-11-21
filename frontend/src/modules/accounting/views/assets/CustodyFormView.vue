<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../../api';
import { AF, type CustodyForm } from '../../assets';
import { dt, money } from '../../lib';
import '../../acc.css';

interface Doc {
  organization: string; form: CustodyForm;
  from: { name: string; no: number; unit: string | null } | null; to: { name: string; no: number; unit: string | null } | null;
  asset: { code: string; name: string; groupName: string; serialNumber: string | null; description: string | null; cost: number; fields: { label: string; value: string | null }[] };
}
const props = defineProps<{ id: string }>();
const d = ref<Doc | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    d.value = await api<Doc>(`${AF}/custody/forms/${props.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const printNow = () => window.print();
</script>

<template>
  <div v-if="d" class="wrap">
    <div class="no-print bar"><RouterLink to="/accounting/assets/custody" class="btn btn-sm">العهد</RouterLink><button class="btn btn-sm btn-primary" @click="printNow">طباعة النموذج</button></div>
    <article class="paper">
      <header>
        <div><b>{{ d.organization }}</b><small>الأصول الثابتة</small></div>
        <h1>نموذج {{ d.form.kindLabel }}</h1>
        <div class="no"><span>رقم</span><b class="ac-code">{{ d.form.formNo }}</b><span>التاريخ {{ d.form.date }}</span></div>
      </header>
      <table class="t">
        <tbody>
          <tr><th>رمز الأصل</th><td class="ac-code">{{ d.asset.code }}</td><th>اسم الأصل</th><td>{{ d.asset.name }}</td></tr>
          <tr><th>المجموعة</th><td>{{ d.asset.groupName }}</td><th>الرقم التسلسلي</th><td class="ac-code">{{ d.asset.serialNumber ?? '—' }}</td></tr>
          <tr v-for="(f, i) in d.asset.fields" :key="i"><th>{{ f.label }}</th><td colspan="3">{{ f.value ?? '—' }}</td></tr>
          <tr><th>قيمة الأصل</th><td>{{ money(d.asset.cost) }} ر.س</td><th>حالة الأصل</th><td>{{ d.form.condition ?? '—' }}</td></tr>
          <tr v-if="d.form.fromName || d.form.fromLocation"><th>من</th><td>{{ d.from ? `${d.from.name} (رقم ${d.from.no})` : '—' }}</td><th>الموقع السابق</th><td>{{ d.form.fromLocation ?? '—' }}</td></tr>
          <tr><th>{{ d.form.kind === 'release' ? 'انتهت العهدة' : 'المستلم' }}</th><td>{{ d.to ? `${d.to.name} (رقم ${d.to.no}) ${d.to.unit ?? ''}` : '—' }}</td><th>الموقع</th><td>{{ d.form.toLocation ?? '—' }}</td></tr>
          <tr v-if="d.form.notes"><th>ملاحظات</th><td colspan="3">{{ d.form.notes }}</td></tr>
        </tbody>
      </table>
      <p class="pledge" v-if="d.to">أقر أنا الموقع أدناه باستلام الأصل الموضح أعلاه بحالته المذكورة، وأتعهد بالمحافظة عليه واستخدامه لأغراض الشركة فقط، وإعادته عند طلبه أو عند انتهاء علاقتي بالشركة، ولا يتم إخلاء طرفي إلا بعد إرجاعه أو نقله لموظف آخر.</p>
      <div class="sign">
        <div><span>المسلِّم</span><b>{{ d.from?.name ?? d.form.createdByName }}</b><i /></div>
        <div><span>المستلِم</span><b>{{ d.to?.name ?? '' }}</b><i /><small v-if="d.form.confirmedAt">أكّد الاستلام إلكترونيًا: {{ d.form.confirmedByName }} · {{ dt(d.form.confirmedAt) }}</small></div>
        <div><span>أمين الأصول</span><b>{{ d.form.createdByName }}</b><i /></div>
      </div>
    </article>
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
</template>

<style scoped>
.wrap { max-width: 900px; margin: 0 auto; }
.bar { display: flex; gap: 8px; justify-content: flex-end; margin-bottom: 12px; }
.paper { background: #fff; color: #0f172a; border: 2px solid #164e38; border-radius: 16px; padding: 28px 32px; }
header { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; border-bottom: 3px double #164e38; padding-bottom: 12px; margin-bottom: 16px; }
header > div { display: flex; flex-direction: column; }
header small { color: #64748b; }
header h1 { font-size: 1.25rem; text-align: center; margin: 0; }
.no { align-items: flex-end; }
.t { width: 100%; border-collapse: collapse; font-size: .92rem; }
.t th, .t td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: start; }
.t th { background: #f1f5f9; width: 18%; }
.pledge { margin: 18px 0; line-height: 1.9; font-size: .92rem; }
.sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 30px; }
.sign > div { display: flex; flex-direction: column; gap: 4px; }
.sign span { color: #64748b; font-size: .85rem; }
.sign i { display: block; border-bottom: 1px solid #0f172a; height: 36px; }
.sign small { color: #047857; font-size: .75rem; }
@media print { .paper { border: 0; padding: 0; } }
</style>
