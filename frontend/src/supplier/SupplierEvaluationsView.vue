<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { GRADE_COLOR, fmtDate, fmtDateTime } from '../modules/procurement/lib';
import { me, supplierApi } from './supplier';

/** تقييمات الأداء المعتمدة التي شاركتها الشركة، ورد المورد عليها بخطة تحسين (مرة واحدة، لمالك الحساب) */
const rows = ref<any[]>([]);
const error = ref('');
const ok = ref('');
const loading = ref(true);
const busy = ref(false);
const replying = ref<any>(null);
const reply = ref({ response: '', improvementPlan: '' });
const isOwner = computed(() => me.value?.user.role === 'owner');
const pct = (v: number | null) => (v === null || v === undefined ? '—' : `${v}%`);

async function load() {
  try {
    rows.value = await supplierApi('/evaluations');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
function open(e: any) {
  replying.value = e;
  reply.value = { response: '', improvementPlan: '' };
}
async function send() {
  busy.value = true;
  error.value = '';
  try {
    await supplierApi(`/evaluations/${replying.value.id}/respond`, {
      method: 'POST', json: { response: reply.value.response, improvementPlan: reply.value.improvementPlan.trim() || null },
    });
    ok.value = 'وصل ردكم إلى الشركة.';
    replying.value = null;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>تقييم الأداء</h1>
        <p class="muted">تقييمات الشركة لأدائكم: التوريد في الموعد، واكتمال الكميات، والجودة، ومطابقة الفواتير، ومستويات الخدمة. يمكن لمالك الحساب الرد على كل تقييم مرة واحدة بخطة تحسين.</p>
      </div>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="ok" class="alert alert-success">{{ ok }}</div>
    <p v-if="!loading && !rows.length" class="pc-empty card">لا توجد تقييمات بعد.</p>
    <div style="display: grid; gap: 14px">
      <section v-for="e in rows" :key="e.id" class="card pm-panel" :style="{ borderInlineStart: `4px solid ${GRADE_COLOR[e.grade]}` }">
        <div class="pc-inline" style="justify-content: space-between">
          <h2 style="margin: 0">{{ e.code }} · {{ e.kindLabel }}</h2>
          <span class="pm-pill" :style="{ '--c': GRADE_COLOR[e.grade] }">{{ e.total }} · {{ e.gradeLabel }}</span>
        </div>
        <p class="pm-muted" style="font-size: .85rem">الفترة {{ fmtDate(e.periodFrom) }} إلى {{ fmtDate(e.periodTo) }} · اعتُمد {{ fmtDateTime(e.approvedAt) }}</p>
        <table class="pc-lines">
          <thead><tr><th>المعيار</th><th>الوزن</th><th>الدرجة</th><th>ملاحظة</th></tr></thead>
          <tbody><tr v-for="(s, i) in e.scores" :key="i"><td>{{ s.name }}</td><td class="pc-num">{{ s.weight }}%</td><td class="pc-num">{{ s.score }}</td><td class="pm-muted">{{ s.note ?? '' }}</td></tr></tbody>
        </table>
        <p class="pm-muted" style="font-size: .85rem">التوريد في الموعد {{ pct(e.metrics.onTimePct) }} · اكتمال الكميات {{ pct(e.metrics.fillPct) }} · المرفوض في الفحص {{ pct(e.metrics.rejectPct) }}
          · الفواتير المطابقة {{ pct(e.metrics.invoiceOkPct) }} · مستويات الخدمة {{ pct(e.metrics.kpiPct) }}</p>
        <p v-if="e.strengths"><b>نقاط القوة:</b> {{ e.strengths }}</p>
        <p v-if="e.weaknesses"><b>فرص التحسين:</b> {{ e.weaknesses }}</p>
        <div v-if="e.supplierResponse" class="alert alert-success" style="white-space: pre-line">
          <b>ردكم ({{ fmtDateTime(e.responseAt) }}):</b> {{ e.supplierResponse }}<template v-if="e.improvementPlan"><br /><b>خطة التحسين:</b> {{ e.improvementPlan }}</template>
        </div>
        <button v-else-if="isOwner" class="btn" @click="open(e)">الرد على التقييم</button>
      </section>
    </div>

    <div v-if="replying" class="modal-backdrop" @click.self="replying = null">
      <form class="card modal" @submit.prevent="send">
        <h2>الرد على التقييم {{ replying.code }}</h2>
        <p class="pm-muted" style="font-size: .85rem">يُرسل الرد مرة واحدة ولا يغيّر الدرجات، ويطلع عليه فريق المشتريات.</p>
        <label class="field"><span>ردكم</span><textarea v-model="reply.response" class="input" rows="4" required minlength="5" maxlength="4000" /></label>
        <label class="field"><span>خطة التحسين (اختياري)</span><textarea v-model="reply.improvementPlan" class="input" rows="3" maxlength="4000" /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">إرسال</button><button type="button" class="btn" @click="replying = null">رجوع</button></div>
      </form>
    </div>
  </div>
</template>
