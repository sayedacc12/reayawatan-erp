<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { fmtDate, LEVELS, num, P } from '../lib';
import '../../projects/projects.css';
import '../gov.css';

interface Alert {
  key: string; level: 'critical' | 'warning' | 'info'; category: string; categoryLabel: string; title: string; detail: string; ref: string | null; due: string | null;
  impact: number | null; link: string | null; acknowledged: boolean; ack: { until: string; note: string | null; byName: string } | null;
}
const session = useSession();
const toast = useToast();
const data = ref<{ items: Alert[]; counts: Record<string, number> } | null>(null);
const showAll = ref(false);
const cat = ref('');
const canAck = computed(() => session.can(P.assess) || session.can(P.actions) || session.can(P.settings));
async function load() {
  data.value = await api(`/governance/alerts${showAll.value ? '?all=1' : ''}`);
}
onMounted(load);
const cats = computed(() => {
  const m = new Map<string, { label: string; n: number }>();
  for (const a of data.value?.items ?? []) m.set(a.category, { label: a.categoryLabel, n: (m.get(a.category)?.n ?? 0) + 1 });
  return [...m.entries()];
});
const list = computed(() => (data.value?.items ?? []).filter((a) => !cat.value || a.category === cat.value));
async function ack(a: Alert) {
  const note = prompt('سبب التأجيل (اختياري). سيُخفى الإنذار 30 يوماً ثم يعود إن بقي سببه:');
  if (note === null) return;
  try {
    await api(`/governance/alerts/${encodeURIComponent(a.key)}/ack`, { method: 'POST', json: { days: 30, note: note || null } });
    toast.success('أُجّل الإنذار 30 يوماً');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function unack(a: Alert) {
  await api(`/governance/alerts/${encodeURIComponent(a.key)}/ack`, { method: 'DELETE' });
  await load();
}
</script>

<template>
  <div>
    <section class="pm-hero gv-hero">
      <div>
        <p class="pm-kicker">الإنذار المبكر</p>
        <h1>إشارات قبل حدوث المشكلة</h1>
        <p class="pm-sub">يراقب النظام المواعيد النظامية والبيانات الأساسية للجمعية والمؤشرات المالية من الدفاتر ونتائج آخر تقييم وخطة التحسين، وينذر قبل أن تتحول إلى خسارة في درجة الحوكمة.</p>
      </div>
    </section>
    <div v-if="data" class="pm-kpis">
      <div v-for="(l, k, i) in LEVELS" :key="k" class="pm-kpi" :style="{ '--a': l.color, '--i': i }"><span>{{ l.label }}</span><strong>{{ data.counts[k] }}</strong></div>
    </div>
    <section class="card pm-panel">
      <div class="pm-filters">
        <div class="gv-tabs" style="margin: 0">
          <button :class="['gv-tab', { on: !cat }]" @click="cat = ''">الكل</button>
          <button v-for="[k, c] in cats" :key="k" :class="['gv-tab', { on: cat === k }]" @click="cat = k">{{ c.label }}<b>{{ c.n }}</b></button>
        </div>
        <label style="margin-inline-start: auto; display: flex; gap: 6px; align-items: center; font-size: .84rem"><input v-model="showAll" type="checkbox" @change="load" /> إظهار المؤجلة</label>
      </div>
      <p v-if="data && !list.length" class="pm-empty">لا توجد إنذارات. الوضع مطمئن.</p>
      <div class="gv-alerts">
        <div v-for="(a, i) in list" :key="a.key" :class="['gv-alert', a.level]" :style="{ '--c': LEVELS[a.level].color, '--i': i, opacity: a.acknowledged ? .6 : 1 }">
          <span class="dot" />
          <div>
            <h4>{{ a.title }}</h4>
            <p>{{ a.detail }}</p>
            <p>
              <span class="gv-pill" :style="{ '--c': LEVELS[a.level].color }">{{ LEVELS[a.level].label }}</span>
              {{ a.categoryLabel }}<template v-if="a.due"> · الموعد {{ fmtDate(a.due) }}</template><template v-if="a.impact"> · الأثر {{ num(a.impact, 2) }} درجة</template>
              <template v-if="a.ref"> · المرجع <span class="gv-code">{{ a.ref }}</span></template>
            </p>
            <p v-if="a.ack">مؤجل حتى {{ fmtDate(a.ack.until) }} بواسطة {{ a.ack.byName }}{{ a.ack.note ? `: ${a.ack.note}` : '' }}</p>
          </div>
          <div class="acts">
            <RouterLink v-if="a.link" :to="a.link" class="btn btn-sm">معالجة</RouterLink>
            <template v-if="canAck">
              <button v-if="!a.acknowledged" class="btn btn-sm btn-ghost" @click="ack(a)">تأجيل</button>
              <button v-else class="btn btn-sm btn-ghost" @click="unack(a)">إلغاء التأجيل</button>
            </template>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
