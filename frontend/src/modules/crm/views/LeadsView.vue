<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import LeadForm from '../components/LeadForm.vue';
import { CR, LEAD_COLOR, fmtDateTime, lookups, relTime } from '../lib';
import '../../../shared/module.css';
import '../crm.css';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const session = useSession();
const lk = ref<any>(null);
const rows = ref<any[]>([]);
const loading = ref(true);
const adding = ref(false);
const qs = (k: string, d = '') => String(route.query[k] ?? d);
const f = ref({ q: '', status: qs('status', 'open'), scope: qs('scope'), source: '', interest: '', owner: qs('owner') });
const tabs = [
  { key: 'open', label: 'المفتوحون' }, { key: 'new', label: 'جديد' }, { key: 'contacted', label: 'تم التواصل' }, { key: 'qualified', label: 'مؤهل' },
  { key: 'converted', label: 'تحول لجهة' }, { key: 'disqualified', label: 'غير مؤهل' }, { key: '', label: 'الكل' },
];
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/crm/leads?${q}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  lk.value = await lookups().catch(() => null);
  await load();
});
let t: ReturnType<typeof setTimeout>;
watch(() => f.value.q, () => { clearTimeout(t); t = setTimeout(load, 300); });
watch(() => [f.value.status, f.value.scope, f.value.source, f.value.interest, f.value.owner], load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>العملاء المحتملون</h1>
        <p class="muted">كل من أبدى اهتمامًا ولم يتحول بعد: من الموقع أو المعارض أو الاستيراد أو الإدخال اليدوي. لكل عميل محتمل مهلة للتواصل الأول ({{ lk?.settings.slaHours ?? '—' }} ساعة)، ثم يُؤهَّل ويتحول إلى جهة، أو يُغلق بسبب.</p>
      </div>
      <div style="display: flex; gap: 8px">
        <RouterLink v-if="session.can(CR.import)" to="/crm/import" class="btn">استيراد</RouterLink>
        <button v-if="session.can(CR.manage)" class="btn btn-primary" @click="adding = true">عميل محتمل جديد</button>
      </div>
    </div>
    <div class="pm-tabs">
      <button v-for="tb in tabs" :key="tb.key" :class="['pm-tab', { on: f.status === tb.key }]" @click="f.status = tb.key">{{ tb.label }}</button>
    </div>
    <div class="cr-toolbar">
      <input v-model="f.q" class="input grow" placeholder="بحث بالاسم أو المنشأة أو الجوال أو البريد أو الحملة" />
      <select v-model="f.scope" class="input"><option value="">كل المتابعات</option><option value="mine">المسندون إليّ</option><option value="unassigned">بلا مسؤول</option><option value="overdue">تجاوزوا المهلة</option></select>
      <select v-model="f.source" class="input"><option value="">كل المصادر</option><option v-for="s in lk?.settings.sources ?? []" :key="s.key" :value="s.key">{{ s.label }}</option></select>
      <select v-model="f.interest" class="input"><option value="">كل الاهتمامات</option><option v-for="s in lk?.settings.interests ?? []" :key="s.key" :value="s.key">{{ s.label }}</option></select>
      <select v-if="lk?.can.all || lk?.can.assign" v-model="f.owner" class="input"><option value="">كل الموظفين</option><option v-for="u in lk.users" :key="u.id" :value="u.id">{{ u.fullName }}</option></select>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرمز</th><th>العميل المحتمل</th><th>المصدر والاهتمام</th><th>الحالة</th><th>المسؤول</th><th>المهلة / التالي</th><th>وصل</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="cr-row" @click="router.push(`/crm/leads/${r.id}`)">
            <td class="cr-code">{{ r.code }}</td>
            <td><b>{{ r.name }}</b><br /><small class="pm-muted">{{ [r.company, r.city].filter(Boolean).join(' · ') }}</small></td>
            <td style="font-size: .86rem">{{ r.sourceLabel }}<br /><small class="pm-muted">{{ r.interestLabel ?? '' }}{{ r.campaign ? ` · ${r.campaign}` : '' }}</small></td>
            <td><span class="cr-chip" :style="{ '--c': LEAD_COLOR[r.status] }">{{ r.statusLabel }}</span></td>
            <td><template v-if="r.ownerName">{{ r.ownerName }}</template><span v-else class="cr-flag" style="background: #fef3c7; color: #92400e">بلا مسؤول</span></td>
            <td style="font-size: .84rem">
              <span v-if="r.overdue" class="cr-flag">تجاوز المهلة {{ relTime(r.dueAt).replace('منذ ', '') }}</span>
              <template v-else-if="['new', 'contacted', 'qualified'].includes(r.status) && !r.firstContactAt">تواصل {{ relTime(r.dueAt) }}</template>
              <template v-else-if="r.nextActivity">التالي {{ fmtDateTime(r.nextActivity) }}</template>
              <template v-else>—</template>
            </td>
            <td class="pm-muted" style="font-size: .84rem">{{ relTime(r.createdAt) }}</td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="7" class="cr-empty">لا يوجد عملاء محتملون مطابقون.</td></tr>
        </tbody>
      </table>
    </div>
    <LeadForm v-if="adding && lk" :lk="lk" @close="adding = false" @saved="(r) => router.push(`/crm/leads/${r.id}`)" />
  </div>
</template>
