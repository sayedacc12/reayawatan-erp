<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { fmtDate } from '../labels';
import { NOTICE_REASON, daysLabel, inDays, reminderText, reminderWa, type DeletionNotice } from '../lifecycle';
import '../platform.css';

/** مواعيد حذف الجمعيات: جمعيات التجربة والإنهاءات بالتراضي، مع تذكير المشغلين، وسجل الجمعيات المحذوفة */
interface Upcoming extends DeletionNotice { id: string; name: string; slug: string; directorName: string | null; phone: string | null }
interface Deleted { id: string; orgName: string; orgSlug: string; reason: 'mutual' | 'trial_expired'; deletedAt: string; deletedRecords: number | null; requestedBy: string; log: { by: string; action: string }[] }
interface Overview { today: string; settings: { trialGraceDays: number }; upcoming: Upcoming[]; deleted: Deleted[] }

const router = useRouter();
const toast = useToast();
const data = ref<Overview | null>(null);
const grace = ref(7);
const busy = ref(false);

async function load() {
  data.value = await api<Overview>('/platform/lifecycle');
  grace.value = data.value.settings.trialGraceDays;
}
onMounted(() => load().catch((e) => toast.error((e as Error).message)));

async function saveGrace() {
  busy.value = true;
  try {
    await api('/platform/lifecycle/settings', { method: 'PUT', json: { trialGraceDays: Number(grace.value) } });
    toast.success('تم حفظ مهلة الحذف');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const tone = (u: Upcoming) => (u.reason === 'trial' ? (u.daysToTrialEnd! <= 3 ? 'bad' : u.daysToTrialEnd! <= 7 ? 'warn' : 'info') : 'bad');
const deletedBy = (d: Deleted) => d.log.find((e) => e.action === 'deleted')?.by ?? d.requestedBy;
</script>

<template>
  <div>
    <section class="p-hero">
      <div>
        <p class="p-kicker">إدارة المنصة</p>
        <h1>مواعيد حذف الجمعيات</h1>
        <p class="p-sub">جمعيات التجربة تُحذف تلقائيًا بعد انتهاء التجربة بالمهلة، والجمعيات المنتهي عقدها بالتراضي في الموعد المتفق عليه.</p>
      </div>
    </section>

    <section class="card p-panel">
      <h2>مهلة الحذف بعد انتهاء التجربة</h2>
      <form class="grace" @submit.prevent="saveGrace">
        <input v-model.number="grace" class="input" type="number" min="0" max="365" required />
        <span>يومًا بعد آخر يوم في التجربة، ثم تُحذف الجمعية وكل بياناتها إن لم يتم التعاقد.</span>
        <button class="btn btn-primary btn-sm" :disabled="busy">حفظ</button>
      </form>
      <p class="muted small">يتوقف دخول الجمعية يوم انتهاء التجربة. لتجنب الحذف: مدّد التجربة أو غيّر حالة الاشتراك من ملف الجمعية.</p>
    </section>

    <section v-if="data" class="card p-panel">
      <h2>الحذف القادم ({{ data.upcoming.length }})</h2>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الجمعية</th><th>الحالة</th><th>نهاية التجربة</th><th>موعد الحذف</th><th>تذكير المشغل</th></tr></thead>
          <tbody>
            <tr v-for="u in data.upcoming" :key="u.id">
              <td><a href="#" @click.prevent="router.push(`/platform/organizations/${u.id}`)">{{ u.name }}</a> <small class="muted" dir="ltr">{{ u.slug }}</small></td>
              <td><span :class="['tone', `tone-${tone(u)}`]">{{ NOTICE_REASON[u.reason] }}<template v-if="u.reason === 'trial'"> · متبقٍ {{ daysLabel(u.daysToTrialEnd ?? 0) }}</template></span></td>
              <td>{{ fmtDate(u.trialEndsOn) }}</td>
              <td><b>{{ fmtDate(u.deleteOn) }}</b> <small class="muted">({{ inDays(u.daysToDelete) }})</small></td>
              <td>
                <a v-if="u.phone" class="btn btn-sm" :href="reminderWa(u.phone, reminderText(u.name, u))" target="_blank" rel="noopener">واتساب {{ u.directorName ?? '' }}</a>
                <small v-else class="muted">لا يوجد جوال في البيانات الرئيسية</small>
              </td>
            </tr>
            <tr v-if="!data.upcoming.length"><td colspan="5" class="muted" style="text-align: center">لا توجد جمعيات مجدول حذفها</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="data" class="card p-panel">
      <h2>الجمعيات المحذوفة</h2>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الجمعية</th><th>السبب</th><th>تاريخ الحذف</th><th>السجلات</th><th>نفّذه</th></tr></thead>
          <tbody>
            <tr v-for="d in data.deleted" :key="d.id">
              <td>{{ d.orgName }} <small class="muted" dir="ltr">{{ d.orgSlug }}</small></td>
              <td>{{ d.reason === 'mutual' ? 'إنهاء بالتراضي' : 'انتهت التجربة دون تعاقد' }}</td>
              <td>{{ fmtDate(d.deletedAt) }}</td>
              <td>{{ (d.deletedRecords ?? 0).toLocaleString('ar-SA') }}</td>
              <td>{{ deletedBy(d) }}</td>
            </tr>
            <tr v-if="!data.deleted.length"><td colspan="5" class="muted" style="text-align: center">لم تُحذف أي جمعية بعد</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.p-panel { margin-bottom: 16px; }
.grace { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.grace .input { width: 90px; }
.small { font-size: .86rem; }
</style>
