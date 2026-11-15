<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import BeneficiaryForm from '../components/BeneficiaryForm.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { CATEGORIES, fmtDate, label, money, STATUSES } from '../labels';
import type { Beneficiary, BeneficiaryRow, Page } from '../types';

const session = useSession();
const router = useRouter();
const canManage = computed(() => session.can('beneficiaries.cases.manage'));

const search = ref('');
const status = ref('');
const category = ref('');
const page = ref(1);
const pageSize = 20;
const data = ref<Page<BeneficiaryRow> | null>(null);
const loading = ref(false);
const error = ref('');
const creating = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (search.value.trim()) q.set('search', search.value.trim());
    if (status.value) q.set('status', status.value);
    if (category.value) q.set('category', category.value);
    data.value = await api<Page<BeneficiaryRow>>(`/beneficiaries?${q}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

let timer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  clearTimeout(timer);
  timer = setTimeout(() => { page.value = 1; load(); }, 300);
});
watch([status, category], () => { page.value = 1; load(); });

const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / pageSize)));
function go(p: number) { page.value = p; load(); }

function opened(b: Beneficiary) {
  creating.value = false;
  router.push(`/beneficiaries/files/${b.id}`);
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>ملفات المستفيدين</h1>
        <p class="muted sub">{{ data ? `${data.total.toLocaleString('ar-EG')} ملف` : '…' }}</p>
      </div>
      <button v-if="canManage" class="btn btn-primary" @click="creating = true">+ ملف جديد</button>
    </div>

    <div class="toolbar card">
      <div class="search">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input v-model="search" class="input" placeholder="ابحث بالاسم أو رقم الهوية أو الموبايل أو رقم الملف" />
      </div>
      <select v-model="category" class="input cat"><option value="">كل الفئات</option><option v-for="c in CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</option></select>
      <div class="chips">
        <button :class="['chip', { on: !status }]" @click="status = ''">الكل</button>
        <button v-for="s in STATUSES" :key="s.value" :class="['chip', { on: status === s.value }]" :style="{ '--c': s.color }" @click="status = s.value">{{ s.label }}</button>
      </div>
    </div>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="card table-wrap" :class="{ dim: loading }">
      <table class="table">
        <thead>
          <tr><th>رقم الملف</th><th>الاسم</th><th>الفئة</th><th>أفراد الأسرة</th><th>الدخل الشهري</th><th>إجمالي المساعدات</th><th>آخر صرف</th><th>الحالة</th></tr>
        </thead>
        <tbody>
          <tr v-for="b in data?.items ?? []" :key="b.id" class="clickable" tabindex="0"
            @click="router.push(`/beneficiaries/files/${b.id}`)" @keydown.enter="router.push(`/beneficiaries/files/${b.id}`)">
            <td><span class="file-no">#{{ b.fileNo }}</span></td>
            <td>
              <div class="who">
                <span :class="['av', b.gender]">{{ b.fullName.charAt(0) }}</span>
                <div><b>{{ b.fullName }}</b><small class="muted" dir="ltr">{{ b.phone || b.nationalId || '' }}</small></div>
              </div>
            </td>
            <td>{{ label('category', b.category) }}</td>
            <td>{{ b.familySize.toLocaleString('ar-EG') }}</td>
            <td>{{ money(b.monthlyIncome) }}</td>
            <td><b class="amt">{{ money(b.aidTotal) }}</b></td>
            <td class="muted">{{ fmtDate(b.lastAidOn) }}</td>
            <td><StatusBadge :value="b.status" /></td>
          </tr>
          <tr v-if="data && !data.items.length">
            <td colspan="8" class="empty">
              <div class="empty-art">🌾</div>
              <p v-if="search || status || category">لا توجد نتائج مطابقة للبحث</p>
              <p v-else>لا توجد ملفات بعد. ابدأ بفتح أول ملف مستفيد.</p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="pages > 1" class="pager">
      <button class="btn btn-sm" :disabled="page <= 1" @click="go(page - 1)">السابق</button>
      <span class="muted">صفحة {{ page.toLocaleString('ar-EG') }} من {{ pages.toLocaleString('ar-EG') }}</span>
      <button class="btn btn-sm" :disabled="page >= pages" @click="go(page + 1)">التالي</button>
    </div>

    <BeneficiaryForm v-if="creating" @close="creating = false" @saved="opened" />
  </div>
</template>

<style scoped>
.sub { margin: 2px 0 0; font-size: .88rem; }
.toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 12px; margin-bottom: 14px; }
.search { position: relative; flex: 1 1 320px; }
.search svg { position: absolute; inset-inline-start: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); }
.search .input { padding-inline-start: 38px; }
.cat { width: 160px; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { --c: var(--primary); font: inherit; font-size: .84rem; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; transition: all .2s; }
.chip:hover { border-color: var(--c); }
.chip.on { background: color-mix(in srgb, var(--c) 14%, transparent); border-color: var(--c); color: color-mix(in srgb, var(--c) 80%, #000); font-weight: 600; }
.table-wrap { transition: opacity .2s; }
.dim { opacity: .55; }
.clickable { cursor: pointer; }
.clickable:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
.file-no { font-size: .8rem; font-weight: 600; color: var(--primary); background: var(--primary-soft); padding: 2px 8px; border-radius: 6px; }
.who { display: flex; align-items: center; gap: 10px; }
.who small { display: block; font-size: .78rem; text-align: right; }
.av { width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; color: #fff; font-weight: 700; flex-shrink: 0;
  background: linear-gradient(135deg, #8b5cf6, #6366f1); }
.av.male { background: linear-gradient(135deg, #14b8a6, #0f766e); }
.amt { color: var(--primary); }
.empty { text-align: center; padding: 40px 10px !important; color: var(--muted); white-space: normal !important; }
.empty-art { font-size: 2.4rem; animation: sway 3s ease-in-out infinite; display: inline-block; }
@keyframes sway { 50% { transform: rotate(-8deg); } }
.pager { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 14px; }
@media (max-width: 700px) { .cat { width: 100%; } }
</style>
