<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../../api';
import { useToast } from '../../../../stores/toast';
import { AF, downloadFile, useLookups } from '../../assets';
import { dt } from '../../lib';
import '../../../../shared/module.css';
import '../../acc.css';
import './assets.css';

interface ImportLog {
  id: string; fileName: string; status: 'complete' | 'partial' | 'rejected'; statusLabel: string; total: number; imported: number;
  errors: { row: number; name: string | null; messages: string[] }[]; assets: { id: string; code: string; name: string }[]; createdByName: string; createdAt: string;
  message?: string; openingDate?: string | null;
}
const toast = useToast();
const { load: reloadLookups } = useLookups();
const STATUS_C: Record<string, string> = { complete: '#10b981', partial: '#f59e0b', rejected: '#dc2626' };
const file = ref<File | null>(null);
const mode = ref<'partial' | 'strict'>('partial');
const busy = ref(false);
const result = ref<ImportLog | null>(null);
const history = ref<ImportLog[]>([]);
const input = ref<HTMLInputElement | null>(null);
const dragging = ref(false);

async function loadHistory() { history.value = await api<ImportLog[]>(`${AF}/import`).catch(() => []); }
onMounted(loadHistory);

async function template() {
  try {
    await downloadFile(`${AF}/import/template`, 'نموذج استيراد الأصول.xlsx');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function pick(e: Event) { file.value = (e.target as HTMLInputElement).files?.[0] ?? null; result.value = null; }
function drop(e: DragEvent) { dragging.value = false; const f = e.dataTransfer?.files?.[0]; if (f) { file.value = f; result.value = null; } }
async function upload() {
  if (!file.value) return;
  busy.value = true;
  try {
    const fd = new FormData();
    fd.append('file', file.value);
    fd.append('mode', mode.value);
    result.value = await api<ImportLog>(`${AF}/import`, { method: 'POST', body: fd });
    if (result.value.imported) reloadLookups(true).catch(() => {});
    file.value = null;
    if (input.value) input.value.value = '';
    await loadHistory();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <section class="pm-hero ac-hero fa-hero">
      <div>
        <p class="pm-kicker">الأصول الثابتة</p>
        <h1>استيراد الأصول من Excel</h1>
        <p class="pm-sub">لإدخال أصول كثيرة مرة واحدة، مثل الأصول القائمة عند بدء استخدام النظام. نزّل النموذج، واملأه، ثم ارفعه. يتحقق النظام من كل صف ويخبرك بالنتيجة.</p>
      </div>
      <div class="pm-actions"><RouterLink to="/accounting/assets/register" class="btn ac-ghost">سجل الأصول</RouterLink></div>
    </section>

    <div class="steps">
      <section class="card pm-panel step">
        <span class="n">1</span>
        <h2>نزّل النموذج</h2>
        <p class="fa-sub">فيه ورقة الأصول بالأعمدة المطلوبة (المعلَّم بـ * إلزامي)، وأوراق بمجموعات الأصول ورموزها والموظفين وأرقامهم، وورقة تعليمات. النموذج يتضمن الحقول الإضافية لكل مجموعة.</p>
        <button class="btn btn-primary" @click="template">⬇️ تنزيل نموذج الاستيراد</button>
      </section>
      <section class="card pm-panel step">
        <span class="n">2</span>
        <h2>املأ البيانات</h2>
        <ul class="fa-sub tips">
          <li>صف لكل أصل، ولا تغيّر عناوين الأعمدة.</li>
          <li>اكتب رمز المجموعة ورقم الموظف كما في أوراق النموذج.</li>
          <li>التاريخ بصيغة 2026-01-31 أو 31/01/2026.</li>
          <li>إن كتبت التكلفة ومجمع الإهلاك يدخل الأصل الدفاتر برصيد افتتاحي، وإن تركتهما يُسجل بلا قيمة.</li>
        </ul>
      </section>
      <section class="card pm-panel step">
        <span class="n">3</span>
        <h2>ارفع الملف</h2>
        <div :class="['drop', { on: dragging, has: file }]" @click="input?.click()" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="drop">
          <input ref="input" type="file" accept=".xlsx" hidden @change="pick" />
          <b>{{ file ? file.name : 'اسحب الملف هنا أو اضغط لاختياره' }}</b>
          <small class="pm-muted">ملف Excel بصيغة xlsx</small>
        </div>
        <div class="field"><span>إن وُجدت أخطاء في بعض الصفوف</span>
          <div class="ac-switch">
            <button type="button" :class="{ on: mode === 'partial' }" @click="mode = 'partial'">استورد الصفوف السليمة</button>
            <button type="button" :class="{ on: mode === 'strict' }" @click="mode = 'strict'">الكل أو لا شيء</button>
          </div>
        </div>
        <button class="btn btn-primary" :disabled="!file || busy" @click="upload">{{ busy ? 'جارٍ الاستيراد...' : 'استيراد' }}</button>
      </section>
    </div>

    <section v-if="result" class="card pm-panel result" :style="{ '--c': STATUS_C[result.status] }">
      <h2><span class="pm-pill" :style="{ '--c': STATUS_C[result.status] }">{{ result.statusLabel }}</span> {{ result.message }}</h2>
      <p class="fa-sub">الملف: {{ result.fileName }} · عدد الصفوف {{ result.total }} · المستورد {{ result.imported }}<template v-if="result.openingDate"> · تاريخ الرصيد الافتتاحي {{ result.openingDate }}</template></p>
      <div v-if="result.errors.length" class="table-wrap">
        <table class="table">
          <thead><tr><th>الصف</th><th>الأصل</th><th>الأخطاء</th></tr></thead>
          <tbody>
            <tr v-for="e in result.errors" :key="e.row"><td><b>{{ e.row }}</b></td><td>{{ e.name ?? '—' }}</td><td><ul class="errs"><li v-for="(m, i) in e.messages" :key="i">{{ m }}</li></ul></td></tr>
          </tbody>
        </table>
      </div>
      <div v-if="result.assets.length" class="made">
        <b>الأصول المضافة:</b>
        <RouterLink v-for="x in result.assets" :key="x.id" :to="`/accounting/assets/${x.id}`" class="pm-tag">{{ x.code }} {{ x.name }}</RouterLink>
      </div>
    </section>

    <section class="card pm-panel">
      <h2>سجل الاستيراد</h2>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>التاريخ</th><th>الملف</th><th>الصفوف</th><th>المستورد</th><th>الأخطاء</th><th>النتيجة</th><th>بواسطة</th></tr></thead>
          <tbody>
            <tr v-for="h in history" :key="h.id" class="ac-row-click" @click="result = h">
              <td>{{ dt(h.createdAt) }}</td><td>{{ h.fileName }}</td><td>{{ h.total }}</td><td>{{ h.imported }}</td><td>{{ h.errors.length }}</td>
              <td><span class="pm-pill" :style="{ '--c': STATUS_C[h.status] }">{{ h.statusLabel }}</span></td><td>{{ h.createdByName }}</td>
            </tr>
            <tr v-if="!history.length"><td colspan="7" class="pm-empty">لم يُستورد أي ملف بعد</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 16px; }
.step { position: relative; display: flex; flex-direction: column; gap: 10px; }
.step .n { position: absolute; top: 14px; left: 14px; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; color: #fff;
  background: linear-gradient(135deg, #0ea5e9, #6366f1); box-shadow: 0 0 18px rgba(99,102,241,.35); }
.tips { margin: 0; padding-inline-start: 18px; line-height: 1.9; }
.drop { border: 2px dashed #cbd5e1; border-radius: 14px; padding: 22px 12px; display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; transition: .2s; text-align: center; }
.drop.on, .drop:hover { border-color: #6366f1; background: #eef2ff; }
.drop.has { border-color: #10b981; background: #ecfdf5; }
.result { border-inline-start: 5px solid var(--c); margin-bottom: 16px; animation: fa-pop .4s var(--ease) both; }
.errs { margin: 0; padding-inline-start: 16px; color: #b91c1c; }
.made { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 12px; }
@keyframes fa-pop { from { opacity: 0; transform: translateY(8px); } }
</style>
