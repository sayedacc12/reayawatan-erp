<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api, openProtectedFile, token } from '../../../api';
import { useToast } from '../../../stores/toast';
import PersonForm from '../components/PersonForm.vue';
import StatusPill from '../components/StatusPill.vue';
import { DECISION_LABEL, copy, fmtDate, fmtDateTime, loadLookups, lookups, publicUrl, sar, toFormData, type MembershipType } from '../lib';
import '../../../shared/module.css';
import '../members.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id: string }>();
const toast = useToast();
const a = ref<any>(null);
const error = ref('');
const note = ref('');
const busy = ref(false);
const editing = ref(false);
const previews = ref<Record<string, string>>({});
const form = ref<InstanceType<typeof PersonForm> | null>(null);

async function loadPreviews() {
  Object.values(previews.value).forEach((u) => URL.revokeObjectURL(u));
  previews.value = {};
  for (const d of a.value?.documents ?? []) {
    if (!d.mime.startsWith('image/')) continue;
    try {
      const res = await fetch(`/api/members/applications/${props.id}/documents/${d.key}`, { headers: { Authorization: `Bearer ${token.get()}` } });
      if (res.ok) previews.value[d.key] = URL.createObjectURL(await res.blob());
    } catch { /* المعاينة اختيارية */ }
  }
}
async function load() {
  try {
    a.value = await api(`/members/applications/${props.id}`);
    await loadPreviews();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await loadLookups().catch(() => null);
  await load();
});
onBeforeUnmount(() => Object.values(previews.value).forEach((u) => URL.revokeObjectURL(u)));
async function decide(decision: 'approve' | 'return' | 'reject') {
  if (decision !== 'approve' && !note.value.trim()) return toast.error(decision === 'return' ? 'اكتب المطلوب استكماله' : 'اكتب سبب الرفض');
  busy.value = true;
  try {
    a.value = await api(`/members/applications/${props.id}/decision`, { method: 'POST', json: { decision, note: note.value.trim() || null } });
    note.value = '';
    toast.success({ approve: 'تم الاعتماد', return: 'أُرجع الطلب للمتقدم', reject: 'رُفض الطلب' }[decision]);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function cancel() {
  const reason = prompt('سبب إلغاء الطلب؟');
  if (!reason) return;
  try {
    a.value = await api(`/members/applications/${props.id}/cancel`, { method: 'POST', json: { note: reason } });
    toast.success('أُلغي الطلب');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function resubmit(data: Record<string, unknown>, files: Record<string, File>) {
  busy.value = true;
  try {
    a.value = await api(`/members/applications/${props.id}/resubmit`, { method: 'POST', body: toFormData(data, files) });
    editing.value = false;
    await loadPreviews();
    toast.success('أُعيد الطلب للاعتماد من المرحلة الأولى');
  } catch (e) {
    form.value?.setError((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const openDoc = (key: string) => openProtectedFile(`/members/applications/${props.id}/documents/${key}`).catch((e) => toast.error((e as Error).message));
async function copyPay() {
  if (await copy(publicUrl(`/m/pay/${a.value.invoice.payToken}`))) toast.success('نُسخ رابط السداد، أرسله للمتقدم');
}
async function copyTrack() {
  if (await copy(publicUrl(`/m/${(a.value as any).slug ?? ''}`))) toast.success('نُسخ الرابط');
}
const LOG_COLOR: Record<string, string> = { submit: '#0ea5e9', resubmit: '#0ea5e9', approve: '#10b981', return: '#f97316', reject: '#ef4444', cancel: '#64748b' };
const typeOf = (code: string) => lookups.value?.types.find((t: MembershipType) => t.code === code);
void copyTrack;
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="a">
      <section class="pm-hero mb-hero">
        <div>
          <p class="pm-kicker">طلب عضوية <span class="mb-code">{{ a.applicationNo }}</span> · {{ a.source === 'public' ? 'من الموقع' : `أدخله ${a.createdByName}` }}</p>
          <h1>{{ a.fullName }}</h1>
          <p class="pm-sub">{{ a.type?.name ?? a.typeCode }} · {{ a.type?.fee ? sar(a.type.fee + (a.type.joiningFee || 0)) : 'بدون اشتراك' }} · قُدم {{ fmtDateTime(a.createdAt) }}</p>
        </div>
        <div class="pm-actions">
          <StatusPill :status="a.status" :label="a.statusLabel" />
          <button v-if="a.can.edit" class="btn mb-glow" @click="editing = true">استكمال البيانات وإعادة التقديم</button>
          <button v-if="a.can.cancel" class="btn mb-ghost" @click="cancel">إلغاء الطلب</button>
        </div>
      </section>

      <section class="card pm-panel">
        <div class="mb-steps">
          <div class="mb-step done"><i />تقديم الطلب</div>
          <div v-for="(s, i) in a.stages" :key="i" :class="['mb-step', { done: s.done, cur: s.current }]"><i />{{ s.name }}</div>
          <div :class="['mb-step', { done: a.status === 'completed', cur: a.status === 'awaiting_payment' }]"><i />السداد</div>
          <div :class="['mb-step', { done: a.status === 'completed' }]"><i />تفعيل العضوية</div>
        </div>
      </section>

      <div v-if="editing && lookups" class="card pm-panel">
        <h2>استكمال الطلب</h2>
        <PersonForm ref="form" mode="apply" :types="lookups.types" :nationalities="lookups.nationalities" :fields="lookups.applicationFields" :documents="lookups.documents"
          :conditions="lookups.conditions" :initial="{ ...a, acceptedConditions: lookups.conditions.map((c) => c.key) }" :existing-docs="a.documents" :busy="busy"
          submit-label="إعادة التقديم" @submit="resubmit" @cancel="editing = false" />
      </div>

      <div class="mb-grid">
        <section class="card pm-panel">
          <h2>بيانات المتقدم</h2>
          <div v-if="a.warnings.length" class="alert alert-error"><b>تنبيه للمعتمد:</b> {{ a.warnings.join('، ') }}</div>
          <dl class="pm-dl">
            <dt>رقم الهوية</dt><dd class="mb-code">{{ a.nationalId }}</dd>
            <dt>انتهاء الهوية</dt><dd>{{ fmtDate(a.idExpiry) }}</dd>
            <dt>الجنسية</dt><dd>{{ a.nationality }}</dd>
            <dt>الجنس</dt><dd>{{ a.gender === 'female' ? 'أنثى' : 'ذكر' }}</dd>
            <dt>تاريخ الميلاد</dt><dd>{{ fmtDate(a.birthDate) }}</dd>
            <dt>الجوال</dt><dd class="mb-code">{{ a.mobile }}</dd>
            <dt>البريد</dt><dd class="mb-code">{{ a.email ?? '—' }}</dd>
            <dt>المدينة</dt><dd>{{ a.city ?? '—' }}</dd>
            <dt>العنوان</dt><dd>{{ a.address ?? '—' }}</dd>
            <dt>المهنة وجهة العمل</dt><dd>{{ [a.occupation, a.employer].filter(Boolean).join(' · ') || '—' }}</dd>
            <dt>المؤهل</dt><dd>{{ a.qualification ?? '—' }}</dd>
            <template v-for="f in lookups?.applicationFields ?? []" :key="f.key"><dt>{{ f.label }}</dt><dd>{{ a.answers[f.key] === true ? 'نعم' : a.answers[f.key] === false ? 'لا' : a.answers[f.key] ?? '—' }}</dd></template>
          </dl>
          <div class="mb-sec">الإقرار بشروط العضوية</div>
          <ul class="conds"><li v-for="c in a.acceptedConditions" :key="c">✓ {{ c }}</li></ul>
        </section>

        <section class="card pm-panel">
          <h2>المستندات</h2>
          <p v-if="!a.documents.length" class="mb-empty">لا توجد مستندات</p>
          <div v-for="d in a.documents" :key="d.key" class="doc" @click="openDoc(d.key)">
            <img v-if="previews[d.key]" :src="previews[d.key]" alt="" />
            <span v-else class="ph">PDF</span>
            <span><b>{{ d.name }}</b><small class="pm-muted" style="display: block">{{ d.fileName }} · {{ fmtDate(d.uploadedAt) }}</small></span>
          </div>

          <template v-if="a.can.decide">
            <div class="mb-sec">قرار مرحلة «{{ a.stageName }}»</div>
            <textarea v-model="note" class="input" rows="2" placeholder="ملاحظة (إلزامية عند الإرجاع أو الرفض، وتظهر للمتقدم)" />
            <div class="modal-actions" style="justify-content: flex-start">
              <button class="btn btn-primary" :disabled="busy" @click="decide('approve')">اعتماد</button>
              <button class="btn" :disabled="busy" @click="decide('return')">إرجاع لاستكمال البيانات</button>
              <button class="btn btn-danger" :disabled="busy" @click="decide('reject')">رفض</button>
            </div>
          </template>
          <p v-else-if="a.status === 'in_review'" class="pm-muted">الطلب في مرحلة «{{ a.stageName }}»، والقرار فيها لغيرك.</p>

          <div v-if="a.invoice" class="pay">
            <div class="mb-sec">مطالبة الاشتراك</div>
            <p><RouterLink :to="`/members/invoices/${a.invoice.id}`" class="pm-link">{{ a.invoice.invoiceNo }}</RouterLink> · {{ sar(a.invoice.amount) }} · <b>{{ a.invoice.statusLabel }}</b></p>
            <button v-if="a.invoice.status === 'unpaid'" class="btn btn-sm" @click="copyPay">نسخ رابط السداد للمتقدم</button>
          </div>
          <p v-if="a.member" class="okline">أصبح عضوًا: <RouterLink :to="`/members/list/${a.member.id}`" class="pm-link">العضوية رقم {{ a.member.memberNo }}</RouterLink></p>
          <p class="pm-muted" style="font-size: .78rem">رمز متابعة المتقدم: <span class="mb-code">{{ a.trackCode }}</span></p>
        </section>

        <section class="card pm-panel wide">
          <h2>سجل الاعتماد</h2>
          <ul class="mb-log">
            <li v-for="(l, i) in a.approvalLog" :key="i" :style="{ '--c': LOG_COLOR[l.decision] }">
              <b>{{ DECISION_LABEL[l.decision] ?? l.decision }}</b> · {{ l.stage }} · {{ l.byName }} · <span class="pm-muted">{{ fmtDateTime(l.at) }}</span>
              <div v-if="l.note">{{ l.note }}</div>
            </li>
          </ul>
          <p v-if="typeOf(a.typeCode)?.benefits" class="pm-muted" style="white-space: pre-line">مزايا {{ a.type?.name }}: {{ typeOf(a.typeCode)?.benefits }}</p>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.doc { display: flex; gap: 12px; align-items: center; padding: 8px; border: 1px solid var(--border); border-radius: 12px; margin-bottom: 8px; cursor: pointer; transition: background .2s; }
.doc:hover { background: var(--surface-2); }
.doc img, .doc .ph { width: 96px; height: 62px; object-fit: cover; border-radius: 8px; background: var(--surface-2); display: grid; place-items: center; font-weight: 700; color: var(--muted); }
.conds { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; font-size: .86rem; color: #047857; }
.pay { margin-top: 8px; }
.okline { background: #ecfdf5; color: #065f46; border-radius: 10px; padding: 8px 12px; }
</style>
