
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import RiskPicker from '../components/RiskPicker.vue';
import WorkflowBar from '../components/WorkflowBar.vue';
import { fmtDateTime, loadLookups, P, SEVERITY, TEAM_KINDS, type Lookups } from '../lib';
import '../../../shared/module.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id?: string }>();
const session = useSession();
const toast = useToast();
const router = useRouter();
const lk = ref<Lookups | null>(null);
const perms = ref<{ code: string; name: string; moduleName: string }[]>([]);
const plans = ref<{ id: string; code: string; title: string }[]>([]);
const data = ref<any>(null);
const blank = () => ({ name: '', kind: 'crisis', mandate: '', members: [] as any[], authorities: [] as any[], systemPermissions: [] as string[], playbook: [] as any[], communication: '', continuityIds: [] as string[] });
const form = reactive(blank());
const act = reactive({ show: false, title: '', scenario: '', severity: 'major', riskId: '' });
const permQ = ref('');
const isNew = computed(() => !props.id);
const canEdit = computed(() => session.can(P.continuity) && (isNew.value || (!['in_review', 'rejected'].includes(data.value?.status) && !data.value?.activeEvent)));
const ROLES = ['قائد الفريق', 'نائب القائد', 'منسق الاتصال والإعلام', 'مسؤول العمليات', 'مسؤول الشؤون المالية', 'مسؤول التقنية', 'عضو'];
const groups = computed(() => {
  const g = new Map<string, typeof perms.value>();
  for (const p of perms.value.filter((x) => !permQ.value || x.name.includes(permQ.value) || x.moduleName.includes(permQ.value))) g.set(p.moduleName, [...(g.get(p.moduleName) ?? []), p]);
  return [...g.entries()];
});
function fill(t: any) {
  data.value = t;
  Object.assign(form, { ...blank(), ...t, mandate: t.mandate ?? '', communication: t.communication ?? '', members: t.members.map((m: any) => ({ ...m, userId: m.userId ?? '' })),
    authorities: t.authorities.map((a: any) => ({ ...a })), playbook: t.playbook.map((s: any) => ({ ...s })), systemPermissions: [...t.systemPermissions], continuityIds: [...t.continuityIds] });
}
onMounted(async () => {
  const [l, p, b] = await Promise.all([loadLookups(), api<any[]>('/risk/permission-options'), api<any[]>('/risk/continuity')]);
  lk.value = l;
  perms.value = p;
  plans.value = b.map((x) => ({ id: x.id, code: x.code, title: x.activity }));
  if (props.id) fill(await api(`/risk/crisis-teams/${props.id}`));
});
function pickUser(m: any) {
  const u = lk.value?.users.find((x) => x.id === m.userId);
  if (u) m.name = u.fullName;
}
function togglePerm(code: string) {
  const i = form.systemPermissions.indexOf(code);
  if (i >= 0) form.systemPermissions.splice(i, 1);
  else form.systemPermissions.push(code);
}
async function save() {
  try {
    const json = { ...form, members: form.members.map((m) => ({ ...m, userId: m.userId || null })) };
    const t = await api<any>(isNew.value ? '/risk/crisis-teams' : `/risk/crisis-teams/${props.id}`, { method: isNew.value ? 'POST' : 'PATCH', json });
    toast.success('حُفظ تشكيل الفريق');
    if (isNew.value) router.replace(`/risk/crisis/${t.id}`);
    fill(t);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function activate() {
  try {
    const e = await api<any>(`/risk/crisis-teams/${props.id}/activate`, { method: 'POST', json: { ...act, riskId: act.riskId || null, scenario: act.scenario || null } });
    toast.success('فُعّل الفريق ومُنح الأعضاء صلاحيات الطوارئ');
    router.push(`/risk/crisis/event/${e.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const initials = (n: string) => n.split(' ').slice(0, 2).map((x) => x[0]).join(' ');
</script>

<template>
  <div v-if="isNew || data">
    <RouterLink v-if="data?.activeEvent" :to="`/risk/crisis/event/${data.activeEvent.id}`" class="rk-alarm">
      <span><span class="siren" /><b>الفريق مفعّل الآن:</b> {{ data.activeEvent.title }}</span><span class="btn btn-sm rk-ghost">غرفة الأزمة</span>
    </RouterLink>
    <div class="page-head">
      <div><h1><span v-if="data" class="rk-code" style="font-size: 1rem">{{ data.code }}</span> {{ isNew ? 'تشكيل فريق أزمة' : form.name }}</h1>
        <p class="muted">الأعضاء من مستخدمي النظام، ولائحة صلاحيات تفصيلية لكل دور، وصلاحيات نظام تُمنح للأعضاء تلقائيًا عند التفعيل وتُسحب عند انتهاء الأزمة.</p></div>
      <button v-if="data && session.can(P.activateCrisis) && data.status === 'approved' && !data.activeEvent" class="btn rk-glow" @click="act.show = true">⚠ تفعيل حالة أزمة</button>
    </div>
    <div class="rk-grid">
      <fieldset :disabled="!canEdit" style="border: 0; padding: 0; margin: 0; min-width: 0; display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2>الفريق</h2>
          <div class="rk-fields">
            <label class="field"><span>اسم الفريق</span><input v-model="form.name" class="input" /></label>
            <label class="field"><span>النوع</span><select v-model="form.kind" class="input"><option v-for="(l, k) in TEAM_KINDS" :key="k" :value="k">{{ l }}</option></select></label>
          </div>
          <label class="field"><span>مهام الفريق ونطاق تفويضه</span><textarea v-model="form.mandate" class="input" rows="2" /></label>
          <div class="rk-sec">الأعضاء</div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>المستخدم</th><th>الاسم</th><th>الدور في الفريق</th><th>الجوال</th><th>البديل</th><th /></tr></thead>
            <tbody><tr v-for="(m, i) in form.members" :key="i">
              <td><select v-model="m.userId" class="input" @change="pickUser(m)"><option value="">من خارج النظام</option><option v-for="u in lk?.users" :key="u.id" :value="u.id">{{ u.fullName }}</option></select></td>
              <td><input v-model="m.name" class="input" /></td>
              <td><input v-model="m.teamRole" class="input" list="rk-team-roles" /></td>
              <td><input v-model="m.phone" class="input" dir="ltr" /></td><td><input v-model="m.alternate" class="input" /></td>
              <td><button type="button" class="btn btn-sm" @click="form.members.splice(i, 1)">✕</button></td>
            </tr></tbody>
          </table></div>
          <datalist id="rk-team-roles"><option v-for="r in ROLES" :key="r" :value="r" /></datalist>
          <button type="button" class="btn btn-sm" @click="form.members.push({ userId: '', name: '', teamRole: form.members.length ? 'عضو' : 'قائد الفريق', phone: '', alternate: '' })">+ عضو</button>
        </section>
        <section class="card pm-panel">
          <h2>لائحة صلاحيات الفريق أثناء الأزمة</h2>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>الصلاحية</th><th>صاحبها</th><th>الحد</th><th /></tr></thead>
            <tbody><tr v-for="(a, i) in form.authorities" :key="i">
              <td><input v-model="a.authority" class="input" placeholder="مثل: اعتماد الصرف الطارئ" /></td><td><input v-model="a.holder" class="input" list="rk-team-roles" /></td>
              <td><input v-model="a.limit" class="input" placeholder="مثل: حتى 50,000 ريال" /></td><td><button type="button" class="btn btn-sm" @click="form.authorities.splice(i, 1)">✕</button></td>
            </tr></tbody>
          </table></div>
          <button type="button" class="btn btn-sm" @click="form.authorities.push({ authority: '', holder: 'قائد الفريق', limit: '' })">+ صلاحية</button>
          <div class="rk-sec">صلاحيات النظام التي تُمنح للأعضاء عند التفعيل ({{ form.systemPermissions.length }})</div>
          <p class="pm-muted">يُنشأ للفريق دور «فريق الأزمة: {{ data?.code ?? 'CMT-…' }}» ويُسند للأعضاء من مستخدمي النظام لحظة التفعيل، ويُسحب منهم عند إعلان انتهاء الأزمة. لا تمنح صلاحية لا تملكها.</p>
          <input v-model="permQ" class="input" placeholder="بحث في الصلاحيات" style="margin-bottom: 8px" />
          <div style="max-height: 260px; overflow: auto; border: 1px solid var(--border); border-radius: 10px; padding: 8px">
            <template v-for="[mod, list] in groups" :key="mod">
              <div class="rk-sec" style="margin-top: 6px">{{ mod }}</div>
              <label v-for="p in list" :key="p.code" class="check" style="display: flex; margin-bottom: 4px"><input type="checkbox" :checked="form.systemPermissions.includes(p.code)" @change="togglePerm(p.code)" /> {{ p.name }}</label>
            </template>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>خطة إدارة الأزمة</h2>
          <p class="pm-muted">خطوات الاستجابة بالترتيب. عند التفعيل تتحول كل خطوة لمهمة مزمنة مسندة لصاحبها.</p>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>#</th><th>الخطوة</th><th>المسؤول (اسم أو دور)</th><th>خلال (ساعة)</th><th /></tr></thead>
            <tbody><tr v-for="(s, i) in form.playbook" :key="i"><td>{{ i + 1 }}</td><td><input v-model="s.title" class="input" /></td><td><input v-model="s.ownerName" class="input" list="rk-team-roles" /></td>
              <td><input v-model.number="s.withinHours" type="number" min="0" class="input" style="max-width: 100px" /></td><td><button type="button" class="btn btn-sm" @click="form.playbook.splice(i, 1)">✕</button></td></tr></tbody>
          </table></div>
          <button type="button" class="btn btn-sm" @click="form.playbook.push({ title: '', ownerName: 'قائد الفريق', withinHours: 2 })">+ خطوة</button>
          <label class="field" style="margin-top: 12px"><span>خطة الاتصال (الجهات والقنوات والمتحدث الرسمي)</span><textarea v-model="form.communication" class="input" rows="2" /></label>
          <div class="rk-sec">خطط التعافي التي يتولاها الفريق</div>
          <RiskPicker v-model="form.continuityIds" :options="plans" placeholder="+ ربط خطة تعافي" :disabled="!canEdit" />
          <div v-if="canEdit" class="modal-actions" style="margin-top: 14px"><button type="button" class="btn btn-primary" @click="save">حفظ التشكيل</button></div>
        </section>
      </fieldset>
      <div v-if="data" style="display: grid; gap: 16px; align-content: start">
        <WorkflowBar :item="data" :base="`/risk/crisis-teams/${data.id}`" :can-submit="session.can(P.continuity)" @changed="fill" />
        <section class="card pm-panel">
          <h2>الأعضاء</h2>
          <div class="rk-members">
            <div v-for="m in data.members" :key="m.name" :class="['rk-member', { lead: /قائد|رئيس/.test(m.teamRole) }]">
              <span class="av">{{ initials(m.name) }}</span><div><b>{{ m.name }}</b><div class="pm-muted">{{ m.teamRole }}{{ m.userId ? '' : ' · خارج النظام' }}</div></div>
            </div>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>سجل التفعيل <span class="pm-tag">{{ data.events.length }}</span></h2>
          <p v-if="!data.events.length" class="pm-muted">لم يُفعّل الفريق من قبل</p>
          <RouterLink v-for="e in data.events" :key="e.id" :to="`/risk/crisis/event/${e.id}`" class="rk-chip" style="margin-bottom: 6px; display: flex; justify-content: space-between">
            <span><span class="rk-code">{{ e.code }}</span> {{ e.title }}</span><span class="pm-muted">{{ fmtDateTime(e.activatedAt) }} {{ e.closedAt ? '' : '· قائمة' }}</span>
          </RouterLink>
        </section>
      </div>
    </div>

    <div v-if="act.show" class="modal-backdrop" @click.self="act.show = false">
      <form class="card modal" @submit.prevent="activate">
        <h2 style="color: var(--danger)">⚠ تفعيل حالة أزمة</h2>
        <p class="rk-warn">سيُمنح {{ data.members.filter((m: any) => m.userId).length }} عضوًا فورًا {{ data.systemPermissions.length }} صلاحية طوارئ في النظام، وتُنشأ مهام الاستجابة من خطة الأزمة.</p>
        <label class="field"><span>عنوان الأزمة</span><input v-model="act.title" class="input" /></label>
        <label class="field"><span>درجة الخطورة</span><select v-model="act.severity" class="input"><option v-for="(s, k) in SEVERITY" :key="k" :value="k">{{ s.label }}</option></select></label>
        <label class="field"><span>الوصف والسيناريو</span><textarea v-model="act.scenario" class="input" rows="3" /></label>
        <label class="field"><span>الخطر المتحقق (اختياري)</span><select v-model="act.riskId" class="input"><option value="">—</option><option v-for="r in lk?.risks" :key="r.id" :value="r.id">{{ r.code }} — {{ r.title }}</option></select></label>
        <div class="modal-actions"><button class="btn btn-danger">تفعيل الآن</button><button type="button" class="btn" @click="act.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
