<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { BOOKING_STATUSES, dateOnly, num, P, riyadh, SOURCES, STATUSES, type Any } from '../lib';
import '../../../shared/module.css';
import '../../../shared/ws.css';
import '../website.css';

const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const lead = ref<Any>(null);
const error = ref('');
const people = ref<{ id: string; fullName: string }[]>([]);
const services = ref<{ slug: string; title: string }[]>([]);
const form = reactive({ status: '', assignedTo: '', nextActionOn: '', note: '' });
const busy = ref(false);
const canManage = computed(() => session.can(P.leadsManage));

async function load() {
  try {
    lead.value = await api(`/website/leads/${props.id}`);
    Object.assign(form, { status: lead.value.status, assignedTo: lead.value.assignedTo ?? '', nextActionOn: lead.value.nextActionOn ?? '', note: '' });
  } catch (e) { error.value = (e as Error).message; }
}
onMounted(async () => {
  await load();
  if (canManage.value) people.value = await api<typeof people.value>('/website/assignees').catch(() => []);
  services.value = await api<typeof services.value>('/website/services').catch(() => []);
});
const svcTitle = (slug: string | null) => services.value.find((s) => s.slug === slug)?.title ?? slug;
async function save() {
  busy.value = true;
  try {
    await api(`/website/leads/${props.id}`, { method: 'PUT', json: {
      status: form.status, assignedTo: form.assignedTo || null, nextActionOn: form.nextActionOn || null, ...(form.note.trim() ? { note: form.note } : {}),
    } });
    toast.success('حُفظت المتابعة');
    await load();
  } catch (e) { toast.error((e as Error).message); } finally { busy.value = false; }
}
const calc = computed(() => lead.value?.result?.calculator);
const assess = computed(() => lead.value?.result?.assessment);
const ANSWER = ['لا، أو لا نعرف', 'جزئيًا', 'نعم، بشكل واضح'];
</script>

