<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../../../api';
import { useToast } from '../../../../stores/toast';

/** توجيه القيد المحاسبي لمساهمات المستفيدين المالية */
interface Accounting {
  debitAccountCode: string | null; debitAccountName: string | null;
  creditAccountCode: string | null; creditAccountName: string | null; description: string | null;
}
const toast = useToast();
const form = reactive<Accounting>({ debitAccountCode: '', debitAccountName: '', creditAccountCode: '', creditAccountName: '', description: '' });
const error = ref('');
const saving = ref(false);

onMounted(async () => {
  try {
    const a = await api<Accounting>('/beneficiaries/settings/accounting');
    Object.keys(form).forEach((k) => { (form as Record<string, unknown>)[k] = (a as unknown as Record<string, unknown>)[k] ?? ''; });
  } catch (e) {
    error.value = (e as Error).message;
  }
});

async function save() {
  saving.value = true;
  error.value = '';
  try {
    await api('/beneficiaries/settings/accounting', { method: 'PUT', json: form });
    toast.success('تم حفظ توجيه القيد');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="acc">
    <p class="muted">لما المستفيد يساهم بمبلغ في تكلفة حالته وتتأكد المساهمة، النظام بيجهّز قيد محاسبي بالتوجيه ده. لما يتفعّل النظام المالي القيد هيتسجل فيه تلقائي.</p>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <form class="card box" @submit.prevent="save">
      <div class="side debit">
        <span class="tag">مدين</span>
        <div class="field"><label>رقم الحساب</label><input v-model="form.debitAccountCode" class="input" dir="ltr" placeholder="1101" /></div>
        <div class="field"><label>اسم الحساب</label><input v-model="form.debitAccountName" class="input" placeholder="الصندوق / البنك" /></div>
      </div>
      <div class="arrow">⟵</div>
      <div class="side credit">
        <span class="tag">دائن</span>
        <div class="field"><label>رقم الحساب</label><input v-model="form.creditAccountCode" class="input" dir="ltr" placeholder="4103" /></div>
        <div class="field"><label>اسم الحساب</label><input v-model="form.creditAccountName" class="input" placeholder="إيرادات مساهمات المستفيدين" /></div>
      </div>
      <div class="field full"><label>البيان</label><input v-model="form.description" class="input" placeholder="مساهمة مستفيد في تكلفة الحالة" /></div>
      <div class="full preview">
        <p class="muted small">شكل القيد:</p>
        <table>
          <tr><th>الحساب</th><th>مدين</th><th>دائن</th></tr>
          <tr><td>{{ form.debitAccountCode }} {{ form.debitAccountName || '—' }}</td><td>المبلغ</td><td></td></tr>
          <tr><td>{{ form.creditAccountCode }} {{ form.creditAccountName || '—' }}</td><td></td><td>المبلغ</td></tr>
        </table>
      </div>
      <div class="full actions"><button class="btn btn-primary" :disabled="saving">حفظ التوجيه</button></div>
    </form>
  </section>
</template>

<style scoped>
.acc > p { margin: 0 0 12px; max-width: 760px; }
.box { padding: 20px; display: grid; grid-template-columns: 1fr auto 1fr; gap: 16px; align-items: start; }
.side { padding: 14px; border-radius: 14px; border: 1px solid var(--border); position: relative; }
.debit { background: linear-gradient(160deg, rgba(16,185,129,.08), transparent); }
.credit { background: linear-gradient(160deg, rgba(99,102,241,.08), transparent); }
.tag { display: inline-block; font-size: .75rem; font-weight: 700; padding: 2px 10px; border-radius: 99px; color: #fff; margin-bottom: 8px; }
.debit .tag { background: #10b981; }
.credit .tag { background: #6366f1; }
.arrow { align-self: center; font-size: 1.6rem; color: var(--primary); }
.full { grid-column: 1 / -1; }
.preview table { width: 100%; border-collapse: collapse; font-size: .88rem; }
.preview th, .preview td { border: 1px solid var(--border); padding: 6px 10px; text-align: right; }
.preview th { background: var(--surface-2); }
.small { font-size: .8rem; margin: 0 0 6px; }
.actions { display: flex; justify-content: flex-end; }
@media (max-width: 800px) { .box { grid-template-columns: 1fr; } .arrow { display: none; } }
</style>
