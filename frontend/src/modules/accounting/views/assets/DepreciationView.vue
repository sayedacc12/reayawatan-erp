<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../../api';
import { useSession } from '../../../../stores/session';
import { useToast } from '../../../../stores/toast';
import DepReport from '../../components/DepReport.vue';
import { AF, prevMonth, useLookups, ym, type AssetRow, type DepReport as Report } from '../../assets';
import { P, monthName, sar } from '../../lib';
import '../../../projects/projects.css';
import '../../acc.css';
import './assets.css';

interface Preview extends Report {
  scopeLabel: string; skipped: { assetId: string; code: string; name: string; groupName: string; reason: string }[];
  blocked: string | null; pendingPurchases: number; canPost: boolean;
}
const session = useSession();
const toast = useToast();
const router = useRouter();
const { lookups, load: loadLookups } = useLookups();
const assets = ref<AssetRow[]>([]);
const s = reactive({ period: prevMonth(), scope: 'all' as 'all' | 'groups' | 'assets', groupIds: [] as string[], assetIds: [] as string[], q: '' });
const preview = ref<Preview | null>(null);
const busy = ref(false);
onMounted(async () => {
  await loadLookups().catch(() => {});
  assets.value = await api<AssetRow[]>(`${AF}?status=active`).catch(() => []);
});
const depGroups = computed(() => (lookups.value?.groups ?? []).filter((g) => g.depreciable));
const shownAssets = computed(() => assets.value.filter((a) => !s.q || `${a.code} ${a.name}`.includes(s.q)));
const scopeBody = computed(() => ({ period: s.period, groupIds: s.scope === 'groups' ? s.groupIds : [], assetIds: s.scope === 'assets' ? s.assetIds : [] }));

