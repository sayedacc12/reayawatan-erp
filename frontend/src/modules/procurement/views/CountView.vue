<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { COUNT_COLOR, fmtDate, fmtDateTime, fmtQty, sar } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const props = defineProps<{ id: string }>();
const toast = useToast();
const c = ref<any>(null);
const edit = ref<any[]>([]);
const busy = ref(false);
const dirty = ref(false);
const modal = ref<'' | 'approve' | 'return' | 'cancel'>('');
const note = ref('');
const onlyDiff = ref(false);
const base = () => `/procurement/counts/${props.id}`;

function apply(v: any) {
  c.value = v;
  edit.value = v.lines.map((l: any) => ({ index: l.index, countedQty: l.countedQty, note: l.note ?? '' }));
  dirty.value = false;
}
async function load() {
  try {
    apply(await api(base()));
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
watch(() => props.id, load);

const diff = (i: number) => {
  const e = edit.value[i];
  return e.countedQty === null || e.countedQty === '' ? null : Number(e.countedQty) - c.value.lines[i].systemQty;
};
const rows = computed(() => (c.value?.lines ?? []).map((l: any, i: number) => ({ l, i })).filter(({ i }: any) => !onlyDiff.value || (diff(i) ?? 0) !== 0));
const pending = computed(() => edit.value.filter((e) => e.countedQty === null || e.countedQty === '').length);
const est = computed(() => {
  let short = 0;
  let plus = 0;
  (c.value?.lines ?? []).forEach((l: any, i: number) => {
    const d = diff(i);
    if (d === null) return;
    if (d < 0) short += -d * l.unitCost;
    else plus += d * l.unitCost;
  });
  return { short, plus };
});

async function saveLines(silent = false) {
  busy.value = true;
  try {
    apply(await api(`${base()}/lines`, {
      method: 'PUT',
      json: { lines: edit.value.map((e) => ({ index: e.index, countedQty: e.countedQty === null || e.countedQty === '' ? null : Number(e.countedQty), note: e.note || null })) },
    }));
    if (!silent) toast.success('حُفظت الكميات المعدودة');
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  } finally {
    busy.value = false;
  }
}
async function submit() {
  if (dirty.value && !(await saveLines(true))) return;
  busy.value = true;
  try {
    apply(await api(`${base()}/submit`, { method: 'POST', json: {} }));
    toast.success('رُفع المحضر لاعتماد الفروقات');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function confirm() {
  busy.value = true;
  const m = modal.value;
  try {
    apply(await api(`${base()}/${m}`, { method: 'POST', json: m === 'approve' ? { note: note.value || null } : { reason: note.value } }));
    toast.success({ approve: 'اعتُمد الجرد وسُويت الفروقات بقيد', return: 'أعيد المحضر لإعادة العد', cancel: 'أُلغي محضر الجرد' }[m as 'approve']);
    modal.value = '';
    note.value = '';
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const fillSystem = () => {
  edit.value.forEach((e, i) => { if (e.countedQty === null || e.countedQty === '') e.countedQty = c.value.lines[i].systemQty; });
  dirty.value = true;
};
const printPage = () => window.print();
</script>

<template>
  <div v-if="c">
    <div class="page-head">
      <div>
        <h1>محضر جرد {{ c.code }}</h1>
        <p class="muted">{{ c.kindLabel }} · {{ c.warehouse.code }} · {{ c.warehouse.name }}{{ c.groupName ? ` · ${c.groupName}` : '' }} · {{ fmtDate(c.date) }} · <span class="pm-pill" :style="{ '--c': COUNT_COLOR[c.status] }">{{ c.statusLabel }}</span></p>
      </div>
      <div class="pc-inline pc-noprint">
        <template v-if="c.can.count">
          <button class="btn" :disabled="busy || !dirty" @click="saveLines()">حفظ</button>
          <button class="btn btn-ghost" @click="fillSystem">تعبئة الفارغ برصيد النظام</button>
        </template>
        <button v-if="c.can.submit" class="btn btn-primary" :disabled="busy || pending > 0" :title="pending ? 'أدخل كل الكميات أولًا' : ''" @click="submit">رفع للاعتماد</button>
        <template v-if="c.can.approve"><button class="btn btn-primary" @click="note = ''; modal = 'approve'">اعتماد الفروقات</button></template>
        <button v-if="c.can.returnCount" class="btn" @click="note = ''; modal = 'return'">إعادة للعد</button>
        <button class="btn" @click="printPage">طباعة</button>
        <button v-if="c.can.cancel" class="btn btn-ghost" @click="note = ''; modal = 'cancel'">إلغاء</button>
      </div>
    </div>
    <div class="pc-cards pc-noprint" style="margin-bottom: 14px">
      <div class="pc-kpi"><small>الأسطر</small><b>{{ c.lines.length }}</b><small>{{ pending ? `${pending} لم تُعد` : 'كلها معدودة' }}</small></div>
      <div class="pc-kpi"><small>العجز</small><b style="color: #b91c1c">{{ sar(c.status === 'approved' ? c.shortage : est.short) }}</b></div>
      <div class="pc-kpi"><small>الزيادة</small><b style="color: #047857">{{ sar(c.status === 'approved' ? c.surplus : est.plus) }}</b></div>
      <div class="pc-kpi"><small>قيد التسوية</small><b style="font-size: 1rem"><RouterLink v-if="c.entry" class="pm-link" :to="`/accounting/entries/${c.entry.id}`">قيد {{ c.entry.entryNo }}</RouterLink><span v-else>{{ c.status === 'approved' ? 'لا فروقات' : 'عند الاعتماد' }}</span></b></div>
    </div>
    <div class="card pm-panel" style="margin-bottom: 14px">
      <dl class="pc-dl">
        <div><dt>لجنة الجرد</dt><dd>{{ c.committee.join('، ') || '—' }}</dd></div>
        <div><dt>فتحه</dt><dd>{{ c.createdByName }}</dd></div>
        <div v-if="c.approvedByName"><dt>اعتمده</dt><dd>{{ c.approvedByName }}</dd></div>
        <div v-if="c.notes"><dt>ملاحظات</dt><dd>{{ c.notes }}</dd></div>
      </dl>
    </div>
    <label class="pc-inline pc-noprint" style="margin-bottom: 8px; font-size: .88rem"><input v-model="onlyDiff" type="checkbox" /> الفروقات فقط</label>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الصنف</th><th>التشغيلة والصلاحية</th><th>رصيد النظام</th><th style="width: 130px">المعدود</th><th>الفرق</th><th>قيمة الفرق</th><th>ملاحظة</th></tr></thead>
        <tbody>
          <tr v-for="{ l, i } in rows" :key="i">
            <td><b>{{ l.itemName }}</b> <span class="pc-code">{{ l.itemCode }}</span></td>
            <td style="font-size: .82rem">{{ l.lot ?? '' }} {{ l.expiryDate ? fmtDate(l.expiryDate) : '' }}<span v-if="l.expired" class="pc-flag" style="margin-inline-start: 4px">منتهي</span></td>
            <td class="pc-num">{{ fmtQty(l.systemQty) }} {{ l.uomName }}</td>
            <td>
              <input v-if="c.can.count" v-model.number="edit[i].countedQty" type="number" min="0" step="any" class="input" @input="dirty = true" />
              <span v-else class="pc-num">{{ fmtQty(l.countedQty) }}</span>
            </td>
            <td class="pc-num" :style="{ color: (diff(i) ?? 0) < 0 ? '#b91c1c' : (diff(i) ?? 0) > 0 ? '#047857' : '' }">{{ diff(i) === null ? '—' : fmtQty(diff(i)) }}</td>
            <td class="pc-num">{{ diff(i) ? sar((diff(i) ?? 0) * l.unitCost) : '—' }}</td>
            <td>
              <input v-if="c.can.count" v-model="edit[i].note" class="input" maxlength="500" @input="dirty = true" />
              <span v-else style="font-size: .82rem">{{ l.note ?? '' }}</span>
            </td>
          </tr>
          <tr v-if="!rows.length"><td colspan="7" class="pc-empty">{{ onlyDiff ? 'لا توجد فروقات.' : 'لا توجد أرصدة في المستودع للجرد.' }}</td></tr>
        </tbody>
      </table>
    </div>
    <section class="card pm-panel pc-noprint" style="margin-top: 16px">
      <h2>السجل</h2>
      <ul class="pc-log">
        <li v-for="(x, i) in [...c.log].reverse()" :key="i"><span><b>{{ x.action }}</b> · {{ x.byName }} <small class="pm-muted">{{ fmtDateTime(x.at) }}</small><div v-if="x.note" class="pm-muted" style="font-size: .8rem">{{ x.note }}</div></span></li>
      </ul>
    </section>

    <div v-if="modal" class="modal-backdrop" @click.self="modal = ''">
      <form class="card modal" @submit.prevent="confirm">
        <h2>{{ { approve: 'اعتماد فروقات الجرد', return: 'إعادة المحضر للعد', cancel: 'إلغاء محضر الجرد' }[modal] }}</h2>
        <p v-if="modal === 'approve'" class="pm-muted" style="font-size: .85rem">تُعاد مقارنة المعدود بالرصيد الحالي، ويُسوى العجز والزيادة بحركات مخزون وقيد على حساب فروقات المخزون.</p>
        <label class="field"><span>{{ modal === 'approve' ? 'ملاحظة (اختياري)' : 'السبب' }}</span><textarea v-model="note" class="input" rows="3" :required="modal !== 'approve'" /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">تأكيد</button><button type="button" class="btn" @click="modal = ''">رجوع</button></div>
      </form>
    </div>
  </div>
</template>
