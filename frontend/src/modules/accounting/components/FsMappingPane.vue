<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';

/**
 * الدليل المحاسبي وفق بنود القوائم: لكل حساب البند الذي يظهر فيه ومصدر الربط.
 * الربط الافتراضي يُدرج تلقائيًا من قواعد الدليل؛ والتعديل اليدوي يسري على الحساب وما تحته، ويُسجَّل في سجل التغييرات.
 */
const props = defineProps<{ canEdit: boolean }>();
const toast = useToast();

interface Row { id: string; code: string; name: string; nature: string; level: number; kind: string; isActive: boolean; line: string; lineName: string; source: 'manual' | 'inherited' | 'default' | 'fallback'; via: string | null; manual: string | null; hasMoves: boolean }
interface Line { code: string; statement: 'bs' | 'is'; group: string; groupName: string; name: string }
const data = ref<{ rows: Row[]; review: { id: string; code: string; name: string; hasMoves: boolean }[]; lines: Line[] } | null>(null);
const error = ref('');
const search = ref('');
const only = ref<'' | 'review' | 'manual' | 'moves'>('');
const busy = ref('');

const SOURCE: Record<Row['source'], { label: string; color: string }> = {
  manual: { label: 'يدوي', color: '#6366f1' }, inherited: { label: 'موروث من الأب', color: '#0ea5e9' },
  default: { label: 'افتراضي', color: '#10b981' }, fallback: { label: 'يحتاج مراجعة', color: '#f59e0b' },
};
const isIs = (nature: string) => nature === 'revenue' || nature === 'expenses';
const linesFor = (r: Row) => (data.value?.lines ?? []).filter((l) => l.statement === (isIs(r.nature) ? 'is' : 'bs'));
const groupsFor = (r: Row) => {
  const m = new Map<string, Line[]>();
  for (const l of linesFor(r)) m.set(l.groupName, [...(m.get(l.groupName) ?? []), l]);
  return [...m.entries()];
};
const rows = computed(() => {
  const s = search.value.trim();
  return (data.value?.rows ?? []).filter((r) => (!s || r.code.startsWith(s) || r.name.includes(s))
    && (!only.value || (only.value === 'review' ? r.kind === 'sub' && r.source === 'fallback' : only.value === 'manual' ? !!r.manual : r.hasMoves)));
});

async function load() {
  try { data.value = await api('/accounting/statements/mapping'); error.value = ''; } catch (e) { error.value = (e as Error).message; }
}
async function setLine(r: Row, lineCode: string | null) {
  busy.value = r.id;
  try {
    await api(`/accounting/statements/mapping/${r.id}`, { method: 'PUT', json: { lineCode } });
    toast.success(lineCode ? `رُبط ${r.code} وما تحته بالبند` : `أُعيد ${r.code} إلى الربط الافتراضي`);
    await load();
  } catch (e) { toast.error((e as Error).message); await load(); } finally { busy.value = ''; }
}
onMounted(load);
</script>

<template>
  <section class="card pm-panel">
    <h2>الدليل المحاسبي وفق بنود القوائم المالية</h2>
    <p class="pm-muted">يُربط كل حساب ببند في قائمة المركز المالي أو قائمة الدخل تلقائيًا حسب ترميز الدليل. غيّر البند عند الحاجة، ويسري التغيير على الحساب وكل ما تحته ما لم يُربط أحدها بنفسه.</p>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="data?.review.length" class="alert alert-warn">
      {{ data.review.length }} حساب فرعي لا تطابقه قاعدة، فيظهر في البند «الآخر» من مجموعته. راجعها واختر بندها المناسب.
      <button class="btn btn-sm" @click="only = 'review'">عرضها</button>
    </div>
    <div class="ac-toolbar">
      <input v-model="search" class="input grow" placeholder="ابحث برمز الحساب أو اسمه" />
      <select v-model="only" class="input">
        <option value="">كل الحسابات</option><option value="review">تحتاج مراجعة</option><option value="manual">المربوطة يدويًا</option><option value="moves">عليها حركة</option>
      </select>
    </div>
    <p v-if="!data" class="pm-empty">جارٍ التحميل...</p>
    <div v-else class="table-wrap"><table class="table">
      <thead><tr><th>الحساب</th><th>البند في القوائم</th><th>المصدر</th><th /></tr></thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id" :class="{ 'fs-dim': !r.isActive }">
          <td :style="{ paddingInlineStart: `${8 + (r.level - 1) * 14}px` }"><span class="ac-code">{{ r.code }}</span> {{ r.name }}<span v-if="r.hasMoves" class="pm-muted"> · عليه حركة</span></td>
          <td>
            <select v-if="props.canEdit" class="input fs-line" :value="r.line" :disabled="busy === r.id" @change="setLine(r, ($event.target as HTMLSelectElement).value)">
              <optgroup v-for="[g, ls] in groupsFor(r)" :key="g" :label="g"><option v-for="l in ls" :key="l.code" :value="l.code">{{ l.name }}</option></optgroup>
            </select>
            <span v-else>{{ r.lineName }}</span>
          </td>
          <td><span class="pm-pill" :style="{ '--c': SOURCE[r.source].color }">{{ SOURCE[r.source].label }}{{ r.via ? ` (${r.via})` : '' }}</span></td>
          <td><button v-if="props.canEdit && r.manual" class="btn btn-sm" :disabled="busy === r.id" @click="setLine(r, null)">إرجاع للافتراضي</button></td>
        </tr>
      </tbody>
    </table></div>
    <p v-if="data && !rows.length" class="pm-empty">لا توجد حسابات مطابقة</p>
  </section>
</template>

<style scoped>
.fs-line { min-width: 240px; }
.fs-dim { opacity: .55; }
.alert .btn { margin-inline-start: 8px; }
</style>