async function run() {
  busy.value = true;
  preview.value = null;
  try {
    preview.value = await api<Preview>(`${AF}/depreciation/preview`, { method: 'POST', json: scopeBody.value });
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function post() {
  if (!preview.value) return;
  if (!confirm(`ترحيل قيد الإهلاك لشهر ${monthName(preview.value.period)} بمبلغ ${sar(preview.value.total)}؟`)) return;
  busy.value = true;
  try {
    const r = await api<{ id: string; runNo: number; entry: { voucherNo: string } }>(`${AF}/depreciation/post`, { method: 'POST', json: { ...scopeBody.value, expectedTotal: preview.value.total } });
    toast.success(`رُحّل قيد الإهلاك بسند الإهلاك رقم ${r.entry?.voucherNo}`);
    router.push(`/accounting/assets/runs/${r.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const printNow = () => window.print();
const toggle = (arr: string[], id: string) => { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); else arr.push(id); };
</script>

<template>
  <div>
    <section class="pm-hero ac-hero fa-hero no-print">
      <div>
        <p class="pm-kicker">الأصول الثابتة</p>
        <h1>احتساب إهلاك الأصول</h1>
        <p class="pm-sub">اختر الشهر ونطاق الأصول ثم «بدء الاحتساب». يظهر تقرير الإهلاك بطريقة عرض الميزانية وصفحة لكل أصل، ثم يُرحَّل القيد بسند إهلاك. لا يُحتسب إهلاك للفترة نفسها مرتين، ولا لأصل لم يُعتمد سند شرائه.</p>
      </div>
      <div class="pm-actions"><RouterLink to="/accounting/assets/runs" class="btn ac-ghost">سجل حركات الإهلاك</RouterLink></div>
    </section>

    <section class="card pm-panel no-print">
      <div class="field-row">
        <label class="field"><span>الفترة (الشهر)</span><input v-model="s.period" type="month" class="input" :max="ym()" required /></label>
        <div class="field"><span>الأصول المطلوب احتساب إهلاكها</span>
          <div class="ac-switch">
            <button type="button" :class="{ on: s.scope === 'all' }" @click="s.scope = 'all'">الكل</button>
            <button type="button" :class="{ on: s.scope === 'groups' }" @click="s.scope = 'groups'">مجموعات محددة</button>
            <button type="button" :class="{ on: s.scope === 'assets' }" @click="s.scope = 'assets'">أصول محددة</button>
          </div>
        </div>
      </div>
      <div v-if="s.scope === 'groups'" class="fa-row" style="margin-bottom: 10px">
        <button v-for="g in depGroups" :key="g.id" type="button" :class="['fa-chip', { on: s.groupIds.includes(g.id) }]" @click="toggle(s.groupIds, g.id)">{{ g.name }} <small>{{ g.inBooks }}</small></button>
      </div>
      <div v-if="s.scope === 'assets'" style="margin-bottom: 10px">
        <input v-model="s.q" class="input" placeholder="ابحث بالرمز أو الاسم" style="margin-bottom: 8px" />
        <div class="picks">
          <label v-for="a in shownAssets" :key="a.id" class="fa-check"><input type="checkbox" :checked="s.assetIds.includes(a.id)" @change="toggle(s.assetIds, a.id)" /> <span class="ac-code">{{ a.code }}</span> {{ a.name }}</label>
        </div>
      </div>
      <button class="btn btn-primary start" :disabled="busy || (s.scope === 'groups' && !s.groupIds.length) || (s.scope === 'assets' && !s.assetIds.length)" @click="run">
        <span class="spark" />بدء الاحتساب
      </button>
    </section>

    <template v-if="preview">
      <div v-if="preview.blocked" class="ac-warn pulse no-print">{{ preview.blocked }}</div>
      <div v-if="preview.pendingPurchases" class="fa-info no-print">{{ preview.pendingPurchases }} أصل ينتظر اعتماد سند شرائه، فلا يدخل هذا الاحتساب حتى يُعتمد السند.</div>
      <details v-if="preview.skipped.length" class="card pm-panel no-print skipped">
        <summary>أصول لم يُحتسب لها إهلاك ({{ preview.skipped.length }})</summary>
        <div v-for="k in preview.skipped" :key="k.assetId" class="fa-grow"><span class="grow"><b>{{ k.name }}</b><small class="pm-muted">{{ k.code }} · {{ k.groupName }}</small></span><span class="pm-muted">{{ k.reason }}</span></div>
      </details>
      <div class="bar no-print">
        <div><b>إهلاك {{ monthName(preview.period) }}</b> · {{ preview.scopeLabel }} · {{ preview.assetCount }} أصل · <b class="tot">{{ sar(preview.total) }}</b></div>
        <div class="fa-row">
          <button class="btn" @click="printNow">طباعة التقرير</button>
          <button v-if="session.can(P.assetsDepreciate)" class="btn ac-glow" :disabled="busy || !preview.canPost" @click="post">ترحيل قيد الإهلاك</button>
        </div>
      </div>
      <DepReport :report="preview" title="تقرير إهلاك الأصول الثابتة" :subtitle="`${monthName(preview.period)} · ${preview.scopeLabel}`" :organization="session.user?.organizationName ?? ''" status="معاينة قبل الترحيل" />
    </template>
  </div>
</template>

<style scoped>
.picks { max-height: 220px; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 4px; border: 1px solid var(--border); border-radius: 12px; padding: 8px; }
.start { position: relative; overflow: hidden; padding: 10px 26px; font-weight: 700; }
.start .spark { position: absolute; inset: 0; background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,.45) 50%, transparent 70%); transform: translateX(100%); animation: sweep 2.6s infinite; }
@keyframes sweep { to { transform: translateX(-100%); } }
.bar { position: sticky; top: 8px; z-index: 5; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin: 14px 0; padding: 12px 16px; border-radius: 14px;
  background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); }
.tot { color: #b45309; font-size: 1.1rem; }
.skipped summary { cursor: pointer; font-weight: 600; }
</style>
