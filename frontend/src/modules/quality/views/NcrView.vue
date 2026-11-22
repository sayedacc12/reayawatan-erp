<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, STATUS_COLOR, errMsg, fmtDate, todayStr, type ActionItem } from '../lib';
import '../../../shared/module.css';
import '../quality.css';

interface Ncr {
  id: string; code: string; sourceLabel: string; sourceRef: string | null; title: string; description: string; clause: string | null; severity: string; departmentName: string;
  detectedDate: string; detectedByName: string; dueDate: string | null; status: string; statusLabel: string; overdue: boolean; correction: string | null;
  rcaMethod: 'five_whys' | 'fishbone'; whys: string[]; fishbone: Record<string, string> | null; rootCause: string | null; actionItems: ActionItem[];
  verification: { result: string; note: string | null; byName: string; at: string } | null; needsRiskUpdate: boolean; relatedCode: string | null;
  history: { action: string; byName: string; at: string; note: string | null }[]; auditId: string | null; auditTitle: string | null; closedAt: string | null; daysOpen: number;
}
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const n = ref<Ncr | null>(null);
const BONES = [
  { k: 'man', l: 'الأفراد' }, { k: 'method', l: 'الطريقة والإجراء' }, { k: 'machine', l: 'الأنظمة والأدوات' },
  { k: 'material', l: 'المدخلات والمستندات' }, { k: 'measurement', l: 'القياس والمتابعة' }, { k: 'environment', l: 'بيئة العمل' },
];
const form = reactive({ correction: '', rcaMethod: 'five_whys' as 'five_whys' | 'fishbone', whys: ['', '', ''] as string[], fishbone: {} as Record<string, string>, rootCause: '', actions: [] as ActionItem[], needsRiskUpdate: false, relatedCode: '' });
function fill(x: Ncr) {
  n.value = x;
  Object.assign(form, {
    correction: x.correction ?? '', rcaMethod: x.rcaMethod, whys: x.whys.length ? [...x.whys] : ['', '', ''],
    fishbone: { ...Object.fromEntries(BONES.map((b) => [b.k, ''])), ...(x.fishbone ?? {}) }, rootCause: x.rootCause ?? '',
    actions: x.actionItems.map((a) => ({ ...a })), needsRiskUpdate: x.needsRiskUpdate, relatedCode: x.relatedCode ?? '',
  });
}
onMounted(async () => fill(await api<Ncr>(`/quality/ncrs/${props.id}`)));
const canEdit = computed(() => n.value && n.value.status !== 'closed' && session.can(P.ncr));
async function save() {
  try {
    fill(await api<Ncr>(`/quality/ncrs/${props.id}/analysis`, {
      method: 'PUT', json: {
        correction: form.correction || null, rcaMethod: form.rcaMethod, whys: form.whys.filter((w) => w.trim()), fishbone: form.rcaMethod === 'fishbone' ? form.fishbone : null,
        rootCause: form.rootCause || null, needsRiskUpdate: form.needsRiskUpdate, relatedCode: form.relatedCode || null,
        actions: form.actions.map((a) => ({ id: a.id, title: a.title, ownerName: a.ownerName, dueDate: a.dueDate || null, status: a.status, note: a.note || null })),
      },
    }));
    toast.success('حُفظ، وانتقلت الحالة للمرحلة المناسبة تلقائيًا');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
async function verify(result: 'effective' | 'not_effective') {
  const note = prompt(result === 'effective' ? 'كيف تحققت من الفاعلية؟ (عينة، متابعة، مؤشر...)' : 'لماذا لم تكن الإجراءات فعّالة؟');
  if (note === null || (result === 'not_effective' && !note)) return;
  try {
    fill(await api<Ncr>(`/quality/ncrs/${props.id}/verify`, { method: 'POST', json: { result, note: note || null } }));
    toast.success(result === 'effective' ? 'أُغلقت الحالة' : 'أعيدت الحالة لتحليل السبب الجذري');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
const ORDER = ['open', 'analysis', 'action', 'verification', 'closed'];
const idx = computed(() => ORDER.indexOf(n.value?.status ?? 'open'));
const ACT: Record<string, string> = { created: 'تسجيل الحالة', updated: 'تحديث', closed: 'إغلاق بعد التحقق من الفاعلية', not_effective: 'الإجراءات غير فعّالة', 'status:analysis': 'انتقلت لتحليل السبب', 'status:action': 'انتقلت لتنفيذ الإجراءات', 'status:verification': 'انتقلت للتحقق من الفاعلية', 'status:open': 'أعيدت للتصحيح' };
</script>

<template>
  <div v-if="n">
    <section class="pm-hero q-hero">
      <div><p class="pm-kicker"><span class="q-code" style="background: rgba(255,255,255,.12); color: #fcd34d">{{ n.code }}</span> · {{ n.sourceLabel }}<template v-if="n.sourceRef"> {{ n.sourceRef }}</template> · {{ n.departmentName }}</p>
        <h1>{{ n.title }}</h1>
        <p class="pm-sub">{{ n.severity === 'major' ? 'جسيمة' : 'بسيطة' }}<template v-if="n.clause"> · البند {{ n.clause }}</template> · اكتشفها {{ n.detectedByName }} {{ fmtDate(n.detectedDate) }} · {{ n.status === 'closed' ? `أُغلقت ${fmtDate(n.closedAt)} بعد ${n.daysOpen} يوم` : `موعد الإغلاق ${fmtDate(n.dueDate)}` }}</p></div>
      <div class="pm-actions">
        <RouterLink v-if="n.auditId" :to="`/quality/audits/${n.auditId}`" class="btn q-ghost">المراجعة: {{ n.auditTitle }}</RouterLink>
        <template v-if="n.status === 'verification' && session.can(P.closeNcr)">
          <button class="btn q-glow" @click="verify('effective')">الإجراءات فعّالة: إغلاق</button><button class="btn q-ghost" @click="verify('not_effective')">غير فعّالة</button>
        </template>
      </div>
    </section>
    <div class="q-steps">
      <div v-for="(l, i) in ['التسجيل', 'التصحيح والتحليل', 'الإجراءات التصحيحية', 'التحقق من الفاعلية', 'الإغلاق']" :key="i" :data-n="i + 1" :class="{ done: idx >= i, cur: idx === i && n.status !== 'closed' }">{{ l }}</div>
    </div>
    <div v-if="n.overdue" class="q-warn">تجاوزت الحالة موعد الإغلاق المستهدف.</div>
    <div class="q-grid">
      <div style="display: grid; gap: 16px">
        <section class="card pm-panel"><h2>وصف عدم المطابقة</h2><p class="q-pre">{{ n.description }}</p></section>
        <section class="card pm-panel">
          <h2>1. التصحيح الفوري (احتواء الأثر)</h2>
          <textarea v-if="canEdit" v-model="form.correction" class="input" rows="2" placeholder="ما الذي فُعل فورًا لمعالجة الأثر؟" />
          <p v-else class="q-pre">{{ n.correction ?? '—' }}</p>
        </section>
        <section class="card pm-panel">
          <h2>2. تحليل السبب الجذري
            <span v-if="canEdit" class="q-tabs" style="margin: 0"><button :class="['q-tab', { on: form.rcaMethod === 'five_whys' }]" @click="form.rcaMethod = 'five_whys'">لماذا الخمس</button><button :class="['q-tab', { on: form.rcaMethod === 'fishbone' }]" @click="form.rcaMethod = 'fishbone'">عظمة السمكة</button></span>
          </h2>
          <template v-if="form.rcaMethod === 'five_whys'">
            <div v-for="(w, i) in form.whys" :key="i" style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px">
              <span class="pm-tag" style="min-width: 70px; text-align: center">لماذا {{ i + 1 }}</span>
              <input v-if="canEdit" v-model="form.whys[i]" class="input" /><span v-else>{{ w || '—' }}</span>
            </div>
            <button v-if="canEdit && form.whys.length < 7" class="btn btn-sm" @click="form.whys.push('')">+ لماذا</button>
          </template>
          <div v-else class="q-fish">
            <div v-for="b in BONES.slice(0, 3)" :key="b.k" class="bone"><b>{{ b.l }}</b><textarea v-if="canEdit" v-model="form.fishbone[b.k]" /><span v-else>{{ form.fishbone[b.k] || '—' }}</span></div>
            <div class="spine" />
            <div class="head">{{ n.title }}</div>
            <div v-for="b in BONES.slice(3)" :key="b.k" class="bone"><b>{{ b.l }}</b><textarea v-if="canEdit" v-model="form.fishbone[b.k]" /><span v-else>{{ form.fishbone[b.k] || '—' }}</span></div>
          </div>
          <label class="field" style="margin-top: 12px"><span><b>السبب الجذري</b></span>
            <textarea v-if="canEdit" v-model="form.rootCause" class="input" rows="2" /><p v-else class="q-pre">{{ n.rootCause ?? '—' }}</p></label>
        </section>
        <section class="card pm-panel">
          <h2>3. الإجراءات التصحيحية <button v-if="canEdit" class="btn btn-sm" @click="form.actions.push({ title: '', ownerName: '', dueDate: null, status: 'open' })">+ إجراء</button></h2>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>الإجراء</th><th>المسؤول</th><th>الموعد</th><th>الحالة</th><th v-if="canEdit" /></tr></thead>
            <tbody>
              <tr v-for="(a, i) in form.actions" :key="i">
                <td><input v-if="canEdit" v-model="a.title" class="input" /><template v-else>{{ a.title }}</template></td>
                <td><input v-if="canEdit" v-model="a.ownerName" class="input" style="width: 150px" /><template v-else>{{ a.ownerName }}</template></td>
                <td><input v-if="canEdit" v-model="a.dueDate" type="date" class="input" /><span v-else :style="{ color: a.status === 'open' && a.dueDate && a.dueDate < todayStr() ? 'var(--danger)' : '' }">{{ fmtDate(a.dueDate) }}</span></td>
                <td>
                  <label v-if="canEdit" style="display: flex; gap: 6px; align-items: center; white-space: nowrap"><input type="checkbox" :checked="a.status === 'done'" @change="a.status = ($event.target as HTMLInputElement).checked ? 'done' : 'open'" /> نُفذ</label>
                  <span v-else class="pm-pill" :style="{ '--c': STATUS_COLOR[a.status === 'done' ? 'done' : 'open'] }">{{ a.status === 'done' ? `نُفذ ${fmtDate(a.doneAt)}` : 'قيد التنفيذ' }}</span>
                </td>
                <td v-if="canEdit"><button class="btn btn-sm" @click="form.actions.splice(i, 1)">✕</button></td>
              </tr>
              <tr v-if="!form.actions.length"><td colspan="5" class="pm-empty">لا توجد إجراءات بعد</td></tr>
            </tbody>
          </table></div>
          <div v-if="canEdit" class="pm-grid2" style="margin-top: 10px">
            <label class="field"><span>وثيقة تحتاج تعديلًا (كود)</span><input v-model="form.relatedCode" class="input" dir="ltr" /></label>
            <label style="display: flex; gap: 8px; align-items: center; margin-top: 22px"><input v-model="form.needsRiskUpdate" type="checkbox" /> تستلزم تحديث سجل المخاطر</label>
          </div>
          <p v-else-if="n.relatedCode || n.needsRiskUpdate" class="pm-muted">{{ n.relatedCode ? `الوثيقة المرتبطة ${n.relatedCode}` : '' }}{{ n.needsRiskUpdate ? ' · تستلزم تحديث سجل المخاطر' : '' }}</p>
          <div v-if="canEdit" class="modal-actions"><button class="btn btn-primary" @click="save">حفظ</button></div>
        </section>
        <section v-if="n.verification" class="card pm-panel">
          <h2>4. التحقق من الفاعلية</h2>
          <p><span class="pm-pill" :style="{ '--c': n.verification.result === 'effective' ? '#10b981' : '#ef4444' }">{{ n.verification.result === 'effective' ? 'فعّالة' : 'غير فعّالة' }}</span> · {{ n.verification.byName }} · {{ fmtDate(n.verification.at) }}</p>
          <p class="q-pre">{{ n.verification.note }}</p>
        </section>
      </div>
      <section class="card pm-panel">
        <h2>المرحلة الحالية</h2>
        <p><span class="pm-pill" :style="{ '--c': STATUS_COLOR[n.status] }">{{ n.statusLabel }}</span></p>
        <p class="pm-muted">تنتقل الحالة تلقائيًا: بعد التصحيح إلى التحليل، وبعد تحديد السبب والإجراءات إلى التنفيذ، وبعد تنفيذ كل الإجراءات إلى التحقق من الفاعلية.</p>
        <h2 style="margin-top: 16px">السجل</h2>
        <ul class="q-timeline">
          <li v-for="(h, i) in [...n.history].reverse()" :key="i"><b>{{ ACT[h.action] ?? h.action }}</b> · {{ h.byName }}<div class="pm-muted">{{ new Date(h.at).toLocaleString('ar-SA-u-ca-gregory') }}</div><div v-if="h.note" class="pm-muted">{{ h.note }}</div></li>
        </ul>
      </section>
    </div>
  </div>
</template>
