<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import Rich from '../Rich.vue';
import Shift from '../Shift.vue';
import StageTag from '../StageTag.vue';
import VisitorFields from '../VisitorFields.vue';
import { blankVisitor, leafRing, LEAFP, setTitle, visitorBody } from '../parts';
import { AR, bySlug, C, fmt, handoff, post, services, visitMeta } from '../site';

/** الصفحة الرئيسية: المحتوى من لوحة التحكم، والحاسبة ترسل نتيجتها للنظام كعميل محتمل */
const router = useRouter();
const h = computed(() => C().home ?? {});
const svcs = computed(() => services());
onMounted(() => setTitle());

const rings = [
  { cls: 'o3', items: leafRing(190, 14, 1.05) },
  { cls: 'o2', items: leafRing(135, 10, 0.95) },
  { cls: 'o1', items: leafRing(82, 7, 0.85) },
];

// ---------- مضاعف الأثر ----------
const budget = ref(3_000_000);
const cost = ref(1500);
const eff = ref(10);
const calc = computed(() => {
  const now = budget.value / cost.value;
  const save = (budget.value * eff.value) / 100;
  const add = save / cost.value;
  return { now, save, add, bar: Math.min(100, ((100 * add) / (now + add)) * 4) };
});
const calcInput = () => ({ budget: budget.value, cost: cost.value, efficiency: eff.value });
const calcMessage = () => `استخدمنا حاسبة مضاعف الأثر: ميزانية برامجنا ${fmt(budget.value)} ر.س وتكلفة المستفيد ${fmt(cost.value)} ر.س. نرغب في مناقشة كيف نرفع كفاءتنا ${AR(eff.value)}٪ لخدمة نحو ${fmt(calc.value.add)} مستفيد إضافي.`;
function discuss() {
  Object.assign(handoff, { message: calcMessage(), service: '', calculator: calcInput(), assessment: null });
  router.push('/book');
}
const sendOpen = ref(false);
const visitor = reactive(blankVisitor());
const sending = ref(false);
const sent = ref(false);
const sendErr = ref('');
async function sendResult() {
  sendErr.value = '';
  sending.value = true;
  try {
    await post('/leads', { ...visitorBody(visitor), ...visitMeta(), source: 'calculator', calculator: calcInput() });
    sent.value = true;
  } catch (e) {
    sendErr.value = (e as Error).message;
  } finally {
    sending.value = false;
  }
}

// ---------- عجلة المجالات ----------
const sel = ref(0);
const cur = computed(() => svcs.value[sel.value] ?? svcs.value[0]);
</script>

