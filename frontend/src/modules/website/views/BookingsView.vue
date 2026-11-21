<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { BOOKING_STATUSES, P, riyadh, type Any } from '../lib';
import '../../../shared/module.css';
import '../../../shared/ws.css';
import '../website.css';

const session = useSession();
const toast = useToast();
const when = ref('upcoming');
const rows = ref<Any[] | null>(null);
const error = ref('');
const people = ref<{ id: string; fullName: string }[]>([]);
const canManage = computed(() => session.can(P.bookings));
const edit = ref<Any>(null);
const form = reactive({ status: '', meetingUrl: '', consultantId: '', reason: '', notifyVisitor: true });
const busy = ref(false);

async function load() {
  try { rows.value = await api(`/website/bookings?when=${when.value}`); error.value = ''; } catch (e) { error.value = (e as Error).message; }
}
onMounted(async () => {
  await load();
  if (canManage.value) people.value = await api<typeof people.value>('/website/assignees').catch(() => []);
});
watch(when, load);
function open(b: Any) {
  edit.value = b;
  Object.assign(form, { status: b.status, meetingUrl: b.meetingUrl ?? '', consultantId: b.consultantId ?? '', reason: '', notifyVisitor: true });
}
async function save() {
  busy.value = true;
  try {
    await api(`/website/bookings/${edit.value.id}`, { method: 'PUT', json: {
      status: form.status, meetingUrl: form.meetingUrl.trim() || null, consultantId: form.consultantId || null,
      ...(form.reason.trim() ? { reason: form.reason } : {}), notifyVisitor: form.notifyVisitor,
    } });
    toast.success('حُفظ الحجز');
    edit.value = null;
    await load();
  } catch (e) { toast.error((e as Error).message); } finally { busy.value = false; }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>حجوزات جلسات التشخيص</h1><p class="muted" style="margin: 4px 0 0">الجلسات المجانية التي حجزها العملاء من الموقع. أكّدوا الموعد وأضيفوا رابط الاجتماع ليصل للعميل على بريده.</p></div>
      <RouterLink v-if="canManage" to="/website/availability" class="btn">أوقات الإتاحة</RouterLink>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="ws-tabs">
      <button v-for="t in [{ v: 'upcoming', l: 'القادمة' }, { v: 'past', l: 'السابقة' }, { v: 'all', l: 'الكل' }]" :key="t.v" :class="['ws-tab', { on: when === t.v }]" @click="when = t.v">{{ t.l }}</button>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الموعد</th><th>العميل</th><th>الموضوع</th><th>المستشار</th><th>الحالة</th><th /></tr></thead>
        <tbody>
          <tr v-for="b in rows ?? []" :key="b.id">
            <td>{{ riyadh(b.startsAt) }}</td>
            <td><RouterLink :to="`/website/leads/${b.leadId}`"><b>{{ b.name }}</b></RouterLink><br><small class="muted">{{ b.orgName || b.email }}</small></td>
            <td style="white-space: normal; max-width: 260px">{{ b.topic || '—' }}</td>
            <td>{{ b.consultantName ?? '—' }}</td>
            <td><span class="ws-pill" :style="{ '--c': BOOKING_STATUSES[b.status]?.c }">{{ BOOKING_STATUSES[b.status]?.l }}</span><br><small v-if="b.cancelReason" class="muted">{{ b.cancelReason }}</small></td>
            <td><button v-if="canManage" class="btn btn-sm" @click="open(b)">إدارة</button> <a v-if="b.meetingUrl" :href="b.meetingUrl" target="_blank" rel="noopener" class="btn btn-sm">الاجتماع ↗</a></td>
          </tr>
          <tr v-if="rows && !rows.length"><td colspan="6" class="ws-empty">لا توجد حجوزات.</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="edit" class="modal-backdrop" @click.self="edit = null">
      <div class="card modal">
        <h2 style="margin-bottom: 4px">{{ edit.name }}</h2>
        <p class="muted" style="margin-top: 0">{{ riyadh(edit.startsAt) }}</p>
        <div class="field"><label>الحالة</label><select v-model="form.status" class="input"><option v-for="(s, k) in BOOKING_STATUSES" :key="k" :value="k">{{ s.l }}</option></select></div>
        <div class="field"><label>رابط الاجتماع المرئي</label><input v-model="form.meetingUrl" class="input" dir="ltr" placeholder="https://"></div>
        <div class="field"><label>المستشار</label><select v-model="form.consultantId" class="input"><option value="">—</option><option v-for="p in people" :key="p.id" :value="p.id">{{ p.fullName }}</option></select></div>
        <div v-if="form.status === 'cancelled'" class="field"><label>سبب الإلغاء</label><input v-model="form.reason" class="input"></div>
        <label class="check"><input v-model="form.notifyVisitor" type="checkbox"> إبلاغ العميل بالتأكيد أو الإلغاء على بريده</label>
        <div class="modal-actions" style="margin-top: 14px"><button class="btn btn-primary" :disabled="busy" @click="save">حفظ</button><button class="btn" @click="edit = null">إغلاق</button></div>
      </div>
    </div>
  </div>
</template>
