<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { MATCH_LABEL, ROLE_COLOR, fmtDate, lookups } from '../lib';
import '../../../shared/module.css';
import '../crm.css';

/** الجهات المكررة بالجوال أو البريد أو الرقم الضريبي أو الاسم، ودمجها: تنتقل الأدوار والأنشطة وأشخاص الاتصال إلى الجهة المُبقاة */
const toast = useToast();
const lk = ref<any>(null);
const groups = ref<any[]>([]);
const keep = ref<Record<number, string>>({});
const loading = ref(true);
const busy = ref(false);
async function load() {
  loading.value = true;
  try {
    [lk.value, groups.value] = await Promise.all([lookups(), api<any[]>('/crm/duplicates')]);
    // تُقترح الجهة الأغنى (أدوار وأنشطة أكثر) للإبقاء
    keep.value = Object.fromEntries(groups.value.map((g, i) => [i, [...g.parties].sort((a: any, b: any) => b.roles.length + b.activities - (a.roles.length + a.activities))[0].id]));
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
async function merge(i: number) {
  const g = groups.value[i];
  const kept = g.parties.find((p: any) => p.id === keep.value[i]);
  const others = g.parties.filter((p: any) => p.id !== kept.id);
  if (!confirm(`دمج ${others.map((o: any) => `«${o.name}»`).join(' و')} في «${kept.name}»؟ تنتقل كل السجلات والأنشطة، وتبقى الجهة المدموجة في السجل غير فاعلة.`)) return;
  busy.value = true;
  try {
    for (const o of others) await api(`/crm/parties/${kept.id}/merge`, { method: 'POST', json: { removeId: o.id } });
    toast.success('تم الدمج');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function sync() {
  busy.value = true;
  try {
    const r = await api<any>('/crm/parties/sync', { method: 'POST' });
    toast.success(r?.created !== undefined ? `اكتملت المزامنة: ${r.created} جهة جديدة، و${r.linked} ربط` : 'اكتملت المزامنة');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>المكرر والدمج</h1>
        <p class="muted">جهات تتشابه في الجوال أو البريد أو الرقم الضريبي أو الاسم. اختر الجهة التي تبقى، فتنتقل إليها الأدوار والأنشطة وأشخاص الاتصال، وتُكمَل بياناتها الناقصة. التشابه في الاسم وحده لا يعني أنها الجهة نفسها، فراجع قبل الدمج.</p>
      </div>
      <button class="btn" :disabled="busy" @click="sync">مزامنة السجلات من الأنظمة</button>
    </div>
    <div v-if="!loading && !groups.length" class="card pm-panel cr-empty">✓ لا توجد جهات مكررة</div>
    <div v-for="(g, i) in groups" :key="i" class="cr-dup card">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap">
        <div>تطابق في: <span v-for="b in g.by" :key="b" class="cr-chip" :style="{ '--c': b === 'name' ? '#d97706' : '#dc2626' }">{{ MATCH_LABEL[b] }}</span></div>
        <button class="btn btn-primary btn-sm" :disabled="busy" @click="merge(i)">دمج في المختارة</button>
      </div>
      <label v-for="p in g.parties" :key="p.id" :class="['cr-dup-row', { keep: keep[i] === p.id }]">
        <div>
          <input v-model="keep[i]" type="radio" :value="p.id" :name="`g${i}`" />
          <b>{{ p.name }}</b> <span class="cr-code">{{ p.code }}</span>
          <span v-for="r in p.roles" :key="r" class="cr-chip" :style="{ '--c': ROLE_COLOR[r], marginInlineStart: '4px' }">{{ lk?.labels.roles[r] ?? r }}</span>
          <div class="pm-muted cr-ltr" style="font-size: .82rem; text-align: start">{{ [p.phone, p.email, p.vatNumber].filter(Boolean).join(' · ') }}</div>
        </div>
        <small class="pm-muted">{{ p.activities }} نشاط · {{ fmtDate(p.createdAt) }}<br /><RouterLink :to="`/crm/parties/${p.id}`" target="_blank" class="pm-link">الملف</RouterLink></small>
      </label>
    </div>
  </div>
</template>
