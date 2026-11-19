<script setup lang="ts">
/** إعدادات الأصول الثابتة داخل إعدادات النظام المالي */
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import SearchSelect from '../../fundraising/components/SearchSelect.vue';
import { AF, useLookups, type AssetConfig } from '../assets';
import { useAccounts } from '../lib';

const toast = useToast();
const { load: reloadLookups } = useLookups();
const { load: loadAccounts, subOptions } = useAccounts();
const cfg = ref<AssetConfig | null>(null);
const form = reactive({ prefix: 'FA', requireCustody: true, alertDays: 30, partialMonth: 'days' as 'days' | 'next_month', donationAccountId: null as string | null });
const busy = ref(false);
onMounted(async () => {
  loadAccounts().catch(() => {});
  cfg.value = await api<AssetConfig>(`${AF}/config`);
  Object.assign(form, { prefix: cfg.value.prefix, requireCustody: cfg.value.requireCustody, alertDays: cfg.value.alertDays, partialMonth: cfg.value.partialMonth, donationAccountId: cfg.value.donationAccountId });
});
const revenue = computed(() => subOptions((a) => a.nature === 'revenue'));
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
      <label class="field"><span>حساب التبرعات العينية (للأصول المتبرع بها)</span>
        <SearchSelect v-model="form.donationAccountId" :options="revenue" :selected-label="cfg?.donationAccount ? `${cfg.donationAccount.code} ${cfg.donationAccount.name}` : ''" placeholder="ابحث برقم الحساب أو اسمه" />
      </label>
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
.info { border-radius: 12px; padding: 10px 14px; background: #f0f9ff; border: 1px solid #bae6fd; color: #075985; font-size: .88rem; margin-top: 12px; }
.info p { margin: 4px 0 0; }
</style>
