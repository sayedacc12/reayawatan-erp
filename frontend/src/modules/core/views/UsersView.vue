<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { passwordProblem } from '../../../validation';
import TempPasswordDialog from '../../../components/TempPasswordDialog.vue';
import type { RoleRow, UserRow } from '../types';

const session = useSession();
const toast = useToast();
const canManage = computed(() => session.can('core.users.manage'));
const users = ref<UserRow[]>([]);
const roles = ref<RoleRow[]>([]);
const search = ref('');
const loadError = ref('');

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return users.value;
  return users.value.filter((u) => u.fullName.toLowerCase().includes(q) || u.email.includes(q));
});

// ---- استعادة كلمة المرور: طلبات «نسيت كلمة المرور» وكلمات المرور المؤقتة ----
interface ResetRow {
  id: string; userId: string | null; name: string; origin: 'request' | 'direct'; superadmin: boolean;
  status: 'pending' | 'issued' | 'completed' | 'cancelled' | 'expired'; requestIp: string | null;
  createdAt: string; issuedAt: string | null; issuedBy: string | null; expiresAt: string | null; completedAt: string | null;
}
const resets = ref<{ pending: ResetRow[]; log: ResetRow[] }>({ pending: [], log: [] });
const showLog = ref(false);
const temp = ref<{ name: string; login: string; password: string; expiresAt: string } | null>(null);
const RESET_STATUS: Record<ResetRow['status'], [string, string]> = {
  pending: ['بانتظار التسليم', 'badge-amber'], issued: ['سُلّمت كلمة مؤقتة', 'badge-primary'], completed: ['غيّرها صاحبها', 'badge-success'],
  cancelled: ['أُلغيت', 'badge-muted'], expired: ['انتهت صلاحيتها', 'badge-muted'],
};
const loginUrl = computed(() => `${location.origin}/o/${session.user?.organizationSlug ?? ''}`);
async function issueTemp(userId: string, name: string) {
  if (!confirm(`إصدار كلمة مرور مؤقتة لـ "${name}"؟ تتوقف كلمة مروره الحالية وتنتهي جلساته المفتوحة فورًا.`)) return;
  try {
    temp.value = await api<{ name: string; login: string; password: string; expiresAt: string; fullName: string }>(`/users/${userId}/temp-password`, { method: 'POST' })
      .then((r) => ({ ...r, name: r.fullName }));
    await loadResets();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function loadResets() {
  if (canManage.value) resets.value = await api('/users/password-resets');
}

async function load() {
  try {
    users.value = await api<UserRow[]>('/users');
    await loadResets();
    if (session.can('core.roles.read')) roles.value = await api<RoleRow[]>('/roles');
  } catch (e) {
    loadError.value = (e as Error).message;
  }
}
onMounted(load);

// ---- نموذج الإضافة/التعديل ----
const editing = ref<UserRow | null>(null);
const open = ref(false);
const formError = ref('');
const saving = ref(false);
const form = reactive({ fullName: '', email: '', password: '', isActive: true, isSuperadmin: false, roleIds: [] as string[] });

function openForm(u?: UserRow) {
  editing.value = u ?? null;
  formError.value = '';
  Object.assign(form, {
    fullName: u?.fullName ?? '',
    email: u?.email ?? '',
    password: '',
    isActive: u?.isActive ?? true,
    isSuperadmin: u?.isSuperadmin ?? false,
    roleIds: u?.roles.map((r) => r.id) ?? [],
  });
  open.value = true;
}

const pwProblem = computed(() => passwordProblem(form.password));

async function save() {
  formError.value = '';
  if (pwProblem.value) {
    formError.value = pwProblem.value;
    return;
  }
  saving.value = true;
  try {
    const body: Record<string, unknown> = {
      fullName: form.fullName, email: form.email, isActive: form.isActive, roleIds: form.roleIds,
    };
    if (session.user?.isSuperadmin) body.isSuperadmin = form.isSuperadmin;
    if (form.password) body.password = form.password;
    if (editing.value) {
      await api(`/users/${editing.value.id}`, { method: 'PATCH', json: body });
    } else {
      await api('/users', { method: 'POST', json: { ...body, password: form.password } });
    }
    open.value = false;
    toast.success(editing.value ? 'تم حفظ تعديلات المستخدم' : 'تمت إضافة المستخدم');
    await load();
    if (editing.value?.id === session.user?.id) await session.refresh();
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

function formatDate(d: string | null) {
  return d ? new Date(d).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}
</script>

<template>
  <div>
    <div class="page-head">
      <h1>المستخدمون</h1>
      <div style="display: flex; gap: 8px">
        <input v-model="search" class="input" placeholder="بحث بالاسم أو البريد" style="width: 220px" />
        <button v-if="canManage" class="btn btn-primary" @click="openForm()">+ مستخدم جديد</button>
      </div>
    </div>
    <div v-if="loadError" class="alert alert-error">{{ loadError }}</div>
    <section v-if="canManage && resets.pending.length" class="card pr-box">
      <h2>طلبات نسيت كلمة المرور ({{ resets.pending.length }})</h2>
      <p class="muted">تأكد أن الطلب من صاحب الحساب نفسه (اتصال أو حضور)، ثم أصدر له كلمة مرور مؤقتة وسلّمها له.</p>
      <div v-for="r in resets.pending" :key="r.id" class="pr-row">
        <div><b>{{ r.name }}</b> <span v-if="r.superadmin" class="badge badge-primary">مدير نظام</span><div class="muted small">طلبها {{ formatDate(r.createdAt) }}</div></div>
        <button v-if="r.userId && (!r.superadmin || session.user?.isSuperadmin)" class="btn btn-primary btn-sm" @click="issueTemp(r.userId, r.name)">إصدار كلمة مرور مؤقتة</button>
        <span v-else class="muted small">يصدرها مدير النظام</span>
      </div>
    </section>
    <div class="card table-wrap">
      <table class="table">
        <thead>
          <tr><th>الاسم</th><th>البريد الإلكتروني</th><th>الأدوار</th><th>الحالة</th><th>آخر دخول</th><th v-if="canManage"></th></tr>
        </thead>
        <tbody>
          <tr v-for="u in filtered" :key="u.id">
            <td>{{ u.fullName }}</td>
            <td dir="ltr" style="text-align: right">{{ u.email }}</td>
            <td>
              <span v-if="u.isSuperadmin" class="badge badge-primary">مدير نظام الجمعية</span>
              <span v-for="r in u.roles" :key="r.id" class="badge">{{ r.name }}</span>
              <span v-if="!u.isSuperadmin && !u.roles.length" class="muted">بدون دور</span>
            </td>
            <td><span :class="['badge', u.isActive ? 'badge-success' : 'badge-muted']">{{ u.isActive ? 'نشط' : 'موقوف' }}</span></td>
            <td class="muted">{{ formatDate(u.lastLoginAt) }}</td>
            <td v-if="canManage" class="row-actions">
              <button class="btn btn-sm" @click="openForm(u)">تعديل</button>
              <button v-if="u.id !== session.user?.id && u.isActive && (!u.isSuperadmin || session.user?.isSuperadmin)" class="btn btn-sm" title="كلمة مرور مؤقتة يغيّرها عند أول دخول" @click="issueTemp(u.id, u.fullName)">كلمة مؤقتة</button>
            </td>
          </tr>
          <tr v-if="!filtered.length"><td colspan="6" class="muted" style="text-align: center">لا يوجد مستخدمون</td></tr>
        </tbody>
      </table>
    </div>

    <section v-if="canManage && resets.log.length" class="pr-log">
      <button class="btn btn-sm" @click="showLog = !showLog">{{ showLog ? 'إخفاء' : 'عرض' }} سجل استعادة كلمات المرور</button>
      <div v-if="showLog" class="card table-wrap" style="margin-top: 10px">
        <table class="table">
          <thead><tr><th>الحساب</th><th>الطريقة</th><th>التاريخ</th><th>سلّمها</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="r in resets.log" :key="r.id">
              <td>{{ r.name }}</td>
              <td>{{ r.origin === 'request' ? 'طلب من «نسيت كلمة المرور»' : 'إصدار مباشر' }}</td>
              <td class="muted">{{ formatDate(r.createdAt) }}</td>
              <td>{{ r.issuedBy ?? '—' }}<div v-if="r.issuedAt" class="muted small">{{ formatDate(r.issuedAt) }}</div></td>
              <td><span :class="['badge', RESET_STATUS[r.status][1]]">{{ RESET_STATUS[r.status][0] }}</span><div v-if="r.completedAt" class="muted small">{{ formatDate(r.completedAt) }}</div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <TempPasswordDialog v-if="temp" :name="temp.name" :login="temp.login" :password="temp.password" :expires-at="temp.expiresAt" :login-url="loginUrl" :place="session.user?.organizationName ?? undefined" @close="temp = null" />

    <div v-if="open" class="modal-backdrop" @click.self="open = false" @keydown.esc="open = false">
      <form class="card modal" @submit.prevent="save">
        <h2 style="margin-bottom: 16px">{{ editing ? 'تعديل مستخدم' : 'مستخدم جديد' }}</h2>
        <div v-if="formError" class="alert alert-error">{{ formError }}</div>
        <div class="field"><label>الاسم الكامل</label><input v-model="form.fullName" class="input" required /></div>
        <div class="field"><label>البريد الإلكتروني</label><input v-model="form.email" class="input" type="email" dir="ltr" required /></div>
        <div class="field">
          <label>{{ editing ? 'كلمة مرور جديدة (اتركها فارغة لعدم التغيير)' : 'كلمة المرور (8 أحرف على الأقل)' }}</label>
          <input v-model="form.password" :class="['input', { invalid: pwProblem }]" type="password" dir="ltr" minlength="8" :required="!editing" autocomplete="new-password" />
          <small v-if="pwProblem" class="field-error">{{ pwProblem }}</small>
        </div>
        <div class="field">
          <label>الأدوار</label>
          <div v-if="roles.length" class="roles-pick">
            <label v-for="r in roles" :key="r.id" class="check">
              <input v-model="form.roleIds" type="checkbox" :value="r.id" /> {{ r.name }}
            </label>
          </div>
          <span v-else class="muted">لا توجد أدوار بعد، أنشئها من شاشة الأدوار والصلاحيات.</span>
        </div>
        <div class="field" style="flex-direction: row; gap: 24px">
          <label class="check"><input v-model="form.isActive" type="checkbox" /> الحساب نشط</label>
          <label v-if="session.user?.isSuperadmin" class="check"><input v-model="form.isSuperadmin" type="checkbox" /> مدير نظام الجمعية (كل الصلاحيات)</label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" :disabled="saving">حفظ</button>
          <button type="button" class="btn" @click="open = false">إلغاء</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.pr-box { padding: 16px 18px; margin-bottom: 14px; border-inline-start: 4px solid #f59e0b; }
.pr-box h2 { font-size: 1.05rem; margin: 0 0 4px; }
.pr-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 0; border-top: 1px solid var(--border); flex-wrap: wrap; }
.pr-log { margin-top: 14px; }
.badge-amber { background: #fef3c7; color: #92400e; border-color: transparent; }
.small { font-size: .82rem; }
.row-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.roles-pick { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; }
</style>
