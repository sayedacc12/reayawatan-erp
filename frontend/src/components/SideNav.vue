<script setup lang="ts">
/** القائمة الجانبية للتطبيق: عناصر مفردة، ومجموعات رئيسية تنفتح بسهم وتضم الشاشات الفرعية */
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

type Item = { label: string; path: string; group?: string };
const props = defineProps<{ items: Item[]; appCode: string }>();
const route = useRoute();

/** تُجمع عناصر كل مجموعة في موضع أول عنصر منها، مع الحفاظ على ترتيب القائمة */
const blocks = computed(() => {
  const out: ({ kind: 'item'; item: Item } | { kind: 'group'; name: string; items: Item[] })[] = [];
  for (const it of props.items) {
    if (!it.group) { out.push({ kind: 'item', item: it }); continue; }
    const g = out.find((b) => b.kind === 'group' && b.name === it.group);
    if (g && g.kind === 'group') g.items.push(it);
    else out.push({ kind: 'group', name: it.group, items: [it] });
  }
  return out;
});

const isActive = (p: string) => route.path === p || route.path.startsWith(`${p}/`);
const key = computed(() => `erp.nav.${props.appCode}`);
const read = () => { try { return JSON.parse(localStorage.getItem(key.value) ?? '[]') as string[]; } catch { return []; } };
const open = ref<string[]>(read());
function toggle(name: string) {
  open.value = open.value.includes(name) ? open.value.filter((n) => n !== name) : [...open.value, name];
  try { localStorage.setItem(key.value, JSON.stringify(open.value)); } catch { /* تجاهل */ }
}
// المجموعة التي فيها الشاشة الحالية تنفتح تلقائيًا
watch(() => route.path, () => {
  for (const b of blocks.value) if (b.kind === 'group' && b.items.some((i) => isActive(i.path)) && !open.value.includes(b.name)) open.value = [...open.value, b.name];
}, { immediate: true });
watch(key, () => { open.value = read(); });
</script>

<template>
  <template v-for="b in blocks" :key="b.kind === 'item' ? b.item.path : `g:${b.name}`">
    <RouterLink v-if="b.kind === 'item'" :to="b.item.path" :class="['nav-item', { 'is-active': route.path === b.item.path }]">{{ b.item.label }}</RouterLink>
    <div v-else :class="['nav-group', { open: open.includes(b.name), current: b.items.some((i) => isActive(i.path)) }]">
      <button type="button" class="nav-head" :aria-expanded="open.includes(b.name)" @click="toggle(b.name)">
        <span>{{ b.name }}</span>
        <svg class="arrow" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <div class="nav-sub">
        <div class="nav-sub-inner">
          <RouterLink v-for="i in b.items" :key="i.path" :to="i.path" :class="['nav-item', 'sub', { 'is-active': isActive(i.path) }]">{{ i.label }}</RouterLink>
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
.nav-item { position: relative; color: var(--text); padding: 10px 14px; border-radius: 10px; transition: background .2s, color .2s, padding .2s var(--ease); display: block; }
.nav-item:hover { background: var(--surface-2); padding-inline-start: 18px; }
.nav-item.is-active { background: var(--primary-soft); color: var(--primary); font-weight: 600; }
.nav-item.is-active::before { content: ''; position: absolute; inset-inline-start: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 3px; background: var(--grad); box-shadow: 0 0 10px rgba(20,184,166,.6); }
.nav-head { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; border: 0; border-radius: 10px; background: transparent;
  color: var(--text); font: inherit; font-weight: 600; cursor: pointer; transition: background .2s; }
.nav-head:hover { background: var(--surface-2); }
.nav-group.current > .nav-head { color: var(--primary); }
.arrow { transition: transform .3s var(--ease); color: var(--muted); }
.nav-group.open .arrow { transform: rotate(-90deg); color: var(--primary); }
.nav-sub { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .3s var(--ease); }
.nav-group.open .nav-sub { grid-template-rows: 1fr; }
.nav-sub-inner { overflow: hidden; margin-inline-start: 14px; border-inline-start: 1px dashed var(--border); padding-inline-start: 6px; display: flex; flex-direction: column; gap: 2px; }
.nav-item.sub { padding: 8px 12px; font-size: .93rem; }
@media (max-width: 900px) {
  .nav-item { white-space: nowrap; }
  .nav-group { display: contents; }
  .nav-head { display: none; }
  .nav-sub, .nav-group.open .nav-sub { display: contents; }
  .nav-sub-inner { display: contents; }
}
</style>
