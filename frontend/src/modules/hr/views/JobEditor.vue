<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, STATUS_COLOR, fmtDate, sar, type Competency, type Grade, type JobRow, type Unit } from '../lib';
import '../../projects/projects.css';
import '../hr.css';

const props = defineProps<{ id?: string }>();
const session = useSession();
const toast = useToast();
const router = useRouter();
const units = ref<Unit[]>([]);
const grades = ref<Grade[]>([]);
const comps = ref<Competency[]>([]);
const jobs = ref<JobRow[]>([]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const job = ref<any>(null);
const canEdit = computed(() => session.can(P.jobs));
const form = reactive({
  title: '', unitId: '', gradeId: '', reportsToJobId: '', headcount: 1, purpose: '', responsibilities: [''] as string[], qualifications: '', experienceYears: 0,
  competencies: [] as { competencyId: string; level: number }[], kpis: [] as { title: string; weight: number; target: string; unit: string }[], qualityCode: '', isActive: true,
});
async function load() {
  const [s, g, c, j] = await Promise.all([api<{ units: Unit[] }>('/hr/structure'), api<Grade[]>('/hr/grades'), api<Competency[]>('/hr/competencies'), api<JobRow[]>('/hr/jobs')]);
  units.value = s.units;
  grades.value = g;
  comps.value = c;
  jobs.value = j.filter((x) => x.id !== props.id);
  if (props.id) {
    job.value = await api(`/hr/jobs/${props.id}`);
    const v = job.value;
    Object.assign(form, {
      title: v.title, unitId: v.unitId, gradeId: v.gradeId ?? '', reportsToJobId: v.reportsToJobId ?? '', headcount: v.headcount, purpose: v.purpose ?? '',
      responsibilities: v.responsibilities.length ? [...v.responsibilities] : [''], qualifications: v.qualifications ?? '', experienceYears: v.experienceYears,
      competencies: v.competencies.map((x: { competencyId: string; level: number }) => ({ competencyId: x.competencyId, level: x.level })),
      kpis: v.kpis.map((k: { title: string; weight: number; target: string; unit: string | null }) => ({ ...k, unit: k.unit ?? '' })), qualityCode: v.qualityCode ?? '', isActive: v.isActive,
    });
  }
}
onMounted(() => load().catch((e) => toast.error((e as Error).message)));
const kpiTotal = computed(() => form.kpis.reduce((s, k) => s + Number(k.weight || 0), 0));
const grade = computed(() => grades.value.find((g) => g.id === form.gradeId));
const comp = (id: string) => comps.value.find((c) => c.id === id);
async function save() {
  try {
    const body = {
      title: form.title, unitId: form.unitId, gradeId: form.gradeId || null, reportsToJobId: form.reportsToJobId || null, headcount: Number(form.headcount), purpose: form.purpose || null,
      responsibilities: form.responsibilities.filter((r) => r.trim()), qualifications: form.qualifications || null, experienceYears: Number(form.experienceYears),
      competencies: form.competencies.filter((c) => c.competencyId), kpis: form.kpis.filter((k) => k.title).map((k) => ({ ...k, weight: Number(k.weight), unit: k.unit || null })),
      qualityCode: form.qualityCode || null, isActive: form.isActive,
    };
    if (props.id) {
      await api(`/hr/jobs/${props.id}`, { method: 'PATCH', json: body });
      toast.success(job.value?.status === 'approved' ? 'حُفظ التعديل وعاد الوصف مسودة حتى يُعاد اعتماده' : 'تم الحفظ');
      await load();
    } else {
      const r = await api<{ id: string }>('/hr/jobs', { method: 'POST', json: body });
      toast.success('أُنشئت الوظيفة');
      router.replace(`/hr/jobs/${r.id}`);
    }
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function approve() {
  try {
    const r = await api<{ revision: number }>(`/hr/jobs/${props.id}/approve`, { method: 'POST' });
    toast.success(`اعتُمد الوصف الوظيفي (الإصدار Rev.${String(r.revision).padStart(2, '0')})`);
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove() {
  if (!confirm('حذف الوظيفة؟')) return;
  try {
    await api(`/hr/jobs/${props.id}`, { method: 'DELETE' });
    router.push('/hr/jobs');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <section class="pm-hero hr-hero">
      <div>
        <p class="pm-kicker">الوصف الوظيفي{{ job ? ` · ${job.code}` : '' }}</p>
        <h1>{{ job ? job.title : 'وظيفة جديدة' }}</h1>
        <p v-if="job" class="pm-sub"><span class="hr-code">{{ job.qualityCode }}</span> · Rev.{{ String(job.revision).padStart(2, '0') }}
          <template v-if="job.approvedAt"> · آخر اعتماد {{ fmtDate(job.approvedAt) }} بواسطة {{ job.approvedByName }}</template></p>
      </div>
      <div class="pm-actions">
        <span v-if="job" class="pm-pill" :style="{ '--c': STATUS_COLOR[job.status], background: 'rgba(255,255,255,.9)' }">{{ job.status === 'approved' ? 'معتمد' : 'مسودة' }}</span>
        <button v-if="job && job.status === 'draft' && session.can(P.approveJobs)" class="btn hr-glow" @click="approve">اعتماد الوصف</button>
        <button v-if="job && !job.approvedAt && canEdit" class="btn hr-ghost" @click="remove">حذف</button>
      </div>
    </section>
    <form class="hr-grid" style="grid-template-columns: 1fr 1fr" @submit.prevent="save">
      <section class="card pm-panel">
        <h2>بيانات الوظيفة</h2>
        <fieldset :disabled="!canEdit" style="border: 0; padding: 0; margin: 0">
          <div class="hr-fields">
            <label class="field" style="grid-column: span 2"><span>المسمى الوظيفي</span><input v-model="form.title" class="input" required /></label>
            <label class="field"><span>الوحدة التنظيمية</span><select v-model="form.unitId" class="input" required><option value="" disabled>اختر</option><option v-for="u in units" :key="u.id" :value="u.id">{{ u.levelName }}: {{ u.name }}</option></select></label>
            <label class="field"><span>ترتبط إداريًا بـ</span><select v-model="form.reportsToJobId" class="input"><option value="">—</option><option v-for="j in jobs" :key="j.id" :value="j.id">{{ j.title }}</option></select></label>
            <label class="field"><span>المرتبة في سلم الرواتب</span><select v-model="form.gradeId" class="input"><option value="">—</option><option v-for="g in grades" :key="g.id" :value="g.id">{{ g.code }} {{ g.name }}</option></select></label>
            <label class="field"><span>عدد الشواغر المعتمدة</span><input v-model.number="form.headcount" type="number" min="0" class="input" /></label>
            <label class="field"><span>سنوات الخبرة</span><input v-model.number="form.experienceYears" type="number" min="0" class="input" /></label>
            <label class="field"><span>كود الجودة</span><input v-model="form.qualityCode" class="input hr-code" placeholder="يُولَّد تلقائيًا" /></label>
          </div>
          <p v-if="grade" class="pm-muted">نطاق الراتب الأساسي: {{ sar(grade.minSalary) }} - {{ sar(grade.maxSalary) }}</p>
          <label class="field"><span>الهدف العام من الوظيفة</span><textarea v-model="form.purpose" class="input" rows="2" /></label>
          <div class="hr-sec">المهام والمسؤوليات</div>
          <div v-for="(r, i) in form.responsibilities" :key="i" style="display: flex; gap: 6px; margin-bottom: 6px">
            <input v-model="form.responsibilities[i]" class="input" :placeholder="`المهمة ${i + 1}`" />
            <button v-if="canEdit" type="button" class="btn btn-sm" @click="form.responsibilities.splice(i, 1)">✕</button>
          </div>
          <button v-if="canEdit" type="button" class="btn btn-sm" @click="form.responsibilities.push('')">+ مهمة</button>
          <label class="field" style="margin-top: 12px"><span>المؤهلات والمهارات</span><textarea v-model="form.qualifications" class="input" rows="2" /></label>
          <label class="check" style="display: flex; gap: 8px"><input v-model="form.isActive" type="checkbox" /> وظيفة نشطة</label>
        </fieldset>
      </section>
      <section class="card pm-panel">
        <h2>الجدارات المطلوبة</h2>
        <fieldset :disabled="!canEdit" style="border: 0; padding: 0; margin: 0">
          <div v-for="(c, i) in form.competencies" :key="i" style="margin-bottom: 10px">
            <div style="display: flex; gap: 6px">
              <select v-model="c.competencyId" class="input"><option value="" disabled>اختر الجدارة</option><option v-for="x in comps.filter((x) => x.isActive || x.id === c.competencyId)" :key="x.id" :value="x.id">{{ x.name }} ({{ x.kindLabel }})</option></select>
              <select v-model.number="c.level" class="input" style="width: 120px; flex-shrink: 0"><option v-for="l in 5" :key="l" :value="l">المستوى {{ l }}</option></select>
              <button v-if="canEdit" type="button" class="btn btn-sm" @click="form.competencies.splice(i, 1)">✕</button>
            </div>
            <small v-if="comp(c.competencyId)" class="pm-muted">{{ comp(c.competencyId)?.levels.find((l) => l.level === c.level)?.description }}</small>
          </div>
          <button v-if="canEdit" type="button" class="btn btn-sm" @click="form.competencies.push({ competencyId: '', level: 3 })">+ جدارة</button>
          <RouterLink to="/hr/competencies" class="pm-link" style="margin-inline-start: 10px; font-size: .82rem">مكتبة الجدارات</RouterLink>
        </fieldset>
        <h2 style="margin-top: 18px">مؤشرات الأداء <span :class="['pm-tag']" :style="{ color: kpiTotal === 100 || !form.kpis.length ? 'var(--success)' : 'var(--danger)' }">{{ kpiTotal }}%</span></h2>
        <fieldset :disabled="!canEdit" style="border: 0; padding: 0; margin: 0">
          <div v-for="(k, i) in form.kpis" :key="i" style="display: grid; grid-template-columns: minmax(0, 2.2fr) 70px minmax(0, 1fr) minmax(0, .8fr) auto; gap: 6px; margin-bottom: 6px">
            <input v-model="k.title" class="input" placeholder="المؤشر" />
            <input v-model.number="k.weight" type="number" min="0" max="100" class="input" placeholder="الوزن %" />
            <input v-model="k.target" class="input" placeholder="المستهدف" />
            <input v-model="k.unit" class="input" placeholder="الوحدة" />
            <button v-if="canEdit" type="button" class="btn btn-sm" @click="form.kpis.splice(i, 1)">✕</button>
          </div>
          <button v-if="canEdit" type="button" class="btn btn-sm" @click="form.kpis.push({ title: '', weight: 0, target: '', unit: '' })">+ مؤشر</button>
          <p class="pm-muted">مجموع الأوزان 100%، وتنتقل هذه المؤشرات لبطاقة الأداء المستهدف لكل موظف على الوظيفة.</p>
        </fieldset>
        <div v-if="canEdit" class="modal-actions" style="margin-top: 16px"><button class="btn btn-primary">حفظ</button><RouterLink to="/hr/jobs" class="btn">رجوع</RouterLink></div>
      </section>
    </form>
  </div>
</template>
