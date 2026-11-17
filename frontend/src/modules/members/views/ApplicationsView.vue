<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import PersonForm from '../components/PersonForm.vue';
import StatusPill from '../components/StatusPill.vue';
import { APP_STATUS, P, exportCsv, fmtDate, loadLookups, lookups, toFormData } from '../lib';
import '../../projects/projects.css';
import '../members.css';

interface Row {
  id: string; applicationNo: string; fullName: string; nationalId: string; mobile: string; gender: string; nationality: string; typeName: string; typeColor: string;
  status: string; statusLabel: string; stageName: string | null; stageIndex: number; stagesCount: number; source: string; createdAt: string; canDecide: boolean; documents: number;
}
const props = defineProps<{ approvals?: boolean }>();
const session = useSession();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const rows = ref<Row[]>([]);
const error = ref('');
const q = reactive({ status: (route.query.status as string) ?? (props.approvals ? '' : 'open'), search: '', type: '', source: '' });
const showNew = ref(route.query.new === '1');
const busy = ref(false);
const form = ref<InstanceType<typeof PersonForm> | null>(null);
async function load() {
  try {
    const params = new URLSearchParams(Object.entries({ ...q, awaiting: props.approvals ? '1' : '' }).filter(([, v]) => v) as [string, string][]);
    rows.value = await api<Row[]>(`/members/applications?${params}`);
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
watch(() => props.approvals, load);
async function create(data: Record<string, unknown>, files: Record<string, File>) {
  busy.value = true;
  try {
    const a = await api<{ id: string }>('/members/applications', { method: 'POST', body: toFormData(data, files) });
    showNew.value = false;
    toast.success('سُجل الطلب وأُرسل للاعتماد');
    router.push(`/members/applications/${a.id}`);
  } catch (e) {
    form.value?.setError((e as Error).message);
  } finally {
    busy.value = false;
  }
}
function exportRows() {
  exportCsv('طلبات العضوية', ['رقم الطلب', 'الاسم', 'الهوية', 'الجوال', 'الجنسية', 'النوع', 'المصدر', 'التاريخ', 'الحالة', 'المرحلة'],
    rows.value.map((r) => [r.applicationNo, r.fullName, r.nationalId, r.mobile, r.nationality, r.typeName, r.source === 'public' ? 'الموقع' : 'موظف', r.createdAt.slice(0, 10), r.statusLabel, r.stageName]));
}
</script>

<template>
  <div>
    <section class="pm-hero mb-hero">
      <div><p class="pm-kicker">الطلبات</p><h1>{{ approvals ? 'اعتماد طلبات العضوية' : 'طلبات العضوية' }}</h1>
        <p class="pm-sub">{{ approvals ? 'الطلبات التي تنتظر قرارك في مرحلتها الحالية. راجع البيانات وصورة الهوية ثم اعتمد أو أرجع أو ارفض.' : 'الطلبات القادمة من صفحة العضوية العامة أو التي أدخلها الموظفون، بمراحل اعتمادها حتى السداد وتفعيل العضوية.' }}</p></div>
      <div class="pm-actions">
        <button v-if="!approvals && session.can(P.applications)" class="btn mb-glow" @click="showNew = true">إدخال طلب داخليًا</button>
        <button class="btn mb-ghost" @click="exportRows">تصدير Excel</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="mb-toolbar">
      <input v-model="q.search" class="input grow" placeholder="بحث بالاسم أو الهوية أو الجوال أو رقم الطلب" />
      <select v-if="!approvals" v-model="q.status" class="input"><option value="">كل الحالات</option><option v-for="s in APP_STATUS" :key="s.value" :value="s.value">{{ s.label }}</option></select>
      <select v-model="q.type" class="input"><option value="">كل الأنواع</option><option v-for="t in lookups?.types" :key="t.code" :value="t.code">{{ t.name }}</option></select>
      <select v-model="q.source" class="input"><option value="">كل المصادر</option><option value="public">من الموقع</option><option value="staff">إدخال موظف</option></select>
    </div>
    <section class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>رقم الطلب</th><th>المتقدم</th><th>نوع العضوية</th><th>المصدر</th><th>المرحلة</th><th>الحالة</th></tr></thead>
          <TransitionGroup tag="tbody" name="page">
            <tr v-for="r in rows" :key="r.id" class="mb-row" @click="$router.push(`/members/applications/${r.id}`)">
              <td class="mb-code">{{ r.applicationNo }}<span class="pm-muted" style="display: block">{{ fmtDate(r.createdAt) }}</span></td>
              <td><b>{{ r.fullName }}</b><span class="pm-muted" style="display: block"><span class="mb-code">{{ r.mobile }}</span> · {{ r.nationality }} · {{ r.documents }} مستند</span></td>
              <td><span class="pm-tag" :style="{ background: r.typeColor + '22', color: r.typeColor }">{{ r.typeName }}</span></td>
              <td>{{ r.source === 'public' ? '🌐 الموقع' : '🏢 موظف' }}</td>
              <td>
                <template v-if="r.status === 'in_review'">
                  <div class="mb-bar" style="width: 90px"><i :style="{ width: ((r.stageIndex + 1) / r.stagesCount) * 100 + '%' }" /></div>
                  <span class="pm-muted">{{ r.stageName }}</span>
                  <span v-if="r.canDecide" class="pm-tag" style="background: #fef3c7; color: #92400e; margin-inline-start: 4px">بانتظارك</span>
                </template>
                <span v-else class="pm-muted">—</span>
              </td>
              <td><StatusPill :status="r.status" :label="r.statusLabel" /></td>
            </tr>
            <tr v-if="!rows.length" key="empty"><td colspan="6" class="pm-empty">{{ approvals ? 'لا توجد طلبات بانتظار قرارك' : 'لا توجد طلبات بهذه التصفية' }}</td></tr>
          </TransitionGroup>
        </table>
      </div>
    </section>
    <div v-if="showNew && lookups" class="modal-backdrop" @click.self="showNew = false">
      <div class="card modal modal-wide">
        <h2>إدخال طلب عضوية داخليًا</h2>
        <p class="pm-muted">للطلبات الورقية أو الحضورية. يمر الطلب بمراحل الاعتماد نفسها، ويُرسل للمتقدم رابط السداد بعد الاعتماد.</p>
        <PersonForm ref="form" mode="apply" :types="lookups.types" :nationalities="lookups.nationalities" :fields="lookups.applicationFields" :documents="lookups.documents"
          :conditions="lookups.conditions" :busy="busy" submit-label="تسجيل الطلب وإرساله للاعتماد" @submit="create" @cancel="showNew = false" />
      </div>
    </div>
  </div>
</template>
