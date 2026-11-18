<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';

/** جرس المهام: ما ينتظر المستخدم من إجراءات في كل الأنظمة، مقسمًا بتبويبات حسب النظام */
interface Task { id: string; title: string; subtitle?: string | null; link: string; at?: string | null; group?: string | null; urgent?: boolean }
interface Group { module: string; name: string; color: string; count: number; urgent: number; items: Task[] }

const route = useRoute();
const data = ref<{ total: number; groups: Group[] }>({ total: 0, groups: [] });
const open = ref(false);
const tab = ref('');
const root = ref<HTMLElement | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;

async function load() {
  try {
    data.value = await api('/tasks');
    if (!data.value.groups.some((g) => g.module === tab.value)) tab.value = data.value.groups[0]?.module ?? '';
  } catch { /* الجرس لا يعطل الواجهة */ }
}
onMounted(() => {
  load();
  timer = setInterval(load, 60_000);
  document.addEventListener('click', outside);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  document.removeEventListener('click', outside);
});
watch(() => route.path, () => {
  open.value = false;
  load();
});
function outside(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false;
}
const urgent = computed(() => data.value.groups.reduce((s, g) => s + g.urgent, 0));
const current = computed(() => data.value.groups.find((g) => g.module === tab.value));
const color = computed(() => (urgent.value ? '#ef4444' : data.value.total ? '#f59e0b' : '#64748b'));
const ago = (iso?: string | null) => {
  if (!iso) return '';
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? 'اليوم' : d === 1 ? 'أمس' : `منذ ${d} يوم`;
};
</script>

<template>
  <div ref="root" class="bell">
    <button class="bell-btn" :aria-expanded="open" :title="data.total ? `${data.total} مهمة بانتظارك` : 'لا توجد مهام معلقة'" @click="open = !open">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      <b v-if="data.total" class="badge" :style="{ '--c': color }">{{ data.total > 99 ? '99+' : data.total }}</b>
    </button>
    <Transition name="drop">
      <div v-if="open" class="panel card">
        <div class="panel-head">
          <strong>المهام المعلقة</strong>
          <span class="muted">{{ data.total ? `${data.total} مهمة${urgent ? ` · ${urgent} متأخرة` : ''}` : 'لا شيء بانتظارك' }}</span>
        </div>
        <template v-if="data.groups.length">
          <div class="tabs" role="tablist">
            <button v-for="g in data.groups" :key="g.module" role="tab" :aria-selected="tab === g.module" :class="{ on: tab === g.module }" :style="{ '--c': g.color }" @click="tab = g.module">
              {{ g.name }} <b>{{ g.count }}</b>
            </button>
          </div>
          <div v-if="current" class="items">
            <RouterLink v-for="t in current.items" :key="t.id" :to="t.link" :class="['item', { urgent: t.urgent }]" :style="{ '--c': current.color }" @click="open = false">
              <span class="dot" />
              <span class="tx">
                <b>{{ t.title }}</b>
                <small v-if="t.subtitle || t.group">{{ t.group }}{{ t.group && t.subtitle ? ' · ' : '' }}{{ t.subtitle }}</small>
              </span>
              <small class="when">{{ t.urgent ? '⚠ ' : '' }}{{ ago(t.at) }}</small>
            </RouterLink>
          </div>
        </template>
        <p v-else class="empty">🎉 أنجزت كل ما عليك</p>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.bell { position: relative; }
.bell-btn { position: relative; width: 38px; height: 38px; border-radius: 12px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.05); color: #fff;
  display: grid; place-items: center; cursor: pointer; transition: background .2s; }
.bell-btn:hover { background: rgba(255,255,255,.12); }
.badge { position: absolute; top: -6px; inset-inline-start: -6px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 99px; font-size: .72rem; display: grid; place-items: center;
  color: #fff; background: var(--c); box-shadow: 0 0 0 2px #0b1f26; animation: bell-pulse 1.8s infinite; }
@keyframes bell-pulse { 0%, 100% { box-shadow: 0 0 0 2px #0b1f26, 0 0 0 0 color-mix(in srgb, var(--c) 55%, transparent); } 50% { box-shadow: 0 0 0 2px #0b1f26, 0 0 0 8px transparent; } }
.panel { position: absolute; inset-inline-end: 0; top: 48px; width: min(420px, calc(100vw - 24px)); padding: 0; color: var(--text); overflow: hidden; z-index: 30; }
.panel-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--border); }
.muted { color: var(--muted); font-size: .8rem; }
.tabs { display: flex; gap: 6px; overflow-x: auto; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.tabs button { flex-shrink: 0; border: 1px solid var(--border); background: var(--surface); border-radius: 99px; padding: 4px 12px; font: inherit; font-size: .84rem; cursor: pointer; color: var(--text); display: inline-flex; gap: 6px; align-items: center; }
.tabs button b { font-size: .72rem; border-radius: 99px; padding: 0 6px; background: color-mix(in srgb, var(--c) 15%, transparent); color: var(--c); }
.tabs button.on { background: var(--c); border-color: transparent; color: #fff; }
.tabs button.on b { background: rgba(255,255,255,.25); color: #fff; }
.items { max-height: 380px; overflow-y: auto; padding: 6px; }
.item { display: flex; gap: 10px; align-items: center; padding: 10px; border-radius: 10px; color: var(--text); transition: background .15s; }
.item:hover { background: var(--surface-2); }
.item .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--c); flex-shrink: 0; }
.item.urgent .dot { background: #ef4444; animation: bell-pulse 1.8s infinite; --c: #ef4444; }
.item .tx { flex: 1; min-width: 0; display: grid; }
.item .tx b { font-weight: 600; font-size: .9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item .tx small { color: var(--muted); font-size: .78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.when { color: var(--muted); font-size: .74rem; white-space: nowrap; }
.item.urgent .when { color: #ef4444; }
.empty { text-align: center; padding: 26px; margin: 0; color: var(--muted); }
.drop-enter-active, .drop-leave-active { transition: all .2s var(--ease); }
.drop-enter-from, .drop-leave-to { opacity: 0; transform: translateY(-6px) scale(.97); }
@media (prefers-reduced-motion: reduce) { .badge, .item.urgent .dot { animation: none; } }
</style>
