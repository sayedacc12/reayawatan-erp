<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { fmtDate, hijri } from '../lib';

interface Letter { letterNo: string; date: string; body: string; organizationName: string; templateName: string; signedBy: string }
const props = defineProps<{ id: string }>();
const letter = ref<Letter | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    const r = await api<{ status: string; result: Letter | null }>(`/hr/me/requests/${props.id}`);
    if (r.status !== 'approved' || !r.result?.body) throw new Error('الخطاب لم يُعتمد بعد');
    letter.value = r.result;
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const print = () => window.print();
</script>

<template>
  <div>
    <div class="ess-actions no-print" style="margin-bottom: 14px">
      <RouterLink :to="`/me/requests/${id}`" class="btn btn-sm">→ العودة للطلب</RouterLink>
      <button v-if="letter" class="btn btn-sm btn-primary" @click="print">🖨️ طباعة أو حفظ PDF</button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <article v-else-if="letter" class="ess-letter">
      <header>
        <div>
          <h2>{{ letter.organizationName }}</h2>
          <p class="pm-muted" style="margin: 4px 0 0">{{ letter.templateName }}</p>
        </div>
        <div class="meta">
          <div>الرقم: <b>{{ letter.letterNo }}</b></div>
          <div>التاريخ: {{ fmtDate(letter.date) }}</div>
          <div>الموافق: {{ hijri(letter.date) }}</div>
        </div>
      </header>
      <div class="body">{{ letter.body }}</div>
      <footer>
        <div>
          <div>شؤون الموظفين</div>
          <b>{{ letter.signedBy }}</b>
          <div>التوقيع: ....................</div>
        </div>
      </footer>
      <span class="seal">{{ letter.organizationName }}<br />شؤون الموظفين</span>
    </article>
    <div v-else class="ess-skeleton"><i /><i /></div>
  </div>
</template>
