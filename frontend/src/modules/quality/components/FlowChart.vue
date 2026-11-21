<script setup lang="ts">
import { computed } from 'vue';
import type { MapStep } from '../lib';

/**
 * رسم خريطة الإجراء: مخطط تدفق بمسارات (Swimlanes) لكل جهة مسؤولة.
 * الخطوات تُرتب تلقائيًا من البداية: كل خطوة تحت السابقة لها، وفي عمود الجهة المسؤولة عنها.
 * الأسهم الراجعة (مثل إعادة للتعديل) تُرسم منقطة على الجانب.
 */
const props = defineProps<{ lanes: string[]; steps: MapStep[]; selected?: string | null }>();
const emit = defineEmits<{ select: [id: string]; doc: [code: string] }>();

const laneW = 220;
const nodeW = 172;
const headH = 46;
const rowH = 108;
const top = headH + 26;
const hOf = (k: MapStep['kind']) => (k === 'decision' ? 74 : k === 'start' || k === 'end' ? 50 : 58);

const layout = computed(() => {
  const steps = props.steps;
  const byId = new Map(steps.map((s) => [s.id, s]));
  const order: string[] = [];
  const seen = new Set<string>();
  const queue = steps.filter((s) => s.kind === 'start').map((s) => s.id);
  if (!queue.length && steps[0]) queue.push(steps[0].id);
  queue.forEach((id) => seen.add(id));
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const n of byId.get(id)?.next ?? []) {
      if (byId.has(n.to) && !seen.has(n.to)) {
        seen.add(n.to);
        queue.push(n.to);
      }
    }
  }
  for (const s of steps) if (!seen.has(s.id)) order.push(s.id);
  // الصف: تحت أبعد سابق له (الأسهم الأمامية فقط)، مع منع تداخل خطوتين في نفس الخانة
  const pos = new Map<string, number>();
  const row = new Map<string, number>();
  order.forEach((id, i) => pos.set(id, i));
  const used = new Set<string>();
  for (const id of order) {
    const s = byId.get(id)!;
    let r = 0;
    for (const p of steps) {
      if (p.next.some((n) => n.to === id) && (pos.get(p.id) ?? 0) < (pos.get(id) ?? 0) && row.has(p.id)) r = Math.max(r, row.get(p.id)! + 1);
    }
    const lane = Math.min(Math.max(s.lane, 0), Math.max(props.lanes.length - 1, 0));
    while (used.has(`${lane}:${r}`)) r++;
    used.add(`${lane}:${r}`);
    row.set(id, r);
  }
  const rows = Math.max(1, ...[...row.values()].map((r) => r + 1));
  const W = Math.max(1, props.lanes.length) * laneW;
  const H = top + rows * rowH;
  const cx = (lane: number) => W - (Math.min(Math.max(lane, 0), Math.max(props.lanes.length - 1, 0)) + 0.5) * laneW;
  const cy = (r: number) => top + r * rowH + 30;
  const nodes = order.map((id, i) => {
    const s = byId.get(id)!;
    return { ...s, x: cx(s.lane), y: cy(row.get(id)!), h: hOf(s.kind), i };
  });
  const at = new Map(nodes.map((n) => [n.id, n]));
  let ei = 0;
  const edges = nodes.flatMap((s) => s.next.filter((n) => at.has(n.to)).map((n, k) => {
    const t = at.get(n.to)!;
    const sb = s.y + s.h / 2;
    const tt = t.y - t.h / 2;
    let d: string;
    let lx: number;
    let ly: number;
    let back = false;
    if (t.y > s.y) {
      if (Math.abs(t.x - s.x) < 1) {
        d = `M${s.x},${sb} V${tt - 2}`;
        lx = s.x + 22;
        ly = sb + 16;
      } else {
        // القرار يخرج مساره الثاني من جانبه
        if (s.kind === 'decision' && k > 0) {
          const sx = t.x < s.x ? s.x - nodeW / 2 + 6 : s.x + nodeW / 2 - 6;
          d = `M${sx},${s.y} H${t.x} V${tt - 2}`;
          lx = (sx + t.x) / 2;
          ly = s.y - 6;
        } else {
          const my = sb + 18;
          d = `M${s.x},${sb} V${my} H${t.x} V${tt - 2}`;
          lx = (s.x + t.x) / 2;
          ly = my - 5;
        }
      }
    } else {
      back = true;
      const gx = Math.min(s.x, t.x) - nodeW / 2 - 16 - k * 6;
      d = `M${s.x - nodeW / 2 + (s.kind === 'decision' ? 6 : 0)},${s.y} H${gx} V${t.y} H${t.x - nodeW / 2 - 3}`;
      lx = gx + 4;
      ly = s.y - 7;
    }
    return { key: `${s.id}-${n.to}-${k}`, d, label: n.label, lx, ly, back, i: ei++ };
  }));
  return { nodes, edges, W, H };
});

const FILL: Record<string, string> = { start: 'url(#q-start)', end: 'url(#q-end)', task: '#ffffff', decision: '#fff7ed', document: '#eff6ff' };
const STROKE: Record<string, string> = { start: '#059669', end: '#b91c1c', task: '#164e38', decision: '#f59e0b', document: '#3b82f6' };
function docPath(x: number, y: number, h: number) {
  const l = x - nodeW / 2;
  const r = x + nodeW / 2;
  const t = y - h / 2;
  const b = y + h / 2 - 6;
  return `M${l},${t} H${r} V${b} C${r - 30},${b + 12} ${x + 20},${b - 12} ${x},${b} S${l + 30},${b + 12} ${l},${b} Z`;
}
</script>

