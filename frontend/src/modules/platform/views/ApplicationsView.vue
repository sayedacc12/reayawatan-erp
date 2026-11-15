<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import RegistrationForm from '../../../registration/RegistrationForm.vue';
import { useToast } from '../../../stores/toast';
import { APPLICATION_STATUS, copyText, fmtDate } from '../labels';
import '../platform.css';

interface Row {
  id: string; number: string; status: string; orgName: string; city: string; licenseNumber: string; directorName: string;
  createdAt: string; organization: { id: string; slug: string } | null;
}
const route = useRoute();
const router = useRouter();
const toast = useToast();
const rows = ref<Row[]>([]);
const error = ref('');
const filter = ref<string>('submitted');
const creating = ref(route.query.new === '1');
const busy = ref(false);
const createError = ref('');

async function load() {
  try {
    rows.value = await api<Row[]>('/platform/applications');
    if (!rows.value.some((r) => r.status === 'submitted')) filter.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
const counts = computed(() => {
  const c: Record<string, number> = {};
  for (const r of rows.value) c[r.status] = (c[r.status] ?? 0) + 1;
  return c;
});
const shown = computed(() => (filter.value ? rows.value.filter((r) => r.status === filter.value) : rows.value));

async function create(fd: FormData) {
  busy.value = true;
  createError.value = '';
  try {
    const res = await api<{ id: string }>('/platform/applications', { method: 'POST', body: fd });
    toast.success('تم تسجيل الطلب، راجعه واعتمده');
    creating.value = false;
    router.push(`/platform/applications/${res.id}`);
  } catch (e) {
    createError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const registerLink = `${location.origin}/register`;
const copy = () => { copyText(registerLink); toast.success('تم نسخ رابط التسجيل'); };
</script>

<template>
  <div>
    <section class="p-hero">
      <div>
        <p class="p-kicker">اشتراكات الجمعيات</p>
        <h1>طلبات الاشتراك</h1>
        <p class="p-sub">تقدّم الجمعية طلبها برابط التسجيل العام مع مستند الترخيص، فتراجعه هنا وتحدد الشاشات والقيمة، ثم تعتمده لتُولَّد روابطها.</p>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap">
        <button class="btn btn-ghost-light" @click="copy">نسخ رابط التسجيل العام</button>
        <button class="btn btn-gold" @click="creating = true">+ تسجيل جمعية نيابة عنها</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="p-filters">
      <button :class="['p-chip', { on: !filter }]" @click="filter = ''">الكل<b>{{ rows.length }}</b></button>
      <button v-for="(s, k) in APPLICATION_STATUS" :key="k" :class="['p-chip', { on: filter === k }]" @click="filter = k">{{ s.label }}<b>{{ counts[k] ?? 0 }}</b></button>
    </div>

    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>رقم الطلب</th><th>الجمعية</th><th>المدينة</th><th>رقم الترخيص</th><th>المدير التنفيذي</th><th>تاريخ التقديم</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="r in shown" :key="r.id" class="click" @click="router.push(`/platform/applications/${r.id}`)">
            <td dir="ltr" style="text-align: right"><code>{{ r.number }}</code></td>
            <td><b>{{ r.orgName }}</b></td>
            <td>{{ r.city }}</td>
            <td dir="ltr" style="text-align: right">{{ r.licenseNumber }}</td>
            <td>{{ r.directorName }}</td>
            <td>{{ fmtDate(r.createdAt) }}</td>
            <td><span :class="['tone', `tone-${APPLICATION_STATUS[r.status].tone}`]">{{ APPLICATION_STATUS[r.status].label }}</span></td>
          </tr>
          <tr v-if="!shown.length"><td colspan="7" class="muted" style="text-align: center; padding: 28px">لا توجد طلبات {{ filter ? 'بهذه الحالة' : 'بعد' }}. شارك رابط التسجيل مع الجمعيات: <code dir="ltr">{{ registerLink }}</code></td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="creating" class="modal-backdrop" @click.self="creating = false">
      <div class="card modal modal-wide">
        <h2 style="margin-bottom: 4px">تسجيل جمعية نيابة عنها</h2>
        <p class="muted" style="margin-top: 0">نفس بيانات صفحة التسجيل العامة، ومستند الترخيص إلزامي.</p>
        <RegistrationForm mode="admin" :busy="busy" submit-label="تسجيل الطلب" @submit="create" @cancel="creating = false">
          <template #error><div v-if="createError" class="alert alert-error">{{ createError }}</div></template>
        </RegistrationForm>
      </div>
    </div>
  </div>
</template>

<style scoped>
.click { cursor: pointer; }
</style>
