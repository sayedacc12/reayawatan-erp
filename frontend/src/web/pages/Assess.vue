<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import PageHead from '../PageHead.vue';
import Rich from '../Rich.vue';
import VisitorFields from '../VisitorFields.vue';
import { blankVisitor, setTitle, visitorBody } from '../parts';
import { AR, bySlug, C, handoff, post, visitMeta } from '../site';

/** تقييم الجاهزية: الأسئلة من لوحة التحكم، والنتيجة تُحسب هنا للعرض ويعيد الخادم حسابها عند الإرسال */
const router = useRouter();
const cfg = computed(() => C().assessment ?? { questions: [], options: [] });
const questions = computed<{ service: string; text: string }[]>(() => cfg.value.questions ?? []);
const answers = ref<(number | null)[]>([]);
onMounted(() => { setTitle('قيّم جاهزية منظمتك'); answers.value = questions.value.map(() => null); });

const done = computed(() => questions.value.length > 0 && answers.value.length === questions.value.length && answers.value.every((v) => v !== null));
const score = computed(() => (done.value ? Math.round(((answers.value as number[]).reduce((a, v) => a + v, 0) / (questions.value.length * 2)) * 100) : null));
const gaps = computed(() => answers.value.map((v, i) => ({ v: v ?? 2, i })).filter((x) => x.v < 2).sort((a, b) => a.v - b.v || a.i - b.i).slice(0, 3)
  .map((x) => bySlug(questions.value[x.i].service)).filter((s): s is NonNullable<typeof s> => !!s));
const label = (q: { service: string }) => bySlug(q.service)?.title ?? q.service;
const stage = (q: { service: string }) => bySlug(q.service)?.stage ?? '';

function book() {
  Object.assign(handoff, {
    message: `أكملنا تقييم الجاهزية وكانت النتيجة ${AR(score.value ?? 0)} من ١٠٠. المجالات الأضعف: ${gaps.value.map((s) => s.title).join('، ') || 'لا يوجد'}. نرغب في جلسة لمناقشة النتيجة.`,
    service: gaps.value[0]?.slug ?? '', calculator: null, assessment: { answers: [...answers.value] },
  });
  router.push('/book');
}

const sendOpen = ref(false);
const visitor = reactive(blankVisitor());
const sending = ref(false);
const sent = ref(false);
const sendErr = ref('');
async function send() {
  sendErr.value = '';
  sending.value = true;
  try {
    await post('/leads', { ...visitorBody(visitor), ...visitMeta(), source: 'assessment', serviceSlug: gaps.value[0]?.slug, assessment: { answers: answers.value } });
    sent.value = true;
  } catch (e) {
    sendErr.value = (e as Error).message;
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <PageHead title="قيّم جاهزية منظمتك" :lead="cfg.lead" :crumbs="[{ l: 'قيّم جاهزيتك' }]" />
  <section class="band"><div class="wrap assess">
    <form class="aq-list" @submit.prevent>
      <fieldset v-for="(q, i) in questions" :key="i" class="aq">
        <legend><span class="stage"><b>{{ AR(i + 1) }}</b>{{ stage(q) }}</span><span class="aq-q">{{ q.text }}</span></legend>
        <div class="aq-opts"><label v-for="(o, v) in cfg.options" :key="v"><input v-model="answers[i]" type="radio" :name="`q${i}`" :value="2 - v"><span>{{ o }}</span></label></div>
      </fieldset>
      <p v-if="!done" class="note">أجيبوا عن الأسئلة لتظهر النتيجة.</p>
    </form>
    <aside class="aq-result" aria-live="polite">
      <h3>نتيجتكم</h3>
      <div class="aq-score"><b>{{ score === null ? '—' : AR(score) }}</b><span>من ١٠٠</span></div>
      <ul class="aq-bars"><li v-for="(q, i) in questions" :key="i"><span>{{ label(q) }}</span><i><em :data-v="answers[i] ?? undefined" :style="{ width: answers[i] == null ? '0' : `${25 + (answers[i] as number) * 37.5}%` }" /></i></li></ul>
      <template v-if="done">
        <div v-if="gaps.length"><p class="aq-rec-h">أين نضيف لكم القيمة أكثر</p><ul class="checklist"><li v-for="s in gaps" :key="s.slug"><RouterLink :to="`/services/${s.slug}`">{{ s.title }}</RouterLink>: {{ s.value }}</li></ul></div>
        <p v-else class="aq-rec-h"><Rich :text="cfg.advancedText" /></p>
        <button class="btn btn-primary" type="button" @click="book">احجز جلسة لمناقشة النتيجة</button>
        <button v-if="!sendOpen && !sent" class="btn-link" type="button" @click="sendOpen = true">أرسلوا النتيجة إلى بريدي</button>
        <div v-if="sent" class="ok-box" role="status">أرسلنا النتيجة إلى بريدكم، وسيتواصل معكم أحد مستشارينا لمناقشتها.</div>
        <form v-else-if="sendOpen" class="mini" @submit.prevent="send">
          <VisitorFields :model-value="visitor" idp="aq" />
          <p v-if="sendErr" class="err">{{ sendErr }}</p>
          <button class="btn btn-primary" type="submit" :disabled="sending">{{ sending ? 'جارٍ الإرسال…' : 'إرسال النتيجة' }}</button>
        </form>
      </template>
    </aside>
  </div></section>
</template>