<template>
  <div class="q-map-wrap">
    <svg class="q-map" :width="layout.W" :height="layout.H" :viewBox="`0 0 ${layout.W} ${layout.H}`" role="img" aria-label="خريطة الإجراء">
      <defs>
        <linearGradient id="q-lane-grad" x1="0" x2="1"><stop offset="0" stop-color="#164e38" /><stop offset="1" stop-color="#0b3b46" /></linearGradient>
        <linearGradient id="q-start" x1="0" x2="1"><stop offset="0" stop-color="#10b981" /><stop offset="1" stop-color="#059669" /></linearGradient>
        <linearGradient id="q-end" x1="0" x2="1"><stop offset="0" stop-color="#f87171" /><stop offset="1" stop-color="#b91c1c" /></linearGradient>
        <marker id="q-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#64748b" /></marker>
        <marker id="q-arrow-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#f59e0b" /></marker>
      </defs>
      <template v-for="(l, i) in lanes" :key="'lane' + i">
        <rect class="lane-bg" :x="layout.W - (i + 1) * laneW" y="0" :width="laneW" :height="layout.H" :fill="i % 2 ? 'rgba(15,118,110,.035)' : 'transparent'" />
        <rect class="lane-head" :x="layout.W - (i + 1) * laneW + 4" y="4" :width="laneW - 8" :height="headH - 8" rx="10" />
        <foreignObject :x="layout.W - (i + 1) * laneW + 4" y="4" :width="laneW - 8" :height="headH - 8"><div class="lane-title">{{ l }}</div></foreignObject>
        <line v-if="i > 0" class="lane-line" :x1="layout.W - i * laneW" :x2="layout.W - i * laneW" :y1="headH" :y2="layout.H" />
      </template>
      <g>
        <path v-for="e in layout.edges" :key="e.key" :d="e.d" :class="['edge', { back: e.back }]" :style="{ '--i': e.i }" :marker-end="e.back ? 'url(#q-arrow-back)' : 'url(#q-arrow)'" />
        <text v-for="e in layout.edges.filter((x) => x.label)" :key="'t' + e.key" class="edge-label" :x="e.lx" :y="e.ly" text-anchor="middle">{{ e.label }}</text>
      </g>
      <g v-for="n in layout.nodes" :key="n.id" :class="['node', { sel: selected === n.id }]" :style="{ '--i': n.i }" @click="emit('select', n.id)">
        <rect v-if="n.kind === 'start' || n.kind === 'end'" class="shape" :x="n.x - nodeW / 2" :y="n.y - n.h / 2" :width="nodeW" :height="n.h" :rx="n.h / 2" :fill="FILL[n.kind]" :stroke="STROKE[n.kind]" />
        <polygon v-else-if="n.kind === 'decision'" class="shape" :points="`${n.x},${n.y - n.h / 2} ${n.x + nodeW / 2},${n.y} ${n.x},${n.y + n.h / 2} ${n.x - nodeW / 2},${n.y}`" :fill="FILL.decision" :stroke="STROKE.decision" />
        <path v-else-if="n.kind === 'document'" class="shape" :d="docPath(n.x, n.y, n.h)" :fill="FILL.document" :stroke="STROKE.document" />
        <rect v-else class="shape" :x="n.x - nodeW / 2" :y="n.y - n.h / 2" :width="nodeW" :height="n.h" rx="10" :fill="FILL.task" :stroke="STROKE.task" />
        <foreignObject :x="n.x - (n.kind === 'decision' ? nodeW / 2 - 26 : nodeW / 2)" :y="n.y - n.h / 2 + (n.kind === 'document' ? 0 : 2)" :width="n.kind === 'decision' ? nodeW - 52 : nodeW" :height="n.h - (n.kind === 'document' ? 8 : 4)">
          <div :class="['n-label', { light: n.kind === 'start' || n.kind === 'end' }]" :style="n.kind === 'decision' ? 'font-size: 11.5px' : ''">{{ n.label }}</div>
        </foreignObject>
        <text v-if="n.docCode" class="doc-tag" :x="n.x" :y="n.y + n.h / 2 + 13" text-anchor="middle" @click.stop="emit('doc', n.docCode!)">📄 {{ n.docCode }}</text>
      </g>
    </svg>
  </div>
  <div class="q-legend">
    <span><i style="border-color: #059669; background: #10b981; border-radius: 8px" />بداية</span>
    <span><i style="border-color: #164e38; border-radius: 3px" />خطوة</span>
    <span><i style="border-color: #f59e0b; background: #fff7ed; transform: rotate(45deg) scale(.7)" />قرار</span>
    <span><i style="border-color: #3b82f6; background: #eff6ff" />نموذج أو وثيقة</span>
    <span><i style="border-color: #b91c1c; background: #f87171; border-radius: 8px" />نهاية</span>
    <span style="color: #b45309">- - - مسار راجع</span>
  </div>
</template>
