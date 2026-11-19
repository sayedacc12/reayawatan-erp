<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { fromLocalInput, lookups, sar, toLocalInput } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const props = defineProps<{ id?: string }>();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const lk = ref<any>(null);
const req = ref<any>(null);
const busy = ref(false);
const supQ = ref('');
const form = ref<any>({
  title: '', method: 'quotes', scope: '', terms: '', closesAt: '', questionsUntil: '', invitedIds: [] as string[], categoryIds: [] as string[],
  criteria: [] as any[], technicalPass: 60, committeeIds: [] as string[],
});

onMounted(async () => {
  try {
    lk.value = await lookups();
    if (props.id) {
      const q = await api<any>(`/procurement/rfqs/${props.id}`);
      req.value = q.request;
      form.value = {
        title: q.title, method: q.method, scope: q.scope ?? '', terms: q.terms ?? '', closesAt: toLocalInput(q.closesAt), questionsUntil: toLocalInput(q.questionsUntil),
        invitedIds: [...q.invitedIds], categoryIds: [...q.categoryIds], criteria: q.criteria.map((c: any) => ({ ...c })), technicalPass: q.technicalPass, committeeIds: [...q.committeeIds],
      };
    } else {
      req.value = await api<any>(`/procurement/requests/${route.query.request}`);
      const d = (n: number) => toLocalInput(new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10) + 'T12:00:00');
      form.value.title = req.value.title;
      form.value.method = req.value.method === 'tender' ? 'tender' : 'quotes';
      form.value.closesAt = d(form.value.method === 'tender' ? 14 : 5);
      form.value.questionsUntil = d(form.value.method === 'tender' ? 7 : 3);
      form.value.criteria = lk.value.sourcing.evalCriteria.map((c: any) => ({ ...c }));
      form.value.technicalPass = lk.value.sourcing.technicalPass;
    }
  } catch (e) {
    toast.error((e as Error).message);
  }
});

const suppliers = computed(() => {
  const q = supQ.value.trim();
  return (lk.value?.approvedSuppliers ?? []).filter((s: any) =>
    (!form.value.categoryIds.length || s.categoryIds.some((c: string) => form.value.categoryIds.includes(c))) && (!q || s.name.includes(q) || s.code.includes(q) || s.activities.join(' ').includes(q)));
});
const toggle = (arr: string[], id: string) => { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); else arr.push(id); };
const weight = computed(() => form.value.criteria.reduce((s: number, c: any) => s + (Number(c.weight) || 0), 0));
const hasTech = computed(() => form.value.criteria.some((c: any) => c.kind === 'technical'));
function addCriterion() {
  form.value.criteria.push({ key: `c${Date.now().toString(36).slice(-5)}`, name: '', weight: 0, kind: 'technical' });
}

