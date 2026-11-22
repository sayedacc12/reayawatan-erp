<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import PageHead from '../PageHead.vue';
import Rich from '../Rich.vue';
import VisitorFields from '../VisitorFields.vue';
import { blankVisitor, setTitle, visitorBody } from '../parts';
import { AR, C, handoff, post, visitMeta } from '../site';

/** حجز جلسة التشخيص: المواعيد من إعداد الإتاحة في لوحة التحكم، والحجز يصل للنظام موعدًا وعميلًا محتملًا */
interface Day { date: string; label: string; slots: string[] }
const b = computed(() => C().booking ?? {});
const loading = ref(true);
const loadErr = ref('');
const enabled = ref(true);
const slotMinutes = ref(45);
const days = ref<Day[]>([]);
const day = ref<Day | null>(null);
const slot = ref('');
const visitor = reactive(blankVisitor());
const topic = ref('');
const extra = ref<{ calculator?: unknown; assessment?: unknown }>({});
const sending = ref(false);
const err = ref('');
const done = ref<{ label: string; manageToken?: string } | null>(null);

const time = (iso: string) => new Intl.DateTimeFormat('ar-SA-u-nu-arab', { timeZone: 'Asia/Riyadh', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const dayName = (d: Day) => new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-arab', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${d.date}T00:00:00Z`));
const dayDate = (d: Day) => new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-arab', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(new Date(`${d.date}T00:00:00Z`));

async function loadSlots() {
  loading.value = true;
  loadErr.value = '';
  try {
    const r = await fetch('/api/public/web/booking/slots');
    if (!r.ok) throw new Error('تعذر تحميل المواعيد، حاولوا بعد قليل');
    const data = await r.json();
    enabled.value = data.enabled;
    slotMinutes.value = data.slotMinutes;
    days.value = data.days;
    if (day.value) day.value = days.value.find((d) => d.date === day.value!.date) ?? null;
    if (!day.value) day.value = days.value[0] ?? null;
    if (slot.value && !day.value?.slots.includes(slot.value)) slot.value = '';
  } catch (e) {
    loadErr.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  setTitle('احجز جلسة تشخيص مجانية');
  topic.value = handoff.message.slice(0, 300);
  if (handoff.calculator) extra.value.calculator = handoff.calculator;
  if (handoff.assessment) extra.value.assessment = handoff.assessment;
  Object.assign(handoff, { message: '', service: '', calculator: null, assessment: null });
  loadSlots();
});

async function submit() {
  err.value = '';
  if (!slot.value) { err.value = 'اختاروا موعدًا من المواعيد المتاحة'; return; }
  if (!visitor.name.trim() || !visitor.email.trim()) { err.value = 'اكتبوا الاسم والبريد الإلكتروني'; return; }
  sending.value = true;
  try {
    const r = await post<{ label?: string; manageToken?: string }>('/booking', {
      ...visitorBody(visitor), ...visitMeta(), startsAt: slot.value, ...(topic.value.trim() ? { topic: topic.value.trim() } : {}), ...extra.value,
    });
    done.value = { label: r.label ?? '', manageToken: r.manageToken };
  } catch (e) {
    err.value = (e as Error).message;
    if (/لم يعد متاحًا/.test(err.value)) { slot.value = ''; loadSlots(); }
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <PageHead :title="b.title || 'احجز جلسة تشخيص مجانية'" :lead="b.intro" :crumbs="[{ l: 'حجز جلسة' }]" />
  <section class="band"><div class="wrap two-col">
    <div v-if="done" class="card ok-box" role="status">
      <h2>تم حجز الجلسة</h2>
      <p v-if="done.label">موعدكم: <b>{{ done.label }}</b></p>
      <p><Rich :text="b.meetingNote" /></p>
      <p v-if="done.manageToken" class="note">احتفظوا بهذا الرابط لإلغاء الموعد إن احتجتم: <RouterLink :to="`/book/manage/${done.manageToken}`">إدارة الموعد</RouterLink></p>
    </div>
    <div v-else-if="loading && !days.length" class="card"><p class="note">جارٍ تحميل المواعيد المتاحة…</p></div>
    <div v-else-if="loadErr" class="card"><p class="err">{{ loadErr }}</p><button class="btn" type="button" @click="loadSlots">إعادة المحاولة</button></div>
    <div v-else-if="!enabled || !days.length" class="card">
      <h2>{{ enabled ? 'لا توجد مواعيد متاحة حاليًا' : 'الحجز الإلكتروني متوقف مؤقتًا' }}</h2>
      <p>اتركوا لنا طلبكم وسنتواصل معكم لتحديد موعد مناسب.</p>
      <RouterLink class="btn btn-primary" to="/contact">طلب استشارة</RouterLink>
    </div>
    <form v-else class="card" novalidate @submit.prevent="submit">
      <h2>١. اختاروا اليوم</h2>
      <div class="slot-days" role="group" aria-label="الأيام المتاحة">
        <button v-for="d in days" :key="d.date" type="button" :aria-pressed="day?.date === d.date" @click="day = d; slot = ''"><span>{{ dayName(d) }}</span><small>{{ dayDate(d) }}</small></button>
      </div>
      <h2>٢. اختاروا الوقت</h2>
      <p class="note slot-hint">بتوقيت الرياض، ومدة الجلسة {{ AR(slotMinutes) }} دقيقة.</p>
      <div class="slot-times" role="group" aria-label="الأوقات المتاحة">
        <button v-for="s in day?.slots ?? []" :key="s" type="button" :aria-pressed="slot === s" @click="slot = s">{{ time(s) }}</button>
      </div>
      <h2>٣. بياناتكم</h2>
      <VisitorFields :model-value="visitor" phone idp="b" />
      <div class="field"><label for="b-topic">ما الذي تودون مناقشته؟</label><textarea id="b-topic" v-model="topic" class="input" maxlength="300" placeholder="التحدي الأهم الذي تواجهه منظمتكم الآن" /></div>
      <p v-if="extra.calculator || extra.assessment" class="note">سنرفق نتيجة {{ extra.calculator ? 'حاسبة مضاعف الأثر' : 'تقييم الجاهزية' }} مع الحجز ليطلع عليها المستشار.</p>
      <div v-if="slot" class="book-sum"><b>الموعد المختار</b><span>{{ day ? `${dayName(day)} ${dayDate(day)}` : '' }}، الساعة {{ time(slot) }}</span></div>
      <p v-if="err" class="err">{{ err }}</p>
      <button class="btn btn-primary" type="submit" :disabled="sending">{{ sending ? 'جارٍ الحجز…' : 'تأكيد الحجز' }}</button>
    </form>
    <aside style="display: grid; gap: 20px; align-content: start">
      <div class="side-box"><h3>ماذا يحدث في الجلسة؟</h3><ul class="checklist"><li>نتعرف على منظمتكم وبرامجها</li><li>نحدد معكم الأثر المستهدف</li><li>نقترح أين نضيف القيمة أولًا</li><li>بلا تكلفة وبلا التزام</li></ul></div>
      <div class="side-box"><h3>لم تجدوا موعدًا مناسبًا؟</h3><p class="note">أرسلوا طلبكم وسنقترح موعدًا آخر.</p><RouterLink class="btn" to="/contact">طلب استشارة</RouterLink></div>
    </aside>
  </div></section>
</template>
