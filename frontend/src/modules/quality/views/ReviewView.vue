<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { OUTPUT_TYPES, P, STATUS_COLOR, errMsg, fmtDate, label, todayStr } from '../lib';
import '../../../shared/module.css';
import '../quality.css';

interface Output { id?: string; type: string; decision: string; ownerName: string; dueDate: string | null; status: 'open' | 'done'; overdue?: boolean }
interface Review {
  id: string; code: string; title: string; meetingDate: string; chairName: string; attendees: string | null; inputs: { key: string; title: string; summary: string }[];
  outputs: Output[]; minutes: string | null; status: 'draft' | 'approved'; approvedByName: string | null; approvedAt: string | null;
}
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const router = useRouter();
const r = ref<Review | null>(null);
const form = reactive({ title: '', meetingDate: '', chairName: '', attendees: '', minutes: '', inputs: [] as Review['inputs'], outputs: [] as Output[] });
function fill(x: Review) {
  r.value = x;
  Object.assign(form, { title: x.title, meetingDate: x.meetingDate, chairName: x.chairName, attendees: x.attendees ?? '', minutes: x.minutes ?? '', inputs: x.inputs.map((i) => ({ ...i })), outputs: x.outputs.map((o) => ({ ...o })) });
}
onMounted(async () => fill(await api<Review>(`/quality/reviews/${props.id}`)));
const draft = computed(() => r.value?.status === 'draft' && session.can(P.reviews));
const payload = () => ({
  title: form.title, meetingDate: form.meetingDate, chairName: form.chairName, attendees: form.attendees || null, minutes: form.minutes || null,
  inputs: form.inputs.map(({ key, title, summary }) => ({ key, title, summary })),
  outputs: form.outputs.map((o) => ({ id: o.id, type: o.type, decision: o.decision, ownerName: o.ownerName, dueDate: o.dueDate || null, status: o.status })),
});
async function save() {
  try {
    fill(await api<Review>(`/quality/reviews/${props.id}`, { method: 'PUT', json: payload() }));
    toast.success('حُفظ المحضر');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
async function refresh() {
  if (!confirm('تحديث المدخلات من بيانات النظام الحالية؟ ستُستبدل النصوص المعدلة.')) return;
  fill(await api<Review>(`/quality/reviews/${props.id}/refresh-inputs`, { method: 'POST' }));
}
async function approve() {
  try {
    await api(`/quality/reviews/${props.id}`, { method: 'PUT', json: payload() });
    fill(await api<Review>(`/quality/reviews/${props.id}/approve`, { method: 'POST' }));
    toast.success('اعتُمد المحضر، وستُتابع القرارات حتى التنفيذ');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
async function remove() {
  if (!confirm('حذف هذا المحضر؟')) return;
  await api(`/quality/reviews/${props.id}`, { method: 'DELETE' });
  router.push('/quality/reviews');
}
const printPage = () => window.print();
</script>

<template>
  <div v-if="r">
    <section class="pm-hero q-hero no-print">
      <div><p class="pm-kicker"><span class="q-code" style="background: rgba(255,255,255,.12); color: #fcd34d">{{ r.code }}</span> · نموذج QF-QMS-06</p><h1>{{ r.title }}</h1>
        <p class="pm-sub">{{ fmtDate(r.meetingDate) }} · برئاسة {{ r.chairName }} · {{ r.status === 'approved' ? `اعتمده ${r.approvedByName} ${fmtDate(r.approvedAt)}` : 'مسودة' }}</p></div>
      <div class="pm-actions">
        <template v-if="draft"><button class="btn q-ghost" @click="refresh">تحديث المدخلات</button><button class="btn q-ghost" @click="save">حفظ</button></template>
        <button v-if="r.status === 'draft' && session.can(P.approveReviews)" class="btn q-glow" @click="approve">اعتماد المحضر</button>
        <button v-if="r.status === 'approved' && session.can(P.reviews)" class="btn q-glow" @click="save">حفظ حالة القرارات</button>
        <button class="btn q-ghost" @click="printPage">طباعة</button>
      </div>
    </section>
    <section class="card pm-panel">
      <div class="q-fields">
        <label class="field"><span>العنوان</span><input v-model="form.title" class="input" :disabled="!draft" /></label>
        <label class="field"><span>التاريخ</span><input v-model="form.meetingDate" type="date" class="input" :disabled="!draft" /></label>
        <label class="field"><span>الرئيس</span><input v-model="form.chairName" class="input" :disabled="!draft" /></label>
      </div>
      <label class="field"><span>الحضور</span><input v-model="form.attendees" class="input" :disabled="!draft" /></label>
    </section>
    <section class="card pm-panel" style="margin-top: 16px">
      <h2>المدخلات (البند 9.3.2)</h2>
      <div class="table-wrap"><table class="table">
        <tbody>
          <tr v-for="(i, k) in form.inputs" :key="i.key">
            <td style="width: 34%"><span class="pm-tag">{{ k + 1 }}</span> <b>{{ i.title }}</b></td>
            <td><textarea v-if="draft" v-model="i.summary" class="input" rows="2" /><span v-else class="q-pre">{{ i.summary }}</span></td>
          </tr>
        </tbody>
      </table></div>
    </section>
    <section class="card pm-panel" style="margin-top: 16px">
      <h2>المخرجات والقرارات (البند 9.3.3) <button v-if="draft" class="btn btn-sm" @click="form.outputs.push({ type: 'improvement', decision: '', ownerName: '', dueDate: null, status: 'open' })">+ قرار</button></h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>النوع</th><th>القرار</th><th>المسؤول</th><th>الموعد</th><th>التنفيذ</th><th v-if="draft" /></tr></thead>
        <tbody>
          <tr v-for="(o, i) in form.outputs" :key="i">
            <td><select v-if="draft" v-model="o.type" class="input"><option v-for="t in OUTPUT_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option></select><span v-else class="pm-tag">{{ label(OUTPUT_TYPES, o.type) }}</span></td>
            <td><input v-if="draft" v-model="o.decision" class="input" /><template v-else>{{ o.decision }}</template></td>
            <td><input v-if="draft" v-model="o.ownerName" class="input" style="width: 150px" /><template v-else>{{ o.ownerName }}</template></td>
            <td><input v-if="draft" v-model="o.dueDate" type="date" class="input" /><span v-else :style="{ color: o.status === 'open' && o.dueDate && o.dueDate < todayStr() ? 'var(--danger)' : '' }">{{ fmtDate(o.dueDate) }}</span></td>
            <td>
              <label v-if="session.can(P.reviews)" style="display: flex; gap: 6px; white-space: nowrap"><input type="checkbox" :checked="o.status === 'done'" @change="o.status = ($event.target as HTMLInputElement).checked ? 'done' : 'open'" /> نُفذ</label>
              <span v-else class="pm-pill" :style="{ '--c': STATUS_COLOR[o.status === 'done' ? 'done' : 'open'] }">{{ o.status === 'done' ? 'نُفذ' : 'قيد التنفيذ' }}</span>
            </td>
            <td v-if="draft"><button class="btn btn-sm" @click="form.outputs.splice(i, 1)">✕</button></td>
          </tr>
          <tr v-if="!form.outputs.length"><td colspan="6" class="pm-empty">سجّل قرارات الاجتماع قبل الاعتماد</td></tr>
        </tbody>
      </table></div>
      <label class="field" style="margin-top: 12px"><span>المحضر والملاحظات</span><textarea v-if="draft" v-model="form.minutes" class="input" rows="4" /><p v-else class="q-pre">{{ r.minutes ?? '—' }}</p></label>
      <div v-if="draft" class="modal-actions"><button class="btn btn-primary" @click="save">حفظ</button><button class="btn" style="color: var(--danger); margin-inline-start: auto" @click="remove">حذف المسودة</button></div>
    </section>
  </div>
</template>
