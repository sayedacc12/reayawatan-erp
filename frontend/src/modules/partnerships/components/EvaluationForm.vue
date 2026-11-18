<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { SCALE, lookups } from '../lib';
import ScoreRing from './ScoreRing.vue';

/** تقييم الشريك وفق معايير الاختيار الموزونة، مع حساب مباشر للدرجة والمستوى */
const props = defineProps<{ partner: any; evaluation?: any }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const toast = useToast();
const lk = ref<any>(null);
const busy = ref(false);
const ev = props.evaluation;
const typeId = ref<string>(ev?.typeId ?? props.partner.typeIds[0] ?? '');
const recommendation = ref<string>(ev?.recommendation ?? '');
const scores = reactive<Record<string, { score: number; note: string }>>({});

onMounted(async () => {
  lk.value = await lookups();
  for (const c of criteria.value) {
    const old = ev?.scores.find((s: any) => s.criterionId === c.id);
    scores[c.id] = { score: old?.score ?? 0, note: old?.note ?? '' };
  }
  if (!typeId.value) typeId.value = lk.value.types.find((t: any) => t.isActive)?.id ?? '';
});
const criteria = computed<any[]>(() => (lk.value?.criteria ?? []).filter((c: any) => c.isActive));
const type = computed(() => lk.value?.types.find((t: any) => t.id === typeId.value));
const total = computed(() => {
  const w = criteria.value.reduce((a, c) => a + c.weight, 0) || 1;
  return Math.round(criteria.value.reduce((a, c) => a + (c.weight * (scores[c.id]?.score ?? 0)) / 5, 0) * (100 / w) * 100) / 100;
});
const done = computed(() => criteria.value.filter((c) => scores[c.id]?.score).length);
const knockout = computed(() => criteria.value.filter((c) => c.knockout && scores[c.id]?.score === 1));
const tier = computed(() => (knockout.value.length ? null : [...(lk.value?.tiers ?? [])].sort((a: any, b: any) => b.min - a.min).find((t: any) => total.value >= t.min) ?? null));
const meets = computed(() => !knockout.value.length && type.value && total.value >= type.value.minScore);

async function save(submit: boolean) {
  if (submit && done.value < criteria.value.length) return toast.error('قيّم كل المعايير قبل الرفع للاعتماد');
  busy.value = true;
  try {
    const body = {
      typeId: typeId.value, recommendation: recommendation.value || null, submit,
      scores: criteria.value.filter((c) => scores[c.id].score).map((c) => ({ criterionId: c.id, score: scores[c.id].score, note: scores[c.id].note || null })),
    };
    const base = `/partnerships/partners/${props.partner.id}/evaluations`;
    await api(ev ? `${base}/${ev.id}` : base, { method: ev ? 'PUT' : 'POST', json: body });
    toast.success(submit ? 'رُفع التقييم للاعتماد' : 'حُفظت مسودة التقييم');
    emit('saved');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="card modal pt-modal-wide ev">
      <header class="ev-head">
        <div>
          <p class="pm-muted" style="margin: 0">تقييم اختيار الشريك</p>
          <h2>{{ partner.name }}</h2>
          <div class="field" style="margin: 8px 0 0; max-width: 320px">
            <label>نوع الشراكة المقيَّم لها</label>
            <select v-model="typeId" class="input"><option v-for="t in lk?.types.filter((x: any) => x.isActive) ?? []" :key="t.id" :value="t.id">{{ t.name }} (الحد الأدنى {{ t.minScore }})</option></select>
          </div>
        </div>
        <div class="live">
          <ScoreRing :score="total" :color="tier?.color ?? (knockout.length ? '#dc2626' : '#94a3b8')" :size="112" />
          <div>
            <span v-if="tier" class="pt-tier" :style="{ '--c': tier.color }">{{ tier.label }}</span>
            <span v-else class="pt-flag">{{ knockout.length ? 'لم يجتز معيارًا حاسمًا' : 'دون المستويات' }}</span>
            <p class="pm-muted" style="margin: 6px 0 0">{{ done }} من {{ criteria.length }} معايير</p>
            <span v-if="done === criteria.length" :class="meets ? 'pt-okflag' : 'pt-flag'">{{ meets ? '✓ يجتاز قواعد القبول' : '✕ لا يجتاز قواعد القبول' }}</span>
          </div>
        </div>
      </header>

      <div class="crit-list">
        <div v-for="(c, i) in criteria" :key="c.id" :class="['crit', { ko: c.knockout && scores[c.id]?.score === 1 }]" :style="{ '--i': i }">
          <div class="crit-top">
            <div>
              <b>{{ c.name }}</b>
              <span class="w">{{ c.weight }}%</span>
              <span v-if="c.knockout" class="pt-chip" style="--c: #dc2626" title="درجة 1 في هذا المعيار تستبعد الشريك">معيار حاسم</span>
              <p v-if="c.guide" class="pm-muted" style="margin: 2px 0 0">{{ c.guide }}</p>
            </div>
            <div v-if="scores[c.id]" class="scale">
              <button v-for="s in SCALE" :key="s.v" type="button" :class="{ on: scores[c.id].score === s.v }" :title="s.label" @click="scores[c.id].score = s.v">{{ s.v }}</button>
            </div>
          </div>
          <input v-if="scores[c.id]" v-model="scores[c.id].note" class="input note" placeholder="مبرر الدرجة أو الشاهد (اختياري)" />
        </div>
      </div>
      <div class="field"><label>توصية المقيّم</label><textarea v-model="recommendation" class="input" rows="3" placeholder="خلاصة التقييم وما يوصى به" /></div>
      <p v-if="knockout.length" class="alert alert-error" style="margin: 0 0 10px">الشريك حصل على 1 في معيار حاسم ({{ knockout.map((k) => k.name).join('، ') }}). يمكن رفع التقييم، والمعتمد يقرر مع كتابة السبب.</p>
      <div class="modal-actions">
        <button class="btn btn-primary" :disabled="busy || !typeId" @click="save(true)">رفع للاعتماد</button>
        <button class="btn" :disabled="busy || !typeId" @click="save(false)">حفظ مسودة</button>
        <button class="btn" @click="emit('close')">إلغاء</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ev-head { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: flex-start; margin-bottom: 12px; }
.live { display: flex; gap: 12px; align-items: center; background: var(--surface-2); border-radius: 16px; padding: 10px 14px; }
.crit-list { display: grid; gap: 8px; margin-bottom: 12px; }
.crit { border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; animation: pm-rise .35s calc(var(--i) * 40ms) var(--ease) both; transition: border-color .2s, background .2s; }
.crit.ko { border-color: #fca5a5; background: #fff5f5; }
.crit-top { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; flex-wrap: wrap; }
.w { display: inline-block; margin: 0 6px; font-size: .74rem; font-weight: 700; color: #b45309; background: #fef3c7; border-radius: 6px; padding: 0 6px; }
.scale { display: flex; gap: 4px; }
.scale button { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); font: inherit; font-weight: 700; cursor: pointer; color: var(--muted); transition: all .15s; }
.scale button:hover { border-color: #f59e0b; color: #b45309; }
.scale button.on { background: linear-gradient(135deg, #f59e0b, #0f766e); color: #fff; border-color: transparent; transform: scale(1.08); box-shadow: 0 4px 12px rgba(245,158,11,.35); }
.note { margin-top: 6px; font-size: .85rem; padding: 6px 10px; }
</style>
