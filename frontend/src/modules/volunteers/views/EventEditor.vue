<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import DynFields from '../components/DynFields.vue';
import { addDays, loadLookups, lookups, todayStr } from '../lib';
import '../../projects/projects.css';
import '../volunteers.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id?: string }>();
const router = useRouter();
const toast = useToast();
const error = ref('');
const busy = ref(false);
const f = reactive({
  title: '', kind: 'field' as 'field' | 'online', categoryCode: '', fieldCodes: [] as string[], description: '', objectives: '', location: '', platform: '', onlineLink: '',
  startDate: addDays(todayStr(), 7), endDate: addDays(todayStr(), 7), startTime: '09:00', endTime: '13:00', plannedHours: 4, volunteersNeeded: 10,
  targetBeneficiaries: 0, budget: 0, supervisorName: '', answers: {} as Record<string, unknown>,
});
onMounted(async () => {
  await loadLookups(true).catch((e) => (error.value = (e as Error).message));
  if (props.id) {
    const e = await api<any>(`/volunteers/events/${props.id}`);
    Object.keys(f).forEach((k) => {
      if (e[k] !== undefined && e[k] !== null) (f as any)[k] = e[k];
    });
    f.answers = { ...e.answers };
  }
});
const toggle = (v: string) => {
  const i = f.fieldCodes.indexOf(v);
  if (i >= 0) f.fieldCodes.splice(i, 1);
  else f.fieldCodes.push(v);
};
async function save(submit = false) {
  error.value = '';
  busy.value = true;
  try {
    const body = {
      ...f, categoryCode: f.categoryCode || null, description: f.description || null, objectives: f.objectives || null, location: f.location || null,
      platform: f.platform || null, onlineLink: f.onlineLink || null, startTime: f.startTime || null, endTime: f.endTime || null, supervisorName: f.supervisorName || null,
    };
    const e = props.id
      ? await api<{ id: string }>(`/volunteers/events/${props.id}`, { method: 'PATCH', json: body })
      : await api<{ id: string }>('/volunteers/events', { method: 'POST', json: body });
    if (submit) await api(`/volunteers/events/${e.id}/submit`, { method: 'POST' });
    toast.success(submit ? 'أُرسلت الفعالية للاعتماد' : 'حُفظت الفعالية مسودة');
    router.push(`/volunteers/events/${e.id}`);
  } catch (e) {
    error.value = (e as Error).message;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <section class="pm-hero vt-hero">
      <div><p class="pm-kicker">نموذج الفعالية</p><h1>{{ id ? 'تعديل الفعالية' : 'فعالية تطوعية جديدة' }}</h1>
        <p class="pm-sub">اختر نوع الفعالية أولًا: الميدانية لها موقع، والتي عن بعد لها منصة ورابط. الحقول الإضافية في آخر النموذج يحددها مدير النظام من الإعدادات.</p></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <form v-if="lookups" class="card pm-panel" @submit.prevent="save(false)">
      <div class="vt-tabs">
        <button type="button" :class="['vt-tab', { on: f.kind === 'field' }]" @click="f.kind = 'field'">📍 فعالية ميدانية</button>
        <button type="button" :class="['vt-tab', { on: f.kind === 'online' }]" @click="f.kind = 'online'">💻 فعالية عن بعد</button>
      </div>
      <div class="pm-grid2">
        <label class="field" style="grid-column: 1 / -1"><span>اسم الفعالية *</span><input v-model="f.title" class="input" required /></label>
        <label class="field"><span>تصنيف الفعالية</span>
          <select v-model="f.categoryCode" class="input"><option value="">بدون تصنيف</option><option v-for="c in lookups.eventCategories.filter((x) => x.isActive || x.code === f.categoryCode)" :key="c.code" :value="c.code">{{ c.name }}</option></select>
        </label>
        <label class="field"><span>مشرف الفعالية</span><input v-model="f.supervisorName" class="input" /></label>
      </div>
      <div class="field"><span>مجالات التطوع في الفعالية</span>
        <div class="vt-chips"><button v-for="x in lookups.volunteerFields.filter((y) => y.isActive || f.fieldCodes.includes(y.code))" :key="x.code" type="button" :class="['vt-chip', { on: f.fieldCodes.includes(x.code) }]" @click="toggle(x.code)">{{ x.name }}</button></div>
      </div>
      <Transition name="page" mode="out-in">
        <div v-if="f.kind === 'field'" key="f"><label class="field"><span>موقع الفعالية *</span><input v-model="f.location" class="input" placeholder="المكان والحي والمدينة" /></label></div>
        <div v-else key="o" class="pm-grid2">
          <label class="field"><span>المنصة</span><input v-model="f.platform" class="input" placeholder="Zoom أو Microsoft Teams..." /></label>
          <label class="field"><span>رابط الدخول</span><input v-model="f.onlineLink" class="input" dir="ltr" placeholder="https://" /></label>
        </div>
      </Transition>
      <div class="vt-sec">الموعد والساعات</div>
      <div class="vt-fields">
        <label class="field"><span>تاريخ البداية *</span><input v-model="f.startDate" type="date" class="input" required /></label>
        <label class="field"><span>تاريخ النهاية *</span><input v-model="f.endDate" type="date" class="input" required /></label>
        <label class="field"><span>من الساعة</span><input v-model="f.startTime" type="time" class="input" /></label>
        <label class="field"><span>إلى الساعة</span><input v-model="f.endTime" type="time" class="input" /></label>
        <label class="field"><span>الساعات التطوعية لكل متطوع</span><input v-model.number="f.plannedHours" type="number" min="0" step="0.5" class="input" /></label>
      </div>
      <div class="vt-sec">المستهدفات</div>
      <div class="vt-fields">
        <label class="field"><span>عدد المتطوعين المطلوب</span><input v-model.number="f.volunteersNeeded" type="number" min="0" class="input" /></label>
        <label class="field"><span>عدد المستفيدين المستهدف</span><input v-model.number="f.targetBeneficiaries" type="number" min="0" class="input" /></label>
        <label class="field"><span>الميزانية التقديرية (ريال)</span><input v-model.number="f.budget" type="number" min="0" class="input" /></label>
      </div>
      <label class="field"><span>وصف الفعالية</span><textarea v-model="f.description" class="input" rows="3" /></label>
      <label class="field"><span>الأهداف</span><textarea v-model="f.objectives" class="input" rows="2" /></label>
      <template v-if="lookups.eventFields.length">
        <div class="vt-sec">بيانات إضافية</div>
        <DynFields v-model="f.answers" :fields="lookups.eventFields" />
      </template>
      <div class="modal-actions">
        <button class="btn" :disabled="busy">حفظ مسودة</button>
        <button type="button" class="btn btn-primary" :disabled="busy" @click="save(true)">حفظ وإرسال للاعتماد</button>
        <button type="button" class="btn" @click="$router.back()">إلغاء</button>
      </div>
      <p class="pm-muted">مراحل الاعتماد الحالية: {{ lookups.stages.map((s) => s.name).join(' ← ') }}</p>
    </form>
  </div>
</template>
