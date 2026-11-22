<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import { useSession } from '../stores/session';
import SampleDataResult, { type SampleResult } from './SampleDataResult.vue';

/**
 * شريط البيانات التجريبية لمدير نظام الشركة في فترة التجربة:
 * في البداية يعرض إضافة بيانات تجريبية جاهزة أو البدء بجمعية فارغة، وبعد الإضافة يذكّر بأن البيانات تجريبية.
 */
interface Status { status: 'none' | 'loading' | 'stalled' | 'loaded' | 'cleared'; canLoad: boolean; isTrial: boolean }

const session = useSession();
const state = ref<Status | null>(null);
const busy = ref(false);
const error = ref('');
const result = ref<SampleResult | null>(null);
const key = () => `erp.sample.${session.user?.organizationId}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* المتصفح يمنع التخزين */ } };
const hidden = ref<string | null>(null);

watch(() => session.user?.id, async () => {
  state.value = null;
  if (!session.user?.organizationId || !session.user.isSuperadmin) return;
  hidden.value = read(key());
  state.value = await api<Status>('/sample-data').catch(() => null);
}, { immediate: true });

const offer = computed(() => state.value?.canLoad && hidden.value !== 'empty');
const reminder = computed(() => state.value?.status === 'loaded' && state.value.isTrial && hidden.value !== 'reminder' && !result.value);

async function load() {
  busy.value = true;
  error.value = '';
  try {
    result.value = await api<SampleResult>('/sample-data', { method: 'POST' });
    state.value = { status: 'loaded', canLoad: false, isTrial: true };
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function startEmpty() {
  write(key(), 'empty');
  hidden.value = 'empty';
}
function hideReminder() {
  write(key(), 'reminder');
  hidden.value = 'reminder';
}
/** بعد الإضافة: إعادة تحميل الصفحة لتظهر البيانات في كل الشاشات */
const done = () => location.reload();
</script>

<template>
  <Transition name="sample">
    <section v-if="offer || busy" class="sample-offer" role="region" aria-label="البيانات التجريبية">
      <div class="glow" aria-hidden="true" />
      <div class="icon" aria-hidden="true">🌾</div>
      <div class="text">
        <h2>هل تريد تجربة النظام ببيانات جاهزة؟</h2>
        <p v-if="!busy">نضيف إلى شركتك بيانات تجريبية مترابطة في كل الأنظمة: مستفيدون وطلبات، ومتبرعون وتبرعات، وقيود وسندات، وموظفون ورواتب، ومشاريع وتقارير. تتعرف بها على النظام في دقائق، وتُحذف كلها عند بدء العمل الفعلي.</p>
        <p v-else class="loading"><span class="spinner" aria-hidden="true" /> جارٍ إضافة البيانات التجريبية في كل الأنظمة... قد يستغرق ذلك دقيقة أو دقيقتين، فلا تغلق الصفحة.</p>
        <p v-if="error" class="err">{{ error }}</p>
      </div>
      <div v-if="!busy" class="actions">
        <button class="btn btn-primary" @click="load">أضف بيانات تجريبية</button>
        <button class="btn btn-quiet" @click="startEmpty">أبدأ ببيانات فارغة</button>
      </div>
    </section>
    <div v-else-if="reminder" class="sample-reminder">
      <span>يعمل النظام الآن ببيانات تجريبية. عند بدء العمل الفعلي تُحذف كلها بطلب منكم، وتبقى حساباتكم وإعداداتكم.</span>
      <button class="link" @click="hideReminder">إخفاء</button>
    </div>
  </Transition>

  <div v-if="result" class="modal-backdrop">
    <div class="modal card wide">
      <h3>🎉 أصبحت شركتك جاهزة للتجربة</h3>
      <SampleDataResult :result="result" :slug="session.user?.organizationSlug ?? ''" />
      <div class="modal-actions">
        <button class="btn btn-primary" @click="done">ابدأ الاستكشاف</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sample-offer { position: relative; overflow: hidden; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 18px;
  padding: 18px 20px; border-radius: 16px; color: #fff; background: var(--grad-dark); box-shadow: 0 12px 30px rgba(6, 20, 26, .25); }
.glow { position: absolute; inset: -40% -10% auto auto; width: 320px; height: 320px; border-radius: 50%;
  background: radial-gradient(circle, rgba(45, 212, 191, .35), transparent 65%); animation: drift 8s ease-in-out infinite alternate; pointer-events: none; }
@keyframes drift { to { transform: translate(-60px, 40px); } }
.icon { font-size: 2.2rem; filter: drop-shadow(0 0 12px rgba(232, 176, 75, .6)); }
.text { flex: 1 1 320px; position: relative; }
.text h2 { margin: 0 0 4px; font-size: 1.15rem; background: linear-gradient(90deg, #fff, #a7f3e9 60%, #d9bc98); -webkit-background-clip: text; background-clip: text; color: transparent; }
.text p { margin: 0; color: rgba(255, 255, 255, .82); line-height: 1.8; font-size: .93rem; }
.err { color: #fecaca !important; margin-top: 6px !important; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; position: relative; }
.btn-quiet { background: rgba(255, 255, 255, .08); color: #fff; border-color: rgba(255, 255, 255, .25); }
.btn-quiet:hover { background: rgba(255, 255, 255, .16); }
.loading { display: flex; align-items: center; gap: 10px; }
.spinner { width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, .25); border-top-color: #a9c9b5; animation: spin .8s linear infinite; flex: none; }
@keyframes spin { to { transform: rotate(360deg); } }
.sample-reminder { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; padding: 8px 14px;
  border-radius: 10px; background: #fff7e6; color: #7a4800; border: 1px solid #f5d79e; font-size: .9rem; }
.link { background: none; border: 0; color: inherit; text-decoration: underline; cursor: pointer; font: inherit; flex: none; }
.wide { max-width: 720px; width: 100%; }
.sample-enter-active, .sample-leave-active { transition: all .35s var(--ease); }
.sample-enter-from, .sample-leave-to { opacity: 0; transform: translateY(-8px); }
@media (prefers-reduced-motion: reduce) { .glow, .spinner { animation: none; } }
</style>
