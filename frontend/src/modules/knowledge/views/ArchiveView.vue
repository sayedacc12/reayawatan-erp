<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import DocForm from '../components/DocForm.vue';
import { DocRow, KP, STATUS_COLOR, TYPE_ICON, fmtDate } from '../lib';
import '../../../shared/ws.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const router = useRouter();
const toast = useToast();
const lookups = ref<any>(null);
const overview = ref<any>(null);
const rows = ref<DocRow[]>([]);
const f = ref({ q: '', category: '', type: '', status: '', visibility: '', review: '' });
const view = ref<'grid' | 'list'>('grid');
const creating = ref(false);
const loading = ref(true);
const canManage = computed(() => session.can(KP.manage) || session.can(KP.publish));

async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/knowledge/documents?${q}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  try {
    [lookups.value, overview.value] = await Promise.all([api('/knowledge/lookups'), api('/knowledge/overview')]);
  } catch (e) {
    toast.error((e as Error).message);
  }
  await load();
});
let t: ReturnType<typeof setTimeout>;
watch(() => f.value.q, () => { clearTimeout(t); t = setTimeout(load, 300); });
watch(() => [f.value.category, f.value.type, f.value.status, f.value.visibility, f.value.review], load);
function pickCategory(id: string) {
  f.value.category = f.value.category === id ? '' : id;
}
function saved(d: any) {
  creating.value = false;
  router.push(`/knowledge/${d.id}`);
}
</script>

