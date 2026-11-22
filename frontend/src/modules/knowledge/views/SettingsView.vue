<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { useToast } from '../../../stores/toast';
import '../../../shared/ws.css';
import StarterSettings from '../../../components/StarterSettings.vue';

/* eslint-disable @typescript-eslint/no-explicit-any */
const toast = useToast();
const tab = ref<'categories' | 'permissions'>('categories');
const cats = ref<any[]>([]);
const busy = ref(false);
onMounted(async () => {
  try {
    cats.value = await api('/knowledge/categories');
  } catch (e) {
    toast.error((e as Error).message);
  }
});
function move(i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= cats.value.length) return;
  [cats.value[i], cats.value[j]] = [cats.value[j], cats.value[i]];
}
async function save() {
  busy.value = true;
  try {
    cats.value = await api('/knowledge/categories', { method: 'PUT', json: { categories: cats.value.map((c) => ({ id: c.id, name: c.name, description: c.description || null, color: c.color, isActive: c.isActive })) } });
    toast.success('حُفظت التصنيفات');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-head"><div><h1>إعدادات أرشيف المعرفة</h1><p class="muted">تصنيفات الوثائق، وصلاحيات الأرشيف على أدوار الشركة.</p></div></div>
    <StarterSettings module="knowledge" />
    <div class="ws-tabs"><button :class="['ws-tab', { on: tab === 'categories' }]" @click="tab = 'categories'">التصنيفات</button><button :class="['ws-tab', { on: tab === 'permissions' }]" @click="tab = 'permissions'">الصلاحيات</button></div>
    <section v-if="tab === 'categories'" class="card ws-panel" style="max-width: 900px">
      <p class="ws-muted">التصنيف الذي فيه وثائق لا يُحذف، أوقفه بدلًا من ذلك. ترتيب التصنيفات هو ترتيبها في الأرشيف وفي صفحة الحوكمة بالموقع.</p>
      <div v-for="(c, i) in cats" :key="c.id ?? i" class="ws-row">
        <input v-model="c.color" type="color" style="width: 42px; height: 38px; border: 1px solid var(--border); border-radius: 8px" />
        <input v-model="c.name" class="input" placeholder="اسم التصنيف" style="flex: 1; min-width: 160px" />
        <input v-model="c.description" class="input" placeholder="وصف مختصر" style="flex: 2; min-width: 200px" />
        <label class="check"><input v-model="c.isActive" type="checkbox" /> مفعّل</label>
        <button class="btn btn-sm" @click="move(i, -1)">↑</button><button class="btn btn-sm" @click="move(i, 1)">↓</button>
        <button class="btn btn-sm btn-danger" @click="cats.splice(i, 1)">حذف</button>
      </div>
      <div class="modal-actions" style="justify-content: space-between">
        <button class="btn" @click="cats.push({ name: '', description: '', color: '#164e38', isActive: true })">+ تصنيف</button>
        <button class="btn btn-primary" :disabled="busy" @click="save">حفظ التصنيفات</button>
      </div>
    </section>
    <ModulePermissionsPane v-else module="knowledge" />
  </div>
</template>
