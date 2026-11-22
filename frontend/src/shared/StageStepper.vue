<script setup lang="ts">
import { computed } from 'vue';

/** شريط مراحل الطلب: المراحل المنتهية، الحالية (متوهجة)، والقادمة */
const props = defineProps<{ stages: { id: string; name: string }[]; currentId: string | null; status: string }>();
const idx = computed(() => {
  if (props.status === 'approved') return props.stages.length;
  if (props.status === 'returned') return -1;
  return props.stages.findIndex((s) => s.id === props.currentId);
});
const state = (i: number) => {
  if (props.status === 'rejected' || props.status === 'cancelled') return 'off';
  if (i < idx.value) return 'done';
  if (i === idx.value) return 'now';
  return 'next';
};
</script>

<template>
  <ol class="stepper">
    <li v-for="(s, i) in stages" :key="s.id" :class="state(i)" :style="{ '--i': i }">
      <span class="bubble"><template v-if="state(i) === 'done'">✓</template><template v-else>{{ i + 1 }}</template></span>
      <span class="name">{{ s.name }}</span>
    </li>
    <li :class="['final', status === 'approved' ? 'done' : status === 'rejected' ? 'bad' : 'next']">
      <span class="bubble">{{ status === 'rejected' ? '✕' : '★' }}</span>
      <span class="name">{{ status === 'rejected' ? 'مرفوض' : status === 'cancelled' ? 'ملغي' : 'معتمد' }}</span>
    </li>
  </ol>
</template>

<style scoped>
.stepper { list-style: none; margin: 0; padding: 4px 0; display: flex; overflow-x: auto; }
li { position: relative; flex: 1; min-width: 92px; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; animation: in .45s calc(var(--i, 6) * 70ms) var(--ease) both; }
li:not(:last-child)::after { content: ''; position: absolute; top: 17px; inset-inline-start: calc(50% + 22px); inset-inline-end: calc(-50% + 22px); height: 3px; border-radius: 3px; background: var(--border); }
li.done:not(:last-child)::after { background: linear-gradient(90deg, #10b981, #2dd4bf); }
.bubble { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: .9rem; background: var(--surface-2); color: var(--muted); border: 2px solid var(--border); position: relative; z-index: 1; transition: all .3s; }
.done .bubble { background: linear-gradient(135deg, #34d399, #059669); color: #fff; border-color: transparent; }
.now .bubble { background: var(--grad); color: #fff; border-color: transparent; box-shadow: 0 0 0 5px rgba(20,184,166,.2), 0 0 22px rgba(20,184,166,.7); animation: glow 1.8s ease-in-out infinite; }
.bad .bubble { background: linear-gradient(135deg, #f87171, #b91c1c); color: #fff; border-color: transparent; }
.final.done .bubble { background: linear-gradient(135deg, #d9bc98, #d99a2b); box-shadow: 0 0 20px rgba(232,176,75,.7); }
.off .bubble { opacity: .5; }
.name { font-size: .8rem; color: var(--muted); max-width: 120px; line-height: 1.4; }
.now .name { color: var(--primary); font-weight: 700; }
.done .name { color: var(--text); }
@keyframes glow { 50% { box-shadow: 0 0 0 9px rgba(20,184,166,.08), 0 0 30px rgba(20,184,166,.9); } }
@media (max-width: 600px) {
  li { min-width: 62px; }
  .bubble { width: 30px; height: 30px; font-size: .8rem; }
  li:not(:last-child)::after { top: 14px; inset-inline-start: calc(50% + 18px); inset-inline-end: calc(-50% + 18px); }
  .name { font-size: .7rem; }
}
@keyframes in { from { opacity: 0; transform: translateY(8px); } }
</style>
