<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { DAYS, type Any } from '../lib';
import '../../../shared/module.css';
import '../../../shared/ws.css';
import '../website.css';

const toast = useToast();
const b = ref<Any>(null);
const preview = ref<Any>(null);
const newBlackout = ref('');
const busy = ref(false);
async function load() {
  const secs = await api<Any[]>('/website/content');
  b.value = JSON.parse(JSON.stringify(secs.find((s) => s.key === 'booking').data));
  preview.value = await api('/website/bookings/preview').catch(() => null);
}
onMounted(() => load().catch((e) => toast.error((e as Error).message)));
function addSlot(day: number) { b.value.weekly.push({ day, from: '09:00', to: '13:00' }); }
function addBlackout() {
  if (newBlackout.value && !b.value.blackouts.includes(newBlackout.value)) b.value.blackouts.push(newBlackout.value);
  b.value.blackouts.sort();
  newBlackout.value = '';
}
async function save() {
  busy.value = true;
  try {
    await api('/website/content/booking', { method: 'PUT', json: { data: b.value } });
    toast.success('حُفظت أوقات الإتاحة');
    await load();
  } catch (e) { toast.error((e as Error).message); } finally { busy.value = false; }
}
</script>

<template>
  <div v-if="b">
    <div class="page-head">
      <div><h1>أوقات الإتاحة لجلسات التشخيص</h1><p class="muted" style="margin: 4px 0 0">الأوقات بتوقيت الرياض. يرى الزائر في الموقع المواعيد المتاحة فقط، ولا يُحجز موعد مرتين.</p></div>
      <button class="btn btn-primary" :disabled="busy" @click="save">حفظ</button>
    </div>
    <div class="rw-grid2">
      <section class="card ws-panel">
        <h2>الإعدادات</h2>
        <label class="check" style="margin-bottom: 12px"><input v-model="b.enabled" type="checkbox"> الحجز الإلكتروني مفعّل في الموقع</label>
        <div class="rw-grid3">
          <div class="field"><label>مدة الجلسة (دقيقة)</label><input v-model.number="b.slotMinutes" type="number" min="15" max="180" class="input"></div>
          <div class="field"><label>فاصل بين الجلسات</label><input v-model.number="b.bufferMinutes" type="number" min="0" max="120" class="input"></div>
          <div class="field"><label>أقل مدة قبل الموعد (ساعة)</label><input v-model.number="b.minNoticeHours" type="number" min="0" max="336" class="input"></div>
        </div>
        <div class="field"><label>يُتاح الحجز لعدد أيام مقدمًا</label><input v-model.number="b.horizonDays" type="number" min="1" max="90" class="input"></div>
        <div class="field"><label>عنوان صفحة الحجز</label><input v-model="b.title" class="input"></div>
        <div class="field"><label>مقدمة صفحة الحجز</label><textarea v-model="b.intro" class="input" rows="3" /></div>
        <div class="field"><label>ملاحظة الاجتماع (تظهر للعميل وفي رسالة التأكيد)</label><input v-model="b.meetingNote" class="input"></div>
      </section>
      <section class="card ws-panel">
        <h2>الإتاحة الأسبوعية</h2>
        <div v-for="(day, i) in DAYS" :key="i" style="border-bottom: 1px solid var(--border); padding: 8px 0">
          <div class="ws-row" style="justify-content: space-between"><b>{{ day }}</b><button class="btn btn-sm" @click="addSlot(i)">+ فترة</button></div>
          <div v-for="(w, j) in b.weekly.filter((x: Any) => x.day === i)" :key="j" class="ws-row">
            <span>من</span><input v-model="w.from" type="time" class="input" style="width: auto">
            <span>إلى</span><input v-model="w.to" type="time" class="input" style="width: auto">
            <button class="btn btn-sm btn-danger" @click="b.weekly.splice(b.weekly.indexOf(w), 1)">حذف</button>
          </div>
        </div>
        <h2 style="margin-top: 16px">أيام مغلقة (إجازات ومناسبات)</h2>
        <div class="ws-row"><input v-model="newBlackout" type="date" class="input" style="width: auto"><button class="btn btn-sm" @click="addBlackout">إضافة</button></div>
        <div class="rw-slots"><span v-for="d in b.blackouts" :key="d">{{ d }} <a href="#" @click.prevent="b.blackouts.splice(b.blackouts.indexOf(d), 1)">×</a></span></div>
      </section>
    </div>
    <section v-if="preview" class="card ws-panel" style="margin-top: 14px">
      <h2>المواعيد المتاحة الآن للزوار (حسب الإعدادات المحفوظة)</h2>
      <p v-if="!preview.enabled" class="ws-muted">الحجز متوقف.</p>
      <p v-else-if="!preview.days.length" class="ws-muted">لا مواعيد متاحة. راجعوا الإتاحة الأسبوعية.</p>
      <div v-for="d in preview.days.slice(0, 7)" :key="d.date" style="margin-bottom: 8px">
        <b>{{ d.label }}</b>
        <div class="rw-slots"><span v-for="s in d.slots" :key="s">{{ new Date(s).toLocaleTimeString('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }) }}</span></div>
      </div>
    </section>
  </div>
</template>
