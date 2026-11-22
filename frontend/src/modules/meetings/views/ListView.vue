<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import MeetingCard from '../components/MeetingCard.vue';
import { addDays, kindOf, todayStr, type Body, type MeetingRow } from '../lib';
import '../../../shared/module.css';
import '../../comms/comms.css';
import '../meetings.css';

/** اجتماعات جهة من الجهات الأربع: الجمعية العمومية، مجلس الإدارة، اللجان، فرق العمل */
const props = defineProps<{ kind: string }>();
const router = useRouter();
const toast = useToast();
const K = computed(() => kindOf(props.kind));
const rows = ref<MeetingRow[] | null>(null);
const bodies = ref<Body[]>([]);
const error = ref('');
const f = reactive({ status: 'upcoming', bodyId: '', scope: '', q: '' });
const show = ref(false);
const busy = ref(false);
const n = reactive({ bodyId: '', title: '', meetingType: 'ordinary', mode: 'in_person', location: '', onlineLink: '', meetingDate: addDays(todayStr(), 7), startTime: '10:00', endTime: '12:00', objectives: '', isConfidential: false, agenda: '' });

async function load() {
  try {
    const qs = new URLSearchParams({ kind: props.kind });
    for (const k of ['status', 'bodyId', 'scope', 'q'] as const) if (f[k]) qs.set(k, f[k]);
    rows.value = await api<MeetingRow[]>(`/meetings/list?${qs}`);
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await load();
  bodies.value = await api<Body[]>(`/meetings/bodies?kind=${props.kind}`).catch(() => []);
});
watch(() => [f.status, f.bodyId, f.scope], load);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(() => f.q, () => { clearTimeout(timer); timer = setTimeout(load, 350); });
const organizable = computed(() => bodies.value.filter((b) => b.canOrganize && b.isActive));
function openNew() {
  const b = organizable.value[0];
  Object.assign(n, { bodyId: b?.id ?? '', title: '', meetingType: 'ordinary', isConfidential: b?.isConfidential ?? false, objectives: '', agenda: 'افتتاح الاجتماع واعتماد جدول الأعمال\nمتابعة توصيات الاجتماع السابق\n' });
  show.value = true;
}
watch(() => n.bodyId, (id) => { n.isConfidential = bodies.value.find((b) => b.id === id)?.isConfidential ?? n.isConfidential; });
async function create() {
  busy.value = true;
  try {
    const r = await api<{ id: string }>('/meetings', { method: 'POST', json: {
      ...n, location: n.location || null, onlineLink: n.onlineLink || null, endTime: n.endTime || null, objectives: n.objectives || null,
      agenda: n.agenda.split('\n').map((x) => x.trim()).filter(Boolean),
    } });
    toast.success('أُنشئت خطة الاجتماع');
    router.push(`/meetings/m/${r.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const TABS = [{ v: 'upcoming', l: 'القادمة' }, { v: 'open', l: 'محاضر قيد الإنجاز' }, { v: 'adopted', l: 'المعتمدة' }, { v: 'cancelled', l: 'الملغاة' }, { v: '', l: 'الكل' }];
</script>

<template>
  <div>
    <section class="pm-hero mt-hero">
      <div style="display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: flex-end">
        <div><p class="pm-kicker">الاجتماعات واللجان</p><h1>اجتماعات {{ K.label }}</h1><p class="pm-sub">{{ K.hint }}</p></div>
        <div class="pm-actions">
          <RouterLink :to="`/meetings/decisions?kind=${kind}`" class="btn cm-ghost">القرارات والتوصيات</RouterLink>
          <button v-if="organizable.length" class="btn mt-glow" @click="openNew">+ تخطيط اجتماع</button>
        </div>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="pm-tabs"><button v-for="t in TABS" :key="t.v" :class="['pm-tab', { on: f.status === t.v }]" @click="f.status = t.v">{{ t.l }}</button></div>
    <div class="cm-toolbar">
      <input v-model="f.q" class="input grow" placeholder="ابحث بالعنوان أو الرقم" />
      <select v-if="bodies.length > 1" v-model="f.bodyId" class="input"><option value="">كل الجهات</option><option v-for="b in bodies" :key="b.id" :value="b.id">{{ b.name }}</option></select>
      <select v-model="f.scope" class="input"><option value="">كل الاجتماعات</option><option value="mine">المدعو إليها فقط</option></select>
    </div>
    <div v-if="rows" class="mt-list"><MeetingCard v-for="(m, i) in rows" :key="m.id" :m="m" :i="i" /></div>
    <div v-if="rows && !rows.length" class="pm-empty card">لا توجد اجتماعات بهذا الفلتر.</div>
    <p v-if="!bodies.length" class="pm-muted" style="margin-top: 12px">لم تُعرَّف جهة لهذا النوع بعد. أضفها مع أعضائها من <RouterLink to="/meetings/bodies">المجالس واللجان</RouterLink>.</p>

    <div v-if="show" class="modal-backdrop" @click.self="show = false">
      <form class="modal card" style="max-width: 680px" @submit.prevent="create">
        <h2>تخطيط اجتماع</h2>
        <p class="pm-muted" style="margin-top: -6px">تُدعى الجهة بأعضائها تلقائيًا، وتمر الخطة على معتمدها ثم تصل الدعوات.</p>
        <label class="field"><span>الجهة</span><select v-model="n.bodyId" class="input" required><option v-for="b in organizable" :key="b.id" :value="b.id">{{ b.name }} ({{ b.members.length }} عضو)</option></select></label>
        <label class="field"><span>عنوان الاجتماع</span><input v-model="n.title" class="input" required minlength="3" placeholder="مثال: الاجتماع العادي الثالث لعام 2026" /></label>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0 12px">
          <label class="field"><span>نوعه</span><select v-model="n.meetingType" class="input"><option value="ordinary">عادي</option><option value="extraordinary">غير عادي</option></select></label>
          <label class="field"><span>التاريخ</span><input v-model="n.meetingDate" type="date" class="input" required /></label>
          <label class="field"><span>من</span><input v-model="n.startTime" type="time" class="input" required /></label>
          <label class="field"><span>إلى</span><input v-model="n.endTime" type="time" class="input" /></label>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 0 12px">
          <label class="field"><span>طريقة الانعقاد</span><select v-model="n.mode" class="input"><option value="in_person">حضوري</option><option value="online">عن بعد</option><option value="hybrid">حضوري وعن بعد</option></select></label>
          <label v-if="n.mode !== 'online'" class="field"><span>المكان</span><input v-model="n.location" class="input" /></label>
          <label v-else class="field"><span>رابط الاجتماع</span><input v-model="n.onlineLink" class="input" dir="ltr" /></label>
        </div>
        <label v-if="n.mode === 'hybrid'" class="field"><span>رابط الاجتماع</span><input v-model="n.onlineLink" class="input" dir="ltr" /></label>
        <label class="field"><span>أهداف الاجتماع</span><textarea v-model="n.objectives" class="input" rows="2" /></label>
        <label class="field"><span>بنود جدول الأعمال (بند في كل سطر، ويمكن تعديلها لاحقًا)</span><textarea v-model="n.agenda" class="input" rows="5" /></label>
        <label style="display: flex; gap: 8px; align-items: center"><input v-model="n.isConfidential" type="checkbox" /> اجتماع سري (لا يراه إلا المدعوون والأمانة)</label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">إنشاء الخطة</button><button type="button" class="btn" @click="show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
