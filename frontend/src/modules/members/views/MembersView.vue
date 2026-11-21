<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import PersonForm from '../components/PersonForm.vue';
import StatusPill from '../components/StatusPill.vue';
import { MEMBER_STATUS, P, exportCsv, fmtDate, loadLookups, lookups, type MemberRow } from '../lib';
import '../../../shared/module.css';
import '../members.css';

const session = useSession();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const rows = ref<MemberRow[]>([]);
const error = ref('');
const q = reactive({ status: (route.query.status as string) ?? 'current', search: '', type: '', gender: '', voting: '' });
const showNew = ref(false);
const busy = ref(false);
const form = ref<InstanceType<typeof PersonForm> | null>(null);

async function load() {
  try {
    const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    rows.value = await api<MemberRow[]>(`/members/members?${params}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await loadLookups().catch(() => null);
  await load();
});
let timer: ReturnType<typeof setTimeout> | undefined;
watch(() => ({ ...q }), () => {
  clearTimeout(timer);
  timer = setTimeout(load, 250);
});

async function create(data: Record<string, unknown>) {
  busy.value = true;
  try {
    const m = await api<{ id: string }>('/members/members', { method: 'POST', json: data });
    showNew.value = false;
    toast.success('أُضيف العضو إلى السجل');
    router.push(`/members/list/${m.id}`);
  } catch (e) {
    form.value?.setError((e as Error).message);
  } finally {
    busy.value = false;
  }
}
function exportRows() {
  exportCsv('سجل الأعضاء', ['رقم العضوية', 'الاسم', 'الهوية', 'الجوال', 'البريد', 'الجنس', 'الجنسية', 'المدينة', 'النوع', 'الانضمام', 'نهاية العضوية', 'الحالة', 'حق التصويت'],
    rows.value.map((r) => [r.memberNo, r.fullName, r.nationalId, r.mobile, r.email, r.gender === 'female' ? 'أنثى' : 'ذكر', r.nationality, r.city, r.typeName, r.joinedOn, r.endDate, r.statusLabel, r.voting ? 'نعم' : 'لا']));
}
</script>

<template>
  <div>
    <section class="pm-hero mb-hero">
      <div><p class="pm-kicker">الأعضاء</p><h1>سجل الأعضاء</h1>
        <p class="pm-sub">كل أعضاء الجمعية العمومية ببياناتهم ومستنداتهم وحالة عضويتهم وحق التصويت. أضف الأعضاء القائمين قبل تشغيل النظام من «إضافة عضو قائم».</p></div>
      <div class="pm-actions">
        <button v-if="session.can(P.members)" class="btn mb-glow" @click="showNew = true">إضافة عضو قائم</button>
        <button class="btn mb-ghost" @click="exportRows">تصدير Excel</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="mb-toolbar">
      <input v-model="q.search" class="input grow" placeholder="بحث بالاسم أو الهوية أو الجوال أو رقم العضوية" />
      <select v-model="q.status" class="input"><option value="">كل الحالات</option><option v-for="s in MEMBER_STATUS" :key="s.value" :value="s.value">{{ s.label }}</option></select>
      <select v-model="q.type" class="input"><option value="">كل الأنواع</option><option v-for="t in lookups?.types" :key="t.code" :value="t.code">{{ t.name }}</option></select>
      <select v-model="q.gender" class="input"><option value="">الجنسان</option><option value="male">ذكور</option><option value="female">إناث</option></select>
      <label class="mb-chip" style="cursor: pointer"><input v-model="q.voting" type="checkbox" true-value="1" false-value="" /> أصحاب حق التصويت</label>
    </div>
    <section class="card pm-panel">
      <p class="pm-muted" style="margin-top: 0">{{ rows.length }} عضو</p>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>رقم العضوية</th><th>العضو</th><th>النوع</th><th>الانضمام</th><th>نهاية العضوية</th><th>التصويت</th><th>الحالة</th></tr></thead>
          <TransitionGroup tag="tbody" name="page">
            <tr v-for="r in rows" :key="r.id" class="mb-row" @click="$router.push(`/members/list/${r.id}`)">
              <td class="mb-code"><b>{{ r.memberNo }}</b></td>
              <td><b>{{ r.fullName }}</b><span class="pm-muted" style="display: block"><span class="mb-code">{{ r.mobile }}</span> · {{ r.nationality }}{{ r.city ? ` · ${r.city}` : '' }}</span></td>
              <td><span class="pm-tag" :style="{ background: r.typeColor + '22', color: r.typeColor }">{{ r.typeName }}</span></td>
              <td>{{ fmtDate(r.joinedOn) }}</td>
              <td>{{ fmtDate(r.endDate) }}<span v-if="r.daysLeft >= 0 && r.daysLeft <= 60" class="pm-muted" style="display: block">بعد {{ r.daysLeft }} يوم</span></td>
              <td><span v-if="r.voting" class="pm-tag" style="background: #dbeafe; color: #1e3a8a">🗳 له حق</span><span v-else class="pm-muted" :title="r.votingNote ?? ''">—</span></td>
              <td><StatusPill :status="r.status" :label="r.statusLabel" /></td>
            </tr>
            <tr v-if="!rows.length" key="empty"><td colspan="7" class="pm-empty">لا يوجد أعضاء بهذه التصفية</td></tr>
          </TransitionGroup>
        </table>
      </div>
    </section>
    <div v-if="showNew && lookups" class="modal-backdrop" @click.self="showNew = false">
      <div class="card modal modal-wide">
        <h2>إضافة عضو قائم</h2>
        <p class="pm-muted">لعضو انضم قبل تشغيل النظام. حدد تاريخ انضمامه وبداية عضويته الحالية، ويُحسب تاريخ الانتهاء تلقائيًا إن تركته فارغًا. ارفع صورة الهوية من ملفه بعد الإضافة.</p>
        <PersonForm ref="form" mode="direct" :types="lookups.types" :nationalities="lookups.nationalities" :fields="lookups.applicationFields" :busy="busy"
          submit-label="إضافة إلى السجل" @submit="create" @cancel="showNew = false" />
      </div>
    </div>
  </div>
</template>
