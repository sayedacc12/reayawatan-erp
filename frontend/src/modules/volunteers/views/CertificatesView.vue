<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, fmtDate, num, type VolunteerRow } from '../lib';
import '../../../shared/module.css';
import '../volunteers.css';

interface Cert {
  id: string; certificateNo: string; kind: 'hours' | 'thanks'; title: string; hours: number; issuedOn: string; issuedByName: string; isRevoked: boolean; verifyCode: string;
  volunteerId: string; volunteerName: string; volunteerNo: number; eventTitle: string | null;
}
const session = useSession();
const toast = useToast();
const router = useRouter();
const rows = ref<Cert[]>([]);
const kind = ref('');
const search = ref('');
const load = async () => (rows.value = await api<Cert[]>('/volunteers/certificates'));
onMounted(() => load().catch((e) => toast.error((e as Error).message)));
const shown = computed(() => rows.value.filter((r) => (!kind.value || r.kind === kind.value) && (!search.value || r.volunteerName.includes(search.value) || r.certificateNo.includes(search.value))));
const f = reactive({ show: false, volunteerId: '', kind: 'hours' as 'hours' | 'thanks', periodFrom: '', periodTo: '', vols: [] as VolunteerRow[] });
async function openNew() {
  f.show = true;
  f.vols = (await api<VolunteerRow[]>('/volunteers/volunteers?status=active')).filter((v) => v.hours > 0);
}
async function issue() {
  try {
    const c = await api<{ id: string }>('/volunteers/certificates', { method: 'POST', json: { volunteerId: f.volunteerId, kind: f.kind, periodFrom: f.periodFrom || null, periodTo: f.periodTo || null } });
    f.show = false;
    toast.success('صدرت الشهادة');
    router.push(`/volunteers/certificates/${c.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <section class="pm-hero vt-hero">
      <div><p class="pm-kicker">المتطوعون</p><h1>شهادات التطوع</h1>
        <p class="pm-sub">شهادة الساعات التطوعية تُحسب من الحضور المعتمد في الفعاليات، وشهادة الشكر لمن شارك فعليًا. لكل شهادة رمز تحقق يتأكد به أي طرف من صحتها.</p></div>
      <div class="pm-actions"><button v-if="session.can(P.certificates)" class="btn vt-glow" @click="openNew">إصدار شهادة</button></div>
    </section>
    <div class="vt-toolbar">
      <input v-model="search" class="input grow" placeholder="بحث باسم المتطوع أو رقم الشهادة" />
      <select v-model="kind" class="input"><option value="">كل الشهادات</option><option value="hours">شهادات الساعات</option><option value="thanks">شهادات الشكر</option></select>
    </div>
    <section class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الرقم</th><th>المتطوع</th><th>الشهادة</th><th>الساعات</th><th>الإصدار</th><th>رمز التحقق</th></tr></thead>
          <tbody>
            <tr v-for="c in shown" :key="c.id" class="vt-row" @click="$router.push(`/volunteers/certificates/${c.id}`)">
              <td class="vt-code">{{ c.certificateNo }}</td>
              <td><b>{{ c.volunteerName }}</b></td>
              <td class="vt-wrap">{{ c.title }}<span v-if="c.eventTitle" class="pm-muted" style="display: block">{{ c.eventTitle }}</span><span v-if="c.isRevoked" class="pm-pill" style="--c: #ef4444">ملغاة</span></td>
              <td class="vt-num">{{ c.kind === 'hours' ? num(c.hours) : '—' }}</td>
              <td>{{ fmtDate(c.issuedOn) }}<span class="pm-muted" style="display: block">{{ c.issuedByName }}</span></td>
              <td class="vt-code">{{ c.verifyCode }}</td>
            </tr>
            <tr v-if="!shown.length"><td colspan="6" class="pm-empty">لا توجد شهادات</td></tr>
          </tbody>
        </table>
      </div>
    </section>
    <div v-if="f.show" class="modal-backdrop" @click.self="f.show = false">
      <form class="card modal" @submit.prevent="issue">
        <h2>إصدار شهادة</h2>
        <label class="field"><span>المتطوع (لهم ساعات معتمدة)</span>
          <select v-model="f.volunteerId" class="input" required><option value="" disabled>اختر</option><option v-for="v in f.vols" :key="v.id" :value="v.id">{{ v.fullName }} · {{ num(v.hours) }} ساعة</option></select>
        </label>
        <label class="field"><span>نوع الشهادة</span><select v-model="f.kind" class="input"><option value="hours">شهادة ساعات تطوعية</option><option value="thanks">شهادة شكر وتقدير</option></select></label>
        <div class="pm-grid2">
          <label class="field"><span>من تاريخ (اختياري)</span><input v-model="f.periodFrom" type="date" class="input" /></label>
          <label class="field"><span>إلى تاريخ (اختياري)</span><input v-model="f.periodTo" type="date" class="input" /></label>
        </div>
        <p class="pm-muted">لشهادة عن فعالية واحدة، أصدرها من ملف المتطوع.</p>
        <div class="modal-actions"><button class="btn btn-primary">إصدار</button><button type="button" class="btn" @click="f.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
