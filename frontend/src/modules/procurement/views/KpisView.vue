<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { today } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

/** مؤشرات أداء المشتريات والمستودعات لفترة، مقارنة بمستهدفاتها */
const toast = useToast();
const r = ref<any>(null);
const f = ref({ from: `${today().slice(0, 4)}-01-01`, to: today() });
async function load() {
  try {
    r.value = await api(`/procurement/insights/kpis?from=${f.value.from}&to=${f.value.to}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
watch(f, load, { deep: true });
const color = (k: any) => (k.met === null ? '#64748b' : k.met ? '#059669' : '#dc2626');
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>مؤشرات أداء المشتريات</h1>
        <p class="muted">تُحسب من الطلبات والتعميدات والاستلام والفواتير والجرد والتقييمات والعقود في الفترة المحددة. التقارير التفصيلية في قسم التقارير.</p>
      </div>
    </div>
    <div class="pc-toolbar">
      <label class="pc-inline">من <input v-model="f.from" type="date" class="input" /></label>
      <label class="pc-inline">إلى <input v-model="f.to" type="date" class="input" :max="today()" /></label>
    </div>
    <div v-if="r" class="pc-cards" style="grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))">
      <div v-for="k in r.kpis" :key="k.key" class="pc-kpi" :style="{ borderInlineStart: `4px solid ${color(k)}` }">
        <small>{{ k.name }}</small>
        <b :style="{ color: color(k) }">{{ k.value ?? '—' }} <small>{{ k.value === null ? '' : k.unit }}</small></b>
        <small v-if="k.target !== null">المستهدف {{ k.better === 'up' ? 'لا يقل عن' : 'لا يزيد عن' }} {{ k.target }} {{ k.unit }}</small>
        <small v-if="k.note">{{ k.note }}</small>
      </div>
    </div>
  </div>
</template>