<template>
  <div v-if="error" class="alert alert-error">{{ error }}</div>
  <div v-else-if="lead">
    <div class="page-head">
      <div>
        <p class="muted" style="margin: 0"><RouterLink to="/website/leads">العملاء المحتملون</RouterLink> / طلب رقم {{ lead.leadNo }}</p>
        <h1>{{ lead.name }} <small v-if="lead.orgName" class="muted">· {{ lead.orgName }}</small></h1>
      </div>
      <div style="display: flex; gap: 6px">
        <span class="ws-pill" :style="{ '--c': SOURCES[lead.source]?.c }">{{ SOURCES[lead.source]?.l }}</span>
        <span class="ws-pill" :style="{ '--c': STATUSES[lead.status]?.c }">{{ STATUSES[lead.status]?.l }}</span>
      </div>
    </div>
    <div class="rw-grid2">
      <div style="display: grid; gap: 14px; align-content: start">
        <section class="card ws-panel">
          <h2>بيانات التواصل</h2>
          <dl class="rw-kv">
            <dt>البريد</dt><dd dir="ltr" style="text-align: right"><a :href="`mailto:${lead.email}`">{{ lead.email }}</a></dd>
            <dt>الجوال</dt><dd dir="ltr" style="text-align: right">{{ lead.phone || '—' }}</dd>
            <dt>نوع الجهة</dt><dd>{{ lead.orgType || '—' }}</dd>
            <dt>الخدمة</dt><dd>{{ lead.serviceSlug ? svcTitle(lead.serviceSlug) : '—' }}</dd>
            <dt>تاريخ الطلب</dt><dd>{{ riyadh(lead.createdAt) }}</dd>
            <dt v-if="lead.meta?.page">الصفحة</dt><dd v-if="lead.meta?.page" dir="ltr" style="text-align: right">{{ lead.meta.page }}</dd>
          </dl>
          <template v-if="lead.message"><h2 style="margin-top: 12px">رسالة العميل</h2><p style="white-space: pre-wrap; margin: 0">{{ lead.message }}</p></template>
        </section>

        <section v-if="calc" class="card ws-panel">
          <h2>نتيجة حاسبة مضاعف الأثر</h2>
          <dl class="rw-kv">
            <dt>ميزانية البرامج</dt><dd>{{ num(calc.budget) }} ر.س</dd>
            <dt>تكلفة المستفيد</dt><dd>{{ num(calc.cost) }} ر.س</dd>
            <dt>تحسن الكفاءة</dt><dd>{{ calc.efficiency }}٪</dd>
            <dt>يخدمون اليوم</dt><dd>{{ num(calc.beneficiariesNow) }} مستفيد</dd>
            <dt>وفر سنوي متوقع</dt><dd>{{ num(calc.annualSaving) }} ر.س</dd>
            <dt>مستفيدون إضافيون</dt><dd><b>{{ num(calc.additionalBeneficiaries) }}</b> سنويًا</dd>
          </dl>
        </section>

        <section v-if="assess" class="card ws-panel">
          <h2>نتيجة تقييم الجاهزية</h2>
          <p class="rw-score">{{ assess.score }} <small class="muted" style="font-size: 1rem">من ١٠٠</small></p>
          <p v-if="assess.gaps.length"><b>المجالات الأضعف:</b> {{ assess.gaps.map((g: Any) => g.title).join('، ') }}</p>
          <ul class="rw-list">
            <li v-for="a in assess.answers" :key="a.service"><span>{{ a.question }}</span><span class="ws-pill" :style="{ '--c': a.answer === 2 ? '#067647' : a.answer === 1 ? '#8f6a45' : '#b42318' }">{{ ANSWER[a.answer] }}</span></li>
          </ul>
        </section>

        <section v-if="lead.bookings.length" class="card ws-panel">
          <h2>جلسات التشخيص</h2>
          <ul class="rw-list">
            <li v-for="b in lead.bookings" :key="b.id">
              <span>{{ riyadh(b.startsAt) }}<br><small v-if="b.topic">{{ b.topic }}</small></span>
              <span class="ws-pill" :style="{ '--c': BOOKING_STATUSES[b.status]?.c }">{{ BOOKING_STATUSES[b.status]?.l }}</span>
            </li>
          </ul>
          <RouterLink to="/website/bookings" class="btn btn-sm" style="align-self: flex-start">إدارة الحجوزات</RouterLink>
        </section>

        <section v-if="lead.downloads.length" class="card ws-panel">
          <h2>الأدلة التي طلبها</h2>
          <ul class="rw-list"><li v-for="d in lead.downloads" :key="d.at"><span>{{ d.title }}</span><small>{{ dateOnly(d.at) }} · نُزّل {{ d.usedCount }} مرة</small></li></ul>
        </section>

        <section v-if="lead.related.length" class="card ws-panel">
          <h2>طلبات أخرى من نفس البريد</h2>
          <ul class="rw-list">
            <li v-for="r in lead.related" :key="r.id"><RouterLink :to="`/website/leads/${r.id}`" @click="$nextTick(load)">طلب {{ r.leadNo }} · {{ SOURCES[r.source]?.l }}</RouterLink><small>{{ dateOnly(r.createdAt) }}</small></li>
          </ul>
        </section>
      </div>

      <div style="display: grid; gap: 14px; align-content: start">
        <section v-if="canManage" class="card ws-panel">
          <h2>المتابعة</h2>
          <div class="field"><label>الحالة</label><select v-model="form.status" class="input"><option v-for="(s, k) in STATUSES" :key="k" :value="k">{{ s.l }}</option></select></div>
          <div class="field"><label>المسؤول</label><select v-model="form.assignedTo" class="input"><option value="">— بلا إسناد —</option><option v-for="p in people" :key="p.id" :value="p.id">{{ p.fullName }}</option></select></div>
          <div class="field"><label>موعد المتابعة التالية</label><input v-model="form.nextActionOn" type="date" class="input"></div>
          <div class="field"><label>ملاحظة</label><textarea v-model="form.note" class="input" rows="3" placeholder="ما الذي تم؟ وما الخطوة التالية؟" /></div>
          <button class="btn btn-primary" :disabled="busy" @click="save">حفظ</button>
        </section>
        <section v-else class="card ws-panel"><h2>المسؤول</h2><p style="margin: 0">{{ lead.assignedName ?? 'بلا إسناد' }}</p></section>
        <section class="card ws-panel">
          <h2>سجل المتابعة</h2>
          <ul class="rw-timeline">
            <li v-for="e in lead.events" :key="e.id" :class="{ note: e.kind === 'note' }">
              <span style="white-space: pre-wrap">{{ e.text }}</span>
              <small>{{ e.userName ?? '—' }} · {{ riyadh(e.createdAt) }}</small>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>
