<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, openProtectedFile, token } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import ItemForm from '../components/ItemForm.vue';
import { KIND_COLOR, PR, accLabel, fmtDateTime, fmtSize, sar, upload } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const it = ref<any>(null);
const editing = ref(false);
const busy = ref(false);
const imageUrl = ref('');
const stopping = ref(false);
const stop = ref({ reason: '', replacedById: '' });
const alt = ref({ q: '', itemId: '', kind: 'alternative', note: '' });
const altResults = ref<any[]>([]);
const can = () => session.can(PR.items);

async function loadImage() {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
  imageUrl.value = '';
  if (!it.value?.imageKey) return;
  const res = await fetch(`/api/procurement/items/${props.id}/files/image`, { headers: { Authorization: `Bearer ${token.get()}` } }).catch(() => null);
  if (res?.ok) imageUrl.value = URL.createObjectURL(await res.blob());
}
async function load() {
  try {
    it.value = await api(`/procurement/items/${props.id}`);
    await loadImage();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
watch(() => props.id, load);
onBeforeUnmount(() => imageUrl.value && URL.revokeObjectURL(imageUrl.value));

async function run(fn: () => Promise<any>, ok: string) {
  busy.value = true;
  try {
    await fn();
    toast.success(ok);
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
function pick(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  return file;
}
const setImage = (e: Event) => { const f = pick(e); if (f) run(() => upload(`/procurement/items/${props.id}/image`, f), 'حُدّثت صورة الصنف'); };
const addAttachment = (e: Event) => { const f = pick(e); if (f) run(() => upload(`/procurement/items/${props.id}/attachments`, f), 'أُرفق الملف'); };
const removeAttachment = (key: string) => run(() => api(`/procurement/items/${props.id}/attachments/${key}`, { method: 'DELETE' }), 'حُذف المرفق');
const openFile = (key: string) => openProtectedFile(`/procurement/items/${props.id}/files/${key}`).catch((e) => toast.error(e.message));

const doStop = () => run(async () => {
  await api(`/procurement/items/${props.id}/stop`, { method: 'POST', json: { reason: stop.value.reason, replacedById: stop.value.replacedById || null } });
  stopping.value = false;
}, 'أُوقف الصنف، ويبقى بسجله التاريخي');
const reactivate = () => run(() => api(`/procurement/items/${props.id}/reactivate`, { method: 'POST' }), 'أُعيد تفعيل الصنف');

let t: ReturnType<typeof setTimeout>;
watch(() => alt.value.q, (q) => {
  clearTimeout(t);
  t = setTimeout(async () => {
    altResults.value = q.trim().length > 1 ? (await api<any[]>(`/procurement/items?status=active&q=${encodeURIComponent(q)}`).catch(() => [])).filter((x) => x.id !== props.id).slice(0, 8) : [];
  }, 300);
});
const addAlt = () => run(async () => {
  await api(`/procurement/items/${props.id}/alternatives`, { method: 'POST', json: { itemId: alt.value.itemId, kind: alt.value.kind, note: alt.value.note || null } });
  alt.value = { q: '', itemId: '', kind: 'alternative', note: '' };
  altResults.value = [];
}, 'اعتُمد البديل في الصنفين');
const removeAlt = (other: string) => run(() => api(`/procurement/items/${props.id}/alternatives/${other}`, { method: 'DELETE' }), 'أُلغي البديل');
</script>

<template>
  <div v-if="it">
    <div class="page-head">
      <div class="pc-inline" style="flex-wrap: nowrap; align-items: flex-start">
        <img v-if="imageUrl" :src="imageUrl" class="pc-thumb" alt="" />
        <div>
          <h1>{{ it.name }}</h1>
          <p class="muted"><span class="pc-code">{{ it.code }}</span> · {{ it.group?.name }} · <span class="pc-chip" :style="{ '--c': KIND_COLOR[it.kind] }">{{ it.kindLabel }}</span>
            <span v-if="it.status === 'stopped'" class="pc-flag" style="margin-inline-start: 6px">موقوف</span></p>
        </div>
      </div>
      <div v-if="can()" class="pc-inline">
        <button class="btn" @click="editing = true">تعديل</button>
        <label class="btn">صورة<input type="file" accept="image/png,image/jpeg,image/webp" hidden @change="setImage" /></label>
        <button v-if="it.status === 'active'" class="btn btn-danger" @click="stopping = true">إيقاف</button>
        <button v-else class="btn" :disabled="busy" @click="reactivate">إعادة تفعيل</button>
      </div>
    </div>

    <div v-if="it.status === 'stopped'" class="alert alert-error">
      أُوقف الصنف: {{ it.stopReason }}.
      <template v-if="it.replacedBy"> البديل المعتمد: <RouterLink :to="`/procurement/items/${it.replacedBy.id}`" class="pm-link">{{ it.replacedBy.code }} {{ it.replacedBy.name }}</RouterLink></template>
    </div>

    <div class="pc-grid">
      <section class="card pm-panel">
        <h2>البطاقة</h2>
        <dl class="pc-dl">
          <div><dt>الوحدة الأساسية</dt><dd>{{ it.uom?.name }}</dd></div>
          <div><dt>الباركود</dt><dd class="pc-code">{{ it.barcode ?? '—' }}</dd></div>
          <div><dt>السعر الاسترشادي</dt><dd>{{ sar(it.refPrice) }}</dd></div>
          <div v-if="it.kind !== 'service' && it.kind !== 'asset'"><dt>سياسة الصرف</dt><dd>{{ it.issuePolicyLabel }}</dd></div>
          <div><dt>الحد الأدنى / الأعلى</dt><dd>{{ it.minQty ?? '—' }} / {{ it.maxQty ?? '—' }}</dd></div>
          <div><dt>نقطة وكمية إعادة الطلب</dt><dd>{{ it.reorderPoint ?? '—' }} / {{ it.reorderQty ?? '—' }}</dd></div>
          <div><dt>التتبع</dt><dd>{{ [it.trackBatch && 'رقم التشغيلة', it.trackSerial && 'الرقم التسلسلي', it.trackExpiry && `الصلاحية${it.shelfLifeDays ? ` (${it.shelfLifeDays} يوم)` : ''}`].filter(Boolean).join('، ') || 'لا يوجد' }}</dd></div>
        </dl>
        <p v-if="it.description" style="margin: 14px 0 0; white-space: pre-line">{{ it.description }}</p>
        <template v-if="it.units.length">
          <div class="pc-sec">وحدات أخرى</div>
          <div class="pc-chips"><span v-for="u in it.units" :key="u.uomId" class="pc-chip">{{ u.uom }} = {{ u.factor }} {{ it.uom?.name }}<span v-if="u.barcode" class="pc-code">{{ u.barcode }}</span></span></div>
        </template>
        <template v-if="it.specs.length">
          <div class="pc-sec">المواصفات</div>
          <dl class="pc-dl"><div v-for="s in it.specs" :key="s.name"><dt>{{ s.name }}</dt><dd>{{ s.value }}</dd></div></dl>
        </template>
      </section>

      <section class="card pm-panel">
        <h2>المحاسبة</h2>
        <dl class="pc-dl" style="grid-template-columns: 1fr">
          <div v-if="it.kind !== 'service'"><dt>طريقة التقييم</dt><dd>{{ it.effective.valuationLabel }}</dd></div>
          <div v-if="it.kind !== 'service'"><dt>حساب المخزون</dt><dd>{{ accLabel(it.effective.inventoryAccount) }}</dd></div>
          <div><dt>حساب المصروف</dt><dd>{{ accLabel(it.effective.expenseAccount) }}</dd></div>
          <div v-if="it.kind === 'asset'"><dt>مجموعة الأصول الثابتة</dt><dd>{{ it.effective.assetGroup ? `${it.effective.assetGroup.code} · ${it.effective.assetGroup.name}` : '—' }}</dd></div>
        </dl>
        <p class="pm-muted" style="font-size: .8rem; margin: 10px 0 0">ما لم يُحدد في الصنف يُؤخذ من مجموعته أو المجموعة الأعلى.</p>
      </section>

      <section class="card pm-panel">
        <h2>البدائل والمكافئات المعتمدة</h2>
        <p v-if="!it.alternatives.length" class="pc-empty">لا توجد بدائل معتمدة</p>
        <div v-for="a in it.alternatives" :key="a.itemId" class="pc-inline" style="padding: 6px 0; border-bottom: 1px solid var(--border)">
          <span class="pc-chip">{{ a.kind === 'equivalent' ? 'مكافئ' : 'بديل' }}</span>
          <RouterLink v-if="a.item" :to="`/procurement/items/${a.item.id}`" class="pm-link"><span class="pc-code">{{ a.item.code }}</span> {{ a.item.name }}</RouterLink>
          <small class="pm-muted">{{ a.note }} · اعتمده {{ a.approvedByName }}</small>
          <button v-if="can()" class="btn btn-sm" style="margin-inline-start: auto" :disabled="busy" @click="removeAlt(a.itemId)">إلغاء</button>
        </div>
        <template v-if="can() && it.status === 'active'">
          <div class="pc-sec">اعتماد بديل جديد</div>
          <div class="pc-inline">
            <input v-model="alt.q" class="input" placeholder="ابحث عن الصنف البديل" />
            <select v-model="alt.kind" class="input" style="flex: 0 0 120px"><option value="alternative">بديل</option><option value="equivalent">مكافئ</option></select>
          </div>
          <div class="pc-chips" style="margin: 6px 0"><button v-for="r in altResults" :key="r.id" type="button" :class="['pc-chip', { on: alt.itemId === r.id }]" @click="alt.itemId = r.id">{{ r.code }} {{ r.name }}</button></div>
          <div class="pc-inline"><input v-model="alt.note" class="input" placeholder="ملاحظة (اختياري)" /><button class="btn btn-sm btn-primary" :disabled="busy || !alt.itemId" @click="addAlt">اعتماد</button></div>
        </template>
        <template v-if="it.replaces.length">
          <div class="pc-sec">يحل محل</div>
          <RouterLink v-for="r in it.replaces" :key="r.id" :to="`/procurement/items/${r.id}`" class="pm-link" style="display: block">{{ r.code }} {{ r.name }}</RouterLink>
        </template>
      </section>

      <section class="card pm-panel">
        <h2>المرفقات <label v-if="can()" class="btn btn-sm">+ مرفق<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden @change="addAttachment" /></label></h2>
        <p v-if="!it.attachments.length" class="pc-empty">لا توجد مرفقات</p>
        <div v-for="a in it.attachments" :key="a.key" class="pc-inline" style="padding: 6px 0; border-bottom: 1px solid var(--border)">
          <button class="pm-link" style="background: none; border: 0; cursor: pointer; font: inherit" @click="openFile(a.key)">{{ a.name }}</button>
          <small class="pm-muted">{{ fmtSize(a.size) }} · {{ a.byName }}</small>
          <button v-if="can()" class="btn btn-sm" style="margin-inline-start: auto" :disabled="busy" @click="removeAttachment(a.key)">✕</button>
        </div>
      </section>

      <section v-if="it.similar.length" class="card pm-panel wide">
        <h2>أصناف بأسماء قريبة</h2>
        <p class="pm-muted">راجعها لتجنب تكرار الصنف في الدليل.</p>
        <div class="pc-chips"><RouterLink v-for="s in it.similar" :key="s.id" :to="`/procurement/items/${s.id}`" class="pc-chip">{{ s.code }} {{ s.name }}</RouterLink></div>
      </section>

      <section class="card pm-panel wide">
        <h2>السجل التاريخي</h2>
        <ul class="pc-log"><li v-for="(l, k) in [...it.log].reverse()" :key="k"><div><b>{{ l.action }}</b> <span v-if="l.note">· {{ l.note }}</span><small>{{ l.byName }} · {{ fmtDateTime(l.at) }}</small></div></li></ul>
      </section>
    </div>

    <ItemForm v-if="editing" :item="it" @close="editing = false" @saved="load" />
    <div v-if="stopping" class="modal-backdrop" @click.self="stopping = false">
      <form class="card modal" @submit.prevent="doStop">
        <h2>إيقاف الصنف</h2>
        <p class="pm-muted">لا يُحذف الصنف، بل يُوقف عن الطلب والشراء ويبقى بسجله وحركاته.</p>
        <label class="field"><span>سبب الإيقاف *</span><input v-model="stop.reason" class="input" required minlength="3" /></label>
        <label class="field"><span>الصنف البديل (اختياري)</span>
          <select v-model="stop.replacedById" class="input"><option value="">—</option><option v-for="a in it.alternatives.filter((x: any) => x.item)" :key="a.itemId" :value="a.itemId">{{ a.item.code }} {{ a.item.name }}</option></select>
          <small class="pm-muted">يظهر هنا البدائل المعتمدة للصنف.</small>
        </label>
        <div class="modal-actions"><button class="btn btn-danger" :disabled="busy">إيقاف</button><button type="button" class="btn" @click="stopping = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
