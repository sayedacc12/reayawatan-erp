<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { fmtDateTime } from '../labels';
import { INQUIRY_KIND, INQUIRY_STATUS, SITE_SERVICES, waNumber } from '../siteLabels';
import '../platform.css';

interface LogEntry { at: string; by: string; action: 'status' | 'note'; status?: string; note?: string }
interface Inquiry {
  id: string; number: number; kind: string; serviceCode: string | null; orgName: string; contactName: string; jobTitle: string | null;
  phone: string; email: string | null; city: string | null; message: string | null; status: string; log: LogEntry[]; createdAt: string;
}
const toast = useToast();
const rows = ref<Inquiry[]>([]);
const counts = ref<Record<string, number>>({});
const filter = ref('');
const kindFilter = ref('');
const error = ref('');
const loading = ref(true);

async function load() {
  try {
    const res = await api<{ rows: Inquiry[]; counts: Record<string, number> }>('/platform/site/inquiries');
    rows.value = res.rows;
    counts.value = res.counts;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const total = computed(() => rows.value.length);
const shown = computed(() => rows.value.filter((r) => (!filter.value || r.status === filter.value) && (!kindFilter.value || r.kind === kindFilter.value)));
const siteLink = `${location.origin}/?site`;

// ---- تفاصيل الطلب ومتابعته ----
const open = ref<Inquiry | null>(null);
const nextStatus = ref('');
const note = ref('');
const busy = ref(false);
function show(r: Inquiry) {
  open.value = r;
  nextStatus.value = r.status;
  note.value = '';
}
const waLink = computed(() => {
  const r = open.value;
  if (!r) return '';
  const text = `السلام عليكم ${r.contactName}، معك فريق سنابل بخصوص طلبك رقم ${r.number}${r.serviceCode ? ` لخدمة ${SITE_SERVICES[r.serviceCode]}` : ''}.`;
  return `https://wa.me/${waNumber(r.phone)}?text=${encodeURIComponent(text)}`;
});
async function save() {
  const r = open.value!;
  if (nextStatus.value === r.status && !note.value.trim()) return toast.error('غيّر الحالة أو اكتب ملاحظة');
  busy.value = true;
  try {
    const updated = await api<Inquiry>(`/platform/site/inquiries/${r.id}`, { method: 'PATCH', json: { status: nextStatus.value, note: note.value } });
    const before = r.status;
    Object.assign(r, updated);
    if (before !== updated.status) {
      counts.value[before] = Math.max(0, (counts.value[before] ?? 1) - 1);
      counts.value[updated.status] = (counts.value[updated.status] ?? 0) + 1;
    }
    note.value = '';
    toast.success('تم حفظ المتابعة');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <section class="p-hero">
      <div>
        <p class="p-kicker">الصفحة التعريفية للمنصة</p>
        <h1>طلبات الخدمات</h1>
        <p class="p-sub">طلبات الاستشارة المجانية وعروض الأسعار والعروض التجريبية الواردة من الصفحة الرئيسية لسنابل. تابع كل طلب وسجّل ما تم معه.</p>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap">
        <a class="btn btn-ghost-light" :href="siteLink" target="_blank" rel="noopener">فتح الصفحة التعريفية</a>
        <RouterLink class="btn btn-gold" to="/platform/settings">بيانات التواصل وواتساب</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="p-filters">
      <button :class="['p-chip', { on: !filter }]" @click="filter = ''">الكل<b>{{ total }}</b></button>
      <button v-for="(s, k) in INQUIRY_STATUS" :key="k" :class="['p-chip', { on: filter === k }]" @click="filter = k">{{ s.label }}<b>{{ counts[k] ?? 0 }}</b></button>
      <select v-model="kindFilter" class="input kind-select" aria-label="نوع الطلب">
        <option value="">كل الأنواع</option>
        <option v-for="(s, k) in INQUIRY_KIND" :key="k" :value="k">{{ s.label }}</option>
      </select>
    </div>

    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>النوع</th><th>الخدمة</th><th>الجمعية</th><th>مقدم الطلب</th><th>الجوال</th><th>التاريخ</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="r in shown" :key="r.id" class="click" @click="show(r)">
            <td><code>{{ r.number }}</code></td>
            <td><span :class="['tone', `tone-${INQUIRY_KIND[r.kind].tone}`]">{{ INQUIRY_KIND[r.kind].label }}</span></td>
            <td>{{ r.serviceCode ? SITE_SERVICES[r.serviceCode] : '—' }}</td>
            <td><b>{{ r.orgName }}</b><small v-if="r.city" class="muted d-block">{{ r.city }}</small></td>
            <td>{{ r.contactName }}<small v-if="r.jobTitle" class="muted d-block">{{ r.jobTitle }}</small></td>
            <td dir="ltr" style="text-align: right">{{ r.phone }}</td>
            <td>{{ fmtDateTime(r.createdAt) }}</td>
            <td><span :class="['tone', `tone-${INQUIRY_STATUS[r.status].tone}`]">{{ INQUIRY_STATUS[r.status].label }}</span></td>
          </tr>
          <tr v-if="!loading && !shown.length">
            <td colspan="8" class="muted" style="text-align: center; padding: 28px">لا توجد طلبات {{ filter || kindFilter ? 'بهذا التصنيف' : 'بعد' }}. تصل الطلبات هنا من نموذج التواصل في الصفحة الرئيسية.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="open" class="modal-backdrop" @click.self="open = null">
      <div class="card modal modal-wide">
        <div class="dlg-head">
          <div>
            <h2 style="margin: 0">طلب رقم {{ open.number }}</h2>
            <p class="muted" style="margin: 2px 0 0">{{ INQUIRY_KIND[open.kind].label }}<template v-if="open.serviceCode"> · {{ SITE_SERVICES[open.serviceCode] }}</template> · {{ fmtDateTime(open.createdAt) }}</p>
          </div>
          <span :class="['tone', `tone-${INQUIRY_STATUS[open.status].tone}`]">{{ INQUIRY_STATUS[open.status].label }}</span>
        </div>

        <dl class="p-dl" style="margin: 16px 0">
          <dt>الجمعية</dt><dd>{{ open.orgName }}</dd>
          <dt>مقدم الطلب</dt><dd>{{ open.contactName }}<template v-if="open.jobTitle"> · {{ open.jobTitle }}</template></dd>
          <dt>الجوال</dt><dd dir="ltr" style="text-align: right">{{ open.phone }}</dd>
          <dt>البريد</dt><dd dir="ltr" style="text-align: right">{{ open.email ?? '—' }}</dd>
          <dt>المدينة</dt><dd>{{ open.city ?? '—' }}</dd>
          <dt>الرسالة</dt><dd style="white-space: pre-wrap">{{ open.message ?? '—' }}</dd>
        </dl>

        <div class="quick">
          <a class="btn wa" :href="waLink" target="_blank" rel="noopener">مراسلة عبر واتساب</a>
          <a class="btn" :href="`tel:${open.phone}`">اتصال</a>
          <a v-if="open.email" class="btn" :href="`mailto:${open.email}`">بريد إلكتروني</a>
        </div>

        <form class="follow" @submit.prevent="save">
          <div class="field">
            <label>الحالة</label>
            <select v-model="nextStatus" class="input">
              <option v-for="(s, k) in INQUIRY_STATUS" :key="k" :value="k">{{ s.label }}</option>
            </select>
          </div>
          <div class="field grow">
            <label>ملاحظة المتابعة</label>
            <input v-model="note" class="input" maxlength="2000" placeholder="مثل: تم الاتصال وحُدد موعد العرض يوم الأحد" />
          </div>
          <button class="btn btn-primary" :disabled="busy">حفظ</button>
        </form>

        <template v-if="open.log.length">
          <h3 class="log-title">سجل المتابعة</h3>
          <ul class="p-timeline">
            <li v-for="(l, i) in [...open.log].reverse()" :key="i">
              <b v-if="l.action === 'status'">{{ INQUIRY_STATUS[l.status!]?.label }}</b>
              <span v-if="l.note">{{ l.action === 'status' ? ': ' : '' }}{{ l.note }}</span>
              <small>{{ l.by }} · {{ fmtDateTime(l.at) }}</small>
            </li>
          </ul>
        </template>

        <div class="modal-actions"><button type="button" class="btn" @click="open = null">إغلاق</button></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.click { cursor: pointer; }
.d-block { display: block; }
.kind-select { width: auto; min-width: 150px; margin-inline-start: auto; padding-block: 6px; }
.dlg-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.quick { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.btn.wa { background: linear-gradient(135deg, #25d366, #128c7e); color: #fff; border-color: transparent; }
.follow { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; padding: 14px; border-radius: 14px; background: var(--surface-2); }
.follow .field { margin: 0; min-width: 160px; }
.follow .grow { flex: 1; min-width: 220px; }
.log-title { font-size: 0.95rem; margin: 18px 0 10px; }
</style>
