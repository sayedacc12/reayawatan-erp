<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import PersonPicker from '../components/PersonPicker.vue';
import { CONF, CONF_COLOR, PRIORITIES, PURPOSES, addDays, loadLookups, todayStr, unitOptions, type Lookups } from '../lib';
import '../../../shared/module.css';
import '../comms.css';

const props = defineProps<{ id?: string }>();
const router = useRouter();
const toast = useToast();
const L = ref<Lookups | null>(null);
const error = ref('');
const busy = ref(false);
const f = reactive({
  docType: 'transaction' as 'transaction' | 'decision' | 'circular', kind: 'admin' as 'admin' | 'financial', direction: 'internal' as 'internal' | 'incoming' | 'outgoing',
  externalParty: '', externalRef: '', categoryCode: '', subject: '', body: '', confidentiality: 'normal', priority: 'normal',
  financialType: 'payment' as 'receipt' | 'payment', amount: null as number | null, partyName: '',
  toMode: 'user' as 'user' | 'unit', toUserId: null as string | null, toUnitId: '', purpose: 'action', dueDate: '', note: '',
  recipientUserIds: [] as string[], recipientUnitIds: [] as string[], followerUserIds: [] as string[],
});
onMounted(async () => {
  L.value = await loadLookups(true);
  if (props.id) {
    const t = await api<Record<string, any>>(`/comms/transactions/${props.id}`);
    Object.assign(f, {
      docType: t.docType, kind: t.kind, direction: t.direction, externalParty: t.externalParty ?? '', externalRef: t.externalRef ?? '', categoryCode: t.categoryCode ?? '',
      subject: t.subject, body: t.body, confidentiality: t.confidentiality, priority: t.priority, financialType: t.financialType ?? 'payment', amount: t.amount, partyName: t.partyName ?? '',
      followerUserIds: (t.followers as { userId: string }[]).map((x) => x.userId),
    });
  } else if (!L.value.can.create && L.value.can.decisions) f.docType = 'decision';
});
const cats = computed(() => (L.value?.categories ?? []).filter((c) => f.docType !== 'transaction' || c.kind === f.kind));
watch(() => f.categoryCode, (c) => {
  const cat = L.value?.categories.find((x) => x.code === c);
  if (cat && f.docType === 'transaction' && !f.dueDate) f.dueDate = addDays(todayStr(), cat.dueDays);
});
watch(() => f.kind, () => {
  if (!cats.value.some((c) => c.code === f.categoryCode)) f.categoryCode = '';
});
watch(() => f.confidentiality, (c) => {
  if (c === 'top_secret') f.followerUserIds = [];
});
const units = computed(() => unitOptions(L.value?.units ?? []));
const unitManager = computed(() => units.value.find((u) => u.id === f.toUnitId)?.manager);

