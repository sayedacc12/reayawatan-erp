<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { fmtDate, sar, today } from '../lib';
import '../../../shared/module.css';
import '../../procurement/procurement.css';
import '../billing.css';

const toast = useToast();
const asOf = ref(today());
const d = ref<any>(null);
async function load() {
  try {
    d.value = await api(`/billing/reconciliation?asOf=${asOf.value}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>مطابقة الفوترة مع الدليل</h1>
        <p class="muted">يُقارن رصيد حساب العملاء وحساب ضريبة المخرجات في الدليل بما يقابلهما في نظام الفوترة: الفواتير والإشعارات الصادرة، والتحصيل بسندات القبض المعتمدة. أي فرق يظهر بعلامة حمراء مع سببه.</p>
      </div>
      <div class="pc-inline"><input v-model="asOf" type="date" class="input" /><button class="btn" @click="load">مطابقة</button></div>
    </div>
    <template v-if="d">
      <p v-if="!d.accounts.length" class="alert" style="background: #fffbeb">حدد حساب العملاء وحساب ضريبة المخرجات في إعدادات الفوترة أولًا.</p>
      <div v-else :class="['pc-check-box', d.ok ? 'ok' : 'bad']" style="margin-bottom: 14px">{{ d.ok ? `✓ الأرصدة مطابقة حتى ${fmtDate(d.asOf)}` : `✕ يوجد ${d.issues} فرق حتى ${fmtDate(d.asOf)}` }}</div>
      <div style="display: grid; gap: 14px">
        <section v-for="a in d.accounts" :key="a.kind" class="card pm-panel" :style="{ borderInlineStart: `4px solid ${a.ok ? '#059669' : '#dc2626'}` }">
          <h2>{{ a.kindLabel }} <small class="pm-muted pc-code">{{ a.code }} {{ a.name }}</small></h2>
          <dl class="pc-dl">
            <div><dt>رصيد الحساب في الدليل</dt><dd>{{ sar(a.gl) }}</dd></div>
            <div><dt>رصيد الفوترة</dt><dd>{{ sar(a.subledger) }}<small class="pm-muted" style="display: block; font-weight: 400">{{ a.description }}</small></dd></div>
            <div><dt>الفرق</dt><dd :style="{ color: a.ok ? '#047857' : '#b91c1c' }">{{ a.ok ? '✓ لا فرق' : sar(a.diff) }}</dd></div>
          </dl>
          <ul v-if="a.problems.length" style="margin: 10px 0 0; padding-inline-start: 18px">
            <li v-for="(p, i) in a.problems" :key="i" style="color: #b91c1c; font-size: .86rem">{{ p }}</li>
          </ul>
          <div v-if="a.foreignEntries.length" style="margin-top: 8px; font-size: .84rem">
            <b>قيود على الحساب من خارج الفوترة:</b>
            <RouterLink v-for="e in a.foreignEntries" :key="e.id" class="pm-link" style="margin-inline-start: 8px" :to="`/accounting/entries/${e.id}`">قيد {{ e.entryNo }}</RouterLink>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
