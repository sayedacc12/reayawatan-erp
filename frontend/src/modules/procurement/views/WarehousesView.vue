<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import WarehouseForm from '../components/WarehouseForm.vue';
import { PR, accLabel, fmtDate, sar } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const route = useRoute();
const router = useRouter();
const tab = ref<'list' | 'reconcile'>(route.query.tab === 'reconcile' ? 'reconcile' : 'list');
const rec = ref<any>(null);
const asOf = ref('');
const session = useSession();
const toast = useToast();
const rows = ref<any[]>([]);
const adding = ref(false);
async function load() {
  try {
    rows.value = await api('/procurement/warehouses');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function loadRec() {
  try {
    rec.value = await api(`/procurement/stock/reconcile${asOf.value ? `?asOf=${asOf.value}` : ''}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function show(t: 'list' | 'reconcile') {
  tab.value = t;
  router.replace({ query: t === 'reconcile' ? { tab: t } : {} });
  if (t === 'reconcile') loadRec();
}
onMounted(() => {
  load();
  if (tab.value === 'reconcile') loadRec();
});
const KIND_C: Record<string, string> = { main: '#0f766e', sub: '#0369a1', field: '#b45309', temporary: '#7c3aed' };
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>المستودعات ومواقع التخزين</h1><p class="muted">المستودعات الرئيسية والفرعية والميدانية، بأمنائها وحساباتها ومواقعها الداخلية (مناطق وممرات وأرفف وخانات).</p></div>
      <button v-if="session.can(PR.warehouses)" class="btn btn-primary" @click="adding = true">+ مستودع جديد</button>
    </div>
    <div class="pc-tabs">
      <button :class="{ on: tab === 'list' }" @click="show('list')">المستودعات</button>
      <button :class="{ on: tab === 'reconcile' }" @click="show('reconcile')">المطابقة مع الدليل<b v-if="rec && rec.issues">{{ rec.issues }}</b></button>
    </div>
    <template v-if="tab === 'reconcile'">
      <p class="pm-muted" style="font-size: .88rem">يُطابق رصيد كل حساب مخزون في الدليل المحاسبي مع مجموع قيمة حركات المستودعات عليه. أي فرق يظهر بعلامة حمراء مع سببه، ويصل تنبيه لمسؤولي المستودعات.</p>
      <div class="pc-toolbar">
        <label class="pc-inline">حتى تاريخ <input v-model="asOf" type="date" class="input" @change="loadRec" /></label>
        <span v-if="rec" :class="rec.ok ? 'pc-okflag' : 'pc-flag'">{{ rec.ok ? '✓ كل الحسابات مطابقة' : `✕ ${rec.issues} حساب غير مطابق` }}</span>
      </div>
      <div v-for="x in rec?.accounts ?? []" :key="x.accountId" class="card pm-panel" :style="{ marginBottom: '12px', borderColor: x.ok ? '' : '#fca5a5' }">
        <div class="pc-inline" style="justify-content: space-between">
          <div><b>{{ x.code }} · {{ x.name }}</b><small class="pm-muted" style="display: block">{{ x.sources.join('، ') || 'غير مرتبط حاليًا' }} · {{ x.moves }} حركة</small></div>
          <span :class="x.ok ? 'pc-okflag' : 'pc-flag'">{{ x.ok ? 'مطابق' : `فرق ${sar(x.diff)}` }}</span>
        </div>
        <dl class="pc-dl" style="margin-top: 10px">
          <div><dt>رصيد الدليل المحاسبي</dt><dd class="pc-num">{{ sar(x.gl) }}</dd></div>
          <div><dt>قيمة المستودعات</dt><dd class="pc-num">{{ sar(x.subledger) }}</dd></div>
          <div><dt>الفرق</dt><dd class="pc-num" :style="{ color: x.ok ? '' : '#b91c1c' }">{{ sar(x.diff) }}</dd></div>
        </dl>
        <ul v-if="x.problems.length" style="margin: 10px 0 0; padding-inline-start: 18px; font-size: .86rem; color: #b91c1c">
          <li v-for="(p, i) in x.problems" :key="i">{{ p }}</li>
        </ul>
        <div v-if="!x.ok && x.foreignEntries.length" style="margin-top: 8px; font-size: .84rem">
          قيود من خارج المستودعات:
          <RouterLink v-for="e in x.foreignEntries" :key="e.id" class="pm-link" style="margin-inline-end: 8px" :to="`/accounting/entries/${e.id}`">قيد {{ e.entryNo }} ({{ fmtDate(e.date) }})</RouterLink>
        </div>
      </div>
      <p v-if="rec && !rec.accounts.length" class="pc-empty">لا توجد حسابات مخزون مرتبطة بالمجموعات أو المستودعات بعد.</p>
    </template>
    <div v-else class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرمز</th><th>المستودع</th><th>النوع</th><th>يتبع</th><th>الأمناء</th><th>حساب المخزون</th><th>المواقع</th></tr></thead>
        <tbody>
          <tr v-for="w in rows" :key="w.id" :class="['pc-row', { off: !w.isActive }]" @click="router.push(`/procurement/warehouses/${w.id}`)">
            <td class="pc-code">{{ w.code }}</td>
            <td><b>{{ w.name }}</b><span class="pm-muted" style="display: block; font-size: .8rem">{{ [w.city, w.unitName, w.projectName].filter(Boolean).join(' · ') }}</span></td>
            <td><span class="pc-chip" :style="{ '--c': KIND_C[w.kind] }">{{ w.kindLabel }}</span> <span v-if="!w.isActive" class="pc-flag">موقوف</span></td>
            <td>{{ w.parentName ?? '—' }}</td>
            <td style="font-size: .84rem">{{ w.keepers.map((k: any) => k.name).join('، ') || '—' }}</td>
            <td style="font-size: .82rem">{{ accLabel(w.glAccount) }}</td>
            <td class="pc-num">{{ w.locations }}</td>
          </tr>
          <tr v-if="!rows.length"><td colspan="7" class="pc-empty">لا توجد مستودعات بعد</td></tr>
        </tbody>
      </table>
    </div>
    <WarehouseForm v-if="adding" :warehouses="rows" @close="adding = false" @saved="(w) => router.push(`/procurement/warehouses/${w.id}`)" />
  </div>
</template>
