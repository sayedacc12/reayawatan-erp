
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { DOMAINS, fmtDate, P, WF_STATUS } from '../lib';
import '../../../shared/module.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const router = useRouter();
const rows = ref<any[] | null>(null);
const domain = ref('');
onMounted(async () => { rows.value = await api<any[]>('/risk/procedures'); });
const list = computed(() => (rows.value ?? []).filter((r) => !domain.value || r.domain === domain.value));
</script>

<template>
  <div>
    <section class="pm-hero rk-hero">
      <div><p class="pm-kicker">هندسة الإجراءات</p><h1>دليل الإجراءات</h1>
        <p class="pm-sub">كل إجراء بخطوات مرتبة: المنفذ والمدة والمخرج ونقطة الرقابة، مع ربطه بالمخاطر والضوابط. يمر بمراحل اعتماد تضبط من الإعدادات، ويأخذ رقم إصدار جديدًا مع كل إعادة اعتماد.</p></div>
      <div class="pm-actions"><RouterLink v-if="session.can(P.procedures)" to="/risk/procedures/new" class="btn rk-glow">إجراء جديد</RouterLink></div>
    </section>
    <div class="rk-tabs">
      <button :class="['rk-tab', { on: !domain }]" @click="domain = ''">الكل</button>
      <button v-for="(l, k) in DOMAINS" :key="k" :class="['rk-tab', { on: domain === k }]" @click="domain = k">{{ l }}</button>
    </div>
    <section class="card">
      <p v-if="rows && !list.length" class="pm-empty">لا توجد إجراءات</p>
      <div v-else class="table-wrap"><table class="table">
        <thead><tr><th>الرمز والإصدار</th><th>الإجراء</th><th>المجال</th><th>الخطوات</th><th>المدة الكلية</th><th>المخاطر / الضوابط</th><th>الاعتماد</th><th>تاريخ الاعتماد</th></tr></thead>
        <tbody><tr v-for="p in list" :key="p.id" class="rk-row" @click="router.push(`/risk/procedures/${p.id}`)">
          <td class="rk-code">{{ p.code }} Rev.{{ String(p.revision).padStart(2, '0') }}</td>
          <td style="white-space: normal"><b>{{ p.name }}</b><span v-if="p.ownerName" class="pm-muted"> · {{ p.ownerName }}</span></td>
          <td>{{ DOMAINS[p.domain] ?? p.domain }}</td><td>{{ p.steps }}</td><td>{{ p.totalDays ? `${p.totalDays} يوم` : '—' }}</td>
          <td>{{ p.risks }} / {{ p.controls }}</td>
          <td><span class="pm-pill" :style="{ '--c': WF_STATUS[p.status].color }">{{ WF_STATUS[p.status].label }}</span><span v-if="p.stageName" class="pm-muted"> {{ p.stageName }}</span></td>
          <td>{{ fmtDate(p.approvedAt) }}</td>
        </tr></tbody>
      </table></div>
    </section>
  </div>
</template>
