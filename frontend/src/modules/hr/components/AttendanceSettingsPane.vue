<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { fmtDate } from '../lib';

/** إعدادات الحضور: الدوام وأيام الراحة والعطل الرسمية، وأجهزة البصمة المرتبطة */
interface Device { id: string; name: string; brand: string | null; serialNumber: string; location: string | null; isActive: boolean; lastSeenAt: string | null; punchCount: number }
interface Settings { config: { enabled: boolean; workStart: string; workEnd: string; weekend: number[]; holidays: { date: string; name: string }[] }; devices: Device[] }
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const toast = useToast();
const cfg = reactive({ enabled: false, workStart: '08:00', workEnd: '15:00', weekend: [5, 6] as number[], holidays: [] as { date: string; name: string }[] });
const devices = ref<Device[]>([]);
const origin = window.location.origin;
function fill(s: Settings) {
  Object.assign(cfg, { ...s.config, holidays: s.config.holidays.map((h) => ({ ...h })) });
  devices.value = s.devices;
}
onMounted(async () => {
  try {
    fill(await api<Settings>('/hr/attendance/settings'));
  } catch (e) {
    toast.error((e as Error).message);
  }
});
function toggleDay(d: number) {
  cfg.weekend = cfg.weekend.includes(d) ? cfg.weekend.filter((x) => x !== d) : [...cfg.weekend, d];
}
async function save() {
  try {
    fill(await api<Settings>('/hr/attendance/settings', { method: 'PUT', json: { ...cfg, holidays: cfg.holidays.filter((h) => h.date && h.name) } }));
    toast.success('حُفظت إعدادات الحضور');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const editing = ref<Device | null>(null);
const dev = reactive({ show: false, name: '', brand: 'ZKTeco', serialNumber: '', location: '', isActive: true });
function openDevice(d?: Device) {
  editing.value = d ?? null;
  Object.assign(dev, { show: true, name: d?.name ?? '', brand: d?.brand ?? 'ZKTeco', serialNumber: d?.serialNumber ?? '', location: d?.location ?? '', isActive: d?.isActive ?? true });
}
async function saveDevice() {
  try {
    const body = { name: dev.name, brand: dev.brand || null, serialNumber: dev.serialNumber.trim(), location: dev.location || null, isActive: dev.isActive };
    fill(editing.value
      ? await api<Settings>(`/hr/attendance/devices/${editing.value.id}`, { method: 'PUT', json: body })
      : await api<Settings>('/hr/attendance/devices', { method: 'POST', json: body }));
    dev.show = false;
    toast.success('حُفظ الجهاز');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function removeDevice() {
  if (!editing.value || !confirm('حذف الجهاز؟')) return;
  try {
    fill(await api<Settings>(`/hr/attendance/devices/${editing.value.id}`, { method: 'DELETE' }));
    dev.show = false;
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const ago = (d: string | null) => {
  if (!d) return 'لم يتصل بعد';
  const m = Math.round((Date.now() - Date.parse(d)) / 60000);
  return m < 2 ? 'متصل الآن' : m < 60 ? `آخر اتصال قبل ${m} دقيقة` : `آخر اتصال ${new Date(d).toLocaleString('ar-SA-u-ca-gregory')}`;
};
</script>

<template>
  <div class="hr-grid">
    <section class="card pm-panel">
      <h2>الدوام والعطل</h2>
      <label class="field" style="flex-direction: row; gap: 8px; align-items: center"><input v-model="cfg.enabled" type="checkbox" />
        <span><b>تفعيل احتساب الحضور في مسير الرواتب</b> (الغياب والتأخير يُخصمان حسب اللائحة)</span></label>
      <div class="pm-grid2">
        <label class="field"><span>بداية الدوام</span><input v-model="cfg.workStart" type="time" class="input" /></label>
        <label class="field"><span>نهاية الدوام</span><input v-model="cfg.workEnd" type="time" class="input" /></label>
      </div>
      <div class="field"><span>أيام الراحة الأسبوعية</span>
        <div class="hr-tabs" style="margin: 4px 0 0"><button v-for="(d, i) in DAYS" :key="i" type="button" :class="['hr-tab', { on: cfg.weekend.includes(i) }]" @click="toggleDay(i)">{{ d }}</button></div>
      </div>
      <div class="hr-sec">العطل الرسمية</div>
      <div v-for="(h, i) in cfg.holidays" :key="i" style="display: grid; grid-template-columns: 160px 1fr auto; gap: 6px; margin-bottom: 6px">
        <input v-model="h.date" type="date" class="input" /><input v-model="h.name" class="input" placeholder="مثل: اليوم الوطني" />
        <button type="button" class="btn btn-sm" @click="cfg.holidays.splice(i, 1)">✕</button>
      </div>
      <button type="button" class="btn btn-sm" @click="cfg.holidays.push({ date: '', name: '' })">+ عطلة</button>
      <p class="pm-muted" style="margin-top: 10px">فترة السماح في التأخير ونسب الخصم تُضبط في <RouterLink to="/hr/policy" class="pm-link">لائحة الموارد البشرية</RouterLink> (تبويب الرواتب).</p>
      <div class="modal-actions"><button class="btn btn-primary" @click="save">حفظ</button></div>
    </section>
    <section class="card pm-panel">
      <div class="pm-row-head"><h2>أجهزة البصمة</h2><button class="btn hr-glow" @click="openDevice()">+ جهاز</button></div>
      <p class="pm-muted">الأجهزة التي تدعم الإرسال التلقائي (ADMS / Push، مثل أغلب أجهزة ZKTeco الحديثة) ترسل البصمات للنظام أولًا بأول. من قائمة الجهاز: الاتصال ← إعدادات الخادم السحابي (Cloud Server)، واكتب:</p>
      <dl class="pm-dl" style="grid-template-columns: 1fr 1fr; margin-bottom: 10px">
        <div><dt>عنوان الخادم</dt><dd class="hr-code">{{ origin.replace(/^https?:\/\//, '') }}</dd></div>
        <div><dt>المنفذ</dt><dd class="hr-code">{{ origin.startsWith('https') ? 443 : 80 }}</dd></div>
      </dl>
      <p class="pm-muted">ثم سجّل الجهاز هنا برقمه التسلسلي (SN) المكتوب في «معلومات الجهاز». الأجهزة التي لا تدعم الإرسال التلقائي: صدّر منها ملف الحضور وارفعه من شاشة الحضور والانصراف.</p>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الجهاز</th><th>الرقم التسلسلي</th><th>الحالة</th><th>البصمات</th><th></th></tr></thead>
          <tbody>
            <tr v-for="d in devices" :key="d.id" :style="{ opacity: d.isActive ? 1 : .5 }">
              <td><b>{{ d.name }}</b><span class="pm-muted">{{ [d.brand, d.location].filter(Boolean).join(' · ') }}</span></td>
              <td class="hr-code">{{ d.serialNumber }}</td>
              <td>{{ d.isActive ? ago(d.lastSeenAt) : 'موقوف' }}</td>
              <td class="hr-num">{{ d.punchCount }}</td>
              <td><button class="btn btn-sm" @click="openDevice(d)">تعديل</button></td>
            </tr>
            <tr v-if="!devices.length"><td colspan="5" class="pm-empty">لم يُسجل جهاز بعد</td></tr>
          </tbody>
        </table>
      </div>
      <p v-if="devices.some((d) => d.lastSeenAt)" class="pm-muted">آخر بيانات وصلت: {{ fmtDate(devices.map((d) => d.lastSeenAt ?? '').sort().at(-1)) }}</p>
    </section>
    <div v-if="dev.show" class="modal-backdrop" @click.self="dev.show = false">
      <form class="card modal" @submit.prevent="saveDevice">
        <h2>{{ editing ? 'تعديل الجهاز' : 'جهاز بصمة جديد' }}</h2>
        <label class="field"><span>الاسم</span><input v-model="dev.name" class="input" required placeholder="مثل: جهاز المقر الرئيسي" /></label>
        <div class="pm-grid2">
          <label class="field"><span>الشركة المصنعة</span><input v-model="dev.brand" class="input" /></label>
          <label class="field"><span>الرقم التسلسلي (SN)</span><input v-model="dev.serialNumber" class="input hr-code" required /></label>
        </div>
        <label class="field"><span>الموقع</span><input v-model="dev.location" class="input" placeholder="مثل: مدخل الموظفين" /></label>
        <label class="field" style="flex-direction: row; gap: 8px; align-items: center"><input v-model="dev.isActive" type="checkbox" /> <span>الجهاز مفعّل</span></label>
        <div class="modal-actions">
          <button class="btn btn-primary">حفظ</button>
          <button v-if="editing" type="button" class="btn btn-danger" @click="removeDevice">حذف</button>
          <button type="button" class="btn" @click="dev.show = false">إلغاء</button>
        </div>
      </form>
    </div>
  </div>
</template>
