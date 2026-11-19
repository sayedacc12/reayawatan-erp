<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import SupplierFields from '../components/SupplierFields.vue';
import { PR, SUPPLIER_COLOR, lookups, supplierForm, supplierPayload } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const route = useRoute();
const router = useRouter();
const session = useSession();
const toast = useToast();
const lk = ref<any>(null);
const rows = ref<any[]>([]);
const loading = ref(true);
const adding = ref(route.query.new === '1');
const form = ref(supplierForm());
const busy = ref(false);
const f = ref({ q: '', status: String(route.query.status ?? ''), category: '', kind: '', activity: '', docs: '' });
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/procurement/suppliers?${q}`);
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
watch(() => f.value.q, () => { clearTimeout(t); t = setTimeout(load, 300); });
watch(() => [f.value.status, f.value.category, f.value.kind, f.value.activity, f.value.docs], load);
async function create() {
  busy.value = true;
  try {
    const s = await api<any>('/procurement/suppliers', { method: 'POST', json: supplierPayload(form.value) });
    toast.success('سُجّل المورد، وهو الآن بانتظار المراجعة والاعتماد');
    router.push(`/procurement/suppliers/${s.id}`);
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
      <div><h1>سجل الموردين</h1><p class="muted">كل مورد بملفه ومستنداته وحسابه البنكي المعتمد. يسجل الموردون أنفسهم عبر البوابة، أو يسجلهم موظف المشتريات.</p></div>
      <button v-if="session.can(PR.suppliers)" class="btn btn-primary" @click="adding = true">+ مورد جديد</button>
    </div>
    <div class="pc-toolbar">
      <input v-model="f.q" class="input grow" placeholder="بحث بالاسم أو السجل أو الرقم الضريبي أو الجوال أو المدينة" />
      <select v-model="f.status" class="input"><option value="">كل الحالات</option><option v-for="(l, k) in lk?.supplierStatus ?? {}" :key="k" :value="k">{{ l }}</option></select>
      <select v-model="f.kind" class="input"><option value="">كل الأنواع</option><option v-for="(l, k) in lk?.supplierKinds ?? {}" :key="k" :value="k">{{ l }}</option></select>
      <select v-model="f.category" class="input"><option value="">كل التصنيفات</option><option v-for="c in lk?.categories ?? []" :key="c.id" :value="c.id">{{ c.name }}</option></select>
      <select v-model="f.activity" class="input"><option value="">كل الأنشطة</option><option v-for="a in lk?.settings.activities ?? []" :key="a" :value="a">{{ a }}</option></select>
      <select v-model="f.docs" class="input"><option value="">كل المستندات</option><option value="expiring">مستندات منتهية أو تنتهي قريبًا</option></select>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>المورد</th><th>النوع</th><th>الأنشطة</th><th>الحالة</th><th>المستندات</th><th>البنك</th><th>البوابة</th></tr></thead>
        <tbody>
          <tr v-for="s in rows" :key="s.id" class="pc-row" @click="router.push(`/procurement/suppliers/${s.id}`)">
            <td class="pc-code">{{ s.code }}</td>
            <td><b>{{ s.name }}</b><span class="pm-muted" style="display: block; font-size: .8rem">{{ s.entityTypeLabel }}{{ s.city ? ` · ${s.city}` : '' }}{{ s.crNumber ? ` · س.ت ${s.crNumber}` : '' }}</span></td>
            <td>{{ s.kindLabel }}<div class="pc-chips"><span v-for="c in s.categories" :key="c.id" class="pc-chip" :style="{ '--c': c.color }">{{ c.name }}</span></div></td>
            <td style="font-size: .8rem; max-width: 220px">{{ s.activities.join('، ') || '—' }}</td>
            <td><span class="pm-pill" :style="{ '--c': SUPPLIER_COLOR[s.status] }">{{ s.statusLabel }}</span></td>
            <td>
              <span v-if="s.docsExpired" class="pc-flag">{{ s.docsExpired }} منتهي</span>
              <span v-else-if="s.docsExpiring" class="pc-warn">{{ s.docsExpiring }} ينتهي قريبًا</span>
              <span v-if="s.docsPending" class="pc-warn">{{ s.docsPending }} للمراجعة</span>
              <span v-if="!s.docsExpired && !s.docsExpiring && !s.docsPending" class="pm-muted">—</span>
            </td>
            <td><span v-if="s.hasBank" class="pc-okflag">✓ معتمد</span><span v-else class="pm-muted">—</span><span v-if="s.banksPending" class="pc-warn">طلب تغيير</span></td>
            <td class="pc-num">{{ s.users || '—' }}</td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="8" class="pc-empty">لا يوجد موردون بهذه المواصفات</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="adding && lk" class="modal-backdrop" @click.self="adding = false">
      <form class="card modal modal-wide" @submit.prevent="create">
        <h2>تسجيل مورد جديد</h2>
        <p class="pm-muted">يدخل المورد مباشرة في انتظار المراجعة. ارفع مستنداته وحسابه البنكي من ملفه بعد الحفظ.</p>
        <SupplierFields v-model="form" :entity-types="lk.entityTypes" :supplier-kinds="lk.supplierKinds" :categories="lk.categories" :activities="lk.settings.activities" />
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">{{ busy ? 'جارٍ الحفظ...' : 'تسجيل المورد' }}</button><button type="button" class="btn" @click="adding = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
