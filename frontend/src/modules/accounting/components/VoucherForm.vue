<script setup lang="ts">
/** نموذج سند القبض أو الصرف: يُعرض بشكل السند الورقي نفسه، والمبلغ يُفقَّط تلقائيًا */
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import SearchSelect from '../../fundraising/components/SearchSelect.vue';
import { METHODS, loadAnalytic, todayStr, useAccounts, type Analytic, type CashAccount, type Partner } from '../lib';
import { tafqeet } from '../tafqeet';
import AnalyticPicker, { type Share } from './AnalyticPicker.vue';

export interface VoucherInput {
  id?: string; voucherDate: string; partyName: string; partnerId: string | null; amount: number | null; purpose: string; sourceType: 'manual' | 'opportunity' | 'store' | 'payroll';
  sourceRef: string | null; projectName: string | null; method: string; methodRef: string | null; cashAccountId: string | null; counterAccountId: string | null; analytic: Share[];
}
const props = defineProps<{ kind: 'receipt' | 'payment'; initial?: Partial<VoucherInput> & { counterAccountCode?: string; counterAccountName?: string }; orgName: string }>();
const emit = defineEmits<{ saved: [{ id: string; serial: number }]; close: [] }>();
const toast = useToast();
const { accounts, load: loadAccounts, subOptions } = useAccounts();
const cash = ref<CashAccount[]>([]);
const partners = ref<Partner[]>([]);
const analytic = ref<Analytic[]>([]);
const busy = ref(false);
const picker = ref(false);
const f = reactive<VoucherInput>({
  voucherDate: todayStr(), partyName: '', partnerId: null, amount: null, purpose: '', sourceType: 'manual', sourceRef: null, projectName: null,
  method: 'transfer', methodRef: null, cashAccountId: null, counterAccountId: null, analytic: [], ...props.initial,
});
onMounted(async () => {
  await Promise.all([
    loadAccounts(),
    api<CashAccount[]>('/accounting/cash-accounts').then((r) => { cash.value = r.filter((c) => c.isActive); if (!f.cashAccountId && cash.value.length === 1) f.cashAccountId = cash.value[0].id; }),
    api<Partner[]>('/accounting/partners').then((r) => { partners.value = r.filter((p) => p.isActive); }).catch(() => {}),
    loadAnalytic().then((r) => { analytic.value = r.accounts; }),
  ]).catch((e) => toast.error((e as Error).message));
});
const isR = computed(() => props.kind === 'receipt');
const words = computed(() => (f.amount ? tafqeet(Number(f.amount)) : ''));
const counterOptions = computed(() => subOptions((a) => !cash.value.some((c) => c.glAccount?.id === a.id)));
const counter = computed(() => accounts.value.find((a) => a.id === f.counterAccountId));
const partner = computed(() => partners.value.find((p) => p.id === f.partnerId));
/** الشريك المسجل المربوط بحساب يحدد الحساب المقابل، فلا يُغيَّر يدويًا */
const lockedByPartner = computed(() => !!partner.value?.account);
const analyticText = computed(() => f.analytic.map((s) => `${analytic.value.find((a) => a.id === s.analyticId)?.name ?? ''}${f.analytic.length > 1 ? ` ${s.percent}%` : ''}`).join('، '));
function pickPartner(id: string | null) {
  f.partnerId = id;
  const p = partners.value.find((x) => x.id === id);
  if (p) {
    f.partyName = p.name;
    // الحساب المقابل يُؤخذ من ملف الشريك نفسه
    if (p.account) f.counterAccountId = p.account.id;
  }
}
async function save() {
  busy.value = true;
  try {
    const body = { ...f, amount: Number(f.amount), methodRef: f.methodRef || null, sourceRef: f.sourceRef || null, projectName: f.projectName || null };
    delete (body as { id?: string }).id;
    for (const k of ['counterAccountCode', 'counterAccountName'] as const) delete (body as Record<string, unknown>)[k];
    const r = f.id
      ? await api<{ id: string; serial: number }>(`/accounting/voucher/${f.id}`, { method: 'PUT', json: body })
      : await api<{ id: string; serial: number }>(`/accounting/vouchers/${props.kind}`, { method: 'POST', json: body });
    toast.success(f.id ? 'تم حفظ التعديل' : `تم حفظ ${isR.value ? 'سند القبض' : 'سند الصرف'} رقم ${r.serial}`);
    emit('saved', r);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form :class="['vform', kind]" @submit.prevent="save">
    <div class="vhead">
      <div>
        <h2>{{ isR ? 'سند قبض' : 'سند صرف' }}</h2>
        <small>{{ isR ? 'Receipt Voucher' : 'Payment Voucher' }}</small>
      </div>
      <label class="date">التاريخ <input v-model="f.voucherDate" type="date" class="input" required /></label>
    </div>

    <div class="vline">
      <span class="lbl">{{ isR ? 'استلمنا نحن' : 'صرفنا نحن' }}</span>
      <span class="val org">{{ orgName }}</span>
      <span class="amt">
        <span class="cur">المبلغ</span>
        <input v-model.number="f.amount" class="input big" type="number" min="0.01" step="0.01" placeholder="0.00" required />
        <span class="cur">ر.س</span>
      </span>
    </div>
    <div class="vline words"><span class="lbl">مبلغ وقدره</span><span class="val">{{ words || '—' }}</span></div>

    <div class="vline">
      <span class="lbl">{{ isR ? 'من السادة' : 'إلى السادة' }}</span>
      <input v-model="f.partyName" class="input grow" required placeholder="اسم الجهة أو الشخص" />
      <select class="input partner" :value="f.partnerId" @change="pickPartner(($event.target as HTMLSelectElement).value || null)">
        <option value="">{{ isR ? 'عميل مسجل (اختياري)' : 'مورد مسجل (اختياري)' }}</option>
        <option v-for="p in partners" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </div>

    <div class="vline">
      <span class="lbl">وهو قيمة</span>
      <input v-model="f.purpose" class="input grow" required placeholder="اكتب البيان يدويًا" />
      <select v-model="f.sourceType" class="input src" title="مصدر البيان">
        <option value="manual">كتابة يدوية</option>
        <option value="opportunity">فرصة تبرع (يُربط لاحقًا)</option>
        <option value="store">مشروع المتجر (يُربط لاحقًا)</option>
        <option v-if="f.sourceType === 'payroll'" value="payroll">مسير الرواتب</option>
      </select>
    </div>
    <div v-if="f.sourceType !== 'manual'" class="vline soft">
      <span class="lbl">مرجع المصدر</span>
      <input v-model="f.sourceRef" class="input grow" :placeholder="f.sourceType === 'opportunity' ? 'رقم فرصة التبرع' : f.sourceType === 'payroll' ? 'شهر المسير' : 'رقم طلب المتجر'" :readonly="f.sourceType === 'payroll'" />
      <span class="pm-muted">يُملأ آليًا عند ربط النظام المالي بالموارد المالية والمتجر.</span>
    </div>

    <div class="grid">
      <label class="field"><span>{{ isR ? 'البنك أو الصندوق المستلِم' : 'يُصرف من (بنك أو صندوق)' }}</span>
        <select v-model="f.cashAccountId" class="input" required>
          <option :value="null" disabled>اختر من البنوك والنقدية</option>
          <option v-for="c in cash" :key="c.id" :value="c.id">{{ c.kind === 'bank' ? '🏦' : '💵' }} {{ c.name }}</option>
        </select>
      </label>
      <label class="field"><span>طريقة {{ isR ? 'الاستلام' : 'الصرف' }}</span>
        <select v-model="f.method" class="input"><option v-for="m in METHODS" :key="m.value" :value="m.value">{{ m.label }}</option></select>
      </label>
      <label v-if="f.method !== 'cash'" class="field"><span>{{ f.method === 'cheque' ? 'رقم الشيك' : 'رقم العملية' }}</span><input v-model="f.methodRef" class="input ac-code" /></label>
      <label class="field wide"><span>{{ isR ? 'الحساب الدائن (المقابل)' : 'الحساب المدين (المصروف عليه)' }}</span>
        <div v-if="lockedByPartner" class="input locked" title="من ملف الشريك">🔗 <span class="ac-code">{{ partner?.account?.code }}</span> {{ partner?.account?.name }} <small class="pm-muted">من ملف {{ partner?.name }}</small></div>
        <SearchSelect v-else v-model="f.counterAccountId" :options="counterOptions" :selected-label="counter ? `${counter.code} ${counter.name}` : initial?.counterAccountCode ? `${initial.counterAccountCode} ${initial.counterAccountName}` : ''" placeholder="ابحث في حسابات الجمعية برقم الحساب أو اسمه" required />
      </label>
      <div class="field"><span>الحساب التحليلي {{ counter?.requiresAnalytic ? '(إلزامي)' : '' }}</span>
        <button type="button" :class="['btn', 'an', { need: counter?.requiresAnalytic && !f.analytic.length }]" @click="picker = true">{{ f.analytic.length ? analyticText : counter?.requiresAnalytic ? 'اختر الحساب التحليلي' : '+ تحليلي (اختياري)' }}</button>
      </div>
      <label class="field"><span>المشروع (اختياري)</span><input v-model="f.projectName" class="input" placeholder="يُربط بإدارة المشاريع لاحقًا" /></label>
    </div>

    <div class="modal-actions">
      <button class="btn btn-primary" :disabled="busy">{{ f.id ? 'حفظ التعديل' : 'حفظ كمسودة' }}</button>
      <button type="button" class="btn" @click="emit('close')">إلغاء</button>
    </div>
    <AnalyticPicker v-if="picker" v-model="f.analytic" :analytic="analytic" :amount="Number(f.amount || 0)" :required="counter?.requiresAnalytic" @close="picker = false" />
  </form>
</template>

<style scoped>
.vform { --c: #0f766e; position: relative; border-radius: 18px; padding: 22px; background: var(--surface);
  background-image: radial-gradient(circle at 100% 0, color-mix(in srgb, var(--c) 10%, transparent), transparent 40%); border: 2px solid color-mix(in srgb, var(--c) 35%, transparent); }
.vform.payment { --c: #b45309; }
.vhead { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid var(--c); padding-bottom: 10px; margin-bottom: 14px; }
.vhead h2 { margin: 0; color: var(--c); font-size: 1.5rem; }
.vhead small { color: var(--muted); letter-spacing: 2px; }
.date { display: flex; gap: 6px; align-items: center; color: var(--muted); }
.date .input { width: 160px; }
.vline { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px dashed var(--border); flex-wrap: wrap; }
.vline.soft { background: var(--surface-2); border-radius: 10px; padding: 8px 10px; border: 0; margin: 4px 0; }
.lbl { color: var(--c); font-weight: 700; min-width: 92px; }
.val { font-weight: 600; flex: 1; }
.org { font-size: 1.05rem; }
.grow { flex: 1; min-width: 200px; }
.partner, .src { width: 200px; }
.amt { display: flex; align-items: center; gap: 6px; border: 2px solid var(--c); border-radius: 12px; padding: 4px 10px; background: color-mix(in srgb, var(--c) 6%, transparent); }
.amt .big { width: 150px; font-size: 1.2rem; font-weight: 800; text-align: end; border: 0; background: transparent; }
.cur { color: var(--c); font-weight: 700; font-size: .85rem; }
.words .val { color: var(--c); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 4px 14px; margin-top: 14px; }
.grid .wide { grid-column: span 2; }
.locked { display: flex; align-items: center; gap: 6px; background: color-mix(in srgb, var(--c) 8%, transparent); border-color: color-mix(in srgb, var(--c) 40%, transparent); }
.an { width: 100%; text-align: start; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an.need { border-color: #f59e0b; color: #b45309; }
@media (max-width: 700px) { .grid .wide { grid-column: auto; } .partner, .src { width: 100%; } }
</style>
