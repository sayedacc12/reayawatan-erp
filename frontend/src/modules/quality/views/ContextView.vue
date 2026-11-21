<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, errMsg, fmtDate } from '../lib';
import '../../../shared/module.css';
import '../quality.css';

interface Ctx {
  scope: string; exclusions: string;
  issues: { kind: 'internal' | 'external'; category: string; text: string }[];
  parties: { name: string; needs: string; monitoring: string }[];
  processes: { name: string; owner: string; inputs: string; outputs: string; kpi: string }[];
  policy: { text: string; approvedBy: string; date: string | null };
  responsibilities: { role: string; duties: string }[];
}
const session = useSession();
const toast = useToast();
const ctx = ref<Ctx | null>(null);
const edit = ref(false);
const tab = ref<'scope' | 'issues' | 'parties' | 'processes' | 'policy' | 'roles'>('scope');
const canEdit = computed(() => session.can(P.context));
onMounted(async () => {
  ctx.value = await api<Ctx>('/quality/context');
});
async function save() {
  try {
    ctx.value = await api<Ctx>('/quality/context', { method: 'PUT', json: { context: ctx.value } });
    edit.value = false;
    toast.success('حُفظ سياق الجمعية');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
const tabs = [
  { k: 'scope', l: 'النطاق (4.3)' }, { k: 'issues', l: 'القضايا الداخلية والخارجية (4.1)' }, { k: 'parties', l: 'الأطراف المعنية (4.2)' },
  { k: 'processes', l: 'العمليات (4.4)' }, { k: 'policy', l: 'سياسة الجودة (5.2)' }, { k: 'roles', l: 'المسؤوليات (5.3)' },
] as const;
</script>

<template>
  <div>
    <section class="pm-hero q-hero">
      <div><p class="pm-kicker">البندان 4 و5 من المواصفة</p><h1>سياق الجمعية وسياسة الجودة</h1>
        <p class="pm-sub">ما يؤثر في الجمعية من الداخل والخارج، ومن يهمه أمرها، ونطاق النظام وعملياته، والسياسة التي تلتزم بها القيادة.</p></div>
      <div class="pm-actions no-print">
        <button v-if="canEdit && !edit" class="btn q-glow" @click="edit = true">تعديل</button>
        <template v-if="edit"><button class="btn q-glow" @click="save">حفظ</button><button class="btn q-ghost" @click="edit = false">إلغاء</button></template>
      </div>
    </section>
    <div class="q-tabs no-print"><button v-for="t in tabs" :key="t.k" :class="['q-tab', { on: tab === t.k }]" @click="tab = t.k">{{ t.l }}</button></div>
    <section v-if="ctx" class="card pm-panel">
      <template v-if="tab === 'scope'">
        <h2>نطاق نظام إدارة الجودة</h2>
        <textarea v-if="edit" v-model="ctx.scope" class="input" rows="5" placeholder="الخدمات والمواقع والعمليات المشمولة" />
        <p v-else class="q-pre">{{ ctx.scope || 'لم يُحدد النطاق بعد' }}</p>
        <h2 style="margin-top: 16px">البنود غير المنطبقة ومبرراتها</h2>
        <textarea v-if="edit" v-model="ctx.exclusions" class="input" rows="3" />
        <p v-else class="q-pre">{{ ctx.exclusions || '—' }}</p>
      </template>

      <template v-else-if="tab === 'issues'">
        <div v-for="kind in (['internal', 'external'] as const)" :key="kind">
          <p class="q-sec">{{ kind === 'internal' ? 'قضايا داخلية (القوة والضعف)' : 'قضايا خارجية (الفرص والتهديدات)' }}</p>
          <div v-if="edit" class="q-list-edit">
            <div v-for="(x, i) in ctx.issues.filter((y) => y.kind === kind)" :key="i" class="r">
              <input v-model="x.category" class="input" style="max-width: 160px" placeholder="التصنيف" /><input v-model="x.text" class="input" placeholder="القضية" />
              <button class="btn btn-sm" @click="ctx.issues.splice(ctx.issues.indexOf(x), 1)">✕</button>
            </div>
            <button class="btn btn-sm" @click="ctx.issues.push({ kind, category: '', text: '' })">+ قضية</button>
          </div>
          <div v-else class="table-wrap"><table class="table"><tbody>
            <tr v-for="(x, i) in ctx.issues.filter((y) => y.kind === kind)" :key="i"><td style="width: 160px"><span class="pm-tag">{{ x.category || '—' }}</span></td><td>{{ x.text }}</td></tr>
            <tr v-if="!ctx.issues.some((y) => y.kind === kind)"><td class="pm-empty">لا توجد قضايا مسجلة</td></tr>
          </tbody></table></div>
        </div>
      </template>

      <template v-else-if="tab === 'parties'">
        <h2>الأطراف المعنية واحتياجاتهم</h2>
        <div v-if="edit" class="q-list-edit">
          <div v-for="(x, i) in ctx.parties" :key="i" class="r">
            <input v-model="x.name" class="input" style="max-width: 200px" placeholder="الطرف" /><input v-model="x.needs" class="input" placeholder="الاحتياجات والتوقعات" />
            <input v-model="x.monitoring" class="input" style="max-width: 240px" placeholder="طريقة المتابعة" /><button class="btn btn-sm" @click="ctx.parties.splice(i, 1)">✕</button>
          </div>
          <button class="btn btn-sm" @click="ctx.parties.push({ name: '', needs: '', monitoring: '' })">+ طرف</button>
        </div>
        <div v-else class="table-wrap"><table class="table">
          <thead><tr><th>الطرف</th><th>الاحتياجات والتوقعات</th><th>طريقة المتابعة</th></tr></thead>
          <tbody><tr v-for="(x, i) in ctx.parties" :key="i"><td><b>{{ x.name }}</b></td><td>{{ x.needs }}</td><td class="pm-muted">{{ x.monitoring }}</td></tr>
            <tr v-if="!ctx.parties.length"><td colspan="3" class="pm-empty">لا توجد أطراف مسجلة</td></tr></tbody>
        </table></div>
      </template>

      <template v-else-if="tab === 'processes'">
        <h2>عمليات النظام وتفاعلها <RouterLink to="/quality/maps" class="pm-link" style="font-size: .8rem">خرائط الإجراءات</RouterLink></h2>
        <div v-if="edit" class="q-list-edit">
          <div v-for="(x, i) in ctx.processes" :key="i" class="r" style="flex-wrap: wrap">
            <input v-model="x.name" class="input" placeholder="العملية" /><input v-model="x.owner" class="input" placeholder="المالك" /><input v-model="x.inputs" class="input" placeholder="المدخلات" />
            <input v-model="x.outputs" class="input" placeholder="المخرجات" /><input v-model="x.kpi" class="input" placeholder="مؤشر الأداء" /><button class="btn btn-sm" @click="ctx.processes.splice(i, 1)">✕</button>
          </div>
          <button class="btn btn-sm" @click="ctx.processes.push({ name: '', owner: '', inputs: '', outputs: '', kpi: '' })">+ عملية</button>
        </div>
        <div v-else class="table-wrap"><table class="table">
          <thead><tr><th>العملية</th><th>المالك</th><th>المدخلات</th><th>المخرجات</th><th>مؤشر الأداء</th></tr></thead>
          <tbody><tr v-for="(x, i) in ctx.processes" :key="i"><td><b>{{ x.name }}</b></td><td>{{ x.owner }}</td><td>{{ x.inputs }}</td><td>{{ x.outputs }}</td><td class="pm-muted">{{ x.kpi }}</td></tr>
            <tr v-if="!ctx.processes.length"><td colspan="5" class="pm-empty">لا توجد عمليات مسجلة</td></tr></tbody>
        </table></div>
      </template>

      <template v-else-if="tab === 'policy'">
        <template v-if="edit">
          <label class="field"><span>نص السياسة</span><textarea v-model="ctx.policy.text" class="input" rows="10" /></label>
          <div class="pm-grid2">
            <label class="field"><span>اعتمدها</span><input v-model="ctx.policy.approvedBy" class="input" /></label>
            <label class="field"><span>تاريخ الاعتماد</span><input v-model="ctx.policy.date" type="date" class="input" /></label>
          </div>
        </template>
        <div v-else class="q-paper">
          <div class="q-paper-body">
            <h3>سياسة الجودة</h3>
            <p class="q-pre">{{ ctx.policy.text || 'لم تُكتب سياسة الجودة بعد' }}</p>
          </div>
          <div class="q-paper-foot"><div>اعتمدها: <b>{{ ctx.policy.approvedBy || '—' }}</b></div><div>تاريخ الاعتماد: <b>{{ fmtDate(ctx.policy.date) }}</b></div><div>الوثيقة في السجل: <span class="q-code">POL-QMS-01</span></div></div>
        </div>
      </template>

      <template v-else>
        <h2>الأدوار والمسؤوليات في نظام الجودة</h2>
        <div v-if="edit" class="q-list-edit">
          <div v-for="(x, i) in ctx.responsibilities" :key="i" class="r">
            <input v-model="x.role" class="input" style="max-width: 240px" placeholder="الدور" /><input v-model="x.duties" class="input" placeholder="المسؤوليات" />
            <button class="btn btn-sm" @click="ctx.responsibilities.splice(i, 1)">✕</button>
          </div>
          <button class="btn btn-sm" @click="ctx.responsibilities.push({ role: '', duties: '' })">+ دور</button>
        </div>
        <div v-else class="table-wrap"><table class="table">
          <tbody><tr v-for="(x, i) in ctx.responsibilities" :key="i"><td style="width: 260px"><b>{{ x.role }}</b></td><td>{{ x.duties }}</td></tr>
            <tr v-if="!ctx.responsibilities.length"><td class="pm-empty">لا توجد مسؤوليات مسجلة</td></tr></tbody>
        </table></div>
        <p class="pm-muted" style="margin-top: 10px">الأوصاف الوظيفية التفصيلية في <RouterLink to="/hr/jobs" class="pm-link">الموارد البشرية</RouterLink>، والصلاحيات في تبويب الصلاحيات بإعدادات كل نظام.</p>
      </template>
    </section>
  </div>
</template>
