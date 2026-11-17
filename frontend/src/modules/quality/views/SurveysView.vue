<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, PARTIES, errMsg, fmtDate, num, uid } from '../lib';
import '../../projects/projects.css';
import '../quality.css';

interface Survey { id: string; title: string; audience: string; audienceLabel: string; status: 'draft' | 'open' | 'closed'; formCode: string | null; questions: number; responses: number; targetResponses: number; index: number | null; publicToken: string; createdAt: string }
const session = useSession();
const toast = useToast();
const router = useRouter();
const rows = ref<Survey[]>([]);
async function load() {
  rows.value = await api<Survey[]>('/quality/surveys');
}
onMounted(load);
const STATUS = { draft: { l: 'مسودة', c: '#94a3b8' }, open: { l: 'مفتوحة', c: '#10b981' }, closed: { l: 'مغلقة', c: '#6366f1' } };
const ringColor = (v: number | null) => (v === null ? '#94a3b8' : v >= 80 ? '#10b981' : v >= 60 ? '#f59e0b' : '#ef4444');

const TEMPLATE = [
  'مدى رضاك عن سهولة تقديم الطلب', 'مدى رضاك عن سرعة إنجاز الطلب', 'مدى رضاك عن تعامل الموظفين', 'مدى رضاك عن وضوح المعلومات والتواصل', 'مدى رضاك العام عن خدمات الجمعية',
];
type Q = { id: string; text: string; type: 'rating' | 'choice' | 'text'; options: string };
const form = reactive({ show: false, title: '', audience: 'beneficiary', description: '', formCode: '', targetResponses: 50, questions: [] as Q[] });
function newSurvey() {
  Object.assign(form, {
    show: true, title: 'استبانة رضا المستفيدين', audience: 'beneficiary', description: 'نسعد بمعرفة رأيك لتحسين خدماتنا. لن تستغرق الإجابة أكثر من دقيقتين.', formCode: 'QF-QMS-06', targetResponses: 50,
    questions: [...TEMPLATE.map((t) => ({ id: uid(), text: t, type: 'rating' as const, options: '' })), { id: uid(), text: 'ما الذي تقترحه لتحسين خدماتنا؟', type: 'text' as const, options: '' }],
  });
}
async function create() {
  try {
    const s = await api<{ id: string }>('/quality/surveys', {
      method: 'POST',
      json: {
        title: form.title, audience: form.audience, description: form.description || null, formCode: form.formCode || null, targetResponses: form.targetResponses,
        questions: form.questions.map((q) => ({ id: q.id, text: q.text, type: q.type, ...(q.type === 'choice' ? { options: q.options.split('\n').map((o) => o.trim()).filter(Boolean) } : {}) })),
      },
    });
    toast.success('أُنشئت الاستبانة. افتحها لتبدأ باستقبال الردود');
    router.push(`/quality/surveys/${s.id}`);
  } catch (e) {
    toast.error(errMsg(e));
  }
}
</script>

<template>
  <div>
    <section class="pm-hero q-hero">
      <div><p class="pm-kicker">البند 9.1.2</p><h1>قياس رضا المستفيدين والأطراف المعنية</h1>
        <p class="pm-sub">استبانات برابط عام يرسل للمستفيدين والداعمين والمتطوعين، أو تُدخل ردودها يدويًا. مؤشر الرضا يُحسب من أسئلة التقييم (1 إلى 5) ويغذي أهداف الجودة ومراجعة الإدارة.</p></div>
      <div class="pm-actions"><button v-if="session.can(P.feedback)" class="btn q-glow" @click="newSurvey">استبانة جديدة</button></div>
    </section>
    <div class="q-grid3">
      <section v-for="(s, i) in rows" :key="s.id" class="card pm-panel q-row" :style="{ '--i': i }" @click="router.push(`/quality/surveys/${s.id}`)">
        <div style="display: flex; justify-content: space-between; gap: 8px; align-items: flex-start">
          <b>{{ s.title }}</b><span class="pm-pill" :style="{ '--c': STATUS[s.status].c }">{{ STATUS[s.status].l }}</span>
        </div>
        <p class="pm-muted" style="margin: 4px 0 10px">{{ s.audienceLabel }} · {{ s.questions }} سؤال<template v-if="s.formCode"> · <span class="q-code">{{ s.formCode }}</span></template></p>
        <div style="display: flex; align-items: center; gap: 14px">
          <div class="q-ring sm" :style="{ '--v': s.index ?? 0, '--c': ringColor(s.index) }"><b>{{ s.index === null ? '—' : Math.round(s.index) + '%' }}</b></div>
          <div style="flex: 1">
            <div><b style="font-size: 1.3rem">{{ num(s.responses, 0) }}</b> <span class="pm-muted">رد من {{ num(s.targetResponses, 0) }} مستهدف</span></div>
            <div class="q-progress" style="margin-top: 6px"><i :style="{ width: Math.min(100, s.targetResponses ? (s.responses / s.targetResponses) * 100 : 0) + '%' }" /></div>
            <p class="pm-muted" style="margin: 6px 0 0">أُنشئت {{ fmtDate(s.createdAt) }}</p>
          </div>
        </div>
      </section>
    </div>
    <p v-if="!rows.length" class="q-empty">لا توجد استبانات</p>

    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" style="max-width: 760px" @submit.prevent="create">
        <h2>استبانة جديدة</h2>
        <label class="field"><span>العنوان</span><input v-model="form.title" class="input" required /></label>
        <div class="q-fields">
          <label class="field"><span>الفئة المستهدفة</span><select v-model="form.audience" class="input"><option v-for="x in PARTIES" :key="x.value" :value="x.value">{{ x.label }}</option></select></label>
          <label class="field"><span>رمز النموذج</span><input v-model="form.formCode" class="input" dir="ltr" placeholder="QF-QMS-06" /></label>
          <label class="field"><span>عدد الردود المستهدف</span><input v-model.number="form.targetResponses" type="number" min="0" class="input" /></label>
        </div>
        <label class="field"><span>مقدمة الاستبانة</span><textarea v-model="form.description" class="input" rows="2" /></label>
        <div class="q-sec">الأسئلة</div>
        <div class="q-list-edit">
          <div v-for="(q, i) in form.questions" :key="q.id" class="r">
            <span class="pm-tag" style="min-width: 28px; text-align: center">{{ i + 1 }}</span>
            <div style="flex: 1; display: grid; gap: 6px">
              <input v-model="q.text" class="input" required />
              <textarea v-if="q.type === 'choice'" v-model="q.options" class="input" rows="2" placeholder="خيار في كل سطر" />
            </div>
            <select v-model="q.type" class="input" style="width: 130px"><option value="rating">تقييم 1 إلى 5</option><option value="choice">اختيار</option><option value="text">نص حر</option></select>
            <button type="button" class="btn btn-sm" @click="form.questions.splice(i, 1)">✕</button>
          </div>
        </div>
        <button type="button" class="btn btn-sm" style="margin-top: 8px" @click="form.questions.push({ id: uid(), text: '', type: 'rating', options: '' })">+ سؤال</button>
        <div class="modal-actions"><button class="btn btn-primary">إنشاء</button><button type="button" class="btn" @click="form.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
