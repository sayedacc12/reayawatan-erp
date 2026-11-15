<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import DonorForm from '../components/DonorForm.vue';
import { fmtDate, sar } from '../labels';
import type { Donor, DonorRow, Settings } from '../types';
import '../fr.css';

const session = useSession();
const router = useRouter();
const settings = ref<Settings | null>(null);
const data = ref<{ items: DonorRow[]; total: number; page: number; pageSize: number } | null>(null);
const error = ref('');
const f = reactive({ search: '', levelId: '', type: '', active: 'true', page: 1 });
const creating = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

async function load() {
  try {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '' && v !== null).map(([k, v]) => [k, String(v)]));
    data.value = await api(`/fundraising/donors?${q}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  settings.value = await api<Settings>('/fundraising/settings').catch(() => null);
  await load();
});
watch(() => [f.levelId, f.type, f.active], () => { f.page = 1; load(); });
watch(() => f.search, () => { clearTimeout(timer); timer = setTimeout(() => { f.page = 1; load(); }, 300); });
function saved(d: Donor) {
  creating.value = false;
  router.push(`/fundraising/donors/${d.id}`);
}
</script>

<template>
  <div>
    <section class="fr-hero">
      <div>
        <p class="kicker">سجل الداعمين</p>
        <h1>شركاء الخير في مكان واحد</h1>
        <p class="sub">بيانات كل داعم ومستواه ومدير الدعم المسؤول عنه، وإجمالي ما قدّمه من فرص معتمدة.</p>
      </div>
      <div class="fr-hero-actions">
        <button v-if="session.can('fundraising.donors.manage') && settings" class="btn btn-gold" @click="creating = true">+ داعم جديد</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="fr-filters">
      <input v-model="f.search" class="input grow" placeholder="ابحث بالاسم أو الجوال أو البريد أو رقم الهوية أو رقم الداعم" />
      <select v-model="f.levelId" class="input"><option value="">كل المستويات</option><option v-for="l in settings?.levels ?? []" :key="l.id" :value="l.id">{{ l.name }}</option></select>
      <select v-model="f.type" class="input"><option value="">أفراد وجهات</option><option value="individual">أفراد</option><option value="entity">جهات</option></select>
      <select v-model="f.active" class="input"><option value="true">النشطون</option><option value="false">الموقوفون</option><option value="">الكل</option></select>
    </div>

    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>رقم</th><th>الداعم</th><th>المستوى</th><th>مدير الدعم</th><th>الجوال</th><th>عدد الفرص</th><th>إجمالي التبرعات</th><th>آخر تبرع</th></tr></thead>
        <tbody>
          <tr v-for="d in data?.items ?? []" :key="d.id" class="fr-row-link" @click="router.push(`/fundraising/donors/${d.id}`)">
            <td><span class="fr-no">{{ d.donorNo }}</span></td>
            <td><b>{{ d.name }}</b> <small class="muted">· {{ d.type === 'entity' ? 'جهة' : 'فرد' }}</small></td>
            <td><span v-if="d.levelName" class="fr-badge" :style="{ '--c': d.levelColor ?? '#e8b04b' }">{{ d.levelName }}</span><span v-else class="muted">—</span></td>
            <td>{{ d.managerName ?? '—' }}</td>
            <td dir="ltr" class="ltr-cell">{{ d.phone ?? '—' }}</td>
            <td>{{ d.opportunityCount.toLocaleString('ar-SA') }}</td>
            <td class="fr-amount">{{ sar(d.totalDonated) }}</td>
            <td>{{ fmtDate(d.lastDonation) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="data && !data.items.length" class="fr-empty">لا يوجد داعمون مطابقون</p>
    </div>
    <div v-if="data && data.total > data.pageSize" class="pager">
      <button class="btn btn-sm" :disabled="f.page <= 1" @click="f.page--; load()">السابق</button>
      <span class="muted">صفحة {{ f.page }} من {{ Math.ceil(data.total / data.pageSize) }}</span>
      <button class="btn btn-sm" :disabled="f.page * data.pageSize >= data.total" @click="f.page++; load()">التالي</button>
    </div>

    <DonorForm v-if="creating && settings" :settings="settings" @close="creating = false" @saved="saved" />
  </div>
</template>

<style scoped>
.ltr-cell { text-align: right; }
.pager { display: flex; gap: 10px; align-items: center; justify-content: center; margin-top: 14px; }
</style>
