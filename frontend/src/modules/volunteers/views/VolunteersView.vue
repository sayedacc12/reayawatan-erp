<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import StatusPill from '../components/StatusPill.vue';
import VolunteerForm from '../components/VolunteerForm.vue';
import { CONTRACT_STATUS, P, VOL_STATUS, copy, exportCsv, fmtDate, loadLookups, lookups, num, publicUrl, type VolunteerRow } from '../lib';
import '../../projects/projects.css';
import '../volunteers.css';

const session = useSession();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const rows = ref<VolunteerRow[]>([]);
const error = ref('');
const q = reactive({ status: (route.query.status as string) ?? '', search: '', type: '', field: '' });
const showNew = ref(route.query.new === '1');
async function load() {
  try {
    const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    rows.value = await api<VolunteerRow[]>(`/volunteers/volunteers?${params}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await loadLookups().catch(() => null);
  await load();
});
let timer: ReturnType<typeof setTimeout> | undefined;
watch(() => ({ ...q }), () => {
  clearTimeout(timer);
  timer = setTimeout(load, 250);
});
function saved(v: { id: string }) {
  showNew.value = false;
  toast.success('سُجل المتطوع');
  router.push(`/volunteers/list/${v.id}`);
}
const joinLink = () => publicUrl(`/v/${session.user?.organizationSlug}`);
async function copyJoin() {
  if (await copy(joinLink())) toast.success('نُسخ رابط صفحة التطوع العامة');
}
function exportRows() {
  exportCsv('سجل المتطوعين', ['الرقم', 'الاسم', 'الهوية', 'الجوال', 'الجنس', 'المدينة', 'النوع', 'المجالات', 'الحالة', 'الساعات', 'الفعاليات'],
    rows.value.map((r) => [r.volunteerNo, r.fullName, r.nationalId, r.mobile, r.gender === 'female' ? 'أنثى' : 'ذكر', r.city, r.typeName, r.fields.join('، '), r.statusLabel, r.hours, r.events]));
}
</script>

<template>
  <div>
    <section class="pm-hero vt-hero">
      <div><p class="pm-kicker">المتطوعون</p><h1>سجل المتطوعين</h1>
        <p class="pm-sub">كل متطوع بنوع تطوعه ومجالاته وساعاته. التسجيل من الموظف، أو من المتطوع نفسه عبر صفحة الجمعية العامة ثم يقبله الموظف.</p></div>
      <div class="pm-actions">
        <button v-if="session.can(P.volunteers)" class="btn vt-glow" @click="showNew = true">تسجيل متطوع</button>
        <button class="btn vt-ghost" @click="copyJoin">نسخ رابط التسجيل العام</button>
        <button class="btn vt-ghost" @click="exportRows">تصدير Excel</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="vt-toolbar">
      <input v-model="q.search" class="input grow" placeholder="بحث بالاسم أو الهوية أو الجوال" />
      <select v-model="q.status" class="input"><option value="">كل الحالات</option><option v-for="s in VOL_STATUS" :key="s.value" :value="s.value">{{ s.label }}</option></select>
      <select v-model="q.type" class="input"><option value="">كل الأنواع</option><option v-for="t in lookups?.volunteerTypes" :key="t.code" :value="t.code">{{ t.name }}</option></select>
      <select v-model="q.field" class="input"><option value="">كل المجالات</option><option v-for="t in lookups?.volunteerFields" :key="t.code" :value="t.code">{{ t.name }}</option></select>
    </div>
    <section class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الرقم</th><th>المتطوع</th><th>النوع والمجالات</th><th>الساعات</th><th>العقد</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id" class="vt-row" @click="$router.push(`/volunteers/list/${r.id}`)">
              <td class="vt-num">{{ r.volunteerNo }}</td>
              <td><b>{{ r.fullName }}</b><span class="pm-muted" style="display: block"><span class="vt-code">{{ r.mobile }}</span> · {{ r.city ?? '—' }} · {{ r.gender === 'female' ? 'أنثى' : 'ذكر' }}</span></td>
              <td class="vt-wrap">{{ r.typeName ?? '—' }}<span class="pm-muted" style="display: block">{{ r.fields.join('، ') }}</span></td>
              <td class="vt-num"><b>{{ num(r.hours) }}</b> ساعة<span class="pm-muted" style="display: block">{{ r.events }} فعالية</span></td>
              <td>{{ r.contractStatus ? CONTRACT_STATUS[r.contractStatus] : '—' }}</td>
              <td><StatusPill :status="r.status" :label="r.statusLabel" /><span class="pm-muted" style="display: block">{{ r.source === 'public' ? 'تسجيل ذاتي' : 'سجّله موظف' }} · {{ fmtDate(r.createdAt) }}</span></td>
            </tr>
            <tr v-if="!rows.length"><td colspan="6" class="pm-empty">لا يوجد متطوعون بهذه التصفية</td></tr>
          </tbody>
        </table>
      </div>
    </section>
    <div v-if="showNew && lookups" class="modal-backdrop" @click.self="showNew = false">
      <div class="card modal modal-wide">
        <h2>تسجيل متطوع جديد</h2>
        <VolunteerForm :lookups="lookups" @saved="saved" @cancel="showNew = false" />
      </div>
    </div>
  </div>
</template>
