<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';

/** إعدادات التطوير والتدريب: مراحل اعتماد الخطط، وأنواع الأنشطة التطويرية */
interface Res { config: { stages: { name: string; roleId: string | null }[]; activityTypes: { code: string; name: string }[] }; roles: { id: string; name: string }[] }
const toast = useToast();
const roles = ref<{ id: string; name: string }[]>([]);
const f = reactive({ stages: [] as { name: string; roleId: string }[], activityTypes: [] as { code: string; name: string }[] });
function fill(r: Res) {
  roles.value = r.roles;
  f.stages = r.config.stages.map((s) => ({ name: s.name, roleId: s.roleId ?? '' }));
  f.activityTypes = r.config.activityTypes.map((t) => ({ ...t }));
}
onMounted(async () => {
  try {
    fill(await api<Res>('/hr/development/config'));
  } catch (e) {
    toast.error((e as Error).message);
  }
});
async function save() {
  try {
    fill(await api<Res>('/hr/development/config', {
      method: 'PUT',
      json: {
        stages: f.stages.filter((s) => s.name.trim()).map((s) => ({ name: s.name.trim(), roleId: s.roleId || null })),
        activityTypes: f.activityTypes.filter((t) => t.code.trim() || t.name.trim()).map((t) => ({ code: t.code.trim(), name: t.name.trim() })),
      },
    }));
    toast.success('حُفظت إعدادات التطوير والتدريب');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function move(i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= f.stages.length) return;
  [f.stages[i], f.stages[j]] = [f.stages[j], f.stages[i]];
}
</script>

<template>
  <div class="hr-grid">
    <section class="card pm-panel">
      <h2>مراحل اعتماد خطط التطوير</h2>
      <p class="pm-muted">تمر كل خطة تطوير (فردية أو للصف الثاني) بهذه المراحل بالترتيب، ولكل مرحلة دور مسؤول (فارغ = أي مستخدم معه صلاحية اعتماد الخطط). بدون مراحل يعتمدها صاحب الصلاحية مباشرة عند الرفع.</p>
      <div v-for="(s, i) in f.stages" :key="i" style="display: grid; grid-template-columns: 28px 1fr 1fr auto auto auto; gap: 6px; margin-bottom: 8px; align-items: center">
        <span class="pm-tag" style="text-align: center">{{ i + 1 }}</span>
        <input v-model="s.name" class="input" placeholder="اسم المرحلة" />
        <select v-model="s.roleId" class="input"><option value="">أي معتمد</option><option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option></select>
        <button type="button" class="btn btn-sm" :disabled="i === 0" @click="move(i, -1)">▲</button>
        <button type="button" class="btn btn-sm" :disabled="i === f.stages.length - 1" @click="move(i, 1)">▼</button>
        <button type="button" class="btn btn-sm" @click="f.stages.splice(i, 1)">✕</button>
      </div>
      <button type="button" class="btn btn-sm" :disabled="f.stages.length >= 8" @click="f.stages.push({ name: '', roleId: '' })">+ مرحلة</button>
    </section>
    <section class="card pm-panel">
      <h2>أنواع الأنشطة التطويرية</h2>
      <p class="pm-muted">تظهر هذه الأنواع عند إضافة نشاط في الخطة. الرمز بالإنجليزية الصغيرة ولا يتغير، ولا يُحذف نوع مستخدم في خطط سابقة.</p>
      <div v-for="(t, i) in f.activityTypes" :key="i" style="display: grid; grid-template-columns: 140px 1fr auto; gap: 6px; margin-bottom: 8px; align-items: center">
        <input v-model="t.code" class="input hr-code" placeholder="course" />
        <input v-model="t.name" class="input" placeholder="اسم النوع" />
        <button type="button" class="btn btn-sm" :disabled="f.activityTypes.length === 1" @click="f.activityTypes.splice(i, 1)">✕</button>
      </div>
      <button type="button" class="btn btn-sm" :disabled="f.activityTypes.length >= 30" @click="f.activityTypes.push({ code: '', name: '' })">+ نوع</button>
      <div class="modal-actions"><button class="btn btn-primary" @click="save">حفظ</button></div>
    </section>
  </div>
</template>