async function save() {
  busy.value = true;
  const f = form.value;
  const body = {
    requestId: props.id ? undefined : req.value.id, title: f.title, method: f.method, scope: f.scope || null, terms: f.terms || null,
    closesAt: fromLocalInput(f.closesAt), questionsUntil: fromLocalInput(f.questionsUntil), invitedIds: f.invitedIds, categoryIds: f.categoryIds,
    criteria: f.criteria.map((c: any) => ({ key: c.key, name: c.name, weight: Number(c.weight), kind: c.kind })), technicalPass: Number(f.technicalPass), committeeIds: f.committeeIds,
  };
  try {
    const q = props.id
      ? await api<any>(`/procurement/rfqs/${props.id}`, { method: 'PUT', json: body })
      : await api<any>('/procurement/rfqs', { method: 'POST', json: body });
    toast.success('حُفظت المنافسة مسودة. راجعها ثم انشرها للموردين');
    router.push(`/procurement/rfqs/${q.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="lk && req">
    <div class="page-head">
      <div><h1>{{ id ? 'تعديل المنافسة' : 'طرح منافسة' }}</h1><p class="muted">لطلب الشراء {{ req.code }} · {{ req.title }} · التقديري {{ sar(req.estimatedTotal) }}</p></div>
    </div>
    <form class="pc-grid" style="grid-template-columns: minmax(0, 3fr) minmax(0, 2fr)" @submit.prevent="save">
      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2>الكراسة</h2>
          <div class="pc-fields">
            <label class="field" style="grid-column: 1 / -1"><span>عنوان المنافسة</span><input v-model="form.title" class="input" required /></label>
            <label class="field"><span>الأسلوب</span><select v-model="form.method" class="input"><option value="quotes">طلب عروض أسعار (موردون مدعوون)</option><option value="tender">منافسة عامة (كل المعتمدين في التصنيف)</option></select></label>
            <label class="field"><span>آخر موعد للاستفسارات</span><input v-model="form.questionsUntil" type="datetime-local" class="input" /></label>
            <label class="field"><span>آخر موعد لتقديم العروض</span><input v-model="form.closesAt" type="datetime-local" class="input" required /></label>
            <label class="field" style="grid-column: 1 / -1"><span>نطاق الأعمال والمواصفات العامة</span><textarea v-model="form.scope" class="input" rows="3" /></label>
            <label class="field" style="grid-column: 1 / -1"><span>الشروط الفنية والمالية</span><textarea v-model="form.terms" class="input" rows="3" placeholder="مدة التوريد، مكان التسليم، الضمان، شروط الدفع..." /></label>
          </div>
          <p class="pm-muted" style="font-size: .8rem">البنود والكميات من طلب الشراء ({{ req.lines?.length ?? '' }} بند)، ولا يرى الموردون السعر التقديري.</p>
        </section>
        <section class="card pm-panel">
          <h2>معايير التقييم <small :class="weight === 100 ? 'pc-okflag' : 'pc-flag'">المجموع {{ weight }} من 100</small></h2>
          <table class="pc-lines">
            <thead><tr><th>المعيار</th><th style="width: 140px">النوع</th><th style="width: 90px">الوزن</th><th /></tr></thead>
            <tbody>
              <tr v-for="(c, i) in form.criteria" :key="c.key">
                <td><input v-model="c.name" class="input" required /></td>
                <td><select v-model="c.kind" class="input"><option value="price">مالي (آلي من السعر)</option><option value="technical">فني (تقدّره اللجنة)</option></select></td>
                <td><input v-model.number="c.weight" type="number" min="1" max="100" class="input" /></td>
                <td><button type="button" class="btn btn-ghost" @click="form.criteria.splice(i, 1)">✕</button></td>
              </tr>
            </tbody>
          </table>
          <div class="pc-inline" style="margin-top: 8px">
            <button type="button" class="btn" @click="addCriterion">+ معيار</button>
            <label v-if="hasTech" class="field" style="margin: 0"><span>الحد الأدنى للدرجة الفنية</span><input v-model.number="form.technicalPass" type="number" min="0" max="100" class="input" style="width: 100px" /></label>
          </div>
        </section>
        <section v-if="hasTech" class="card pm-panel">
          <h2>لجنة التقييم الفني</h2>
          <p class="pm-muted" style="font-size: .82rem">يقيّم كل عضو العروض بعد فتحها، والدرجة متوسط تقديراتهم. يحتاج العضو صلاحية «تقييم العروض».</p>
          <div class="pc-chips">
            <label v-for="u in lk.users" :key="u.id" class="pc-chip" :style="{ '--c': form.committeeIds.includes(u.id) ? '#059669' : '#94a3b8', cursor: 'pointer' }">
              <input type="checkbox" :checked="form.committeeIds.includes(u.id)" hidden @change="toggle(form.committeeIds, u.id)" />{{ form.committeeIds.includes(u.id) ? '✓ ' : '' }}{{ u.fullName }}
            </label>
          </div>
        </section>
      </div>

      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2>الموردون المدعوون <small class="pm-muted">({{ form.invitedIds.length }})</small></h2>
          <p v-if="form.method === 'quotes'" class="pm-muted" style="font-size: .82rem">الحد الأدنى {{ lk.sourcing.minQuotes }} موردين؛ وإن دعوت أقل تُطلب منك المبررات عند النشر.</p>
          <p v-else class="pm-muted" style="font-size: .82rem">تُرسل المنافسة العامة لكل المعتمدين في التصنيفات المختارة (أو كلهم إن لم تختر)، إضافة لمن تحددهم.</p>
          <div class="pc-sec">التصنيفات</div>
          <div class="pc-chips">
            <label v-for="c in lk.categories" :key="c.id" class="pc-chip" :style="{ '--c': form.categoryIds.includes(c.id) ? c.color : '#94a3b8', cursor: 'pointer' }">
              <input type="checkbox" :checked="form.categoryIds.includes(c.id)" hidden @change="toggle(form.categoryIds, c.id)" />{{ form.categoryIds.includes(c.id) ? '✓ ' : '' }}{{ c.name }}
            </label>
          </div>
          <input v-model="supQ" class="input" placeholder="بحث بالاسم أو النشاط" style="margin: 10px 0 6px" />
          <div style="max-height: 340px; overflow: auto; display: grid; gap: 4px">
            <label v-for="s in suppliers" :key="s.id" class="pc-inline" style="font-size: .88rem; padding: 4px 6px; border-radius: 8px" :style="form.invitedIds.includes(s.id) ? 'background: #ecfdf5' : ''">
              <input type="checkbox" :checked="form.invitedIds.includes(s.id)" @change="toggle(form.invitedIds, s.id)" />
              <span><b>{{ s.name }}</b> <span class="pc-code">{{ s.code }}</span><small class="pm-muted" style="display: block">{{ s.activities.slice(0, 3).join('، ') }}</small></span>
            </label>
            <p v-if="!suppliers.length" class="pm-muted">لا يوجد موردون معتمدون بهذه المواصفات</p>
          </div>
        </section>
        <div class="pc-inline">
          <button class="btn btn-primary" :disabled="busy">{{ busy ? 'جارٍ الحفظ...' : 'حفظ المسودة' }}</button>
          <button type="button" class="btn btn-ghost" @click="router.back()">إلغاء</button>
        </div>
      </div>
    </form>
  </div>
</template>
