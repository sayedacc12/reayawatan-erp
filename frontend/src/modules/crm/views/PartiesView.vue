<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import PartyForm from '../components/PartyForm.vue';
import { CHANNEL_ICON, CR, ROLE_COLOR, lookups, relTime } from '../lib';
import '../../../shared/module.css';
import '../crm.css';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const session = useSession();
const lk = ref<any>(null);
const rows = ref<any[]>([]);
const loading = ref(true);
const adding = ref(false);
const f = ref({ q: '', role: String(route.query.role ?? ''), kind: '', scope: '', tag: '' });
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/crm/parties?${q}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  lk.value = await lookups().catch(() => null);
  await load();
});
let t: ReturnType<typeof setTimeout>;
watch(() => [f.value.q, f.value.tag], () => { clearTimeout(t); t = setTimeout(load, 300); });
watch(() => [f.value.role, f.value.kind, f.value.scope], load);
const granted = (r: any) => Object.entries(r.consents ?? {}).filter(([, v]: any) => v?.granted).map(([k]) => k);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>الجهات</h1>
        <p class="muted">السجل الموحد: كل شخص أو منشأة مرة واحدة، وأدوارها (داعم، عميل، عضو، متطوع، شريك) مربوطة بسجلاتها في أنظمتها. تُضاف الجهات الجديدة في الأنظمة الأخرى إلى السجل تلقائيًا.</p>
      </div>
      <div style="display: flex; gap: 8px">
        <RouterLink v-if="session.can(CR.merge)" to="/crm/duplicates" class="btn">المكرر والدمج</RouterLink>
        <button v-if="session.can(CR.manage)" class="btn btn-primary" @click="adding = true">جهة جديدة</button>
      </div>
    </div>
    <div class="cr-toolbar">
      <input v-model="f.q" class="input grow" placeholder="بحث بالاسم أو الجوال أو البريد أو الرقم الضريبي أو المدينة" />
      <select v-model="f.role" class="input"><option value="">كل الأدوار</option><option v-for="(l, k) in lk?.labels.roles ?? {}" :key="k" :value="k">{{ l }}</option></select>
      <select v-model="f.kind" class="input"><option value="">أشخاص ومنشآت</option><option v-for="(l, k) in lk?.labels.kinds ?? {}" :key="k" :value="k">{{ l }}</option></select>
      <select v-model="f.scope" class="input"><option value="">كل المسؤولين</option><option value="mine">مسؤوليتي</option><option value="unowned">بلا مسؤول</option></select>
      <input v-model="f.tag" class="input" placeholder="وسم" maxlength="60" />
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرمز</th><th>الجهة</th><th>الأدوار</th><th>التواصل</th><th>الموافقات</th><th>المسؤول</th><th>آخر نشاط</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="cr-row" @click="router.push(`/crm/parties/${r.id}`)">
            <td class="cr-code">{{ r.code }}</td>
            <td>
              <b>{{ r.name }}</b> <small class="pm-muted">{{ r.kind === 'org' ? 'منشأة' : 'شخص' }}{{ r.city ? ` · ${r.city}` : '' }}</small>
              <div v-if="r.tags?.length" class="cr-chips" style="margin-top: 3px"><span v-for="t in r.tags" :key="t" class="cr-chip">{{ t }}</span></div>
            </td>
            <td><div class="cr-chips"><span v-for="ro in r.roles" :key="ro" class="cr-chip" :style="{ '--c': ROLE_COLOR[ro] }">{{ lk?.labels.roles[ro] ?? ro }}</span></div></td>
            <td class="cr-ltr" style="font-size: .84rem">{{ r.phone ?? '' }}<br v-if="r.phone && r.email" />{{ r.email ?? '' }}</td>
            <td>
              <span v-if="r.doNotContact" class="cr-flag">لا تتواصل</span>
              <span v-else :title="granted(r).map((c) => lk?.labels.channels[c]).join('، ')">{{ granted(r).map((c) => CHANNEL_ICON[c]).join(' ') || '—' }}</span>
            </td>
            <td>{{ r.ownerName ?? '—' }}</td>
            <td class="pm-muted" style="font-size: .84rem">{{ r.lastActivity ? relTime(r.lastActivity) : '—' }}</td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="7" class="cr-empty">لا توجد جهات مطابقة.</td></tr>
        </tbody>
      </table>
    </div>
    <PartyForm v-if="adding && lk" :lk="lk" @close="adding = false" @saved="(r) => router.push(`/crm/parties/${r.id}`)" />
  </div>
</template>
