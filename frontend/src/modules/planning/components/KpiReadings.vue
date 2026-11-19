<script setup lang="ts">
import { computed, reactive } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { BAND, errMsg, num, P, periodLabel, periodsOf, todayStr } from '../lib';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** تسجيل القراءات الفعلية لمؤشر لكل فترة، مع المستهدف ونسبة التحقق لكل سنة */
const props = defineProps<{ kpi: any; plan: { id: string; startYear: number; endYear: number; version: number } }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', v: any): void }>();
const session = useSession();
const toast = useToast();
const now = todayStr();
const rows = computed(() => {
  const out: { period: string; target: number | null; future: boolean }[] = [];
  for (let y = props.plan.startYear; y <= props.plan.endYear; y++) {
    for (const p of periodsOf(y, props.kpi.frequency)) out.push({ period: p, target: props.kpi.targets[p] ?? (p.length === 4 ? props.kpi.targets[p] : null) ?? null, future: p > now.slice(0, p.length) && y > Number(now.slice(0, 4)) });
  }
  return out;
});
const draft = reactive<Record<string, { value: any; note: string }>>(Object.fromEntries(rows.value.map((r) => {
  const x = props.kpi.stat?.readings.find((z: any) => z.period === r.period);
  return [r.period, { value: x?.value ?? '', note: x?.note ?? '' }];
})));
const has = (p: string) => props.kpi.stat?.readings.some((z: any) => z.period === p);
async function save(p: string) {
  const d = draft[p];
  if (d.value === '' || d.value === null) return toast.error('اكتب القيمة الفعلية');
  try {
    emit('saved', await api(`/planning/kpis/${props.kpi.id}/readings`, { method: 'PUT', json: { period: p, value: Number(d.value), note: d.note || null } }));
    toast.success(`سُجلت قراءة ${periodLabel(p)}`);
  } catch (e) {
    toast.error(errMsg(e));
  }
}
async function remove(p: string) {
  if (!confirm(`حذف قراءة ${periodLabel(p)}؟`)) return;
  try {
    emit('saved', await api(`/planning/kpis/${props.kpi.id}/readings/${p}`, { method: 'DELETE' }));
    draft[p] = { value: '', note: '' };
  } catch (e) {
    toast.error(errMsg(e));
  }
}
const canEdit = computed(() => session.can(P.progress) && props.plan.version > 0);
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="card modal modal-wide">
      <h2><span class="rk-code">{{ kpi.code }}</span> {{ kpi.name }}</h2>
      <p class="pm-muted">الوحدة: {{ kpi.unit }} · خط الأساس: {{ num(kpi.baseline) }}<span v-if="kpi.dataSource"> · المصدر: {{ kpi.dataSource }}</span></p>
      <div class="pl-flex" style="margin: 8px 0 12px">
        <span v-for="s in kpi.stat?.series ?? []" :key="s.year" class="pm-tag">{{ s.year }}: المستهدف {{ num(s.target) }} · الفعلي {{ num(s.actual) }}<template v-if="s.ach !== null"> · {{ num(s.ach) }}%</template></span>
      </div>
      <p v-if="!plan.version" class="rk-warn">تُسجّل القراءات بعد اعتماد الخطة.</p>
      <div class="table-wrap" style="max-height: 50vh; overflow: auto">
        <table class="table">
          <thead><tr><th>الفترة</th><th>المستهدف</th><th>الفعلي</th><th>ملاحظة</th><th /></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.period" :style="{ opacity: r.future ? 0.5 : 1 }">
              <td>{{ periodLabel(r.period) }}</td><td>{{ num(r.target) }}</td>
              <td><input v-model="draft[r.period].value" type="number" step="any" class="input" style="width: 110px" :disabled="!canEdit || r.future" /></td>
              <td><input v-model="draft[r.period].note" class="input" :disabled="!canEdit || r.future" /></td>
              <td style="white-space: nowrap">
                <button v-if="canEdit && !r.future" class="btn btn-sm btn-primary" @click="save(r.period)">حفظ</button>
                <button v-if="canEdit && has(r.period)" class="btn btn-sm" @click="remove(r.period)">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="kpi.stat" class="pm-muted" style="margin-top: 8px">الحالة في {{ kpi.stat.year }}: <span class="pm-pill" :style="{ '--c': BAND[kpi.stat.band ?? 'none'].color }">{{ BAND[kpi.stat.band ?? 'none'].label }}</span></p>
      <div class="modal-actions"><button type="button" class="btn" @click="emit('close')">إغلاق</button></div>
    </div>
  </div>
</template>
