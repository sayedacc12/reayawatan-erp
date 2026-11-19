<script setup lang="ts">
/** فتح بطاقة الأصل من ملصق QR: الرابط يحمل رمز الأصل */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../../api';
import { AF } from '../../assets';

const props = defineProps<{ code: string }>();
const router = useRouter();
const error = ref('');
onMounted(async () => {
  try {
    const a = await api<{ id: string }>(`${AF}/by-code/${encodeURIComponent(props.code)}`);
    router.replace(`/accounting/assets/${a.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>

<template>
  <div class="card" style="padding: 24px; text-align: center">
    <p v-if="!error">جارٍ فتح بطاقة الأصل <b>{{ code }}</b>...</p>
    <div v-else class="alert alert-error">{{ error }}</div>
  </div>
</template>
