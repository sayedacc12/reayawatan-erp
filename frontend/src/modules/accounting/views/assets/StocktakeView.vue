<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { api } from '../../../../api';
import { useSession } from '../../../../stores/session';
import { useToast } from '../../../../stores/toast';
import { AF, CONDITIONS } from '../../assets';
import { P, dt } from '../../lib';
import '../../../../shared/module.css';
import '../../acc.css';
import './assets.css';

interface Line { assetId: string; code: string; name: string; expectedLocation: string | null; expectedCustodian: string | null; result: 'pending' | 'found' | 'missing';
  foundLocation: string | null; condition: string | null; notes: string | null; countedByName: string | null; countedAt: string | null }
interface St { id: string; stocktakeNo: number; title: string; date: string; scope: { label: string }; status: 'open' | 'closed'; closedAt: string | null; closedByName: string | null;
  counts: { total: number; found: number; missing: number; pending: number; moved: number; extras: number }; lines: Line[]; extras: { code: string; note: string | null; byName: string; at: string }[] }
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const s = ref<St | null>(null);
const error = ref('');
const filter = ref<'all' | 'pending' | 'found' | 'missing' | 'moved'>('all');
async function load() {
  try {
    s.value = await api<St>(`${AF}/stocktakes/${props.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
const moved = (l: Line) => l.result === 'found' && !!l.foundLocation && !!l.expectedLocation && l.foundLocation !== l.expectedLocation;
const lines = computed(() => (s.value?.lines ?? []).filter((l) => filter.value === 'all' || (filter.value === 'moved' ? moved(l) : l.result === filter.value)));
const canCount = computed(() => s.value?.status === 'open' && session.can(P.assetsCustody));

// ---------------- العد: مسح الملصق أو كتابة الرمز ----------------
const manual = ref('');
const last = ref<{ matched: boolean; code: string; name: string | null } | null>(null);
const opts = reactive({ location: '', condition: 'جيد' });
async function count(code: string, extra: Record<string, unknown> = {}) {
  try {
    const r = await api<{ matched: boolean; code: string; name: string | null; stocktake: St }>(`${AF}/stocktakes/${props.id}/count`, {
      method: 'POST', json: { code, location: opts.location || undefined, condition: opts.condition, ...extra },
    });
    s.value = r.stocktake;
    last.value = r;
    if (r.matched) toast.success(`✓ ${r.name}`);
    else toast.error(`الملصق ${r.code} ليس ضمن هذا الجرد${r.name ? ` (${r.name})` : ''}، وسُجل في الفروقات`);
    navigator.vibrate?.(r.matched ? 60 : [60, 60, 60]);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function submitManual() {
  if (!manual.value.trim()) return;
  await count(manual.value.trim());
  manual.value = '';
}

// كاميرا الجوال (BarcodeDetector) عند توفرها في المتصفح
const video = ref<HTMLVideoElement | null>(null);
const scanning = ref(false);
const scanSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window;
let stream: MediaStream | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let lastCode = '';
let lastAt = 0;
async function startScan() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    scanning.value = true;
    await new Promise((r) => setTimeout(r, 50));
    if (!video.value) return;
    video.value.srcObject = stream;
    await video.value.play();
    const Detector = (window as unknown as { BarcodeDetector: new (o: object) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    const det = new Detector({ formats: ['qr_code'] });
    timer = setInterval(async () => {
      if (!video.value) return;
      const found = await det.detect(video.value).catch(() => []);
      const code = found[0]?.rawValue;
      if (code && (code !== lastCode || Date.now() - lastAt > 4000)) {
        lastCode = code;
        lastAt = Date.now();
        await count(code);
      }
    }, 450);
  } catch {
    toast.error('تعذر فتح الكاميرا. اسمح للمتصفح باستخدامها، أو اكتب رمز الأصل يدويًا');
    stopScan();
  }
}
function stopScan() {
  clearInterval(timer);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  scanning.value = false;
}
onBeforeUnmount(stopScan);

// تعديل نتيجة سطر
const edit = ref<Line | null>(null);
const ef = reactive({ result: 'found' as 'found' | 'missing', location: '', condition: 'جيد', notes: '' });
function openLine(l: Line) {
  if (!canCount.value) return;
  edit.value = l;
  Object.assign(ef, { result: l.result === 'missing' ? 'missing' : 'found', location: l.foundLocation ?? l.expectedLocation ?? '', condition: l.condition ?? 'جيد', notes: l.notes ?? '' });
}
async function saveLine() {
  if (!edit.value) return;
  await count(edit.value.code, { result: ef.result, location: ef.location || undefined, condition: ef.condition, notes: ef.notes || null });
  edit.value = null;
}
async function close() {
  if (!s.value) return;
  if (!confirm(s.value.counts.pending ? `بقي ${s.value.counts.pending} أصل لم يُجرد، وسيُسجل مفقودًا عند الإغلاق. إغلاق الجرد؟` : 'إغلاق الجرد وإصدار تقرير الفروقات؟')) return;
  try {
    s.value = await api<St>(`${AF}/stocktakes/${props.id}/close`, { method: 'POST' });
    stopScan();
    toast.success('أُغلق الجرد');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const printNow = () => window.print();
</script>

<template>
  <div v-if="s">
    <section class="pm-hero ac-hero fa-hero no-print">
      <div>
        <p class="pm-kicker">الجرد رقم {{ s.stocktakeNo }} · {{ s.scope.label }}</p>
        <h1>{{ s.title }}</h1>
        <p class="pm-sub">{{ s.date }} · {{ s.status === 'open' ? 'مفتوح للعد' : `مغلق بواسطة ${s.closedByName} ${dt(s.closedAt)}` }}</p>
      </div>
      <div class="pm-actions">
        <button class="btn ac-ghost" @click="printNow">طباعة التقرير</button>
        <button v-if="canCount" class="btn ac-glow" @click="close">إغلاق الجرد</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #0ea5e9; --i: 0"><span>أصول الجرد</span><strong>{{ s.counts.total }}</strong><small>{{ s.counts.pending }} لم يُجرد بعد</small></div>
      <div class="pm-kpi" style="--a: #10b981; --i: 1"><span>موجود</span><strong>{{ s.counts.found }}</strong><small>{{ s.counts.moved }} في غير موقعه</small></div>
      <div class="pm-kpi" style="--a: #ef4444; --i: 2"><span>مفقود</span><strong>{{ s.counts.missing }}</strong><small>يحتاج متابعة</small></div>
      <div class="pm-kpi" style="--a: #f59e0b; --i: 3"><span>ملصقات خارج الجرد</span><strong>{{ s.counts.extras }}</strong><small>وُجدت ولم تكن متوقعة</small></div>
    </div>

    <section v-if="canCount" class="card pm-panel scan no-print">
      <h2>عد الأصول</h2>
      <div class="field-row">
        <label class="field"><span>الموقع الحالي (اختياري)</span><input v-model="opts.location" class="input" placeholder="يُستخدم الموقع المسجل إن تُرك فارغًا" /></label>
        <label class="field"><span>حالة الأصل</span><select v-model="opts.condition" class="input"><option v-for="c in CONDITIONS" :key="c">{{ c }}</option></select></label>
      </div>
      <div class="fa-row">
        <button v-if="scanSupported && !scanning" class="btn btn-primary" @click="startScan">📷 مسح الملصقات بالكاميرا</button>
        <button v-if="scanning" class="btn" @click="stopScan">إيقاف الكاميرا</button>
        <form class="fa-row" style="flex: 1" @submit.prevent="submitManual">
          <input v-model="manual" class="input ac-code" placeholder="أو اكتب رمز الأصل، مثل FA-CAR-0003" />
          <button class="btn">تسجيل</button>
        </form>
      </div>
      <div v-if="scanning" class="cam"><video ref="video" playsinline muted /><i class="frame" /></div>
      <p v-if="!scanSupported" class="fa-sub">متصفحك لا يدعم المسح المباشر. استخدم كروم على الجوال، أو امسح الملصق بتطبيق الكاميرا فيفتح بطاقة الأصل، أو اكتب الرمز.</p>
      <p v-if="last" :class="['lastc', { bad: !last.matched }]">{{ last.matched ? '✓ سُجل' : '✕ خارج الجرد' }}: <span class="ac-code">{{ last.code }}</span> {{ last.name ?? '' }}</p>
    </section>

    <section class="card pm-panel">
      <div class="pm-tabs no-print">
        <button v-for="[k, l] in ([['all', 'الكل'], ['pending', 'لم يُجرد'], ['found', 'موجود'], ['missing', 'مفقود'], ['moved', 'في غير موقعه']] as const)" :key="k" :class="['pm-tab', { on: filter === k }]" @click="filter = k">{{ l }}</button>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الرمز</th><th>الأصل</th><th>العهدة المسجلة</th><th>الموقع المسجل</th><th>الموقع الفعلي</th><th>الحالة</th><th>النتيجة</th><th>بواسطة</th></tr></thead>
          <tbody>
            <tr v-for="l in lines" :key="l.code" :class="[l.result, { moved: moved(l), click: canCount }]" @click="openLine(l)">
              <td class="ac-code">{{ l.code }}</td><td><b>{{ l.name }}</b></td><td>{{ l.expectedCustodian ?? '—' }}</td><td>{{ l.expectedLocation ?? '—' }}</td>
              <td>{{ l.foundLocation ?? '' }}</td><td>{{ l.condition ?? '' }}</td>
              <td><span class="pm-pill" :style="{ '--c': l.result === 'found' ? (moved(l) ? '#f59e0b' : '#10b981') : l.result === 'missing' ? '#ef4444' : '#94a3b8' }">{{ l.result === 'found' ? (moved(l) ? 'في غير موقعه' : 'موجود') : l.result === 'missing' ? 'مفقود' : 'لم يُجرد' }}</span></td>
              <td class="pm-muted">{{ l.countedByName ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <template v-if="s.extras.length">
        <h2 style="margin-top: 14px">ملصقات وُجدت خارج نطاق الجرد</h2>
        <div v-for="x in s.extras" :key="x.code" class="fa-grow"><span class="grow"><b class="ac-code">{{ x.code }}</b><small class="pm-muted">{{ x.note ?? '' }} · {{ x.byName }} · {{ dt(x.at) }}</small></span></div>
      </template>
    </section>

    <div v-if="edit" class="modal-backdrop" @click.self="edit = null">
      <form class="card modal" @submit.prevent="saveLine">
        <h2>{{ edit.name }} <span class="ac-code pm-muted">{{ edit.code }}</span></h2>
        <div class="ac-switch" style="margin-bottom: 10px"><button type="button" :class="{ on: ef.result === 'found' }" @click="ef.result = 'found'">موجود</button><button type="button" :class="{ on: ef.result === 'missing' }" @click="ef.result = 'missing'">مفقود</button></div>
        <div v-if="ef.result === 'found'" class="field-row">
          <label class="field"><span>الموقع الفعلي</span><input v-model="ef.location" class="input" /></label>
          <label class="field"><span>الحالة</span><select v-model="ef.condition" class="input"><option v-for="c in CONDITIONS" :key="c">{{ c }}</option></select></label>
        </div>
        <label class="field"><span>ملاحظات</span><input v-model="ef.notes" class="input" /></label>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="edit = null">إلغاء</button></div>
      </form>
    </div>
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
</template>

<style scoped>
.cam { position: relative; margin-top: 12px; border-radius: 16px; overflow: hidden; max-width: 420px; background: #000; }
.cam video { width: 100%; display: block; }
.cam .frame { position: absolute; inset: 18%; border: 3px solid #34d399; border-radius: 16px; box-shadow: 0 0 0 999px rgba(0,0,0,.35), 0 0 22px #34d399; animation: fa-blink 1.6s infinite; }
.lastc { margin-top: 10px; font-weight: 700; color: #047857; }
.lastc.bad { color: #b91c1c; }
tr.missing td { background: #fef2f2; }
tr.moved td { background: #fffbeb; }
tr.click { cursor: pointer; }
</style>
