
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import WorkflowBar from '../components/WorkflowBar.vue';
import { loadConfig, P, todayStr, type ConfigPayload } from '../lib';
import '../../projects/projects.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id?: string }>();
const route = useRoute();
const router = useRouter();
const session = useSession();
const toast = useToast();
const meta = ref<ConfigPayload | null>(null);
const data = ref<any>(null);
const form = reactive({ kind: (route.query.kind === 'swot' ? 'swot' : 'pestel') as 'pestel' | 'swot', title: '', scope: '', analysisDate: todayStr(), items: [] as any[], strategies: [] as any[], summary: '' });
const toRisk = reactive({ show: false, itemId: '', text: '', category: '', ownerName: '' });
const isNew = computed(() => !props.id);
const canEdit = computed(() => session.can(P.analysis) && (isNew.value || !['in_review', 'rejected'].includes(data.value?.status)));
const COLORS: Record<string, string> = {
  political: '#be123c', economic: '#d97706', social: '#0d9488', technological: '#4f46e5', environmental: '#16a34a', legal: '#7c3aed',
  strength: '#059669', weakness: '#dc2626', opportunity: '#0284c7', threat: '#ea580c',
};
const LETTER: Record<string, string> = { political: 'P', economic: 'E', social: 'S', technological: 'T', environmental: 'E', legal: 'L', strength: 'S', weakness: 'W', opportunity: 'O', threat: 'T' };
const factors = computed(() => (form.kind === 'pestel' ? meta.value?.pestel : meta.value?.swot) ?? []);
const TOWS = [
  { type: 'SO', label: 'SO: استثمار القوة في الفرص' }, { type: 'WO', label: 'WO: معالجة الضعف بالفرص' },
  { type: 'ST', label: 'ST: مواجهة التهديدات بالقوة' }, { type: 'WT', label: 'WT: تقليل الضعف وتجنب التهديدات' },
];
function fill(a: any) {
  data.value = a;
  Object.assign(form, { kind: a.kind, title: a.title, scope: a.scope ?? '', analysisDate: a.analysisDate, summary: a.summary ?? '', items: a.items.map((i: any) => ({ ...i })), strategies: a.strategies.map((s: any) => ({ ...s })) });
}
onMounted(async () => {
  meta.value = await loadConfig();
  if (props.id) fill(await api(`/risk/analyses/${props.id}`));
});
const itemsOf = (f: string) => form.items.filter((i) => i.factor === f);
const addItem = (factor: string) => form.items.push({ factor, text: '', impact: 3, likelihood: 3, trend: null, note: null });
const riskCode = (id: string | null) => data.value?.risks?.find((r: any) => r.id === id)?.code;
async function save() {
  try {
    const json = { ...form, scope: form.scope || null, summary: form.summary || null, strategies: form.kind === 'swot' ? form.strategies.filter((s) => s.text.trim()) : [] };
    const a = await api<any>(isNew.value ? '/risk/analyses' : `/risk/analyses/${props.id}`, { method: isNew.value ? 'POST' : 'PATCH', json });
    toast.success('حُفظ التحليل');
    if (isNew.value) router.replace(`/risk/analysis/${a.id}`);
    fill(a);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function openToRisk(i: any) {
  if (!i.id) return toast.error('احفظ التحليل أولًا');
  Object.assign(toRisk, { show: true, itemId: i.id, text: i.text, category: meta.value?.config.categories[0]?.code ?? '', ownerName: '' });
}
async function convert() {
  try {
    const r = await api<any>(`/risk/analyses/${props.id}/to-risk`, { method: 'POST', json: { itemId: toRisk.itemId, category: toRisk.category, ownerName: toRisk.ownerName || null } });
    toast.success(`أُضيف للسجل برمز ${r.code}`);
    toRisk.show = false;
    fill(await api(`/risk/analyses/${props.id}`));
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div v-if="meta && (isNew || data)">
    <div class="page-head">
      <div><h1><span v-if="data" class="rk-code" style="font-size: 1rem">{{ data.code }}</span> {{ isNew ? `تحليل ${form.kind === 'pestel' ? 'PESTEL' : 'SWOT'} جديد` : form.title }}</h1>
        <p class="muted">{{ form.kind === 'pestel' ? 'العوامل السياسية والاقتصادية والاجتماعية والتقنية والبيئية والقانونية المؤثرة على الجمعية.' : 'القوة والضعف (داخلية) والفرص والتهديدات (خارجية)، ثم الاستراتيجيات.' }} قيّم كل عامل بالأثر والاحتمالية من 1 إلى 5.</p></div>
      <button v-if="canEdit" class="btn btn-primary" @click="save">حفظ التحليل</button>
    </div>
    <fieldset :disabled="!canEdit" style="border: 0; padding: 0; margin: 0">
      <section class="card pm-panel" style="margin-bottom: 16px">
        <div class="rk-fields">
          <label class="field"><span>العنوان</span><input v-model="form.title" class="input" /></label>
          <label class="field"><span>النطاق (الجمعية أو برنامج أو مشروع)</span><input v-model="form.scope" class="input" /></label>
          <label class="field"><span>تاريخ التحليل</span><input v-model="form.analysisDate" type="date" class="input" /></label>
        </div>
      </section>
      <div :class="['rk-board', form.kind]">
        <div v-for="(f, fi) in factors" :key="f.code" class="rk-col" :style="{ '--c': COLORS[f.code], '--i': fi }">
          <header><b>{{ f.name }}</b><span class="lt">{{ LETTER[f.code] }}</span></header>
          <div class="items">
            <div v-for="it in itemsOf(f.code)" :key="it.id ?? form.items.indexOf(it)" class="rk-item">
              <textarea v-model="it.text" class="input" placeholder="اكتب العامل" />
              <div class="meta">
                الأثر <select v-model.number="it.impact" class="input"><option v-for="n in 5" :key="n" :value="n">{{ n }}</option></select>
                الاحتمالية <select v-model.number="it.likelihood" class="input"><option v-for="n in 5" :key="n" :value="n">{{ n }}</option></select>
                <select v-if="form.kind === 'pestel'" v-model="it.trend" class="input"><option :value="null">الاتجاه</option><option value="up">↑ يتصاعد</option><option value="stable">→ مستقر</option><option value="down">↓ يتراجع</option></select>
                <span class="rk-score" :style="{ '--c': COLORS[f.code], minWidth: '28px', height: '22px' }">{{ it.impact * it.likelihood }}</span>
                <span style="flex: 1" />
                <RouterLink v-if="it.riskId" :to="`/risk/register/${it.riskId}`" class="pm-tag" style="color: var(--primary)">في السجل {{ riskCode(it.riskId) }}</RouterLink>
                <button v-else-if="!['strength', 'opportunity'].includes(f.code) && session.can(P.register) && it.id" type="button" class="btn btn-sm" :disabled="false" @click="openToRisk(it)">نقل لسجل المخاطر</button>
                <button v-if="canEdit && !it.riskId" type="button" class="btn btn-sm" @click="form.items.splice(form.items.indexOf(it), 1)">✕</button>
              </div>
            </div>
            <button v-if="canEdit" type="button" class="btn btn-sm" @click="addItem(f.code)">+ عامل</button>
          </div>
        </div>
      </div>
      <section v-if="form.kind === 'swot'" class="card pm-panel" style="margin-top: 16px">
        <h2>استراتيجيات TOWS</h2>
        <div class="pm-grid2">
          <div v-for="t in TOWS" :key="t.type">
            <div class="rk-sec">{{ t.label }}</div>
            <div v-for="(s, i) in form.strategies.filter((x) => x.type === t.type)" :key="i" style="display: flex; gap: 6px; margin-bottom: 6px">
              <input v-model="s.text" class="input" /><button type="button" class="btn btn-sm" @click="form.strategies.splice(form.strategies.indexOf(s), 1)">✕</button>
            </div>
            <button type="button" class="btn btn-sm" @click="form.strategies.push({ type: t.type, text: '' })">+ استراتيجية</button>
          </div>
        </div>
      </section>
      <section class="card pm-panel" style="margin-top: 16px">
        <label class="field"><span>الخلاصة والتوصيات</span><textarea v-model="form.summary" class="input" rows="3" /></label>
      </section>
    </fieldset>
    <div v-if="data" style="margin-top: 16px"><WorkflowBar :item="data" :base="`/risk/analyses/${data.id}`" :can-submit="session.can(P.analysis)" @changed="fill" /></div>

    <div v-if="toRisk.show" class="modal-backdrop" @click.self="toRisk.show = false">
      <form class="card modal" @submit.prevent="convert">
        <h2>نقل إلى سجل المخاطر</h2>
        <p class="rk-note">{{ toRisk.text }}</p>
        <label class="field"><span>تصنيف الخطر</span><select v-model="toRisk.category" class="input"><option v-for="c in meta.config.categories" :key="c.code" :value="c.code">{{ c.name }}</option></select></label>
        <label class="field"><span>مالك الخطر</span><input v-model="toRisk.ownerName" class="input" /></label>
        <p class="pm-muted">يُسجل بنفس الأثر والاحتمالية، ثم تُكمل تقييم الضوابط والمعالجة من صفحة الخطر.</p>
        <div class="modal-actions"><button class="btn btn-primary">نقل للسجل</button><button type="button" class="btn" @click="toRisk.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
