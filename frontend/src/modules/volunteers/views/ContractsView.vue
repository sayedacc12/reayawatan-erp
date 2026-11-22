<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import StatusPill from '../components/StatusPill.vue';
import { CONTRACT_STATUS, P, copy, fmtDate, fmtDateTime, publicUrl } from '../lib';
import '../../../shared/module.css';
import '../volunteers.css';

interface Row {
  id: string; contractNo: string; volunteerId: string; volunteerName: string; startDate: string; endDate: string; status: string; signedName: string | null;
  signedAt: string | null; signedVia: string | null; issuedByName: string; createdAt: string; signToken: string; expired: boolean;
}
const session = useSession();
const toast = useToast();
const rows = ref<Row[]>([]);
const status = ref('');
const load = async () => (rows.value = await api<Row[]>('/volunteers/contracts'));
onMounted(() => load().catch((e) => toast.error((e as Error).message)));
const shown = computed(() => rows.value.filter((r) => !status.value || r.status === status.value));
async function copyLink(r: Row) {
  if (await copy(publicUrl(`/v/contract/${r.signToken}`))) toast.success('نُسخ رابط التوقيع، أرسله للمتطوع');
}
</script>

<template>
  <div>
    <section class="pm-hero vt-hero">
      <div><p class="pm-kicker">المتطوعون</p><h1>عقود التطوع</h1>
        <p class="pm-sub">يصدر العقد من ملف المتطوع بالفقرات المفعّلة في الإعدادات، ويوقّعه المتطوع إلكترونيًا من رابطه، أو ورقيًا ويسجّل الموظف التوقيع.</p></div>
      <div class="pm-actions">
        <RouterLink v-if="session.can(P.settings)" to="/volunteers/settings?tab=contract" class="btn vt-ghost">تعديل فقرات العقد</RouterLink>
      </div>
    </section>
    <div class="vt-toolbar">
      <div class="vt-tabs" style="margin: 0">
        <button :class="['vt-tab', { on: !status }]" @click="status = ''">الكل</button>
        <button v-for="(l, k) in CONTRACT_STATUS" :key="k" :class="['vt-tab', { on: status === k }]" @click="status = k">{{ l }}</button>
      </div>
    </div>
    <section class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>رقم العقد</th><th>المتطوع</th><th>المدة</th><th>الحالة</th><th>التوقيع</th><th /></tr></thead>
          <tbody>
            <tr v-for="r in shown" :key="r.id">
              <td><RouterLink :to="`/volunteers/contracts/${r.id}`" class="pm-link vt-code">{{ r.contractNo }}</RouterLink></td>
              <td><RouterLink :to="`/volunteers/list/${r.volunteerId}`" class="pm-link">{{ r.volunteerName }}</RouterLink></td>
              <td>{{ fmtDate(r.startDate) }} إلى {{ fmtDate(r.endDate) }}<span v-if="r.expired" class="pm-muted" style="display: block">منتهي</span></td>
              <td><StatusPill :status="r.status" :label="CONTRACT_STATUS[r.status]" /></td>
              <td>{{ r.signedAt ? `${r.signedVia === 'paper' ? 'ورقي' : 'إلكتروني'} · ${fmtDateTime(r.signedAt)}` : '—' }}</td>
              <td><button v-if="r.status === 'issued'" class="btn btn-sm" @click="copyLink(r)">نسخ رابط التوقيع</button></td>
            </tr>
            <tr v-if="!shown.length"><td colspan="6" class="pm-empty">لا توجد عقود</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
