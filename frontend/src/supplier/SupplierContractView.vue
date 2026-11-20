<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { CONTRACT_COLOR, fmtDate, fmtDateTime, fmtSize, sar } from '../modules/procurement/lib';
import { openSupplierFile, supplierApi } from './supplier';

const route = useRoute();
const slug = computed(() => route.params.slug as string);
const id = computed(() => route.params.id as string);
const d = ref<any>(null);
const error = ref('');
onMounted(async () => {
  try {
    d.value = await supplierApi(`/contracts/${id.value}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const slaName = (k: string) => d.value?.slas.find((s: any) => s.key === k)?.name ?? '—';
const openFile = (key: string) => openSupplierFile(`/contracts/${id.value}/files/${key}`).catch((e) => (error.value = (e as Error).message));
</script>

<template>
  <div>
    <RouterLink :to="`/supplier/${slug}/contracts`" class="pm-link" style="display: inline-block; margin-bottom: 10px">→ العقود</RouterLink>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="d">
      <div class="page-head">
        <div>
          <h1>{{ d.code }} · {{ d.title }}</h1>
          <p class="muted">{{ d.kindLabel }} · <span class="pm-pill" :style="{ '--c': CONTRACT_COLOR[d.status] }">{{ d.statusLabel }}</span> · النسخة {{ d.version }}<span v-if="d.reference"> · المرجع {{ d.reference }}</span></p>
        </div>
      </div>
      <div class="pc-cards" style="margin-bottom: 14px">
        <div class="pc-kpi"><small>المدة</small><b style="font-size: 1rem">{{ fmtDate(d.startsOn) }}</b><small>إلى {{ fmtDate(d.endsOn) }}</small></div>
        <div class="pc-kpi"><small>قيمة العقد</small><b>{{ sar(d.value) }}</b></div>
        <div class="pc-kpi"><small>المستخدم بالتعميدات</small><b>{{ sar(d.used) }}</b></div>
        <div class="pc-kpi"><small>المتبقي</small><b>{{ sar(d.remaining) }}</b></div>
      </div>
      <div style="display: grid; gap: 16px">
        <section v-if="d.scope || d.terms" class="card pm-panel">
          <p v-if="d.scope" style="white-space: pre-line; margin: 0"><b>النطاق:</b> {{ d.scope }}</p>
          <p v-if="d.terms" class="pm-muted" style="white-space: pre-line"><b>الشروط:</b> {{ d.terms }}</p>
        </section>
        <section class="card pm-panel">
          <h2>الأسعار التعاقدية</h2>
          <table class="pc-lines">
            <thead><tr><th>البند</th><th>الوحدة</th><th>سعر الوحدة</th><th>الحد الأعلى للكمية</th></tr></thead>
            <tbody>
              <tr v-for="(p, i) in d.prices" :key="i"><td>{{ p.description }}</td><td>{{ p.unit ?? '—' }}</td><td class="pc-num">{{ p.unitPrice }}</td><td class="pc-num">{{ p.maxQty ?? '—' }}</td></tr>
              <tr v-if="!d.prices.length"><td colspan="4" class="pm-muted">لا توجد أسعار تعاقدية.</td></tr>
            </tbody>
          </table>
        </section>
        <section class="card pm-panel">
          <h2>مستويات الخدمة</h2>
          <ul class="pc-log">
            <li v-for="s in d.slas" :key="s.key"><span>{{ s.name }}: {{ s.direction === 'max' ? 'لا يزيد عن' : 'لا يقل عن' }} {{ s.target }} {{ s.unit }}</span></li>
          </ul>
          <table v-if="d.kpiReadings.length" class="pc-lines" style="margin-top: 8px">
            <thead><tr><th>المؤشر</th><th>الشهر</th><th>القراءة</th><th>النتيجة</th></tr></thead>
            <tbody><tr v-for="(r, i) in d.kpiReadings" :key="i"><td>{{ slaName(r.slaKey) }}</td><td>{{ r.period }}</td><td class="pc-num">{{ r.value }}</td>
              <td><span :class="r.met ? 'pc-okflag' : 'pc-warn'">{{ r.met ? 'محقق' : 'غير محقق' }}</span></td></tr></tbody>
          </table>
        </section>
        <section class="card pm-panel">
          <h2>الضمانات والجزاءات والملاحق</h2>
          <ul class="pc-log">
            <li v-for="(g, i) in d.guarantees" :key="`g${i}`"><span><b>{{ g.kind }}</b> · {{ sar(g.amount) }} {{ g.ref ?? '' }}{{ g.expiresOn ? ` · ينتهي ${fmtDate(g.expiresOn)}` : '' }}{{ g.released ? ' · أُفرج عنه' : '' }}</span></li>
            <li v-for="(p, i) in d.penalties" :key="`p${i}`"><span>جزاء {{ fmtDate(p.date) }}: {{ p.reason }} · <b>{{ sar(p.amount) }}</b></span></li>
            <li v-for="a in d.amendments" :key="`a${a.no}`"><span>ملحق {{ a.no }} ({{ a.kind }}): {{ a.reason }} <small class="pm-muted">{{ fmtDateTime(a.at) }}</small></span></li>
            <li v-if="!d.guarantees.length && !d.penalties.length && !d.amendments.length" class="pm-muted">لا شيء.</li>
          </ul>
        </section>
        <section class="card pm-panel">
          <h2>المستندات</h2>
          <p v-if="d.requiredDocs.length" class="pm-muted" style="font-size: .85rem">المطلوب منكم: {{ d.requiredDocs.join('، ') }}</p>
          <ul class="pc-log">
            <li v-for="f in d.attachments" :key="f.key"><span><a class="pm-link" href="#" @click.prevent="openFile(f.key)">{{ f.name }}</a> <small class="pm-muted">{{ fmtSize(f.size) }}</small></span></li>
            <li v-if="!d.attachments.length" class="pm-muted">لا توجد مرفقات.</li>
          </ul>
        </section>
      </div>
    </template>
  </div>
</template>
