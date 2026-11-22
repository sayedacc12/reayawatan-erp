<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';

/**
 * زر «الإعدادات الافتراضية» في أعلى شاشة إعدادات كل نظام: يظهر لمدير النظام أو من يملك إعدادات النظام،
 * ويُفعّل مرة واحدة فقط. بعد التفعيل يبقى سطر صغير يذكر من أضافها ومتى وما أضيف.
 */
const props = defineProps<{ module: string }>();

interface Step { key: string; label: string; detail: string }
interface Result { key: string; label: string; added: number; note?: string }
interface Status {
  module: string; moduleName: string; status: 'available' | 'applying' | 'applied';
  steps: Step[]; applied: { at: string; by: string; results: Result[] } | null;
}

const state = ref<Status | null>(null);
const confirming = ref(false);
const busy = ref(false);
const error = ref('');
const done = ref<Status | null>(null);
const details = ref(false);

onMounted(async () => {
  // من لا يملك إعدادات النظام لا يرى شيئًا
  state.value = await api<Status>(`/starter/${props.module}`).catch(() => null);
});

async function apply() {
  busy.value = true;
  error.value = '';
  try {
    const s = await api<Status>(`/starter/${props.module}`, { method: 'POST' });
    state.value = s;
    done.value = s;
    confirming.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

const fmt = (d: string) => new Date(d).toLocaleDateString('ar-SA-u-ca-gregory', { year: 'numeric', month: 'long', day: 'numeric' });
const total = (r: Result[]) => r.reduce((s, x) => s + x.added, 0);
/** إعادة تحميل الشاشة لتظهر الإعدادات المضافة */
const finish = () => location.reload();
</script>

<template>
  <template v-if="state">
    <section v-if="state.status !== 'applied'" class="starter" role="region" aria-label="الإعدادات الافتراضية">
      <div class="glow" aria-hidden="true" />
      <div class="icon" aria-hidden="true">🌱</div>
      <div class="text">
        <h2>ابدأ بالإعدادات الافتراضية</h2>
        <p v-if="state.status === 'applying'">جارٍ إضافة الإعدادات الافتراضية الآن... أعد فتح الصفحة بعد قليل.</p>
        <p v-else>بدل أن تبدأ من الصفر، نضيف لك إعدادات جاهزة لنظام «{{ state.moduleName }}» تعدّلها بعد ذلك كما تريد. تُستخدم مرة واحدة فقط، ولا تغيّر شيئًا أدخلته من قبل.</p>
      </div>
      <div v-if="state.status === 'available'" class="actions">
        <button class="btn btn-primary" @click="confirming = true">عرض ما سيُضاف</button>
      </div>
    </section>
    <p v-else class="starter-done">
      <span>🌱 أُضيفت الإعدادات الافتراضية في {{ fmt(state.applied!.at) }} بواسطة {{ state.applied!.by }}، ويمكنك تعديلها من هذه الشاشة.</span>
      <button class="link" @click="details = !details">{{ details ? 'إخفاء التفاصيل' : 'التفاصيل' }}</button>
    </p>
    <ul v-if="details && state.applied" class="starter-results card">
      <li v-for="r in state.applied.results" :key="r.key">
        <strong>{{ r.label }}</strong>
        <span v-if="r.added">: أُضيف {{ r.added }}</span>
        <span v-if="r.note" class="muted"> ({{ r.note }})</span>
      </li>
    </ul>
  </template>

  <div v-if="confirming && state" class="modal-backdrop" @click.self="!busy && (confirming = false)">
    <div class="modal card modal-wide" role="dialog" aria-modal="true" aria-labelledby="starter-title">
      <h3 id="starter-title">الإعدادات الافتراضية لنظام «{{ state.moduleName }}»</h3>
      <p class="muted">سيُضاف ما يلي، وكل ما أدخلته من قبل يبقى كما هو. هذا الزر يُستخدم مرة واحدة فقط.</p>
      <ol class="steps">
        <li v-for="s in state.steps" :key="s.key">
          <strong>{{ s.label }}</strong>
          <span>{{ s.detail }}</span>
        </li>
      </ol>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <div class="modal-actions">
        <button class="btn btn-primary" :disabled="busy" @click="apply">
          <span v-if="busy" class="spinner" aria-hidden="true" />
          {{ busy ? 'جارٍ الإضافة...' : 'أضف الإعدادات الافتراضية' }}
        </button>
        <button class="btn" :disabled="busy" @click="confirming = false">إلغاء</button>
      </div>
    </div>
  </div>

  <div v-if="done && done.applied" class="modal-backdrop">
    <div class="modal card modal-wide" role="dialog" aria-modal="true" aria-labelledby="starter-done-title">
      <h3 id="starter-done-title">🎉 أصبح نظام «{{ done.moduleName }}» جاهزًا للعمل</h3>
      <p class="muted">أُضيف {{ total(done.applied.results) }} عنصرًا. راجعها وعدّلها بما يناسب شركتك.</p>
      <ul class="steps">
        <li v-for="r in done.applied.results" :key="r.key">
          <strong>{{ r.label }}</strong>
          <span>{{ r.added ? `أُضيف ${r.added}` : '' }}{{ r.note ? (r.added ? ' · ' : '') + r.note : '' }}</span>
        </li>
      </ul>
      <div class="modal-actions">
        <button class="btn btn-primary" @click="finish">عرض الإعدادات</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.starter { position: relative; overflow: hidden; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 16px;
  padding: 16px 20px; border-radius: 16px; color: #fff; background: var(--grad-dark); box-shadow: 0 12px 30px rgba(6, 20, 26, .22); }
.glow { position: absolute; inset: -50% auto auto -10%; width: 300px; height: 300px; border-radius: 50%;
  background: radial-gradient(circle, rgba(232, 176, 75, .3), transparent 65%); animation: drift 9s ease-in-out infinite alternate; pointer-events: none; }
@keyframes drift { to { transform: translate(60px, 30px); } }
.icon { font-size: 2rem; filter: drop-shadow(0 0 12px rgba(94, 234, 212, .6)); position: relative; }
.text { flex: 1 1 300px; position: relative; }
.text h2 { margin: 0 0 4px; font-size: 1.1rem; background: linear-gradient(90deg, #fff, #a7f3e9 60%, #f5c66b); -webkit-background-clip: text; background-clip: text; color: transparent; }
.text p { margin: 0; color: rgba(255, 255, 255, .82); line-height: 1.8; font-size: .92rem; }
.actions { position: relative; }
.starter-done { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin: 0 0 12px; padding: 8px 14px;
  border-radius: 10px; background: var(--primary-soft); color: var(--primary); font-size: .88rem; }
.link { background: none; border: 0; color: inherit; text-decoration: underline; cursor: pointer; font: inherit; }
.starter-results { margin: -4px 0 14px; padding: 10px 28px; font-size: .88rem; line-height: 1.9; }
.muted { color: var(--muted); }
.steps { margin: 10px 0 14px; padding-inline-start: 22px; display: grid; gap: 10px; }
.steps li { line-height: 1.7; }
.steps strong { display: block; }
.steps span { color: var(--muted); font-size: .9rem; }
.spinner { display: inline-block; width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, .35); border-top-color: #fff;
  animation: spin .8s linear infinite; vertical-align: -2px; margin-inline-end: 6px; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .glow, .spinner { animation: none; } }
</style>
