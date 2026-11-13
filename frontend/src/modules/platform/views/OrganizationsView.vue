<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';

interface Org {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  userCount: number;
  modules: string[];
}
interface OptionalModule { code: string; name: string; description?: string }

const orgs = ref<Org[]>([]);
const optional = ref<OptionalModule[]>([]);
const error = ref('');

async function load() {
  try {
    [orgs.value, optional.value] = await Promise.all([
      api<Org[]>('/platform/organizations'),
      api<OptionalModule[]>('/platform/modules'),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

// ---- جمعية جديدة ----
const createOpen = ref(false);
const createError = ref('');
const saving = ref(false);
const form = reactive({ name: '', slug: '', adminFullName: '', adminEmail: '', adminPassword: '' });

function openCreate() {
  Object.assign(form, { name: '', slug: '', adminFullName: '', adminEmail: '', adminPassword: '' });
  createError.value = '';
  createOpen.value = true;
}
async function create() {
  createError.value = '';
  saving.value = true;
  try {
    await api('/platform/organizations', { method: 'POST', json: { ...form, slug: form.slug.trim().toLowerCase() } });
    createOpen.value = false;
    await load();
  } catch (e) {
    createError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

async function toggleActive(o: Org) {
  const verb = o.isActive ? 'إيقاف' : 'تفعيل';
  if (o.isActive && !confirm(`إيقاف "${o.name}"؟ لن يستطيع أي مستخدم فيها الدخول حتى تُفعّل مرة أخرى.`)) return;
  try {
    await api(`/platform/organizations/${o.id}`, { method: 'PATCH', json: { isActive: !o.isActive } });
    await load();
  } catch (e) {
    error.value = `تعذر ${verb} الجمعية: ${(e as Error).message}`;
  }
}

// ---- الوحدات الاختيارية ----
const modulesFor = ref<Org | null>(null);
const selectedModules = ref<string[]>([]);
function openModules(o: Org) {
  modulesFor.value = o;
  selectedModules.value = [...o.modules];
}
async function saveModules() {
  if (!modulesFor.value) return;
  try {
    await api(`/platform/organizations/${modulesFor.value.id}/modules`, { method: 'PUT', json: { modules: selectedModules.value } });
    modulesFor.value = null;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const moduleName = (code: string) => optional.value.find((m) => m.code === code)?.name ?? code;
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>الجمعيات</h1>
        <p class="muted">كل جمعية حساب مستقل ببياناتها ومستخدميها ومدير نظام خاص بها.</p>
      </div>
      <button class="btn btn-primary" @click="openCreate">+ جمعية جديدة</button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="card table-wrap">
      <table class="table">
        <thead>
          <tr><th>الجمعية</th><th>المعرف</th><th>المستخدمون</th><th>الخدمات الإضافية</th><th>الحالة</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="o in orgs" :key="o.id">
            <td>{{ o.name }}</td>
            <td dir="ltr" style="text-align: right"><code>{{ o.slug }}</code></td>
            <td>{{ o.userCount }}</td>
            <td>
              <span v-for="m in o.modules" :key="m" class="badge badge-primary">{{ moduleName(m) }}</span>
              <span v-if="!o.modules.length" class="muted">الأساسية فقط</span>
            </td>
            <td><span :class="['badge', o.isActive ? 'badge-success' : 'badge-muted']">{{ o.isActive ? 'نشطة' : 'موقوفة' }}</span></td>
            <td style="display: flex; gap: 6px">
              <button class="btn btn-sm" @click="openModules(o)">الخدمات</button>
              <button :class="['btn', 'btn-sm', o.isActive && 'btn-danger']" @click="toggleActive(o)">{{ o.isActive ? 'إيقاف' : 'تفعيل' }}</button>
            </td>
          </tr>
          <tr v-if="!orgs.length"><td colspan="6" class="muted" style="text-align: center">لا توجد جمعيات بعد. ابدأ بإضافة أول جمعية.</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="createOpen" class="modal-backdrop" @click.self="createOpen = false">
      <form class="card modal" @submit.prevent="create">
        <h2 style="margin-bottom: 16px">جمعية جديدة</h2>
        <div v-if="createError" class="alert alert-error">{{ createError }}</div>
        <div class="field"><label>اسم الجمعية</label><input v-model="form.name" class="input" required /></div>
        <div class="field">
          <label>المعرف (بالإنجليزية، مثل al-bir)</label>
          <input v-model="form.slug" class="input" dir="ltr" pattern="[a-z0-9\-]+" required />
        </div>
        <h2 style="margin: 18px 0 12px; font-size: 1rem">مدير نظام الجمعية</h2>
        <div class="field"><label>الاسم</label><input v-model="form.adminFullName" class="input" required /></div>
        <div class="field"><label>البريد الإلكتروني</label><input v-model="form.adminEmail" class="input" type="email" dir="ltr" required /></div>
        <div class="field"><label>كلمة المرور المبدئية (8 أحرف على الأقل)</label><input v-model="form.adminPassword" class="input" type="password" dir="ltr" minlength="8" required autocomplete="new-password" /></div>
        <div class="modal-actions">
          <button class="btn btn-primary" :disabled="saving">إنشاء الجمعية</button>
          <button type="button" class="btn" @click="createOpen = false">إلغاء</button>
        </div>
      </form>
    </div>

    <div v-if="modulesFor" class="modal-backdrop" @click.self="modulesFor = null">
      <div class="card modal">
        <h2 style="margin-bottom: 6px">خدمات {{ modulesFor.name }}</h2>
        <p class="muted" style="margin-top: 0">الوحدات الأساسية مفعلة دائمًا. فعّل الخدمات الإضافية التي اشتركت فيها الجمعية.</p>
        <div v-if="optional.length" style="display: flex; flex-direction: column; gap: 10px; margin: 12px 0">
          <label v-for="m in optional" :key="m.code" class="check">
            <input v-model="selectedModules" type="checkbox" :value="m.code" />
            <span><strong>{{ m.name }}</strong><br /><span class="muted">{{ m.description }}</span></span>
          </label>
        </div>
        <p v-else class="alert" style="background: var(--surface-2)">لا توجد خدمات إضافية مثبتة بعد. أول خدمة مخطط لها: الموقع الإلكتروني ومنصة التبرعات.</p>
        <div class="modal-actions">
          <button class="btn btn-primary" :disabled="!optional.length" @click="saveModules">حفظ</button>
          <button class="btn" @click="modulesFor = null">إغلاق</button>
        </div>
      </div>
    </div>
  </div>
</template>
