<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../../api';
import { useSession } from '../../../../stores/session';
import { useToast } from '../../../../stores/toast';
import SearchSelect from '../../../fundraising/components/SearchSelect.vue';
import { AF, type AssetRow } from '../../assets';
import { P, sar } from '../../lib';
import '../../../projects/projects.css';
import '../../acc.css';
import './assets.css';

interface Row { id: string; assetId: string; code: string; name: string; groupName: string; asOf: string; purchaseDate: string; cost: number; accum: number; nbv: number; locked: boolean; createdByName: string }
const session = useSession();
const toast = useToast();
const data = ref<{ defaultDate: string | null; rows: Row[]; totals: { cost: number; accum: number } } | null>(null);
const drafts = ref<AssetRow[]>([]);
const error = ref('');
async function load() {
  try {
    [data.value, drafts.value] = await Promise.all([api<typeof data.value>(`${AF}/opening`), api<AssetRow[]>(`${AF}?status=draft`)]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const form = reactive({ assetId: null as string | null, purchaseDate: '', asOf: '', cost: null as number | null, accum: 0 as number | null });
const editing = ref<Row | null>(null);
const options = computed(() => drafts.value.map((a) => ({ id: a.id, label: `${a.code} ${a.name}`, sub: a.groupName })));
const nbv = computed(() => Number(form.cost || 0) - Number(form.accum || 0));
function reset() {
  editing.value = null;
  Object.assign(form, { assetId: null, purchaseDate: '', asOf: data.value?.defaultDate ?? '', cost: null, accum: 0 });
}
function edit(r: Row) {
  editing.value = r;
  Object.assign(form, { assetId: r.assetId, purchaseDate: r.purchaseDate, asOf: r.asOf, cost: r.cost, accum: r.accum });
}
async function save() {
  try {
    await api(`${AF}/opening`, { method: 'POST', json: { ...form, accum: form.accum ?? 0 } });
    toast.success('تم حفظ الرصيد الافتتاحي');
    await load();
    reset();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove(r: Row) {
  if (!confirm(`حذف الرصيد الافتتاحي للأصل ${r.code}؟`)) return;
  try {
    await api(`${AF}/opening/${r.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(async () => { await load(); reset(); });
</script>

<template>
  <div>
    <section class="pm-hero ac-hero fa-hero">
      <div>
        <p class="pm-kicker">الأصول الثابتة</p>
        <h1>الأرصدة الافتتاحية للأصول</h1>
        <p class="pm-sub">للأصول الموجودة قبل بدء استخدام النظام: تاريخ الشراء، وقيمة الأصل عند الشراء، ورصيد مجمع الإهلاك في تاريخ الافتتاح. ثم يُسجَّل القيد الافتتاحي بالإجماليات نفسها في النظام المالي لتتطابق الأرصدة.</p>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="fa-grid2" style="grid-template-columns: minmax(0, 1fr) minmax(0, 2fr)">
      <form v-if="session.can(P.assetsManage)" class="card pm-panel" @submit.prevent="save">
        <h2>{{ editing ? `تعديل رصيد ${editing.code}` : 'رصيد افتتاحي جديد' }}</h2>
        <label class="field"><span>الأصل</span>
          <SearchSelect v-model="form.assetId" :options="options" :selected-label="editing ? `${editing.code} ${editing.name}` : ''" placeholder="الأصول المسجلة بلا قيمة" required />
        </label>
        <label class="field"><span>تاريخ شراء الأصل</span><input v-model="form.purchaseDate" type="date" class="input" required /></label>
        <label class="field"><span>تاريخ الرصيد الافتتاحي</span><input v-model="form.asOf" type="date" class="input" required />
          <small class="pm-muted">قبل بداية أول سنة مالية في النظام، ويُحتسب الإهلاك بعده</small></label>
        <label class="field"><span>قيمة الأصل عند الشراء (ريال)</span><input v-model.number="form.cost" type="number" min="0.01" step="0.01" class="input" required /></label>
        <label class="field"><span>رصيد مجمع الإهلاك (ريال)</span><input v-model.number="form.accum" type="number" min="0" step="0.01" class="input" />
          <small :class="nbv < 1 ? 'fa-money-neg' : 'pm-muted'">صافي القيمة {{ sar(nbv) }} (لا يقل عن ريال واحد)</small></label>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button v-if="editing" type="button" class="btn" @click="reset">إلغاء التعديل</button></div>
      </form>

      <section class="card pm-panel">
        <h2>الأرصدة المسجلة <span v-if="data?.defaultDate" class="pm-tag">في {{ data.defaultDate }}</span></h2>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>الأصل</th><th>المجموعة</th><th>تاريخ الشراء</th><th>القيمة عند الشراء</th><th>مجمع الإهلاك</th><th>صافي القيمة</th><th></th></tr></thead>
            <tbody>
              <tr v-for="r in data?.rows ?? []" :key="r.id">
                <td><RouterLink :to="`/accounting/assets/${r.assetId}`" class="pm-link"><span class="ac-code">{{ r.code }}</span></RouterLink> {{ r.name }}</td>
                <td>{{ r.groupName }}</td><td>{{ r.purchaseDate }}</td><td class="ac-num">{{ sar(r.cost) }}</td><td class="ac-num">{{ sar(r.accum) }}</td><td class="ac-num"><b>{{ sar(r.nbv) }}</b></td>
                <td class="acts">
                  <template v-if="!r.locked && session.can(P.assetsManage)"><button class="btn btn-sm" @click="edit(r)">تعديل</button><button class="btn btn-sm" @click="remove(r)">حذف</button></template>
                  <span v-else-if="r.locked" class="pm-tag" title="احتُسب إهلاك بعد الرصيد الافتتاحي">مقفل</span>
                </td>
              </tr>
              <tr v-if="!data?.rows.length"><td colspan="7" class="pm-empty">لا توجد أرصدة افتتاحية</td></tr>
            </tbody>
            <tfoot v-if="data?.rows.length"><tr><td colspan="3"><b>الإجمالي</b></td><td class="ac-num"><b>{{ sar(data.totals.cost) }}</b></td><td class="ac-num"><b>{{ sar(data.totals.accum) }}</b></td><td class="ac-num"><b>{{ sar(data.totals.cost - data.totals.accum) }}</b></td><td /></tr></tfoot>
          </table>
        </div>
        <p class="fa-info" style="margin-top: 12px">بعد إدخال الأرصدة: سجّل قيدًا افتتاحيًا في النظام المالي يجعل حساب كل مجموعة مدينًا بإجمالي قيمها، وحساب مجمع إهلاكها دائنًا بإجمالي المجمع. تقرير المطابقة يوضح أي فرق.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.acts { white-space: nowrap; }
</style>
