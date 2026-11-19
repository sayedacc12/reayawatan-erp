<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { fmtDateTime } from '../modules/procurement/lib';
import { strongPasswordProblem } from '../validation';
import { loadMe, me, setMe, supplierApi } from './supplier';

const busy = ref(false);
const error = ref('');
const ok = ref('');
const roles = ref<Record<string, string>>({});
const f = ref({ fullName: '', email: '', phone: '', role: 'sales', password: '' });
const pwProblem = computed(() => strongPasswordProblem(f.value.password));
onMounted(async () => {
  try {
    await loadMe(true);
    roles.value = (await supplierApi(`/o/${me.value.organization.slug}`)).portalRoles;
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const m = computed(() => me.value);
async function act(fn: () => Promise<any>, msg: string) {
  busy.value = true;
  error.value = '';
  ok.value = '';
  try {
    setMe(await fn());
    ok.value = msg;
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    return false;
  } finally {
    busy.value = false;
  }
}
async function add() {
  if (pwProblem.value) { error.value = pwProblem.value; return; }
  if (await act(() => supplierApi('/users', { method: 'POST', json: { ...f.value, phone: f.value.phone || null } }), 'أُضيف المستخدم. أبلغه بكلمة المرور، وسيُطلب منه تغييرها عند أول دخول ✓')) {
    f.value = { fullName: '', email: '', phone: '', role: 'sales', password: '' };
  }
}
const update = (u: any, patch: Record<string, unknown>) => act(() => supplierApi(`/users/${u.id}`, { method: 'PATCH', json: patch }), 'حُفظ التعديل');
</script>

<template>
  <div>
    <div class="page-head"><div><h1>مستخدمو البوابة</h1><p class="muted">أضف موظفي منشأتك بأدوار: المبيعات للمستندات والعروض، والمالية للحساب البنكي والفواتير، والاطلاع فقط.</p></div></div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="ok" class="alert alert-success">{{ ok }}</div>
    <template v-if="m && m.user.role === 'owner'">
      <div class="card table-wrap" style="margin-bottom: 16px">
        <table class="table">
          <thead><tr><th>المستخدم</th><th>البريد</th><th>الدور</th><th>آخر دخول</th><th /></tr></thead>
          <tbody>
            <tr v-for="u in m.users" :key="u.id" :style="{ opacity: u.isActive ? 1 : .55 }">
              <td><b>{{ u.fullName }}</b></td>
              <td dir="ltr" style="text-align: start">{{ u.email }}</td>
              <td><select :value="u.role" class="input" :disabled="u.id === m.user.id || busy" @change="update(u, { role: ($event.target as HTMLSelectElement).value })"><option v-for="(l, k) in roles" :key="k" :value="k">{{ l }}</option></select></td>
              <td style="font-size: .82rem">{{ fmtDateTime(u.lastLoginAt) }}</td>
              <td><button v-if="u.id !== m.user.id" class="btn btn-sm" :disabled="busy" @click="update(u, { isActive: !u.isActive })">{{ u.isActive ? 'إيقاف' : 'تفعيل' }}</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <section class="card pm-panel">
        <h2>إضافة مستخدم</h2>
        <form class="pc-fields" @submit.prevent="add">
          <label class="field"><span>الاسم *</span><input v-model="f.fullName" class="input" required /></label>
          <label class="field"><span>البريد *</span><input v-model="f.email" class="input" type="email" dir="ltr" required /></label>
          <label class="field"><span>الجوال</span><input v-model="f.phone" class="input" dir="ltr" /></label>
          <label class="field"><span>الدور</span><select v-model="f.role" class="input"><option v-for="(l, k) in roles" :key="k" :value="k">{{ l }}</option></select></label>
          <label class="field"><span>كلمة مرور مؤقتة *</span><input v-model="f.password" class="input" dir="ltr" required /><small v-if="pwProblem" class="field-error">{{ pwProblem }}</small></label>
          <div class="field" style="justify-content: flex-end"><button class="btn btn-primary" :disabled="busy">إضافة</button></div>
        </form>
      </section>
    </template>
    <p v-else-if="m" class="card pc-empty">إدارة المستخدمين لمدير الحساب فقط.</p>
  </div>
</template>
