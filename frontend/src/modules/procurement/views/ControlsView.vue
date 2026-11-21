<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { LEVEL_COLOR, fmtDate, sar } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

/** الرقابة على المشتريات: إشارات المخاطر وسجل المخاطر، والفحوص الرقابية المستمرة، وتوصيات المراجعة الداخلية */
const toast = useToast();
const risks = ref<any>(null);
const controls = ref<any>(null);
const tab = ref<'risks' | 'controls' | 'audit'>('risks');
const LEVEL: Record<string, string> = { high: 'مرتفع', medium: 'متوسط', low: 'منخفض' };
const opened = ref<Record<string, boolean>>({});

onMounted(async () => {
  try {
    [risks.value, controls.value] = await Promise.all([api('/procurement/insights/risks'), api('/procurement/insights/controls')]);
  } catch (e) {
    toast.error((e as Error).message);
  }
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>الرقابة والمخاطر</h1>
        <p class="muted">إشارات تُحسب آليًا من بيانات المشتريات والمستودعات والعقود، مع المخاطر المسجلة في نظام المخاطر، والفحوص الرقابية المستمرة، وتوصيات المراجعة الداخلية على المشتريات.</p>
      </div>
    </div>
    <div class="pc-tabs" style="margin-bottom: 12px">
      <button :class="{ on: tab === 'risks' }" @click="tab = 'risks'">المخاطر ({{ risks?.signals.length ?? 0 }})</button>
      <button :class="{ on: tab === 'controls' }" @click="tab = 'controls'">الفحوص الرقابية</button>
      <button :class="{ on: tab === 'audit' }" @click="tab = 'audit'">المراجعة الداخلية ({{ controls?.audit.length ?? 0 }})</button>
    </div>

    <template v-if="tab === 'risks' && risks">
      <div class="pc-grid" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)">
        <section class="card pm-panel">
          <h2>إشارات المخاطر</h2>
          <ul class="pc-log">
            <li v-for="(s, i) in risks.signals" :key="i">
              <span><span class="pm-pill" :style="{ '--c': LEVEL_COLOR[s.level] }">{{ LEVEL[s.level] }}</span>
                <RouterLink v-if="s.link" class="pm-link" :to="s.link"> <b>{{ s.title }}</b></RouterLink><b v-else> {{ s.title }}</b>
                <div class="pm-muted" style="font-size: .84rem">{{ s.detail }}</div></span>
            </li>
            <li v-if="!risks.signals.length" class="pc-okflag">لا توجد إشارات مخاطر حاليًا.</li>
          </ul>
        </section>
        <div style="display: grid; gap: 16px; align-content: start">
          <section class="card pm-panel">
            <h2>تركّز الإنفاق على الموردين (آخر سنة)</h2>
            <div v-for="c in risks.concentration" :key="c.id" style="margin-bottom: 8px">
              <div class="pc-inline" style="justify-content: space-between; font-size: .86rem"><RouterLink class="pm-link" :to="`/procurement/suppliers/${c.id}`">{{ c.name }}</RouterLink><span>{{ c.share }}%</span></div>
              <div class="pc-bar"><i :style="{ width: `${Math.min(100, c.share)}%`, background: c.share >= 40 ? '#dc2626' : '#0369a1' }" /></div>
              <small class="pm-muted">{{ sar(c.amount) }}</small>
            </div>
            <p v-if="!risks.concentration.length" class="pm-muted">لا توجد تعميدات في آخر سنة.</p>
          </section>
          <section class="card pm-panel">
            <h2>من سجل المخاطر</h2>
            <p v-if="!risks.riskAllowed" class="pm-muted">يظهر سجل المخاطر لمن يملك صلاحية عرض نظام المخاطر.</p>
            <p v-else-if="!risks.riskModule" class="pm-muted">نظام المخاطر غير مفعّل.</p>
            <ul v-else class="pc-log">
              <li v-for="r in risks.riskRegister" :key="r.id"><span><RouterLink class="pm-link" :to="`/risk/register/${r.id}`">{{ r.code }}</RouterLink> · {{ r.title }}
                <small class="pm-muted">{{ r.levelLabel }} ({{ r.score }})</small>
                <small v-if="r.contracts.length" class="pm-muted" style="display: block">مرتبط بـ {{ r.contracts.map((c: any) => c.code).join('، ') }}</small></span></li>
              <li v-if="!risks.riskRegister.length" class="pm-muted">لا توجد مخاطر مسجلة تخص المشتريات. اربط المخاطر بالعقود من شاشة العقد.</li>
            </ul>
          </section>
        </div>
      </div>
    </template>

    <template v-if="tab === 'controls' && controls">
      <div style="display: grid; gap: 12px">
        <section v-for="c in controls.checks" :key="c.kind" class="card pm-panel" :style="{ borderInlineStart: `4px solid ${c.count ? '#d97706' : '#059669'}` }">
          <div class="pc-inline" style="justify-content: space-between; cursor: pointer" @click="opened[c.kind] = !opened[c.kind]">
            <b>{{ c.title }}</b><span :class="c.count ? 'pc-warn' : 'pc-okflag'">{{ c.count ? `${c.count} حالة` : 'لا توجد حالات' }}</span>
          </div>
          <ul v-if="opened[c.kind] && c.rows.length" class="pc-log" style="margin-top: 8px">
            <li v-for="(r, i) in c.rows" :key="i"><span><RouterLink v-if="r.link" class="pm-link" :to="r.link">{{ r.label }}</RouterLink><span v-else>{{ r.label }}</span>
              <div v-if="r.detail" class="pm-muted" style="font-size: .82rem">{{ r.detail }}</div></span></li>
          </ul>
        </section>
      </div>
    </template>

    <template v-if="tab === 'audit' && controls">
      <section class="card pm-panel">
        <p v-if="!controls.auditAllowed" class="pm-muted">تظهر توصيات المراجعة الداخلية لمن يملك صلاحية عرض نظام المراجعة الداخلية.</p>
        <p v-else-if="!controls.auditConfigured" class="pm-muted">حدد مجالات المراجعة الداخلية الخاصة بالمشتريات من الإعدادات (تبويب «تقييم الموردين والرقابة») لتظهر توصياتها هنا.</p>
        <table v-else class="pc-lines">
          <thead><tr><th>الإجراء</th><th>المهمة</th><th>المسؤول</th><th>الاستحقاق</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="a in controls.audit" :key="a.id">
              <td><b>{{ a.code }}</b> {{ a.title }}<small v-if="a.recommendation" class="pm-muted" style="display: block">{{ a.recommendation }}</small></td>
              <td>{{ a.engagement }}</td><td>{{ a.assignee ?? '—' }}</td>
              <td :class="{ 'pc-flag': a.overdue }">{{ fmtDate(a.dueDate) }}</td><td>{{ a.statusLabel }}</td>
            </tr>
            <tr v-if="!controls.audit.length"><td colspan="5" class="pm-muted">لا توجد إجراءات مراجعة على مجالات المشتريات.</td></tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>