async function save(draft: boolean) {
  busy.value = true;
  error.value = '';
  try {
    const body = {
      docType: f.docType, kind: f.docType === 'transaction' ? f.kind : 'admin', direction: f.docType === 'transaction' ? f.direction : 'internal',
      externalParty: f.externalParty || null, externalRef: f.externalRef || null, categoryCode: f.categoryCode || null, subject: f.subject, body: f.body,
      confidentiality: f.confidentiality, priority: f.priority, draft,
      ...(f.docType === 'transaction' && f.kind === 'financial' ? { financialType: f.financialType, amount: f.amount, partyName: f.partyName || null } : {}),
      ...(f.docType === 'transaction'
        ? { toUserId: f.toMode === 'user' ? f.toUserId : null, toUnitId: f.toMode === 'unit' ? f.toUnitId || null : null, purpose: f.purpose, dueDate: f.dueDate || null, note: f.note || null }
        : { recipientUserIds: f.recipientUserIds, recipientUnitIds: f.recipientUnitIds }),
      followerUserIds: f.confidentiality === 'top_secret' ? [] : f.followerUserIds,
    };
    const t = await api<{ id: string; refNo: string }>(props.id ? `/comms/transactions/${props.id}` : '/comms/transactions', { method: props.id ? 'PUT' : 'POST', json: body });
    toast.success(draft ? 'حُفظت المسودة' : `أُرسلت برقم ${t.refNo}`);
    router.push(draft ? '/comms/inbox?box=drafts' : `/comms/t/${t.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const toggleUnit = (id: string) => {
  f.recipientUnitIds = f.recipientUnitIds.includes(id) ? f.recipientUnitIds.filter((x) => x !== id) : [...f.recipientUnitIds, id];
};
</script>

<template>
  <div v-if="L">
    <section class="pm-hero cm-hero">
      <p class="pm-kicker">الاتصالات الإدارية</p>
      <h1>{{ id ? 'تعديل المسودة' : f.docType === 'transaction' ? 'معاملة جديدة' : f.docType === 'decision' ? 'قرار جديد' : 'تعميم جديد' }}</h1>
      <p class="pm-sub">المعاملة تُحال لموظف أو لإدارة (تصل لمديرها)، وتتنقل حتى تُنجز أو تُحفظ. القرار والتعميم يصدران دفعة واحدة للموجه إليهم ويُسجل اطلاع كل منهم.</p>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <form class="cm-grid" @submit.prevent="save(false)">
      <section class="card pm-panel">
        <div class="pm-tabs" style="margin-top: -6px">
          <button v-if="L.can.create" type="button" :class="['pm-tab', { on: f.docType === 'transaction' }]" @click="f.docType = 'transaction'">معاملة</button>
          <button v-if="L.can.decisions" type="button" :class="['pm-tab', { on: f.docType === 'decision' }]" @click="f.docType = 'decision'">قرار</button>
          <button v-if="L.can.decisions" type="button" :class="['pm-tab', { on: f.docType === 'circular' }]" @click="f.docType = 'circular'">تعميم أو إشعار</button>
        </div>
        <div v-if="f.docType === 'transaction'" class="pm-grid2" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0 12px">
          <label class="field"><span>نوع المعاملة</span>
            <div class="cm-seg"><button type="button" :class="{ on: f.kind === 'admin' }" @click="f.kind = 'admin'">إدارية</button><button type="button" :class="{ on: f.kind === 'financial' }" @click="f.kind = 'financial'">مالية</button></div>
          </label>
          <label class="field"><span>التصنيف</span><select v-model="f.categoryCode" class="input"><option value="">بدون تصنيف</option><option v-for="c in cats" :key="c.code" :value="c.code">{{ c.name }}</option></select></label>
          <label class="field"><span>الاتجاه</span><select v-model="f.direction" class="input"><option value="internal">داخلية</option><option value="incoming">واردة من جهة خارجية</option><option value="outgoing">صادرة لجهة خارجية</option></select></label>
        </div>
        <div v-if="f.direction !== 'internal' && f.docType === 'transaction'" style="display: grid; grid-template-columns: 2fr 1fr; gap: 0 12px">
          <label class="field"><span>الجهة الخارجية</span><input v-model="f.externalParty" class="input" required /></label>
          <label class="field"><span>رقم خطابها</span><input v-model="f.externalRef" class="input" /></label>
        </div>
        <label class="field"><span>الموضوع</span><input v-model="f.subject" class="input" required maxlength="300" /></label>
        <label class="field"><span>{{ f.docType === 'transaction' ? 'نص المعاملة' : 'نص القرار أو التعميم' }}</span><textarea v-model="f.body" class="input" rows="8" /></label>

        <div v-if="f.docType === 'transaction' && f.kind === 'financial'" class="card" style="padding: 14px; background: var(--surface-2); margin-bottom: 14px">
          <p class="cm-sec" style="margin-top: 0">بيانات المعاملة المالية (تنتهي بسند قبض أو صرف في النظام المالي، أو تُحفظ)</p>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0 12px">
            <label class="field"><span>النوع</span><select v-model="f.financialType" class="input"><option value="payment">صرف</option><option value="receipt">قبض</option></select></label>
            <label class="field"><span>المبلغ (ريال)</span><input v-model.number="f.amount" type="number" min="0.01" step="0.01" class="input" required /></label>
            <label class="field"><span>الجهة (المستفيد من السند)</span><input v-model="f.partyName" class="input" /></label>
          </div>
        </div>

        <p class="cm-sec">درجة السرية</p>
        <div class="cm-conf-pick">
          <label v-for="c in CONF" :key="c.value" :class="{ on: f.confidentiality === c.value }" :style="{ '--c': CONF_COLOR[c.value] }">
            <input v-model="f.confidentiality" type="radio" :value="c.value" /><b>{{ c.label }}</b><small>{{ c.hint }}</small>
          </label>
        </div>
        <label class="field" style="margin-top: 14px"><span>الأهمية</span>
          <div class="cm-seg"><button v-for="p in PRIORITIES" :key="p.value" type="button" :class="{ on: f.priority === p.value }" @click="f.priority = p.value">{{ p.label }}</button></div>
        </label>
      </section>

      <section class="card pm-panel">
        <template v-if="f.docType === 'transaction'">
          <h2>الإحالة</h2>
          <div class="cm-seg" style="margin-bottom: 10px"><button type="button" :class="{ on: f.toMode === 'user' }" @click="f.toMode = 'user'">إلى موظف</button><button type="button" :class="{ on: f.toMode === 'unit' }" @click="f.toMode = 'unit'">إلى إدارة أو قسم</button></div>
          <div v-if="f.toMode === 'user'" class="field"><PersonPicker v-model="f.toUserId" :people="L.people" placeholder="اختر الموظف المحال إليه" /></div>
          <label v-else class="field"><select v-model="f.toUnitId" class="input"><option value="">اختر الإدارة</option><option v-for="u in units" :key="u.id" :value="u.id">{{ u.label }}</option></select>
            <small class="pm-muted">{{ f.toUnitId ? (unitManager ? `تصل إلى مديرها: ${unitManager}` : 'لا يوجد مدير محدد لهذه الوحدة في الهيكل') : 'تصل المعاملة إلى مدير الوحدة في الهيكل التنظيمي' }}</small></label>
          <label class="field"><span>الغرض</span><select v-model="f.purpose" class="input"><option v-for="p in PURPOSES" :key="p.value" :value="p.value">{{ p.label }}</option></select></label>
          <label class="field"><span>الإنجاز المطلوب قبل</span><input v-model="f.dueDate" type="date" class="input" :min="todayStr()" /></label>
          <label class="field"><span>توجيه أو ملاحظة للمحال إليه</span><textarea v-model="f.note" class="input" rows="3" /></label>
        </template>
        <template v-else>
          <h2>الموجه إليهم</h2>
          <p class="pm-muted" style="margin-top: -6px">اختر إدارات كاملة (تشمل أقسامها) و/أو أشخاصًا بأعينهم.</p>
          <div class="cm-chips" style="margin-bottom: 12px">
            <button v-for="u in units" :key="u.id" type="button" :class="['cm-chip', { read: f.recipientUnitIds.includes(u.id) }]" style="cursor: pointer" @click="toggleUnit(u.id)">{{ u.label.replace(/— /g, '') }}</button>
          </div>
          <div class="field"><span>أشخاص</span><PersonPicker v-model="f.recipientUserIds" :people="L.people" multiple /></div>
        </template>
        <template v-if="f.confidentiality !== 'top_secret'">
          <p class="cm-sec">المتابعون (يطلعون دون أن يتدخلوا)</p>
          <PersonPicker v-model="f.followerUserIds" :people="L.people" multiple placeholder="أضف متابعًا" />
        </template>
        <p v-else class="alert" style="background: #fef2f2; color: #b91c1c; margin-top: 14px">عالية السرية: لا يراها إلا الموجهة لهم، ولا يضاف لها متابعون.</p>
        <div class="modal-actions" style="margin-top: 18px">
          <button class="btn btn-primary" :disabled="busy">{{ f.docType === 'transaction' ? 'إرسال المعاملة' : 'إصدار' }}</button>
          <button type="button" class="btn" :disabled="busy" @click="save(true)">حفظ كمسودة</button>
        </div>
        <p class="pm-muted" style="margin-top: 10px">المرفقات تُضاف من صفحة المعاملة بعد حفظها.</p>
      </section>
    </form>
  </div>
</template>
