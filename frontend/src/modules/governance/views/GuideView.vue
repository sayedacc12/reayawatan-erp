<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { loadCatalog, METHOD, type Catalog } from '../lib';
import '../../projects/projects.css';
import '../gov.css';

interface Band { from: number | null; to: number | null; rule: string }
interface PerfSub { code: string; title: string; weight: number; formula: string; unit: string; fullAt: number; zeroAt: number; bands: Band[]; page: number }
const cat = ref<(Catalog & { performance: { code: string; title: string; weight: number; subs: PerfSub[] }[] }) | null>(null);
const tab = ref<string>('rules');
const q = ref('');
onMounted(async () => {
  cat.value = (await loadCatalog()) as typeof cat.value;
});
const std = computed(() => cat.value?.standards.find((s) => s.code === tab.value));
const match = (t: string) => !q.value.trim() || t.includes(q.value.trim());
</script>

<template>
  <div v-if="cat">
    <section class="pm-hero gv-hero">
      <div>
        <p class="pm-kicker">دليل التقييم</p>
        <h1>قواعد التقييم كما وردت في أدلة المركز الوطني</h1>
        <p class="pm-sub">أدلة حوكمة الجمعيات الأهلية الصادرة عن المركز الوطني لتنمية القطاع غير الربحي: معيار الامتثال والالتزام، ومعيار الشفافية والإفصاح، ومعيار السلامة المالية. كل بطاقة بأسئلتها وحالاتها ونسبها وشواهدها.</p>
      </div>
    </section>
    <div class="gv-tabs">
      <button :class="['gv-tab', { on: tab === 'rules' }]" @click="tab = 'rules'">قواعد الحساب</button>
      <button v-for="s in cat.standards" :key="s.code" :class="['gv-tab', { on: tab === s.code }]" @click="tab = s.code">{{ s.title }}<b>{{ cat.stats[s.code]?.practices }}</b></button>
      <button :class="['gv-tab', { on: tab === 'FIN' }]" @click="tab = 'FIN'">مؤشرات الأداء المالي<b>11</b></button>
    </div>

    <section v-if="tab === 'rules'" class="card pm-panel" style="line-height: 2">
      <h2>كيف تُحسب درجة الحوكمة</h2>
      <ol style="margin: 0; padding-inline-start: 20px">
        <li>الدرجة الكلية = الامتثال والالتزام × 40% + الشفافية والإفصاح × 20% + السلامة المالية × 40%.</li>
        <li>السلامة المالية = مؤشرات الأداء المالي × 50% + التنظيم المالي × 50%.</li>
        <li>درجة الأداء المالي تُضرب في معامل رأي المحاسب القانوني: الرأي المطلق 100%، والمتحفظ يخصم 10% عن كل بند تحفظ، والمعارض والامتناع وعدم إصدار القوائم صفر.</li>
        <li>كل معيار مقسم إلى مؤشرات بأوزان، وكل مؤشر إلى ممارسات (بطاقات)، وكل بطاقة إلى بنود بدرجات مجموعها وزن المؤشر.</li>
        <li>درجة البند = درجته × نسبة الحالة المختارة (100% أو نسبة جزئية أو صفر). وخيار «يتم الانتقال إلى السؤال التالي» يحيل النسبة إلى السؤال الذي بعده.</li>
        <li>البند غير المجاب عليه يُحسب صفراً في الدرجة الحالية، ويُكمَل في الدرجة المتوقعة من آخر تقييم معتمد أو من الإشارات الآلية للأنظمة.</li>
        <li>أثر فرصة التحسين = الدرجة المفقودة × وزن معيارها في الدرجة الكلية (الامتثال 0.4، الشفافية 0.2، التنظيم المالي 0.2، الأداء المالي 0.2).</li>
      </ol>
      <div class="gv-sec">التقدير</div>
      <div class="pm-legend"><span v-for="g in [['ممتاز', '90 فأكثر'], ['جيد جداً', '80 – 89'], ['جيد', '70 – 79'], ['متوسط', '50 – 69'], ['ضعيف', 'أقل من 50']]" :key="g[0]">{{ g[0] }}: {{ g[1] }}</span></div>
      <div class="gv-sec">عدد البنود</div>
      <table class="table">
        <thead><tr><th>المعيار</th><th>المؤشرات</th><th>الممارسات</th><th>البنود</th><th>الأسئلة</th></tr></thead>
        <tbody><tr v-for="s in cat.standards" :key="s.code"><td>{{ s.title }}</td><td>{{ cat.stats[s.code]?.indicators }}</td><td>{{ cat.stats[s.code]?.practices }}</td><td>{{ cat.stats[s.code]?.items }}</td><td>{{ cat.stats[s.code]?.questions }}</td></tr></tbody>
      </table>
    </section>

    <template v-else-if="std">
      <div class="pm-filters"><input v-model="q" class="input" placeholder="بحث في الممارسات…" /><span class="pm-muted">{{ std.source }}</span></div>
      <details v-for="ind in std.indicators" :key="ind.code" class="gv-ind">
        <summary><span><span class="gv-code">{{ ind.code }}</span> <b>{{ ind.title }}</b> <span class="pm-muted">· {{ ind.domain }}</span></span><span class="pm-muted">الوزن {{ ind.weight }}%</span><span class="pm-muted">{{ ind.practices.length }} ممارسة</span></summary>
        <div class="body">
          <article v-for="p in ind.practices.filter((x) => match(x.title + x.requirement))" :key="p.code" class="gv-prac">
            <header><h3><span class="gv-code">{{ p.code }}</span> {{ p.title }}</h3><span class="pm-muted">بطاقة {{ p.no }}</span></header>
            <p style="margin: 0 0 6px">{{ p.requirement }}</p>
            <p v-if="p.refs?.length" class="pm-muted" style="margin: 0">المصدر: {{ p.refs.join('، ') }}</p>
            <div v-for="it in p.items" :key="it.code" class="gv-item">
              <div class="hd"><span class="gv-code">{{ it.code }}</span><span class="pm-muted">الدرجة {{ it.points }}</span></div>
              <div v-for="(s, i) in it.steps" :key="i" class="gv-step">
                <div class="q">{{ s.q }} <span class="pm-muted">({{ METHOD[s.m] }})</span></div>
                <div v-if="s.ev.length" class="ev">التحقق: {{ s.ev.join('، ') }}</div>
                <div class="gv-opts"><span v-for="(o, j) in s.o" :key="j" class="gv-opt" style="cursor: default; --c: var(--border)">{{ o[0] }}<i>{{ o[1] === null ? 'السؤال التالي' : `${o[1]}%` }}</i></span></div>
              </div>
            </div>
            <template v-if="p.activities.length"><div class="gv-sec">الأنشطة المقترحة</div><ul class="pm-muted" style="margin: 0; padding-inline-start: 18px"><li v-for="(a, i) in p.activities" :key="i">{{ a }}</li></ul></template>
            <template v-if="p.evidence.length"><div class="gv-sec">الشواهد</div><p class="pm-muted" style="margin: 0">{{ p.evidence.join('، ') }}</p></template>
          </article>
        </div>
      </details>
    </template>

    <template v-else-if="tab === 'FIN'">
      <section v-for="m in cat.performance" :key="m.code" class="card pm-panel" style="margin-bottom: 12px">
        <h2><span><span class="gv-code">{{ m.code }}</span> {{ m.title }}</span><span class="pm-muted">الوزن {{ m.weight }}%</span></h2>
        <div v-for="s in m.subs" :key="s.code" class="gv-prac" style="margin-bottom: 10px">
          <header><h3><span class="gv-code">{{ s.code }}</span> {{ s.title }}</h3><span class="pm-muted">الوزن {{ s.weight }}% · الدليل ص {{ s.page }}</span></header>
          <p style="margin: 0 0 6px">{{ s.formula }}</p>
          <ul class="pm-muted" style="margin: 0; padding-inline-start: 18px"><li v-for="(b, i) in s.bands" :key="i">{{ b.rule }}</li></ul>
        </div>
      </section>
    </template>
  </div>
</template>
