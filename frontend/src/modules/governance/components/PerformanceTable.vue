<script setup lang="ts">
import { num, ratio, scoreColor, type PerformanceResult, type SubResult } from '../lib';

/** جدول مؤشرات الأداء المالي: النسبة والدرجة الفعلية والمتوقعة مع موقع النسبة بين حد الدرجة الكاملة وحد الصفر */
const props = defineProps<{ actual: PerformanceResult; forecast?: PerformanceResult | null }>();
const fc = (code: string) => props.forecast?.indicators.flatMap((i) => i.subs).find((s) => s.code === code);
/** موضع المؤشر على المقياس (0–100%) بين حد الدرجة الكاملة وحد الصفر وما بعدهما */
function pos(s: SubResult) {
  if (s.ratio === null || !Number.isFinite(s.ratio)) return s.ratio === Infinity ? 100 : 0;
  const lo = Math.min(s.fullAt, s.zeroAt);
  const hi = Math.max(s.fullAt, s.zeroAt);
  const span = (hi - lo) || 1;
  const min = lo - span * 0.5;
  const max = hi + span * 0.5;
  return Math.max(0, Math.min(100, ((s.ratio - min) / (max - min)) * 100));
}
</script>

<template>
  <div class="gv-fin">
    <div v-for="m in actual.indicators" :key="m.code">
      <div class="gv-sec" style="margin-top: 6px"><span class="gv-code">{{ m.code }}</span> {{ m.title }} · الوزن {{ m.weight }}% · <span :style="{ color: scoreColor(m.score) }">{{ num(m.score) }}%</span></div>
      <div v-for="s in m.subs" :key="s.code" class="gv-sub">
        <div>
          <b>{{ s.title }}</b> <span class="gv-code">{{ s.code }}</span>
          <div class="pm-muted">{{ s.formula }} · الدرجة الكاملة {{ s.better === 'lower' ? 'أقل من' : s.better === 'higher' ? 'أعلى من' : 'عند' }} {{ s.fullAt }}{{ s.unit === '%' ? '%' : ' شهر' }} والصفر عند {{ s.zeroAt }}{{ s.unit === '%' ? '%' : ' شهر' }} · الدليل ص {{ s.page }}</div>
        </div>
        <div>
          <div class="gv-num">{{ ratio(s) }}</div>
          <div :class="['gv-gauge', s.better === 'lower' ? 'lower' : '']"><b :style="{ left: `${pos(s)}%` }" /></div>
        </div>
        <div style="text-align: end">
          <div class="gv-num" :style="{ color: scoreColor(s.score) }">{{ num(s.score) }}%</div>
          <div v-if="forecast && fc(s.code)" class="pm-muted">متوقع {{ num(fc(s.code)!.score) }}%</div>
        </div>
      </div>
    </div>
  </div>
</template>
