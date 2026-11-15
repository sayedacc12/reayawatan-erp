<script setup lang="ts">
import { reactive, ref } from 'vue';
import { api } from '../api';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import { PRIORITY, SUPPORT_MANAGE, type SupportTask } from './support';

/** نافذة إنشاء مهمة عمل وتكليف عضو بها، من طلب صيانة أو مستقلة */
const props = defineProps<{ ticket?: { id: string; number: string; priority: string } | null; team: { id: string; fullName: string }[] }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', t: SupportTask): void }>();
const session = useSession();
const toast = useToast();
const manager = session.can(SUPPORT_MANAGE);
const form = reactive({
  title: '', description: '', assigneeId: manager ? '' : session.user!.id,
  priority: props.ticket?.priority ?? 'normal', dueAt: '', estimatedHours: '' as string | number,
});
const busy = ref(false);
const error = ref('');

async function save() {
  busy.value = true;
  error.value = '';
  try {
    const t = await api<SupportTask>('/support-desk/tasks', {
      method: 'POST',
      json: {
        title: form.title, description: form.description || undefined, assigneeId: form.assigneeId, priority: form.priority,
        ticketId: props.ticket?.id, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : undefined,
        estimatedHours: form.estimatedHours === '' ? undefined : Number(form.estimatedHours),
      },
    });
    toast.success(`تم إنشاء المهمة ${t.number} وتكليف ${t.assigneeName}`);
    emit('saved', t);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <form class="card modal" @submit.prevent="save">
      <h2>مهمة عمل جديدة<small v-if="ticket" class="muted"> على الطلب <span dir="ltr">{{ ticket.number }}</span></small></h2>
      <div class="field"><label>عنوان المهمة</label><input v-model="form.title" class="input" required minlength="3" maxlength="200" placeholder="مثال: مراجعة سجلات الخطأ وإصلاح الخلل" /></div>
      <div class="field"><label>التفاصيل (اختياري)</label><textarea v-model="form.description" class="input" rows="3" maxlength="5000" /></div>
      <div class="p-row-2">
        <div class="field">
          <label>المكلَّف</label>
          <select v-if="manager" v-model="form.assigneeId" class="input" required>
            <option value="" disabled>اختر من فريق الدعم</option>
            <option v-for="u in team" :key="u.id" :value="u.id">{{ u.fullName }}</option>
          </select>
          <input v-else class="input" :value="session.user!.fullName" disabled />
        </div>
        <div class="field"><label>الأولوية</label><select v-model="form.priority" class="input"><option v-for="(p, k) in PRIORITY" :key="k" :value="k">{{ p.icon }} {{ p.label }}</option></select></div>
      </div>
      <div class="p-row-2">
        <div class="field">
          <label>موعد التسليم (اختياري)</label>
          <input v-model="form.dueAt" class="input" type="datetime-local" />
          <small class="muted">{{ ticket ? 'إن تُرك: موعد حل الطلب' : 'إن تُرك: مهلة الحل لمستوى الأولوية' }}</small>
        </div>
        <div class="field"><label>الساعات المقدّرة (اختياري)</label><input v-model="form.estimatedHours" class="input" type="number" min="0.25" step="0.25" /></div>
      </div>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <div class="modal-actions">
        <button type="button" class="btn" @click="emit('close')">إلغاء</button>
        <button class="btn btn-primary" :disabled="busy">{{ busy ? 'جارٍ الحفظ...' : 'إنشاء المهمة' }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
textarea.input { width: 100%; resize: vertical; }
h2 { font-size: 1.1rem; margin-bottom: 14px; }
</style>