<template>
  <section class="hero hero-x"><div class="wrap">
    <div class="hx-copy">
      <p class="eyebrow">{{ h.eyebrow }}</p>
      <h1>{{ h.title }}<br><em>{{ h.titleEm }}</em></h1>
      <p class="lead"><Rich :text="h.lead" /></p>
      <div class="actions">
        <RouterLink class="btn btn-primary btn-lg" to="/book">احجز جلسة تشخيص مجانية</RouterLink>
        <RouterLink class="btn btn-ghost-light btn-lg" to="/assess">قيّم جاهزية منظمتك في ٣ دقائق</RouterLink>
      </div>
      <ul class="hx-proof"><li v-for="(p, i) in h.proof" :key="i"><b>{{ p.n }}</b><span>{{ p.label }}</span></li></ul>
    </div>
    <figure class="rings" :aria-label="`دوائر الأثر: ${(h.rings ?? []).join('، ')}`">
      <svg viewBox="-200 -200 400 400" role="img" aria-hidden="true">
        <circle r="190" class="ring r3" /><circle r="135" class="ring r2" /><circle r="82" class="ring r1" />
        <g v-for="r in rings" :key="r.cls" :class="['orbit', r.cls]"><path v-for="(l, i) in r.items" :key="i" :class="['lf', { br: l.br }]" :d="LEAFP" :transform="l.t" /></g>
        <path class="core" d="M0 -34 C24 -18 24 18 0 34 C-24 18 -24 -18 0 -34Z" transform="rotate(35)" />
        <path d="M0 -26 L0 26" transform="rotate(35)" stroke="#fff" stroke-width="2" opacity=".7" />
      </svg>
      <figcaption><span v-for="(r, i) in h.rings" :key="i" :class="['rl', `l${i}`]">{{ r }}</span></figcaption>
    </figure>
  </div></section>

  <section class="band story"><div class="wrap">
    <div class="sec-head"><p class="eyebrow">{{ h.storyEyebrow }}</p><h2>{{ h.storyTitle }}</h2><p class="lead"><Rich :text="h.storyLead" /></p></div>
    <ol class="chapters">
      <li v-for="(ch, i) in h.chapters" :key="i" :class="{ 'ch-final': i === h.chapters.length - 1 }">
        <span class="ch-n">{{ AR(i + 1) }}</span>
        <div>
          <p class="ch-tag">{{ ch.tag }}</p><h3>{{ ch.title }}</h3><p><Rich :text="ch.text" /></p>
          <div v-if="ch.links?.some((k: string) => bySlug(k))" class="ch-links">
            <template v-for="k in ch.links" :key="k"><RouterLink v-if="bySlug(k)" :to="`/services/${k}`">{{ bySlug(k)!.title }}</RouterLink></template>
          </div>
        </div>
      </li>
    </ol>
  </div></section>

  <section class="band calc-band"><div class="wrap calc">
    <div class="calc-copy">
      <p class="eyebrow">{{ h.calcEyebrow }}</p>
      <h2>{{ h.calcTitle }}</h2>
      <p class="lead">{{ h.calcLead }}</p>
      <div class="field"><label for="c-budget">ميزانية البرامج السنوية <output>{{ fmt(budget) }} ر.س</output></label><input id="c-budget" v-model.number="budget" type="range" min="250000" max="20000000" step="250000"></div>
      <div class="field"><label for="c-cost">تكلفة خدمة المستفيد الواحد سنوياً <output>{{ fmt(cost) }} ر.س</output></label><input id="c-cost" v-model.number="cost" type="range" min="100" max="10000" step="100"></div>
      <div class="field"><span class="lbl">نسبة تحسن الكفاءة المتوقعة</span>
        <div class="seg" role="radiogroup" aria-label="نسبة تحسن الكفاءة"><button v-for="v in [5, 10, 15, 20]" :key="v" type="button" role="radio" :aria-checked="v === eff" @click="eff = v">{{ AR(v) }}٪</button></div>
      </div>
    </div>
    <div class="calc-out" aria-live="polite">
      <div class="co-row"><span>تخدمون اليوم تقريباً</span><b>{{ fmt(calc.now) }}</b><small>مستفيد</small></div>
      <div class="co-row"><span>وفر سنوي متوقع</span><b>{{ fmt(calc.save) }}</b><small>ر.س</small></div>
      <div class="co-big"><span>مستفيدون إضافيون كل عام بنفس الميزانية</span><b>{{ fmt(calc.add) }}</b></div>
      <div class="co-bar"><i :style="{ width: `${calc.bar}%` }" /></div>
      <p class="note">{{ h.calcNote }}</p>
      <button class="btn btn-primary" type="button" @click="discuss">ناقشوا هذا الرقم معنا</button>
      <button v-if="!sendOpen && !sent" class="btn-link" type="button" @click="sendOpen = true">أرسلوا النتيجة إلى بريدي</button>
      <div v-if="sent" class="ok-box" role="status">أرسلنا النتيجة، وسيتواصل معكم أحد مستشارينا لمناقشتها.</div>
      <form v-else-if="sendOpen" class="mini" @submit.prevent="sendResult">
        <VisitorFields :model-value="visitor" idp="calc" />
        <p v-if="sendErr" class="err">{{ sendErr }}</p>
        <button class="btn btn-primary" type="submit" :disabled="sending">{{ sending ? 'جارٍ الإرسال…' : 'إرسال النتيجة' }}</button>
      </form>
    </div>
  </div></section>

  <section class="band"><div class="wrap">
    <div class="sec-head"><p class="eyebrow">{{ h.wheelEyebrow }}</p><h2>{{ h.wheelTitle }}</h2><p class="lead">{{ h.wheelLead }}</p></div>
    <div class="wheel-wrap">
      <div class="wheel" role="tablist" aria-label="مجالات الخدمة">
        <div class="wheel-hub"><img class="lg-dark" src="/brand/mark.png" alt=""><img class="lg-light" src="/brand/mark-light.png" alt=""></div>
        <button v-for="(s, i) in svcs" :key="s.slug" class="wnode" role="tab" :style="{ '--a': `${(i / svcs.length) * 360}deg` }" :aria-selected="i === sel" @click="sel = i">
          <span class="wn-n">{{ AR(i + 1) }}</span><span class="wn-t">{{ s.title }}</span>
        </button>
      </div>
      <div v-if="cur" class="wheel-panel" role="tabpanel">
        <StageTag :s="cur" />
        <h3>{{ cur.title }}</h3>
        <p class="vb-value">{{ cur.value }}</p>
        <Shift v-for="(x, i) in cur.shifts" :key="i" :from="x.from" :to="x.to" />
        <p class="note">نقيس: {{ cur.kpis.join('، ') }}.</p>
        <RouterLink class="btn btn-primary" :to="`/services/${cur.slug}`">القيمة والمؤشرات بالتفصيل</RouterLink>
      </div>
    </div>
  </div></section>

  <section class="band alt"><div class="wrap">
    <div class="sec-head"><p class="eyebrow">{{ h.dualEyebrow }}</p><h2>{{ h.dualTitle }}</h2></div>
    <div class="flow">
      <div v-for="(d, i) in h.dual" :key="i" class="flow-track"><span class="flow-label">{{ d.label }}</span>
        <div class="flow-steps"><template v-for="(st, j) in d.steps" :key="j"><i v-if="j" aria-hidden="true">←</i><div :class="{ hl: j === d.steps.length - 1 }">{{ st }}</div></template></div>
      </div>
    </div>
  </div></section>

  <section class="band logo-story"><div class="wrap ls">
    <div class="ls-mark"><img class="lg-dark" src="/brand/mark.png" alt="أوراق شعار رعاية وطن"><img class="lg-light" src="/brand/mark-light.png" alt="أوراق شعار رعاية وطن"></div>
    <div class="prose">
      <p class="eyebrow">{{ h.logoEyebrow }}</p>
      <h2>{{ h.logoTitle }}</h2>
      <p><Rich :text="h.logoText" /></p>
      <p v-if="h.logoNote" class="note"><Rich :text="h.logoNote" /></p>
    </div>
  </div></section>

  <section class="band alt"><div class="wrap">
    <div class="sec-head"><p class="eyebrow">{{ h.commitEyebrow }}</p><h2>{{ h.commitTitle }}</h2></div>
    <ol class="steps"><li v-for="(c, i) in h.commitments" :key="i"><h3>{{ c.title }}</h3><p><Rich :text="c.text" /></p></li></ol>
  </div></section>

  <section class="band"><div class="wrap">
    <div class="sec-head"><p class="eyebrow">{{ h.kpiEyebrow }}</p><h2>{{ h.kpiTitle }}</h2><p class="lead"><Rich :text="h.kpiLead" /></p></div>
    <div class="kpis"><div v-for="(k, i) in h.kpis" :key="i"><span class="kv-num"><Rich :text="k.value" /></span><span class="kv-lbl">{{ k.label }}</span></div></div>
  </div></section>

  <section class="final-cta"><div class="wrap">
    <h2>{{ h.finalTitle }}</h2>
    <p>{{ h.finalText }}</p>
    <div class="fc-grid four">
      <RouterLink to="/assess"><b>قيّموا جاهزيتكم</b><span>سبعة أسئلة تكشف أين تضيف لكم القيمة أكثر.</span><i>ابدأ التقييم ←</i></RouterLink>
      <RouterLink to="/book"><b>جلسة تشخيص مجانية</b><span>اختاروا موعدًا مناسبًا مع أحد مستشارينا.</span><i>احجز الجلسة ←</i></RouterLink>
      <RouterLink to="/guides"><b>أدلة مجانية</b><span>أدلة عملية مختصرة في مجالات عمل المنظمة.</span><i>تصفح الأدلة ←</i></RouterLink>
      <RouterLink to="/contact"><b>تحدثوا معنا مباشرة</b><span>واتساب الأعمال: <Rich :text="C().contact?.whatsapp" /></span><i>تواصل معنا ←</i></RouterLink>
    </div>
  </div></section>
</template>
