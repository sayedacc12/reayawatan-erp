
<script setup lang="ts">
import { reactive } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { addDays, fmtDate, TASK_STATUS, todayStr, type Lookups } from '../lib';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * مهام المتابعة المزمنة: الإضافة على مصدر (طلب تغيير أو أزمة)، والإسناد لجهة من الهيكل التنظيمي ومسؤول،
 * وتحديث الإنجاز من المسؤول، والإغلاق بتوثيق ما تم.
 */
const props = defineProps<{ tasks: any[]; addPath?: string; canManage: boolean; lookups: Lookups | null; showSource?: boolean }>();
const emit = defineEmits<{ (e: 'changed'): void }>();
const session = useSession();
const toast = useToast();
const form = reactive({ show: false, id: '', title: '', description: '', unitId: '', assigneeUserId: '', startDate: todayStr(), dueDate: addDays(14) });
const prog = reactive({ show: false, id: '', title: '', status: 'in_progress', progress: 0, completionNote: '' });

function openNew() {
  Object.assign(form, { show: true, id: '', title: '', description: '', unitId: '', assigneeUserId: '', startDate: todayStr(), dueDate: addDays(14) });
}
function openEdit(t: any) {
  Object.assign(form, { show: true, id: t.id, title: t.title, description: t.description ?? '', unitId: t.unitId ?? '', assigneeUserId: t.assigneeUserId ?? '', startDate: t.startDate ?? '', dueDate: t.dueDate });
}
async function save() {
  try {
    const json = { title: form.title, description: form.description || null, unitId: form.unitId || null, assigneeUserId: form.assigneeUserId || null, startDate: form.startDate || null, dueDate: form.dueDate };
    await api(form.id ? `/risk/tasks/${form.id}` : props.addPath!, { method: form.id ? 'PATCH' : 'POST', json });
    form.show = false;
    toast.success('حُفظت المهمة');
    emit('changed');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const canProgress = (t: any) => props.canManage || t.assigneeUserId === session.user?.id;
function openProgress(t: any) {
  Object.assign(prog, { show: true, id: t.id, title: t.title, status: t.status === 'open' ? 'in_progress' : t.status, progress: t.progress, completionNote: t.completionNote ?? '' });
}
async function saveProgress() {
  try {
    await api(`/risk/tasks/${prog.id}/progress`, { method: 'POST', json: { status: prog.status, progress: prog.progress, completionNote: prog.completionNote || null } });
    prog.show = false;
    toast.success('حُدّث الإنجاز');
    emit('changed');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove(t: any) {
  if (!confirm('حذف المهمة؟')) return;
  try {
    await api(`/risk/tasks/${t.id}`, { method: 'DELETE' });
    emit('changed');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <p v-if="!tasks.length" class="pm-empty">لا توجد مهام</p>
    <div v-else class="table-wrap"><table class="table">
      <thead><tr><th v-if="showSource">المصدر</th><th>المهمة</th><th>الجهة المسؤولة</th><th>المسؤول</th><th>الاستحقاق</th><th>الإنجاز</th><th /></tr></thead>
      <tbody><tr v-for="t in tasks" :key="t.id">
        <td v-if="showSource"><RouterLink v-if="t.source" :to="t.sourceType === 'change' ? `/risk/changes/${t.sourceId}` : `/risk/crisis/event/${t.sourceId}`" class="rk-code pm-link">{{ t.source.code }}</RouterLink></td>
        <td style="white-space: normal; min-width: 180px"><b>{{ t.title }}</b><span v-if="t.completionNote" class="pm-muted">✓ {{ t.completionNote }}</span></td>
        <td>{{ t.unitName ?? '—' }}</td><td>{{ t.assigneeName ?? '—' }}</td>
        <td :style="{ color: t.overdue ? 'var(--danger)' : '' }">{{ fmtDate(t.dueDate) }}<span v-if="t.overdue" class="pm-muted" style="color: var(--danger)">متأخرة</span></td>
        <td style="min-width: 130px"><span class="pm-pill" :style="{ '--c': TASK_STATUS[t.status].color }">{{ TASK_STATUS[t.status].label }}</span>
          <div class="pm-bar" style="margin-top: 4px"><i :style="{ width: t.progress + '%', background: TASK_STATUS[t.status].color }" /></div></td>
        <td>
          <button v-if="canProgress(t) && t.status !== 'cancelled'" class="btn btn-sm" @click="openProgress(t)">الإنجاز</button>
          <button v-if="canManage && t.status !== 'done' && addPath !== undefined" class="btn btn-sm" @click="openEdit(t)">تعديل</button>
          <button v-if="canManage && t.status === 'open' && !t.progress" class="btn btn-sm" @click="remove(t)">✕</button>
        </td>
      </tr></tbody>
    </table></div>
    <button v-if="canManage && addPath" class="btn btn-sm" style="margin-top: 10px" @click="openNew">+ مهمة متابعة</button>

    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" @submit.prevent="save">
        <h2>{{ form.id ? 'تعديل المهمة' : 'مهمة متابعة جديدة' }}</h2>
        <label class="field"><span>المهمة</span><input v-model="form.title" class="input" /></label>
        <label class="field"><span>الجهة المسؤولة (من الهيكل التنظيمي)</span><select v-model="form.unitId" class="input"><option value="">—</option><option v-for="u in lookups?.units" :key="u.id" :value="u.id">{{ '— '.repeat(u.level) }}{{ u.name }}</option></select></label>
        <label class="field"><span>الموظف المسؤول</span><select v-model="form.assigneeUserId" class="input"><option value="">—</option><option v-for="u in lookups?.users" :key="u.id" :value="u.id">{{ u.fullName }}</option></select></label>
        <div class="pm-grid2">
          <label class="field"><span>البداية</span><input v-model="form.startDate" type="date" class="input" /></label>
          <label class="field"><span>الاستحقاق</span><input v-model="form.dueDate" type="date" class="input" /></label>
        </div>
        <label class="field"><span>التفاصيل</span><textarea v-model="form.description" class="input" rows="2" /></label>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="form.show = false">إلغاء</button></div>
      </form>
    </div>
    <div v-if="prog.show" class="modal-backdrop" @click.self="prog.show = false">
      <form class="card modal" @submit.prevent="saveProgress">
        <h2>إنجاز: {{ prog.title }}</h2>
        <label class="field"><span>الحالة</span><select v-model="prog.status" class="input"><option v-for="(s, k) in TASK_STATUS" :key="k" :value="k" :disabled="k === 'cancelled' && !canManage">{{ s.label }}</option></select></label>
        <label class="field"><span>نسبة الإنجاز {{ prog.progress }}%</span><input v-model.number="prog.progress" type="range" min="0" max="100" step="5" /></label>
        <label class="field"><span>توثيق ما تم {{ prog.status === 'done' ? '(إلزامي للإغلاق)' : '' }}</span><textarea v-model="prog.completionNote" class="input" rows="3" /></label>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="prog.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
