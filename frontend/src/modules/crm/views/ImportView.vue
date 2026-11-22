<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { lookups } from '../lib';
import '../../../shared/module.css';
import '../crm.css';

/** استيراد عملاء محتملين من ملف CSV أو لصق من Excel: معاينة وتجربة أولًا، ثم الاستيراد. المكرر يُستبعد مع ذكر السبب */
const router = useRouter();
const toast = useToast();
const lk = ref<any>(null);
const text = ref('');
const f = ref({ source: 'import', interest: '', campaign: '' });
const result = ref<any>(null);
const busy = ref(false);
onMounted(async () => {
  lk.value = await lookups().catch(() => null);
});

/** أعمدة الملف: يتعرف على العناوين بالعربية أو الإنجليزية، وإن لم توجد فالترتيب: الاسم، المنشأة، الجوال، البريد، المدينة، ملاحظات */
const HEAD: Record<string, string> = {
  الاسم: 'name', name: 'name', المنشأة: 'company', الشركة: 'company', company: 'company', الجوال: 'phone', الهاتف: 'phone', phone: 'phone', mobile: 'phone',
  البريد: 'email', 'البريد الإلكتروني': 'email', email: 'email', المدينة: 'city', city: 'city', ملاحظات: 'notes', notes: 'notes',
};
const ORDER = ['name', 'company', 'phone', 'email', 'city', 'notes'];
function splitLine(line: string, sep: string) {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (c === sep && !q) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
const rows = computed(() => {
  const lines = text.value.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const first = splitLine(lines[0], sep);
  const mapped = first.map((h) => HEAD[h.toLowerCase()] ?? HEAD[h]);
  const hasHead = mapped.some(Boolean);
  const cols = hasHead ? mapped : ORDER;
  return (hasHead ? lines.slice(1) : lines).map((l) => {
    const cells = splitLine(l, sep);
    const r: any = {};
    cols.forEach((c, i) => { if (c && cells[i]) r[c] = cells[i].slice(0, c === 'notes' ? 1000 : 250); });
    return r;
  }).filter((r) => r.name && r.name.length >= 2);
});
async function readFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 2_000_000) return toast.error('الملف أكبر من 2 ميجابايت');
  text.value = await file.text();
  result.value = null;
}
async function run(dryRun: boolean) {
  if (rows.value.length > 2000) return toast.error('الحد الأقصى 2000 صف في المرة الواحدة');
  busy.value = true;
  try {
    const r = await api<any>('/crm/leads/import', {
      method: 'POST',
      json: { rows: rows.value, source: f.value.source, interest: f.value.interest || null, campaign: f.value.campaign || null, dryRun },
    });
    result.value = { ...r, dryRun };
    if (!dryRun) toast.success(`استُورد ${r.created} عميل محتمل`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="lk">
    <div class="page-head">
      <div>
        <h1>استيراد العملاء المحتملين</h1>
        <p class="muted">من كشف معرض أو قائمة مهتمين. احفظ الملف من Excel بصيغة CSV، أو انسخ الخلايا والصقها هنا. يُستبعد من سُجل من قبل (عميلًا محتملًا مفتوحًا أو جهة)، ويُوزع الباقي حسب إعدادات التوزيع.</p>
      </div>
    </div>
    <div class="cr-grid">
      <section class="card pm-panel">
        <p class="cr-sec">1. البيانات</p>
        <input type="file" accept=".csv,.txt,text/csv,text/plain" class="input" @change="readFile" />
        <textarea v-model="text" class="input" rows="9" dir="auto" style="margin-top: 10px; font-family: ui-monospace, monospace; font-size: .82rem"
          placeholder="الاسم,المنشأة,الجوال,البريد,المدينة,ملاحظات&#10;محمد العلي,شركة النور,0551112222,m@example.com,الرياض,زار الجناح" @input="result = null" />
        <p class="pm-muted" style="font-size: .82rem">الأعمدة المعروفة: الاسم، المنشأة، الجوال، البريد، المدينة، ملاحظات. الاسم إلزامي، ومعه جوال أو بريد. قُرئ {{ rows.length }} صف.</p>
        <table v-if="rows.length" class="table" style="font-size: .82rem">
          <thead><tr><th>الاسم</th><th>المنشأة</th><th>الجوال</th><th>البريد</th><th>المدينة</th></tr></thead>
          <tbody><tr v-for="(r, i) in rows.slice(0, 8)" :key="i"><td>{{ r.name }}</td><td>{{ r.company }}</td><td class="cr-ltr">{{ r.phone }}</td><td class="cr-ltr">{{ r.email }}</td><td>{{ r.city }}</td></tr></tbody>
        </table>
        <p v-if="rows.length > 8" class="pm-muted" style="font-size: .8rem">و{{ rows.length - 8 }} صفًا آخر</p>
      </section>
      <section class="card pm-panel">
        <p class="cr-sec">2. بيانات الدفعة</p>
        <label class="field"><span>المصدر</span><select v-model="f.source" class="input"><option v-for="s in lk.settings.sources.filter((x: any) => x.isActive)" :key="s.key" :value="s.key">{{ s.label }}</option></select></label>
        <label class="field"><span>الاهتمام</span><select v-model="f.interest" class="input"><option value="">—</option><option v-for="s in lk.settings.interests.filter((x: any) => x.isActive)" :key="s.key" :value="s.key">{{ s.label }}</option></select></label>
        <label class="field"><span>الحملة أو المناسبة</span><input v-model="f.campaign" class="input" maxlength="200" placeholder="مثل: معرض الرياض 2026" /></label>
        <p class="cr-sec">3. التجربة ثم الاستيراد</p>
        <div style="display: flex; gap: 8px">
          <button class="btn" :disabled="busy || !rows.length" @click="run(true)">تجربة</button>
          <button class="btn btn-primary" :disabled="busy || !result?.dryRun || !result.ready" @click="run(false)">استيراد {{ result?.dryRun ? result.ready : '' }}</button>
        </div>
        <div v-if="result" style="margin-top: 12px">
          <p v-if="result.dryRun"><span class="cr-ok">{{ result.ready }} جاهز</span> <span v-if="result.skipped" class="cr-flag">{{ result.skipped }} مستبعد</span></p>
          <p v-else><span class="cr-ok">استُورد {{ result.created }}</span> <span v-if="result.skipped" class="cr-flag">{{ result.skipped }} مستبعد</span>
            <RouterLink class="pm-link" to="/crm/leads?status=new" style="margin-inline-start: 8px">عرض العملاء المحتملين ←</RouterLink></p>
          <table v-if="result.issues.length" class="table" style="font-size: .82rem">
            <thead><tr><th>الصف</th><th>الاسم</th><th>السبب</th></tr></thead>
            <tbody><tr v-for="x in result.issues" :key="x.row"><td>{{ x.row }}</td><td>{{ x.name }}</td><td>{{ x.reason }}</td></tr></tbody>
          </table>
        </div>
        <button v-if="result && !result.dryRun" class="btn" style="margin-top: 10px" @click="router.push('/crm/leads')">تم</button>
      </section>
    </div>
  </div>
</template>
