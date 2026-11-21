
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import RiskPicker from '../components/RiskPicker.vue';
import { CONTROL_TYPES, EFFECTIVENESS, fmtDate, FREQUENCIES, loadLookups, P, type Lookups } from '../lib';
import '../../../shared/module.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const toast = useToast();
const rows = ref<any[]>([]);
const lk = ref<Lookups | null>(null);
const obligations = ref<{ id: string; code: string; title: string }[]>([]);
const blank = () => ({ id: '', name: '', description: '', type: 'preventive', automated: false, frequency: 'continuous', ownerName: '', effectiveness: 'not_tested', lastTestDate: '', lastTestNote: '', riskIds: [] as string[], obligationIds: [] as string[], isActive: true });
const form = reactive({ show: false, ...blank() });
async function load() {
  [rows.value, lk.value, obligations.value] = await Promise.all([api<any[]>('/risk/controls'), loadLookups(), api<any[]>('/risk/obligations')]);
}
onMounted(() => load().catch((e) => toast.error((e as Error).message)));
function open(c?: any) {
  Object.assign(form, blank(), c ? { ...c, description: c.description ?? '', ownerName: c.ownerName ?? '', lastTestDate: c.lastTestDate ?? '', lastTestNote: c.lastTestNote ?? '' } : {}, { show: true });
}
async function save() {
  try {
    const { show: _s, id, ...json } = form;
    await api(id ? `/risk/controls/${id}` : '/risk/controls', { method: id ? 'PATCH' : 'POST', json: { ...json, lastTestDate: json.lastTestDate || null } });
    form.show = false;
    toast.success('حُفظ الضابط');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove() {
  if (!confirm('حذف الضابط؟')) return;
  try {
    await api(`/risk/controls/${form.id}`, { method: 'DELETE' });
    form.show = false;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>مكتبة الضوابط الرقابية</h1><p class="muted">كل ضابط يرتبط بالمخاطر التي يخففها والمتطلبات التي يحققها، ويُختبر دوريًا. هذه المكتبة أساس عمل المراجعة الداخلية لاحقًا.</p></div>
      <button v-if="session.can(P.register)" class="btn btn-primary" @click="open()">ضابط جديد</button>
    </div>
    <section class="card">
      <p v-if="!rows.length" class="pm-empty">لا توجد ضوابط بعد</p>
      <div v-else class="table-wrap"><table class="table">
        <thead><tr><th>الرمز</th><th>الضابط</th><th>النوع</th><th>الدورية</th><th>المالك</th><th>المخاطر</th><th>الفاعلية</th><th>آخر اختبار</th></tr></thead>
        <tbody><tr v-for="c in rows" :key="c.id" class="rk-row" :style="{ opacity: c.isActive ? 1 : 0.5 }" @click="open(c)">
          <td class="rk-code">{{ c.code }}</td><td style="white-space: normal"><b>{{ c.name }}</b><span class="pm-muted">{{ c.automated ? 'آلي' : 'يدوي' }}</span></td>
          <td>{{ CONTROL_TYPES[c.type] }}</td><td>{{ FREQUENCIES[c.frequency] }}</td><td>{{ c.ownerName ?? '—' }}</td>
          <td><span v-for="r in c.risks" :key="r.id" class="pm-tag" style="margin-inline-end: 4px">{{ r.code }}</span></td>
          <td><span class="pm-pill" :style="{ '--c': EFFECTIVENESS[c.effectiveness].color }">{{ EFFECTIVENESS[c.effectiveness].label }}</span></td>
          <td :style="{ color: c.testOverdue ? 'var(--danger)' : '' }">{{ fmtDate(c.lastTestDate) }}</td>
        </tr></tbody>
      </table></div>
    </section>

    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal modal-wide" @submit.prevent="save">
        <fieldset :disabled="!session.can(P.register)" style="border: 0; padding: 0; margin: 0">
          <h2>{{ form.id ? 'الضابط الرقابي' : 'ضابط جديد' }}</h2>
          <label class="field"><span>اسم الضابط</span><input v-model="form.name" class="input" placeholder="مثل: تسوية بنكية شهرية يعتمدها المدير المالي" /></label>
          <div class="rk-fields">
            <label class="field"><span>النوع</span><select v-model="form.type" class="input"><option v-for="(l, k) in CONTROL_TYPES" :key="k" :value="k">{{ l }}</option></select></label>
            <label class="field"><span>الدورية</span><select v-model="form.frequency" class="input"><option v-for="(l, k) in FREQUENCIES" :key="k" :value="k">{{ l }}</option></select></label>
            <label class="field"><span>المالك</span><input v-model="form.ownerName" class="input" /></label>
            <label class="field" style="justify-content: end"><span class="check"><input v-model="form.automated" type="checkbox" /> ضابط آلي (في النظام)</span></label>
          </div>
          <label class="field"><span>الوصف</span><textarea v-model="form.description" class="input" rows="2" /></label>
          <div class="rk-sec">آخر اختبار للفاعلية</div>
          <div class="rk-fields">
            <label class="field"><span>الفاعلية</span><select v-model="form.effectiveness" class="input"><option v-for="(e, k) in EFFECTIVENESS" :key="k" :value="k">{{ e.label }}</option></select></label>
            <label class="field"><span>تاريخ الاختبار</span><input v-model="form.lastTestDate" type="date" class="input" /></label>
          </div>
          <label class="field"><span>نتيجة الاختبار</span><input v-model="form.lastTestNote" class="input" /></label>
          <div class="rk-sec">المخاطر التي يخففها</div>
          <RiskPicker v-model="form.riskIds" :options="lk?.risks ?? []" />
          <div class="rk-sec">متطلبات الالتزام التي يحققها</div>
          <RiskPicker v-model="form.obligationIds" :options="obligations" placeholder="+ ربط متطلب" />
          <label v-if="form.id" class="check" style="margin-top: 12px"><input v-model="form.isActive" type="checkbox" /> ضابط نشط</label>
        </fieldset>
        <div class="modal-actions">
          <button v-if="session.can(P.register)" class="btn btn-primary">حفظ</button>
          <button type="button" class="btn" @click="form.show = false">إغلاق</button>
          <button v-if="form.id && session.can(P.register)" type="button" class="btn btn-danger" style="margin-inline-start: auto" @click="remove">حذف</button>
        </div>
      </form>
    </div>
  </div>
</template>
