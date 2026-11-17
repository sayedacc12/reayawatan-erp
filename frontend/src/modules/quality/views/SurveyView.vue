<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, errMsg, fmtDate, num } from '../lib';
import '../../projects/projects.css';
import '../quality.css';

interface Question { id: string; text: string; type: 'rating' | 'choice' | 'text'; options?: string[] }
interface Analysis extends Question { count: number; average?: number | null; index?: number | null; distribution?: number[]; counts?: { option: string; count: number }[]; comments?: string[] }
interface Survey {
  id: string; title: string; audience: string; audienceLabel: string; description: string | null; formCode: string | null; status: 'draft' | 'open' | 'closed';
  questions: Question[]; targetResponses: number; publicToken: string; responses: number; index: number | null; analysis: Analysis[];
  recent: { id: string; respondentName: string | null; channel: string; score: number | null; createdAt: string }[];
}
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const s = ref<Survey | null>(null);
onMounted(async () => {
  s.value = await api<Survey>(`/quality/surveys/${props.id}`);
});
const can = computed(() => session.can(P.feedback));
const link = computed(() => (s.value ? `${location.origin}/survey/${s.value.publicToken}` : ''));
const STATUS = { draft: { l: 'مسودة', c: '#94a3b8' }, open: { l: 'مفتوحة لاستقبال الردود', c: '#10b981' }, closed: { l: 'مغلقة', c: '#6366f1' } };
const ringColor = (v: number | null | undefined) => (v === null || v === undefined ? '#94a3b8' : v >= 80 ? '#10b981' : v >= 60 ? '#f59e0b' : '#ef4444');
const STAR_COLOR = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981'];

async function setStatus(status: 'draft' | 'open' | 'closed') {
  try {
    s.value = await api<Survey>(`/quality/surveys/${props.id}/status`, { method: 'POST', json: { status } });
    toast.success(status === 'open' ? 'فُتحت الاستبانة، أرسل الرابط للفئة المستهدفة' : 'أُغلقت الاستبانة');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(link.value);
    toast.success('نُسخ الرابط');
  } catch {
    toast.error('تعذر النسخ، انسخ الرابط يدويًا');
  }
}

