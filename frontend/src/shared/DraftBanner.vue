<script setup lang="ts">
/** شريط المسودة أعلى النموذج: استعادة مسودة سابقة أو تجاهلها، وحالة الحفظ التلقائي */
withDefaults(defineProps<{ found: { at: number } | null; savedAt: number | null; note?: string }>(), { note: '' });
const emit = defineEmits<{ restore: []; discard: [] }>();
const time = (t: number) => new Date(t).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
</script>

<template>
  <div v-if="found" class="draft-bar" role="status">
    <span>📝 لديك مسودة غير محفوظة من {{ time(found.at) }}.</span>
    <span class="draft-acts">
      <button type="button" class="btn btn-sm btn-primary" @click="emit('restore')">استعادة المسودة</button>
      <button type="button" class="btn btn-sm" @click="emit('discard')">تجاهلها</button>
    </span>
  </div>
  <p v-else-if="savedAt" class="draft-saved">حُفظت مسودة على جهازك تلقائيًا ({{ time(savedAt) }}). تُحذف عند الحفظ أو تسجيل الخروج أو بعد 7 أيام.{{ note ? ` ${note}` : '' }}</p>
</template>

<style scoped>
.draft-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; margin: 0 0 12px; padding: 8px 12px;
  border-radius: 10px; background: var(--primary-soft); color: var(--primary); font-size: .9rem; }
.draft-acts { display: flex; gap: 6px; }
.draft-saved { margin: 0 0 10px; color: var(--muted); font-size: .8rem; }
</style>
