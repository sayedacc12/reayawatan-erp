<script setup lang="ts">
import { reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { todayStr } from '../lib';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ doc?: any; lookups: any }>();
const emit = defineEmits<{ (e: 'saved', d: any): void; (e: 'close'): void }>();
const toast = useToast();
const d = props.doc;
const f = reactive({
  code: d?.code ?? '', title: d?.title ?? '', categoryId: d?.categoryId ?? null, docType: d?.docType ?? 'policy', summary: d?.summary ?? '', content: d?.content ?? '',
  tags: (d?.tags ?? []).join('، '), version: d?.version ?? '1.0', issuedOn: d?.issuedOn ?? todayStr(), reviewOn: d?.reviewOn ?? '', ownerName: d?.ownerName ?? '',
  approvedBy: d?.approvedBy ?? '', externalUrl: d?.externalUrl ?? '',
});
const file = ref<File | null>(null);
const busy = ref(false);

async function save() {
  busy.value = true;
  try {
    const body = {
      ...f, code: f.code.trim() || null, tags: f.tags.split(/[،,]/).map((x: string) => x.trim()).filter(Boolean), reviewOn: f.reviewOn || null, issuedOn: f.issuedOn || null,
      summary: f.summary || null, content: f.content || null, ownerName: f.ownerName || null, approvedBy: f.approvedBy || null, externalUrl: f.externalUrl.trim() || null,
    };
    let r: any = d ? await api(`/knowledge/documents/${d.id}`, { method: 'PUT', json: body }) : await api('/knowledge/documents', { method: 'POST', json: body });
    if (file.value) {
      const fd = new FormData();
      fd.append('file', file.value);
      r = await api(`/knowledge/documents/${r.id}/file`, { method: 'POST', body: fd });
    }
    toast.success(d ? 'حُفظت التعديلات' : 'أُضيفت الوثيقة كمسودة');
    emit('saved', r);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal modal-wide card">
      <h2 style="margin-bottom: 14px">{{ d ? 'تعديل الوثيقة' : 'وثيقة جديدة' }}</h2>
      <div class="ws-grid3">
        <label class="field" style="grid-column: span 2"><span>العنوان *</span><input v-model="f.title" class="input" /></label>
        <label class="field"><span>الرمز</span><input v-model="f.code" class="input" placeholder="مثل: ل-05 أو QP-HR-01" /></label>
        <label class="field"><span>النوع</span><select v-model="f.docType" class="input"><option v-for="(l, k) in lookups.types" :key="k" :value="k">{{ l }}</option></select></label>
        <label class="field"><span>التصنيف</span><select v-model="f.categoryId" class="input"><option :value="null">بدون تصنيف</option><option v-for="c in lookups.categories.filter((x: any) => x.isActive)" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
        <label class="field"><span>الإصدار</span><input v-model="f.version" class="input" dir="ltr" /></label>
        <label class="field"><span>تاريخ الإصدار</span><input v-model="f.issuedOn" type="date" class="input" /></label>
        <label class="field"><span>موعد المراجعة القادمة</span><input v-model="f.reviewOn" type="date" class="input" /></label>
        <label class="field"><span>الجهة المالكة</span><input v-model="f.ownerName" class="input" placeholder="مثل: الإدارة المالية" /></label>
        <label class="field"><span>الجهة المعتمدة</span><input v-model="f.approvedBy" class="input" placeholder="مثل: مجلس الإدارة" /></label>
        <label class="field" style="grid-column: span 2"><span>الكلمات المفتاحية (افصل بفاصلة)</span><input v-model="f.tags" class="input" /></label>
      </div>
      <label class="field"><span>ملخص</span><textarea v-model="f.summary" class="input" rows="2" /></label>
      <label class="field"><span>المحتوى المكتوب (اختياري، للأدلة القصيرة والدروس المستفادة)</span><textarea v-model="f.content" class="input" rows="5" /></label>
      <div class="ws-grid2">
        <label class="field"><span>{{ d?.hasFile ? 'استبدال ملف الإصدار الحالي' : 'ملف الوثيقة (PDF أو صورة)' }}</span><input type="file" accept="application/pdf,image/*" class="input" @change="file = ($event.target as HTMLInputElement).files?.[0] ?? null" /></label>
        <label class="field"><span>أو رابط خارجي</span><input v-model="f.externalUrl" class="input" dir="ltr" placeholder="https://" /></label>
      </div>
      <p class="ws-muted">تُحفظ الوثيقة الجديدة مسودة، ثم ينشرها من يملك صلاحية النشر داخليًا أو في الموقع. لرفع إصدار جديد مع حفظ السابق استخدم «إصدار جديد» من صفحة الوثيقة.</p>
      <div class="modal-actions"><button class="btn btn-primary" :disabled="busy" @click="save">حفظ</button><button class="btn" @click="emit('close')">إلغاء</button></div>
    </div>
  </div>
</template>
