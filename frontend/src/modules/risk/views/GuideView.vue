
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { loadConfig, P, SOURCES } from '../lib';
import '../../projects/projects.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const toast = useToast();
const router = useRouter();
const rows = ref<any[]>([]);
const cats = ref<{ code: string; name: string }[]>([]);
const tab = ref<'term' | 'risk'>('term');
const q = ref('');
const cat = ref('');
const canEdit = computed(() => session.can(P.guide));
const blank = () => ({ id: '', kind: 'term' as 'term' | 'risk', title: '', titleEn: '', category: '', body: '', details: { source: 'internal', causes: '', controls: '', kris: '' } });
const form = reactive({ show: false, ...blank() });
onMounted(async () => {
  const [g, c] = await Promise.all([api<any[]>('/risk/guide'), loadConfig()]);
  rows.value = g;
  cats.value = c.config.categories;
});
const catName = (code: string) => cats.value.find((c) => c.code === code)?.name ?? code;
const ofKind = computed(() => rows.value.filter((r) => r.kind === tab.value));
const categories = computed(() => [...new Set(ofKind.value.map((r) => r.category))]);
const list = computed(() => {
  const s = q.value.trim();
  return ofKind.value.filter((r) => (!cat.value || r.category === cat.value) && (!s || `${r.title} ${r.titleEn ?? ''} ${r.body}`.includes(s) || (r.titleEn ?? '').toLowerCase().includes(s.toLowerCase())));
});
function setTab(t: 'term' | 'risk') { tab.value = t; cat.value = ''; }
function open(r?: any) {
  Object.assign(form, blank(), { show: true, kind: tab.value, category: tab.value === 'risk' ? cats.value[0]?.code ?? '' : 'المخاطر' });
  if (r) Object.assign(form, { id: r.id, kind: r.kind, title: r.title, titleEn: r.titleEn ?? '', category: r.category, body: r.body, details: { ...blank().details, ...r.details } });
}
async function save() {
  try {
    const json = { kind: form.kind, title: form.title, titleEn: form.titleEn || null, category: form.category, body: form.body, details: form.kind === 'risk' ? form.details : undefined };
    const e = await api<any>(form.id ? `/risk/guide/${form.id}` : '/risk/guide', { method: form.id ? 'PATCH' : 'POST', json });
    const i = rows.value.findIndex((x) => x.id === e.id);
    if (i >= 0) rows.value[i] = e; else rows.value.push(e);
    form.show = false;
    toast.success('حُفظ');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove(r: any) {
  if (!confirm(`حذف «${r.title}» من الدليل؟`)) return;
  try {
    await api(`/risk/guide/${r.id}`, { method: 'DELETE' });
    rows.value = rows.value.filter((x) => x.id !== r.id);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function toRegister(r: any) {
  router.push({ path: '/risk/register/new', query: { title: r.title, description: r.body, category: r.category, source: r.details?.source ?? 'internal', causes: r.details?.causes ?? '' } });
}
</script>

<template>
  <div>
    <section class="pm-hero rk-hero">
      <div><p class="pm-kicker">مرجع موحد للجمعية</p><h1>دليل المصطلحات والمخاطر</h1>
        <p class="pm-sub">مصطلحات المخاطر والاستمرارية والتغيير والالتزام بتعريفات واضحة، ومكتبة بالمخاطر الشائعة في الجمعيات مع أسبابها وضوابطها ومؤشراتها. أضف أي خطر منها إلى السجل بنقرة، وعدّل الدليل كما تشاء.</p></div>
      <div v-if="canEdit" class="pm-actions"><button class="btn rk-glow" @click="open()">{{ tab === 'term' ? 'مصطلح جديد' : 'خطر جديد في الدليل' }}</button></div>
    </section>
    <div class="rk-tabs">
      <button :class="['rk-tab', { on: tab === 'term' }]" @click="setTab('term')">المصطلحات ({{ rows.filter((r) => r.kind === 'term').length }})</button>
      <button :class="['rk-tab', { on: tab === 'risk' }]" @click="setTab('risk')">دليل المخاطر ({{ rows.filter((r) => r.kind === 'risk').length }})</button>
      <input v-model="q" class="input" style="max-width: 260px; margin-inline-start: auto" placeholder="بحث…" />
      <select v-model="cat" class="input" style="max-width: 200px"><option value="">كل التصنيفات</option><option v-for="c in categories" :key="c" :value="c">{{ tab === 'risk' ? catName(c) : c }}</option></select>
    </div>
    <p v-if="!list.length" class="pm-empty card">لا توجد نتائج</p>
    <div v-else-if="tab === 'term'" class="rk-grid3">
      <article v-for="(r, i) in list" :key="r.id" class="card pm-panel" :style="{ '--i': i % 12 }">
        <h2 style="font-size: 1rem"><span>{{ r.title }} <span v-if="r.titleEn" class="rk-code">{{ r.titleEn }}</span></span>
          <span v-if="canEdit" style="display: flex; gap: 4px"><button class="btn btn-sm" @click="open(r)">✎</button><button class="btn btn-sm" @click="remove(r)">✕</button></span></h2>
        <p style="margin: 0; line-height: 1.8">{{ r.body }}</p>
        <span class="pm-tag" style="margin-top: 8px; display: inline-block">{{ r.category }}</span>
      </article>
    </div>
    <div v-else class="rk-grid" style="grid-template-columns: 1fr 1fr">
      <article v-for="(r, i) in list" :key="r.id" class="card pm-panel" :style="{ '--i': i % 12 }">
        <h2 style="font-size: 1rem"><span>{{ r.title }}</span>
          <span style="display: flex; gap: 4px">
            <button v-if="session.can(P.register)" class="btn btn-sm btn-primary" @click="toRegister(r)">إضافة للسجل</button>
            <template v-if="canEdit"><button class="btn btn-sm" @click="open(r)">✎</button><button class="btn btn-sm" @click="remove(r)">✕</button></template>
          </span></h2>
        <div class="rk-chips" style="margin-bottom: 6px">
          <span class="pm-pill" :style="{ '--c': SOURCES[r.details?.source]?.color ?? '#94a3b8' }">{{ SOURCES[r.details?.source]?.label ?? '—' }}</span>
          <span class="pm-tag">{{ catName(r.category) }}</span>
        </div>
        <p style="margin: 0 0 6px; line-height: 1.8">{{ r.body }}</p>
        <p v-if="r.details?.causes" class="pm-muted" style="margin: 2px 0"><b>الأسباب:</b> {{ r.details.causes }}</p>
        <p v-if="r.details?.controls" class="pm-muted" style="margin: 2px 0"><b>الضوابط المقترحة:</b> {{ r.details.controls }}</p>
        <p v-if="r.details?.kris" class="pm-muted" style="margin: 2px 0"><b>مؤشرات الإنذار:</b> {{ r.details.kris }}</p>
      </article>
    </div>
    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" style="max-width: 640px" @submit.prevent="save">
        <h2>{{ form.id ? 'تعديل' : 'إضافة' }} {{ form.kind === 'term' ? 'مصطلح' : 'خطر في الدليل' }}</h2>
        <div class="rk-fields">
          <label class="field"><span>{{ form.kind === 'term' ? 'المصطلح' : 'الخطر' }}</span><input v-model="form.title" class="input" /></label>
          <label v-if="form.kind === 'term'" class="field"><span>بالإنجليزية</span><input v-model="form.titleEn" class="input" dir="ltr" /></label>
          <label v-if="form.kind === 'term'" class="field"><span>المجال</span><input v-model="form.category" class="input" list="rk-term-cats" /><datalist id="rk-term-cats"><option v-for="c in categories" :key="c" :value="c" /></datalist></label>
          <template v-else>
            <label class="field"><span>التصنيف</span><select v-model="form.category" class="input"><option v-for="c in cats" :key="c.code" :value="c.code">{{ c.name }}</option></select></label>
            <label class="field"><span>المصدر</span><select v-model="form.details.source" class="input"><option v-for="(s, k) in SOURCES" :key="k" :value="k">{{ s.label }}</option></select></label>
          </template>
        </div>
        <label class="field"><span>{{ form.kind === 'term' ? 'التعريف' : 'الوصف' }}</span><textarea v-model="form.body" class="input" rows="3" /></label>
        <template v-if="form.kind === 'risk'">
          <label class="field"><span>الأسباب</span><textarea v-model="form.details.causes" class="input" rows="2" /></label>
          <label class="field"><span>الضوابط المقترحة</span><textarea v-model="form.details.controls" class="input" rows="2" /></label>
          <label class="field"><span>مؤشرات الإنذار المبكر</span><textarea v-model="form.details.kris" class="input" rows="2" /></label>
        </template>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="form.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
