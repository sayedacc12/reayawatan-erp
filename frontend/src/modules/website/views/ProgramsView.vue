<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import SiteIcon from '../../../site/SiteIcon.vue';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { STATUS_COLOR, WP, errMsg, fmtDate, sar } from '../lib';
import '../website.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const toast = useToast();
const rows = ref<any[]>([]);
const tab = ref('all');
const ordering = ref(false);
const TABS: [string, string][] = [['all', 'الكل'], ['approved', 'معتمد'], ['pending', 'بانتظار الاعتماد'], ['returned', 'معاد'], ['draft', 'مسودة'], ['rejected', 'مرفوض']];
async function load() {
  try {
    rows.value = await api('/website/programs');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
onMounted(load);
const count = (s: string) => (s === 'all' ? rows.value.length : rows.value.filter((r) => r.status === s).length);
const shown = computed(() => (ordering.value ? rows.value.filter((r) => r.status === 'approved') : rows.value.filter((r) => tab.value === 'all' || r.status === tab.value)));
function move(p: any, d: number) {
  const list = shown.value;
  const i = list.indexOf(p);
  const other = list[i + d];
  if (!other) return;
  const a = rows.value.indexOf(p);
  const b = rows.value.indexOf(other);
  [rows.value[a], rows.value[b]] = [rows.value[b], rows.value[a]];
}
async function saveOrder() {
  try {
    rows.value = await api('/website/programs/order', { method: 'PUT', json: { ids: rows.value.filter((r) => r.status === 'approved').map((r) => r.id) } });
    ordering.value = false;
    toast.success('حُفظ ترتيب البرامج في الموقع');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>البرامج والمشاريع</h1><p class="muted">صفحة لكل برنامج في الموقع، ويحدد المعتمد ظهوره في المتجر ومستهدفه المالي.</p></div>
      <div class="ws-row" style="margin: 0">
        <template v-if="session.can(WP.publish)">
          <button v-if="!ordering" class="btn" @click="ordering = true">ترتيب الظهور</button>
          <template v-else><button class="btn" @click="ordering = false; load()">إلغاء</button><button class="btn btn-primary" @click="saveOrder">حفظ الترتيب</button></template>
        </template>
        <RouterLink v-if="session.can(WP.edit) || session.can(WP.publish)" to="/website/programs/new" class="btn btn-primary">+ برنامج جديد</RouterLink>
      </div>
    </div>
    <div v-if="!ordering" class="ws-tabs">
      <button v-for="[k, l] in TABS" :key="k" :class="['ws-tab', { on: tab === k }]" @click="tab = k">{{ l }}<span :class="['count', { warn: k === 'pending' && count(k) }]">{{ count(k) }}</span></button>
    </div>
    <div v-else class="ws-note info">رتّب البرامج المعتمدة بالأسهم كما تريد ظهورها في الموقع، ثم احفظ.</div>
    <div v-if="!shown.length" class="card ws-empty"><strong>لا توجد برامج هنا</strong>أضف برنامجًا ليظهر في الموقع بعد اعتماده</div>
    <div class="pg-grid">
      <component :is="ordering ? 'div' : 'RouterLink'" v-for="p in shown" :key="p.id" :to="`/website/programs/${p.id}`" class="pg-card card">
        <div class="pg-img" :style="p.imageUrl ? { backgroundImage: `url(${p.imageUrl})` } : {}">
          <span class="pg-icon"><SiteIcon :name="p.icon" :size="22" /></span>
          <span class="ws-pill pg-status" :style="{ '--c': STATUS_COLOR[p.status] }">{{ p.statusLabel }}</span>
        </div>
        <div class="pg-body">
          <strong>{{ p.name }} <span v-if="p.featured" title="مميز">★</span></strong>
          <p class="muted">{{ p.tagline || p.summary }}</p>
          <template v-if="p.status === 'approved'">
            <div class="ws-row" style="gap: 6px; margin: 0">
              <span class="ws-pill" :style="{ '--c': p.showOnSite ? '#10b981' : '#94a3b8' }">{{ p.showOnSite ? 'ظاهر في الموقع' : 'مخفي' }}</span>
              <span class="ws-pill" :style="{ '--c': p.store.on && !p.storeBlock ? '#0ea5e9' : '#94a3b8' }">{{ p.store.on ? (p.storeBlock ? 'المتجر متوقف' : p.store.kind === 'waqf' ? 'وقف في المتجر' : 'في المتجر') : 'خارج المتجر' }}</span>
            </div>
            <div v-if="p.store.goal" class="ws-progress"><i :style="{ width: `${p.progress}%` }" /></div>
            <small class="muted">{{ sar(p.raised) }}<template v-if="p.store.goal"> من {{ sar(p.store.goal) }}</template> · {{ p.donationsCount }} تبرع</small>
          </template>
          <small v-else class="muted">{{ p.createdByName }} · {{ fmtDate(p.updatedAt) }}</small>
          <div v-if="ordering" class="ws-row" style="margin: 6px 0 0"><button class="btn btn-sm" @click="move(p, -1)">↑ للأعلى</button><button class="btn btn-sm" @click="move(p, 1)">↓ للأسفل</button></div>
        </div>
      </component>
    </div>
  </div>
</template>

<style scoped>
.pg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.pg-card { padding: 0; overflow: hidden; color: inherit; display: flex; flex-direction: column; transition: transform .2s, box-shadow .2s; animation: ws-rise .45s var(--ease) both; }
a.pg-card:hover { transform: translateY(-3px); box-shadow: 0 14px 30px rgba(15,23,42,.12); }
.pg-img { position: relative; height: 130px; background: var(--grad) center / cover; }
.pg-icon { position: absolute; bottom: -18px; inset-inline-start: 14px; width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; background: var(--surface); color: var(--primary); box-shadow: 0 6px 16px rgba(0,0,0,.15); }
.pg-status { position: absolute; top: 10px; inset-inline-end: 10px; }
.pg-body { padding: 24px 14px 14px; display: grid; gap: 6px; }
.pg-body p { margin: 0; font-size: .86rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style>