<template>
  <div>
    <section class="kn-hero">
      <div class="kn-hero-text">
        <span class="kn-kicker">أرشيف المعرفة</span>
        <h1>كل معرفة الجمعية في مكان واحد</h1>
        <p>اللوائح والسياسات والأدلة والدراسات والتقارير والدروس المستفادة، بإصداراتها المعتمدة.</p>
        <div class="kn-search">
          <span>⌕</span><input v-model="f.q" placeholder="ابحث بالعنوان أو الرمز أو الكلمات المفتاحية أو المحتوى" />
        </div>
      </div>
      <div v-if="overview" class="kn-hero-stats">
        <div><strong>{{ overview.published }}</strong><span>وثيقة منشورة</span></div>
        <div><strong>{{ overview.public }}</strong><span>في الموقع</span></div>
        <div v-if="canManage"><strong>{{ overview.drafts }}</strong><span>مسودة</span></div>
        <button v-if="overview.reviewDue" :class="['due', { on: f.review === '1' }]" @click="f.review = f.review ? '' : '1'"><strong>{{ overview.reviewDue }}</strong><span>تحتاج مراجعة</span></button>
      </div>
      <i class="orb a" /><i class="orb b" />
    </section>

    <div v-if="overview?.byCategory?.length" class="kn-cats">
      <button v-for="c in overview.byCategory" :key="c.id" :class="['kn-cat', { on: f.category === c.id }]" :style="{ '--c': c.color }" @click="pickCategory(c.id)">
        <i /><strong>{{ c.name }}</strong><span>{{ c.count }}</span>
      </button>
    </div>

    <div class="ws-filters">
      <select v-model="f.type" class="input"><option value="">كل الأنواع</option><option v-for="(l, k) in lookups?.types" :key="k" :value="k">{{ l }}</option></select>
      <select v-if="canManage" v-model="f.status" class="input"><option value="">كل الحالات</option><option v-for="(l, k) in lookups?.statuses" :key="k" :value="k">{{ l }}</option></select>
      <select v-model="f.visibility" class="input"><option value="">الداخلية والعامة</option><option value="public">المنشورة في الموقع</option><option value="internal">الداخلية فقط</option></select>
      <span style="flex: 1" />
      <div class="kn-view"><button :class="{ on: view === 'grid' }" title="بطاقات" @click="view = 'grid'">▦</button><button :class="{ on: view === 'list' }" title="قائمة" @click="view = 'list'">☰</button></div>
      <button v-if="session.can(KP.manage)" class="btn btn-primary" @click="creating = true">+ وثيقة جديدة</button>
    </div>

    <div v-if="!loading && !rows.length" class="card ws-empty"><strong>لا توجد وثائق</strong>{{ f.q ? 'جرّب كلمات بحث أخرى' : 'أضف أول وثيقة إلى الأرشيف' }}</div>
    <TransitionGroup v-else-if="view === 'grid'" tag="div" name="kn" class="kn-grid">
      <RouterLink v-for="d in rows" :key="d.id" :to="`/knowledge/${d.id}`" class="kn-card card" :style="{ '--c': d.categoryColor }">
        <div class="kn-card-top">
          <span class="kn-type" :title="d.typeLabel">{{ TYPE_ICON[d.docType] ?? '•' }}</span>
          <div><small>{{ d.typeLabel }}<template v-if="d.code"> · <span class="ws-code">{{ d.code }}</span></template></small><strong>{{ d.title }}</strong></div>
        </div>
        <p>{{ d.summary || 'بدون ملخص' }}</p>
        <div class="kn-card-foot">
          <span class="ws-pill" :style="{ '--c': STATUS_COLOR[d.status] }">{{ d.statusLabel }}</span>
          <span v-if="d.visibility === 'public'" class="ws-pill" style="--c: #0ea5e9">في الموقع</span>
          <span v-if="d.reviewDue" class="ws-pill" style="--c: #f97316">حان موعد المراجعة</span>
          <span style="flex: 1" />
          <small class="muted">إصدار {{ d.version }}</small>
        </div>
        <div class="kn-meta"><span>{{ d.categoryName ?? 'بدون تصنيف' }}</span><span>👁 {{ d.views }}</span></div>
      </RouterLink>
    </TransitionGroup>
    <div v-else class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرمز</th><th>العنوان</th><th>النوع</th><th>التصنيف</th><th>الإصدار</th><th>تاريخ الإصدار</th><th>المراجعة</th><th>الحالة</th><th>المشاهدات</th></tr></thead>
        <tbody>
          <tr v-for="d in rows" :key="d.id" class="ws-click" @click="router.push(`/knowledge/${d.id}`)">
            <td class="ws-code">{{ d.code ?? '—' }}</td><td><strong>{{ d.title }}</strong></td><td>{{ d.typeLabel }}</td><td>{{ d.categoryName ?? '—' }}</td><td>{{ d.version }}</td>
            <td>{{ fmtDate(d.issuedOn) }}</td><td :style="{ color: d.reviewDue ? '#ea580c' : '' }">{{ fmtDate(d.reviewOn) }}</td>
            <td><span class="ws-pill" :style="{ '--c': STATUS_COLOR[d.status] }">{{ d.statusLabel }}</span><span v-if="d.visibility === 'public'" class="ws-pill" style="--c: #0ea5e9">في الموقع</span></td><td>{{ d.views }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <DocForm v-if="creating && lookups" :lookups="lookups" @close="creating = false" @saved="saved" />
  </div>
</template>

<style scoped>
.kn-hero { position: relative; overflow: hidden; border-radius: 18px; padding: 28px; margin-bottom: 16px; color: #fff; background: var(--grad-dark); display: flex; gap: 24px; align-items: flex-end; flex-wrap: wrap; }
.kn-hero-text { flex: 1; min-width: 280px; position: relative; z-index: 1; }
.kn-kicker { color: var(--gold); font-weight: 700; font-size: .85rem; }
.kn-hero h1 { font-size: 1.6rem; margin: 6px 0; }
.kn-hero p { opacity: .8; margin: 0 0 16px; }
.kn-search { display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.2); border-radius: 14px; padding: 4px 14px; backdrop-filter: blur(6px); max-width: 620px; transition: background .2s, border-color .2s; }
.kn-search:focus-within { background: rgba(255,255,255,.16); border-color: var(--gold); }
.kn-search span { font-size: 1.3rem; opacity: .7; }
.kn-search input { flex: 1; background: none; border: 0; color: #fff; font: inherit; padding: 10px 0; outline: none; }
.kn-search input::placeholder { color: rgba(255,255,255,.6); }
.kn-hero-stats { display: flex; gap: 10px; position: relative; z-index: 1; flex-wrap: wrap; }
.kn-hero-stats > * { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); border-radius: 14px; padding: 10px 16px; text-align: center; color: #fff; font: inherit; }
.kn-hero-stats strong { display: block; font-size: 1.5rem; }
.kn-hero-stats span { font-size: .78rem; opacity: .8; }
.kn-hero-stats .due { cursor: pointer; border-color: rgba(251,146,60,.6); }
.kn-hero-stats .due strong { color: #fdba74; }
.kn-hero-stats .due.on { background: rgba(251,146,60,.25); }
.orb { position: absolute; border-radius: 50%; filter: blur(30px); opacity: .35; animation: float 9s ease-in-out infinite; }
.orb.a { width: 220px; height: 220px; background: var(--gold); inset-inline-end: -60px; top: -80px; }
.orb.b { width: 180px; height: 180px; background: #2dd4bf; inset-inline-start: 30%; bottom: -110px; animation-delay: -4s; }
@keyframes float { 50% { transform: translate(-20px, 14px) scale(1.08); } }
.kn-cats { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.kn-cat { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); background: var(--surface); border-radius: 12px; padding: 8px 12px; cursor: pointer; font: inherit; transition: transform .2s, border-color .2s, box-shadow .2s; }
.kn-cat:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
.kn-cat i { width: 10px; height: 10px; border-radius: 3px; background: var(--c); }
.kn-cat span { background: var(--surface-2); border-radius: 999px; padding: 0 8px; font-size: .78rem; color: var(--muted); }
.kn-cat.on { border-color: var(--c); background: color-mix(in srgb, var(--c) 10%, white); }
.kn-view { display: flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.kn-view button { border: 0; background: var(--surface); padding: 7px 12px; cursor: pointer; font-size: 1rem; color: var(--muted); }
.kn-view button.on { background: var(--primary-soft); color: var(--primary); }
.kn-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.kn-card { padding: 16px; color: var(--text); display: flex; flex-direction: column; gap: 10px; position: relative; overflow: hidden; transition: transform .25s var(--ease), box-shadow .25s; border-top: 3px solid var(--c); }
.kn-card:hover { transform: translateY(-4px); box-shadow: 0 14px 30px rgba(15,23,42,.1); }
.kn-card-top { display: flex; gap: 10px; align-items: flex-start; }
.kn-type { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; font-size: 1.2rem; flex-shrink: 0; color: var(--c); background: color-mix(in srgb, var(--c) 12%, white); }
.kn-card-top small { color: var(--muted); display: block; font-size: .78rem; }
.kn-card-top strong { line-height: 1.4; }
.kn-card p { margin: 0; color: var(--muted); font-size: .88rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.6em; }
.kn-card-foot { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.kn-meta { display: flex; justify-content: space-between; font-size: .78rem; color: var(--muted); border-top: 1px dashed var(--border); padding-top: 8px; }
.kn-enter-active { transition: all .35s var(--ease); }
.kn-enter-from { opacity: 0; transform: translateY(10px); }
</style>
