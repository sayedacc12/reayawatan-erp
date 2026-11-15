<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { useToast } from '../stores/toast';
import '../modules/platform/platform.css';
import SlaBadge from './SlaBadge.vue';
import SlaLevels from './SlaLevels.vue';
import { CATEGORY, PRIORITY, STATUS, fmtDT, hoursLabel, type SlaLevel, type TicketDetail, type TicketSummary } from './support';

/** الدعم الفني والصيانة: طلبات الجمعية لفريق المنصة */
const route = useRoute();
const router = useRouter();
const toast = useToast();
const rows = ref<TicketSummary[]>([]);
const levels = ref<SlaLevel[]>([]);
const error = ref('');
const tab = ref<'list' | 'new' | 'guide'>(route.query.new === '1' ? 'new' : 'list');
const filter = ref<'open' | 'done' | ''>('open');
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval>;

const form = reactive({ subject: '', category: 'malfunction', priority: 'normal', screen: '', contactPhone: '', description: '' });
const file = ref<File | null>(null);
const busy = ref(false);
const formError = ref('');

async function load() {
  try {
    [rows.value, levels.value] = await Promise.all([api<TicketSummary[]>('/support/tickets'), api<SlaLevel[]>('/support/sla')]);
    if (!rows.value.length && tab.value === 'list') tab.value = 'new';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => { load(); timer = setInterval(() => (now.value = Date.now()), 30_000); });
onUnmounted(() => clearInterval(timer));

const isOpen = (t: TicketSummary) => !['resolved', 'closed'].includes(t.status);
const shown = computed(() => rows.value.filter((t) => (filter.value === 'open' ? isOpen(t) : filter.value === 'done' ? !isOpen(t) : true)));
const openCount = computed(() => rows.value.filter(isOpen).length);
const chosen = computed(() => levels.value.find((l) => l.priority === form.priority));

async function submit() {
  busy.value = true;
  formError.value = '';
  try {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) if (v) fd.append(k, v);
    if (file.value) fd.append('file', file.value);
    const t = await api<TicketDetail>('/support/tickets', { method: 'POST', body: fd });
    toast.success(`تم تسجيل طلبك برقم ${t.number}`);
    router.push(`/settings/support/${t.id}`);
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <section class="p-hero">
      <div>
        <p class="p-kicker">خدمة العملاء</p>
        <h1>الدعم الفني والصيانة</h1>
        <p class="p-sub">أرسل أي عطل أو استفسار لفريق منصة سنابل، واختر مستوى الخدمة المناسب. يلتزم الفريق بمهلة الرد والحل لكل مستوى، وتتابع طلبك هنا خطوة بخطوة.</p>
      </div>
      <button class="btn btn-gold" @click="tab = 'new'">+ طلب صيانة جديد</button>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <nav class="p-tabs">
      <button :class="['p-tab', { on: tab === 'list' }]" @click="tab = 'list'">طلباتي ({{ openCount }} مفتوح)</button>
      <button :class="['p-tab', { on: tab === 'new' }]" @click="tab = 'new'">طلب جديد</button>
      <button :class="['p-tab', { on: tab === 'guide' }]" @click="tab = 'guide'">مستويات الخدمة وآلية التعامل</button>
    </nav>

    <template v-if="tab === 'list'">
      <div class="p-filters">
        <button :class="['p-chip', { on: filter === 'open' }]" @click="filter = 'open'">المفتوحة</button>
        <button :class="['p-chip', { on: filter === 'done' }]" @click="filter = 'done'">المحلولة والمغلقة</button>
        <button :class="['p-chip', { on: !filter }]" @click="filter = ''">الكل<b>{{ rows.length }}</b></button>
      </div>
      <div class="card table-wrap">
        <table class="table">
          <thead><tr><th>رقم الطلب</th><th>العنوان</th><th>المستوى</th><th>الحالة</th><th>المهلة</th><th>تاريخ التقديم</th></tr></thead>
          <tbody>
            <tr v-for="t in shown" :key="t.id" class="clickable" @click="router.push(`/settings/support/${t.id}`)">
              <td><b dir="ltr">{{ t.number }}</b></td>
              <td>{{ t.subject }}<br /><small class="muted">{{ CATEGORY[t.category] }}</small></td>
              <td><span class="prio" :style="{ '--c': PRIORITY[t.priority].color }">{{ PRIORITY[t.priority].label }}</span></td>
              <td><span :class="['tone', `tone-${STATUS[t.status].tone}`]">{{ STATUS[t.status].label }}</span></td>
              <td>
                <SlaBadge v-if="isOpen(t)" :state="t.sla.resolution" :due="t.sla.resolutionDueAt" label="الحل" :now="now" />
                <span v-else-if="t.rating" class="muted">تقييمك: {{ '★'.repeat(t.rating) }}</span>
              </td>
              <td>{{ fmtDT(t.createdAt) }}</td>
            </tr>
            <tr v-if="!shown.length"><td colspan="6" class="muted center">لا توجد طلبات هنا.</td></tr>
          </tbody>
        </table>
      </div>
    </template>

    <form v-else-if="tab === 'new'" class="new-grid" @submit.prevent="submit">
      <section class="card p-panel">
        <h2>📝 بيانات الطلب</h2>
        <div class="field"><label>عنوان الطلب</label><input v-model="form.subject" class="input" required minlength="5" maxlength="200" placeholder="مثال: لا يمكن حفظ طلب مستفيد جديد" /></div>
        <div class="p-row-2">
          <div class="field"><label>نوع الطلب</label><select v-model="form.category" class="input"><option v-for="(l, k) in CATEGORY" :key="k" :value="k">{{ l }}</option></select></div>
          <div class="field"><label>الشاشة المتأثرة (اختياري)</label><input v-model="form.screen" class="input" maxlength="200" placeholder="مثال: سجل المستفيدين" /></div>
        </div>
        <div class="field">
          <label>مستوى الخدمة</label>
          <div class="prio-pick">
            <button v-for="l in levels" :key="l.priority" type="button" :class="['pp', { on: form.priority === l.priority }]"
              :style="{ '--c': PRIORITY[l.priority].color }" @click="form.priority = l.priority">
              <b>{{ l.name }}</b><small>رد خلال {{ hoursLabel(l.responseHours) }}</small>
            </button>
          </div>
          <p v-if="chosen" class="hint">{{ chosen.description }} <b>الحل خلال {{ hoursLabel(chosen.resolutionHours) }}.</b></p>
        </div>
        <div class="field"><label>وصف المشكلة بالتفصيل</label><textarea v-model="form.description" class="input" rows="6" required minlength="10" maxlength="5000" placeholder="ما الذي حدث؟ وما الخطوات التي قمت بها؟ وما رسالة الخطأ إن ظهرت؟" /></div>
        <div class="p-row-2">
          <div class="field"><label>جوال للتواصل (اختياري)</label><input v-model="form.contactPhone" class="input" dir="ltr" placeholder="05xxxxxxxx" /></div>
          <div class="field"><label>مرفق (صورة الشاشة أو ملف)</label><label class="input file-pick">📎 {{ file ? file.name : 'اختر ملفًا' }}<input type="file" hidden @change="file = ($event.target as HTMLInputElement).files?.[0] ?? null" /></label></div>
        </div>
        <div v-if="formError" class="alert alert-error">{{ formError }}</div>
        <button class="btn btn-primary" :disabled="busy">{{ busy ? 'جارٍ الإرسال...' : 'إرسال الطلب' }}</button>
      </section>
      <aside class="card p-panel">
        <h2>⏱️ مهل الخدمة</h2>
        <p class="muted small">قد يعدّل فريق المنصة المستوى بعد المراجعة مع ذكر السبب. تتوقف المهلة أثناء انتظار ردك.</p>
        <SlaLevels :levels="levels" compact />
      </aside>
    </form>

    <SlaLevels v-else :levels="levels" />
  </div>
</template>

<style scoped>
.clickable { cursor: pointer; }
.center { text-align: center; }
.small { font-size: .85rem; }
.prio { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: var(--c); }
.prio::before { content: ''; width: 9px; height: 9px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 18%, transparent); }
.new-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 960px) { .new-grid { grid-template-columns: 1fr; } }
.prio-pick { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
@media (max-width: 640px) { .prio-pick { grid-template-columns: repeat(2, 1fr); } }
.pp { border: 1.5px solid var(--border); background: var(--surface); border-radius: 12px; padding: 10px 6px; cursor: pointer; font: inherit; display: flex; flex-direction: column; gap: 2px; align-items: center; transition: all .2s var(--ease); }
.pp b { color: var(--c); }
.pp small { color: var(--muted); font-size: .76rem; }
.pp.on { border-color: var(--c); background: color-mix(in srgb, var(--c) 9%, var(--surface)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 18%, transparent); transform: translateY(-1px); }
.hint { margin: 8px 0 0; font-size: .88rem; color: var(--muted); }
.file-pick { display: block; cursor: pointer; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
textarea.input { width: 100%; resize: vertical; }
</style>
