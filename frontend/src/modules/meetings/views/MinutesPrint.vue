<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import MinutesDoc from '../components/MinutesDoc.vue';
import { fmtDateTime, type Snapshot } from '../lib';
import '../../projects/projects.css';
import '../meetings.css';

interface Print {
  draft: boolean; minutes: Snapshot; hash: string | null; verifyCode: string | null; issuedAt: string | null; adoptedAt: string | null; adoptionMethod: string | null; footer: string | null;
  signatures: { name: string; role: string; status: string; statusLabel: string; method: string | null; at: string | null; reason: string | null }[];
}
const props = defineProps<{ id: string }>();
const p = ref<Print | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    p.value = await api<Print>(`/meetings/m/${props.id}/minutes/print`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const verifyUrl = computed(() => (p.value?.verifyCode ? `${location.origin}/minutes/verify/${p.value.verifyCode}` : ''));
const METHOD_AR: Record<string, string> = { password: 'إلكتروني (كلمة المرور)', code: 'إلكتروني (رابط ورمز)', wet: 'توقيع حي' };
</script>

<template>
  <div>
    <div class="no-print" style="display: flex; gap: 8px; margin-bottom: 14px">
      <RouterLink :to="`/meetings/m/${id}`" class="btn btn-sm">→ العودة للاجتماع</RouterLink>
      <button v-if="p" class="btn btn-sm btn-primary" onclick="window.print()">🖨️ طباعة أو حفظ PDF</button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <MinutesDoc v-else-if="p" :m="p.minutes" :draft="p.draft" style="max-width: 860px; margin: 0 auto">
      <h3>التوقيعات</h3>
      <table>
        <thead><tr><th>الاسم</th><th>الصفة</th><th>الحالة</th><th>طريقة التوقيع والوقت</th><th style="width: 150px">التوقيع</th></tr></thead>
        <tbody>
          <tr v-for="(s, i) in p.signatures" :key="i">
            <td>{{ s.name }}</td><td>{{ s.role }}</td>
            <td>{{ p.draft ? '' : s.statusLabel }}<small v-if="s.reason" style="display: block; color: #b45309">{{ s.reason }}</small></td>
            <td style="font-size: .8rem">{{ s.method ? METHOD_AR[s.method] : '' }}<br />{{ s.at ? fmtDateTime(s.at) : '' }}</td>
            <td style="height: 46px">{{ s.status === 'signed' && s.method !== 'wet' ? '✔ موقّع إلكترونيًا' : '' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="p.hash" style="margin-top: 18px; font-size: .75rem; color: #475569; border-top: 1px solid #cbd5e1; padding-top: 8px">
        بصمة المحضر (SHA-256): <span class="mt-hash" style="color: #475569">{{ p.hash }}</span><br />
        رمز التحقق: <b dir="ltr">{{ p.verifyCode }}</b> · للتحقق: <span dir="ltr">{{ verifyUrl }}</span>
      </div>
      <p v-if="p.footer" style="font-size: .8rem; color: #475569; margin-top: 10px; white-space: pre-line">{{ p.footer }}</p>
    </MinutesDoc>
  </div>
</template>
