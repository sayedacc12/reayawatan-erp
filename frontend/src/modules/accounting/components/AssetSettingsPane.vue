<script setup lang="ts">
/** إعدادات الأصول الثابتة داخل إعدادات النظام المالي */
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import SearchSelect from '../../../shared/SearchSelect.vue';
import { AF, useLookups, type AssetConfig } from '../assets';
import { useAccounts } from '../lib';

const toast = useToast();
const { load: reloadLookups } = useLookups();
const { load: loadAccounts, subOptions } = useAccounts();
const cfg = ref<AssetConfig | null>(null);
const form = reactive({
  prefix: 'FA', requireCustody: true, alertDays: 30, partialMonth: 'days' as 'days' | 'next_month',
  revaluationAccountId: null as string | null, impairmentAccountId: null as string | null, wipAccountId: null as string | null,
  grantReleaseAccountId: null as string | null, maintenanceAccountId: null as string | null, budgetControl: 'warn' as 'warn' | 'block',
});
type AccKey = 'revaluationAccountId' | 'impairmentAccountId' | 'wipAccountId' | 'grantReleaseAccountId' | 'maintenanceAccountId';
const REF: Record<AccKey, 'revaluationAccount' | 'impairmentAccount' | 'wipAccount' | 'grantReleaseAccount' | 'maintenanceAccount'> = {
  revaluationAccountId: 'revaluationAccount', impairmentAccountId: 'impairmentAccount', wipAccountId: 'wipAccount', grantReleaseAccountId: 'grantReleaseAccount', maintenanceAccountId: 'maintenanceAccount',
};
const lbl = (k: AccKey) => {
  const a = cfg.value?.[REF[k]];
  return a ? `${a.code} ${a.name}` : '';
};
const busy = ref(false);
onMounted(async () => {
  loadAccounts().catch(() => {});
  cfg.value = await api<AssetConfig>(`${AF}/config`);
  const c = cfg.value;
  Object.assign(form, {
    prefix: c.prefix, requireCustody: c.requireCustody, alertDays: c.alertDays, partialMonth: c.partialMonth,
    revaluationAccountId: c.revaluationAccountId, impairmentAccountId: c.impairmentAccountId, wipAccountId: c.wipAccountId,
    grantReleaseAccountId: c.grantReleaseAccountId, maintenanceAccountId: c.maintenanceAccountId, budgetControl: c.budgetControl ?? 'warn',
  });
});
const revenue = computed(() => subOptions((a) => a.nature === 'revenue'));
const all = computed(() => subOptions(() => true));
const ACCS: { key: AccKey; label: string; hint: string }[] = [
  { key: 'revaluationAccountId', label: 'حساب فائض إعادة التقييم', hint: 'يُقيد فيه الفرق عند زيادة القيمة العادلة للأصل' },
  { key: 'impairmentAccountId', label: 'حساب خسائر هبوط القيمة', hint: 'مصروف يُقيد فيه انخفاض القيمة القابلة للاسترداد' },
  { key: 'wipAccountId', label: 'حساب المشروعات تحت التنفيذ', hint: 'تُجمع فيه دفعات الأصول تحت الإنشاء حتى رسملتها، ولا يتغير بعد تسجيل أول دفعة' },
  { key: 'grantReleaseAccountId', label: 'حساب تحرير القيود (الأصول الممولة)', hint: 'عند اعتماد شراء أصل ممول من منحة: يُخفض صافي الأصول المقيد مقابل هذا الحساب' },
  { key: 'maintenanceAccountId', label: 'حساب مصروف الصيانة الافتراضي', hint: 'يُستخدم في سند صرف الصيانة' },
];
async function save() {
  busy.value = true;
  try {
    cfg.value = await api<AssetConfig>(`${AF}/config`, { method: 'PUT', json: form });
    reloadLookups(true).catch(() => {});
    toast.success('تم حفظ إعدادات الأصول الثابتة');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="card pm-panel">
    <h2>إعدادات الأصول الثابتة</h2>
    <form @submit.prevent="save">
      <div class="field-row">
        <label class="field"><span>بادئة ترميز الأصول</span><input v-model="form.prefix" class="input ac-code" maxlength="6" required />
          <small class="pm-muted">الترميز: البادئة ثم رمز المجموعة ثم رقم مسلسل، مثل {{ form.prefix || 'FA' }}-CAR-0001</small></label>
        <label class="field"><span>التنبيه قبل انتهاء التواريخ (أيام)</span><input v-model.number="form.alertDays" type="number" min="1" max="365" class="input" />
          <small class="pm-muted">مثل انتهاء الاستمارة أو عقود الصيانة أو الضمان</small></label>
      </div>
      <div class="field"><span>إهلاك الشهر الأول (كسر الشهر)</span>
        <div class="ac-switch">
          <button type="button" :class="{ on: form.partialMonth === 'days' }" @click="form.partialMonth = 'days'">بعدد الأيام من تاريخ الشراء</button>
          <button type="button" :class="{ on: form.partialMonth === 'next_month' }" @click="form.partialMonth = 'next_month'">من بداية الشهر التالي</button>
        </div>
        <small class="pm-muted">لا تتغير هذه القاعدة بعد ترحيل أي إهلاك، حتى لا يختلف أساس الاحتساب بين الفترات.</small>
      </div>
      <div class="accs">
        <label v-for="x in ACCS" :key="x.key" class="field"><span>{{ x.label }}</span>
          <SearchSelect v-model="form[x.key]" :options="all" :selected-label="lbl(x.key)" placeholder="ابحث برقم الحساب أو اسمه" />
          <small class="pm-muted">{{ x.hint }}</small></label>
      </div>
      <div class="field"><span>تجاوز بند الموازنة الرأسمالية عند الشراء</span>
        <div class="ac-switch">
          <button type="button" :class="{ on: form.budgetControl === 'warn' }" @click="form.budgetControl = 'warn'">تنبيه فقط</button>
          <button type="button" :class="{ on: form.budgetControl === 'block' }" @click="form.budgetControl = 'block'">منع العملية</button>
        </div>
      </div>
      <label class="fa-check"><input v-model="form.requireCustody" type="checkbox" /> الأصول المادية يجب أن تُسلَّم لموظف عند تسجيلها</label>
      <div class="info">
        <b>سندات الإهلاك وسندات الأصول الثابتة</b>
        <p>نوعان من السندات بتسلسل مستقل لكل سنة، تصدر من الأصول الثابتة فقط وتظهر في النظام المالي ضمن العمليات. لا تُعدَّل ولا تُحذف ولا تُلغى من النظام المالي، وإنما من سجل حركات الإهلاك أو عمليات الأصول.</p>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ</button></div>
    </form>
  </section>
</template>

<style scoped>
.fa-check { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
.accs { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0 16px; }
.info { border-radius: 12px; padding: 10px 14px; background: #f0f9ff; border: 1px solid #bae6fd; color: #075985; font-size: .88rem; margin-top: 12px; }
.info p { margin: 4px 0 0; }
</style>
