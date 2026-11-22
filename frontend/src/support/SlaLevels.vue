<script setup lang="ts">
import { PRIORITY, hoursLabel, type SlaLevel } from './support';
/** دليل مستويات الخدمة وآلية التعامل مع كل مستوى (يظهر للشركة ولمدير المنصة) */
defineProps<{ levels: SlaLevel[]; compact?: boolean }>();
</script>

<template>
  <div class="levels">
    <article v-for="(l, i) in levels" :key="l.priority" class="lvl" :style="{ '--c': PRIORITY[l.priority].color, '--i': i }">
      <header>
        <span class="name"><i class="dot" />{{ l.name }}</span>
        <span class="t"><small>أول رد خلال</small><b>{{ hoursLabel(l.responseHours) }}</b></span>
        <span class="t"><small>الحل خلال</small><b>{{ hoursLabel(l.resolutionHours) }}</b></span>
      </header>
      <p class="desc">{{ l.description }}</p>
      <template v-if="!compact">
        <div class="cols">
          <div>
            <h4>أمثلة</h4>
            <ul><li v-for="e in l.examples" :key="e">{{ e }}</li></ul>
          </div>
          <div>
            <h4>آلية التعامل</h4>
            <ol><li v-for="h in l.handling" :key="h">{{ h }}</li></ol>
          </div>
        </div>
        <p class="esc"><b>التصعيد:</b> {{ l.escalation }}</p>
      </template>
    </article>
  </div>
</template>

<style scoped>
.levels { display: grid; gap: 12px; }
.lvl { position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 14px 18px 12px; overflow: hidden;
  animation: lv-in .45s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--i) * 70ms); }
.lvl::before { content: ''; position: absolute; inset-inline-start: 0; top: 0; bottom: 0; width: 5px; background: var(--c); }
@keyframes lv-in { from { opacity: 0; transform: translateY(10px); } }
header { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.name { font-weight: 700; font-size: 1.05rem; color: var(--c); display: inline-flex; align-items: center; gap: 8px; flex: 1; min-width: 120px; }
.dot { width: 12px; height: 12px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 18%, transparent); }
.t { display: flex; flex-direction: column; background: var(--surface-2); border-radius: 10px; padding: 4px 12px; min-width: 110px; }
.t small { color: var(--muted); font-size: .76rem; }
.desc { margin: 8px 0 4px; }
.cols { display: grid; grid-template-columns: 1fr 1.4fr; gap: 16px; }
h4 { font-size: .85rem; color: var(--muted); margin: 8px 0 4px; font-weight: 600; }
ul, ol { margin: 0; padding-inline-start: 20px; font-size: .92rem; line-height: 1.8; }
.esc { margin: 8px 0 0; font-size: .88rem; background: color-mix(in srgb, var(--c) 8%, transparent); border-radius: 8px; padding: 6px 10px; }
@media (max-width: 700px) { .cols { grid-template-columns: 1fr; } }
</style>