// إدخال رد يدوي (استبانة ورقية أو هاتفية)
const m = reactive({ show: false, respondentName: '', answers: {} as Record<string, string | number> });
function manual() {
  Object.assign(m, { show: true, respondentName: '', answers: {} });
}
async function saveManual() {
  try {
    s.value = await api<Survey>(`/quality/surveys/${props.id}/responses`, { method: 'POST', json: { answers: m.answers, respondentName: m.respondentName || null } });
    m.show = false;
    toast.success('سُجل الرد');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
const max = (xs: number[]) => Math.max(1, ...xs);
</script>

<template>
  <div v-if="s">
    <section class="pm-hero q-hero">
      <div><p class="pm-kicker">قياس الرضا<template v-if="s.formCode"> · <span class="q-code" style="background: rgba(255,255,255,.12); color: #fcd34d">{{ s.formCode }}</span></template></p><h1>{{ s.title }}</h1>
        <p class="pm-sub">{{ s.audienceLabel }} · {{ STATUS[s.status].l }} · {{ s.responses }} رد من {{ s.targetResponses }} مستهدف</p></div>
      <div v-if="can" class="pm-actions">
        <button v-if="s.status !== 'open'" class="btn q-glow" @click="setStatus('open')">{{ s.status === 'draft' ? 'فتح الاستبانة' : 'إعادة فتحها' }}</button>
        <button v-else class="btn q-ghost" @click="setStatus('closed')">إغلاق الاستبانة</button>
        <button v-if="s.status !== 'draft'" class="btn q-ghost" @click="manual">إدخال رد يدوي</button>
      </div>
    </section>
    <div class="q-grid">
      <section class="card pm-panel">
        <h2>نتائج الأسئلة</h2>
        <div v-for="(q, i) in s.analysis" :key="q.id" style="padding: 12px 0; border-bottom: 1px solid var(--border)">
          <div style="display: flex; justify-content: space-between; gap: 10px; align-items: baseline">
            <b><span class="pm-tag">{{ i + 1 }}</span> {{ q.text }}</b>
            <span v-if="q.type === 'rating'" class="q-num" :style="{ color: ringColor(q.index), fontWeight: 700 }">{{ q.index === null ? '—' : `${num(q.index)}%` }} <small class="pm-muted">متوسط {{ num(q.average ?? null, 2) }} من 5</small></span>
            <span v-else class="pm-muted">{{ q.count }} إجابة</span>
          </div>
          <div v-if="q.type === 'rating'" class="q-dist" style="margin-top: 8px">
            <div v-for="k in [5, 4, 3, 2, 1]" :key="k" class="r"><span>{{ k }} ★</span><i :style="{ width: ((q.distribution![k - 1] / max(q.distribution!)) * 100) + '%', '--c': STAR_COLOR[k - 1] }" /><span class="q-num">{{ q.distribution![k - 1] }}</span></div>
          </div>
          <div v-else-if="q.type === 'choice'" class="q-dist" style="margin-top: 8px">
            <div v-for="o in q.counts" :key="o.option" class="r" style="grid-template-columns: 140px 1fr 30px"><span>{{ o.option }}</span><i :style="{ width: (o.count / max(q.counts!.map((x) => x.count))) * 100 + '%' }" /><span class="q-num">{{ o.count }}</span></div>
          </div>
          <ul v-else style="margin: 8px 0 0; padding-inline-start: 18px">
            <li v-for="(c, k) in q.comments" :key="k" class="pm-muted">{{ c }}</li>
            <li v-if="!q.comments?.length" class="pm-muted">لا توجد تعليقات</li>
          </ul>
        </div>
      </section>
      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel" style="text-align: center">
          <h2>مؤشر الرضا</h2>
          <div class="q-ring" :style="{ '--v': s.index ?? 0, '--c': ringColor(s.index) }"><div><b>{{ s.index === null ? '—' : `${num(s.index)}%` }}</b><small>{{ s.responses }} رد</small></div></div>
          <p class="pm-muted">يُحسب من أسئلة التقييم: 1 = 0% و5 = 100%</p>
        </section>
        <section class="card pm-panel">
          <h2>رابط الاستبانة</h2>
          <p class="pm-muted">أرسله برسالة نصية أو واتساب أو ضعه في رمز QR. لا يحتاج المستجيب لتسجيل الدخول.</p>
          <input :value="link" class="input" dir="ltr" readonly @focus="($event.target as HTMLInputElement).select()" />
          <div style="display: flex; gap: 6px; margin-top: 8px"><button class="btn btn-sm btn-primary" @click="copy">نسخ الرابط</button><a :href="link" target="_blank" class="btn btn-sm">معاينة</a></div>
          <p v-if="s.status !== 'open'" class="q-warn" style="margin: 10px 0 0">الرابط لا يستقبل ردودًا حتى تُفتح الاستبانة.</p>
        </section>
        <section class="card pm-panel">
          <h2>آخر الردود</h2>
          <div v-for="r in s.recent" :key="r.id" style="display: flex; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border)">
            <span>{{ r.respondentName ?? 'بدون اسم' }} <small class="pm-muted">{{ r.channel === 'link' ? 'عبر الرابط' : 'إدخال يدوي' }} · {{ fmtDate(r.createdAt) }}</small></span>
            <b class="q-num" :style="{ color: ringColor(r.score) }">{{ r.score === null ? '—' : `${Math.round(r.score)}%` }}</b>
          </div>
          <p v-if="!s.recent.length" class="pm-muted">لا توجد ردود بعد</p>
        </section>
      </div>
    </div>

    <div v-if="m.show" class="modal-backdrop" @click.self="m.show = false">
      <form class="card modal" style="max-width: 640px" @submit.prevent="saveManual">
        <h2>إدخال رد يدوي</h2>
        <label class="field"><span>اسم المستجيب (اختياري)</span><input v-model="m.respondentName" class="input" /></label>
        <div v-for="(q, i) in s.questions" :key="q.id" class="field">
          <span>{{ i + 1 }}. {{ q.text }}</span>
          <div v-if="q.type === 'rating'" class="q-stars"><button v-for="n in 5" :key="n" type="button" :class="{ on: Number(m.answers[q.id] ?? 0) >= n }" @click="m.answers[q.id] = n">{{ n }}</button></div>
          <select v-else-if="q.type === 'choice'" v-model="m.answers[q.id]" class="input"><option value="">—</option><option v-for="o in q.options" :key="o" :value="o">{{ o }}</option></select>
          <textarea v-else v-model="m.answers[q.id]" class="input" rows="2" />
        </div>
        <div class="modal-actions"><button class="btn btn-primary">حفظ الرد</button><button type="button" class="btn" @click="m.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
