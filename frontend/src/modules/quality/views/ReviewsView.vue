<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, STATUS_COLOR, errMsg, fmtDate, todayStr } from '../lib';
import '../../../shared/module.css';
import '../quality.css';

interface Review { id: string; code: string; title: string; meetingDate: string; chairName: string; status: string; approvedByName: string | null; outputs: { status: string }[]; openOutputs: number }
const session = useSession();
const toast = useToast();
const router = useRouter();
const rows = ref<Review[]>([]);
onMounted(async () => {
  rows.value = await api<Review[]>('/quality/reviews');
});
const form = reactive({ show: false, title: 'مراجعة الإدارة لنظام الجودة', meetingDate: todayStr(), chairName: 'المدير التنفيذي', attendees: '' });
async function create() {
  try {
    const r = await api<{ id: string }>('/quality/reviews', { method: 'POST', json: { title: form.title, meetingDate: form.meetingDate, chairName: form.chairName, attendees: form.attendees || null } });
    toast.success('أُنشئ المحضر وعُبئت المدخلات من بيانات النظام');
    router.push(`/quality/reviews/${r.id}`);
  } catch (e) {
    toast.error(errMsg(e));
  }
}
</script>

<template>
  <div>
    <section class="pm-hero q-hero">
      <div><p class="pm-kicker">البندان 9.3 و5.1</p><h1>مراجعة الإدارة</h1>
        <p class="pm-sub">اجتماع الإدارة العليا لتقييم النظام. المدخلات الاثنا عشر (البند 9.3.2) تُعبأ تلقائيًا من بيانات النظام، والقرارات تُتابع حتى التنفيذ.</p></div>
      <div class="pm-actions"><button v-if="session.can(P.reviews)" class="btn q-glow" @click="form.show = true">محضر جديد</button></div>
    </section>
    <section class="card pm-panel">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الرقم</th><th>الاجتماع</th><th>التاريخ</th><th>الرئيس</th><th>القرارات</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="q-row" @click="router.push(`/quality/reviews/${r.id}`)">
            <td><span class="q-code">{{ r.code }}</span></td><td><b>{{ r.title }}</b></td><td class="q-num">{{ fmtDate(r.meetingDate) }}</td><td>{{ r.chairName }}</td>
            <td class="q-num">{{ r.outputs.length - r.openOutputs }}/{{ r.outputs.length }} منفذ</td>
            <td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[r.status] }">{{ r.status === 'approved' ? `معتمد · ${r.approvedByName}` : 'مسودة' }}</span></td>
          </tr>
          <tr v-if="!rows.length"><td colspan="6" class="pm-empty">لا توجد مراجعات</td></tr>
        </tbody>
      </table></div>
    </section>
    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" @submit.prevent="create">
        <h2>محضر مراجعة إدارة جديد</h2>
        <label class="field"><span>العنوان</span><input v-model="form.title" class="input" required /></label>
        <div class="pm-grid2">
          <label class="field"><span>تاريخ الاجتماع</span><input v-model="form.meetingDate" type="date" class="input" required /></label>
          <label class="field"><span>رئيس الاجتماع</span><input v-model="form.chairName" class="input" required /></label>
        </div>
        <label class="field"><span>الحضور</span><input v-model="form.attendees" class="input" /></label>
        <div class="modal-actions"><button class="btn btn-primary">إنشاء</button><button type="button" class="btn" @click="form.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
