<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import '../modules/platform/platform.css';
import { ROLE, fmtDT } from './support';

/** فريق الدعم: إضافة الأعضاء وتحديد أدوارهم، مع حمل العمل الحالي */
interface Member { id: string; fullName: string; email: string; role: string; isActive: boolean; lastLoginAt: string | null; openTickets: number; openTasks: number; overdueTasks: number }
const toast = useToast();
const session = useSession();
const rows = ref<Member[]>([]);
const error = ref('');
const open = ref(false);
const busy = ref(false);
const formError = ref('');
const form = reactive({ fullName: '', email: '', password: '', role: 'support_agent' });

async function load() {
  try { rows.value = await api<Member[]>('/support-desk/team'); } catch (e) { error.value = (e as Error).message; }
}
onMounted(load);

async function add() {
  busy.value = true;
  formError.value = '';
  try {
    await api('/support-desk/team', { method: 'POST', json: form });
    toast.success(`تمت إضافة ${form.fullName} إلى فريق الدعم`);
    Object.assign(form, { fullName: '', email: '', password: '', role: 'support_agent' });
    open.value = false;
    load();
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function update(m: Member, json: Record<string, unknown>, msg: string) {
  try {
    await api(`/support-desk/team/${m.id}`, { method: 'PATCH', json });
    toast.success(msg);
    load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function resetPassword(m: Member) {
  const p = prompt(`كلمة مرور جديدة لـ ${m.fullName} (8 أحرف على الأقل، بحروف وأرقام)`);
  if (p) update(m, { password: p }, 'تم تغيير كلمة المرور');
}
const loginLink = `${location.origin}/login`;
</script>

<template>
  <div>
    <section class="p-hero">
      <div>
        <p class="p-kicker">الدعم الفني</p>
        <h1>فريق الدعم</h1>
        <p class="p-sub">أضف موظفي الدعم ومديريه. موظف الدعم يعمل على الطلبات والمهام المسندة له فقط، ومدير الدعم يوزّع الطلبات ويكلّف بالمهام ويرى تقييم الأداء. لا يرى أي منهم شاشات إدارة المنصة.</p>
      </div>
      <button class="btn btn-gold" @click="open = true">+ عضو جديد</button>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="p-link-box"><span>رابط دخول الفريق:</span><code>{{ loginLink }}</code></div>

    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>العضو</th><th>الدور</th><th>طلبات مفتوحة</th><th>مهام مفتوحة</th><th>آخر دخول</th><th>الحالة</th><th></th></tr></thead>
        <tbody>
          <tr v-for="m in rows" :key="m.id" :class="{ off: !m.isActive }">
            <td><b>{{ m.fullName }}</b><br /><small class="muted" dir="ltr">{{ m.email }}</small></td>
            <td>
              <span v-if="m.role === 'owner'" class="tone tone-info">{{ ROLE.owner }}</span>
              <select v-else class="input sel" :value="m.role" :disabled="m.id === session.user?.id" @change="update(m, { role: ($event.target as HTMLSelectElement).value }, 'تم تغيير الدور')">
                <option value="support_agent">{{ ROLE.support_agent }}</option>
                <option value="support_manager">{{ ROLE.support_manager }}</option>
              </select>
            </td>
            <td>{{ m.openTickets }}</td>
            <td>{{ m.openTasks }}<span v-if="m.overdueTasks" class="tone tone-bad late">{{ m.overdueTasks }} متأخرة</span></td>
            <td>{{ fmtDT(m.lastLoginAt) }}</td>
            <td><span :class="['tone', m.isActive ? 'tone-ok' : 'tone-muted']">{{ m.isActive ? 'نشط' : 'موقوف' }}</span></td>
            <td class="acts">
              <template v-if="m.role !== 'owner' && m.id !== session.user?.id">
                <button class="btn btn-sm" @click="resetPassword(m)">كلمة المرور</button>
                <button :class="['btn btn-sm', m.isActive ? 'btn-danger' : '']" @click="update(m, { isActive: !m.isActive }, m.isActive ? 'تم إيقاف الحساب' : 'تم تفعيل الحساب')">{{ m.isActive ? 'إيقاف' : 'تفعيل' }}</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="open" class="modal-backdrop" @click.self="open = false">
      <form class="card modal" @submit.prevent="add">
        <h2>عضو جديد في فريق الدعم</h2>
        <div class="field"><label>الاسم الكامل</label><input v-model="form.fullName" class="input" required minlength="2" /></div>
        <div class="field"><label>البريد الإلكتروني (للدخول)</label><input v-model="form.email" class="input" type="email" dir="ltr" required /></div>
        <div class="field"><label>كلمة المرور المبدئية</label><input v-model="form.password" class="input" type="text" dir="ltr" required minlength="8" /></div>
        <div class="field">
          <label>الدور</label>
          <select v-model="form.role" class="input">
            <option value="support_agent">{{ ROLE.support_agent }}: يعمل على الطلبات والمهام المسندة له</option>
            <option value="support_manager">{{ ROLE.support_manager }}: يوزّع ويكلّف ويقيّم الأداء</option>
          </select>
        </div>
        <div v-if="formError" class="alert alert-error">{{ formError }}</div>
        <div class="modal-actions">
          <button type="button" class="btn" @click="open = false">إلغاء</button>
          <button class="btn btn-primary" :disabled="busy">{{ busy ? 'جارٍ الحفظ...' : 'إضافة' }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.sel { width: auto; padding-block: 4px; }
.off { opacity: .6; }
.late { margin-inline-start: 6px; }
.acts { display: flex; gap: 6px; justify-content: flex-end; }
h2 { font-size: 1.1rem; margin-bottom: 14px; }
</style>
