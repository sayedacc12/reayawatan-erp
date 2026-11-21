<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import PersonPicker from '../../comms/components/PersonPicker.vue';
import { KINDS, ROLES, fmtDate, kindOf, loadLookups, type Body, type BodyMember, type Lookups } from '../lib';
import '../../../shared/module.css';
import '../../comms/comms.css';
import '../meetings.css';

/** الجهات: الجمعية العمومية ومجلس الإدارة واللجان وفرق العمل، بأعضائها وصفاتهم ومعتمد الخطط وأمين السر والنصاب */
const toast = useToast();
const L = ref<Lookups | null>(null);
const rows = ref<Body[]>([]);
const error = ref('');
const kind = ref('');
const editing = ref<string | null>(null);
const show = ref(false);
const busy = ref(false);
const f = reactive({
  kind: 'board', code: '', name: '', description: '', unitId: '' as string, approverUserId: null as string | null, secretaryUserId: null as string | null,
  members: [] as BodyMember[], quorumPercent: 51, isConfidential: false, termStart: '', termEnd: '', isActive: true,
});
async function load() {
  try {
    rows.value = await api<Body[]>('/meetings/bodies');
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await load();
  L.value = await loadLookups().catch(() => null);
});
const shown = computed(() => rows.value.filter((b) => !kind.value || b.kind === kind.value));
const canCreate = computed(() => !!L.value && (L.value.can.manage || L.value.can.teams));
const kindsAllowed = computed(() => KINDS.filter((k) => L.value?.can.manage || k.value === 'team'));

function open(b?: Body) {
  editing.value = b?.id ?? null;
  Object.assign(f, b
    ? { kind: b.kind, code: b.code, name: b.name, description: b.description ?? '', unitId: b.unitId ?? '', approverUserId: b.approverUserId, secretaryUserId: b.secretaryUserId,
        members: b.members.map((m) => ({ ...m })), quorumPercent: b.quorumPercent, isConfidential: b.isConfidential, termStart: b.termStart ?? '', termEnd: b.termEnd ?? '', isActive: b.isActive }
    : { kind: kindsAllowed.value[0]?.value ?? 'team', code: '', name: '', description: '', unitId: '', approverUserId: null, secretaryUserId: null, members: [], quorumPercent: 51,
        isConfidential: false, termStart: '', termEnd: '', isActive: true });
  show.value = true;
}
const blank = (type: BodyMember['type']): BodyMember => ({ type, userId: null, memberId: null, name: '', role: 'member', title: null, mobile: null, email: null, voting: true });
function importAssembly() {
  const have = new Set(f.members.map((m) => m.memberId).filter(Boolean));
  const add = (L.value?.assembly ?? []).filter((a) => !have.has(a.id)).map((a) => ({ ...blank('member'), memberId: a.id, name: a.fullName, mobile: a.mobile, email: a.email, voting: a.voting }));
  f.members.push(...add);
  toast.success(add.length ? `أُضيف ${add.length} عضوًا من سجل العضوية` : 'كل الأعضاء مضافون');
}
function pickMember(m: BodyMember, id: string) {
  const a = L.value?.assembly.find((x) => x.id === id);
  Object.assign(m, { memberId: id || null, name: a?.fullName ?? '', mobile: a?.mobile ?? null, voting: a?.voting ?? true });
}
async function save() {
  busy.value = true;
  try {
    const json = {
      ...f, description: f.description || null, unitId: f.unitId || null, termStart: f.termStart || null, termEnd: f.termEnd || null,
      members: f.members.map(({ roleLabel: _r, ...m }) => ({ ...m, title: m.title || null, mobile: m.mobile || null, email: m.email || null })),
    };
    await api(editing.value ? `/meetings/bodies/${editing.value}` : '/meetings/bodies', { method: editing.value ? 'PUT' : 'POST', json });
    toast.success('حُفظت الجهة');
    show.value = false;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <section class="pm-hero mt-hero">
      <div style="display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: flex-end">
        <div><p class="pm-kicker">الاجتماعات واللجان</p><h1>المجالس واللجان وأعضاؤها</h1>
          <p class="pm-sub">كل جهة لها أعضاء بصفاتهم وحق التصويت، ومعتمد لخطط اجتماعاتها، وأمين سر ينظمها، ونسبة نصاب. أعضاء الجمعية العمومية يُستوردون من سجل العضوية.</p></div>
        <div class="pm-actions"><button v-if="canCreate" class="btn mt-glow" @click="open()">+ جهة جديدة</button></div>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="pm-tabs">
      <button :class="['pm-tab', { on: !kind }]" @click="kind = ''">الكل</button>
      <button v-for="k in KINDS" :key="k.value" :class="['pm-tab', { on: kind === k.value }]" @click="kind = k.value">{{ k.label }}</button>
    </div>
    <div class="cm-tasks" style="grid-template-columns: repeat(auto-fill, minmax(330px, 1fr))">
      <article v-for="(b, i) in shown" :key="b.id" class="card cm-task" :style="{ '--i': i, '--c': kindOf(b.kind).color, cursor: 'default' }">
        <div style="display: flex; justify-content: space-between; gap: 8px; align-items: center">
          <span class="cm-role" :style="{ '--c': kindOf(b.kind).color }">{{ b.kindLabel }}</span>
          <span style="display: flex; gap: 6px; align-items: center">
            <span v-if="b.isConfidential" class="pm-pill" style="--c: #f59e0b">سرية</span>
            <span v-if="!b.isActive" class="pm-pill" style="--c: #94a3b8">موقوفة</span>
            <span class="cm-code">{{ b.code }}</span>
          </span>
        </div>
        <h3>{{ b.name }}</h3>
        <p v-if="b.description" class="pm-muted" style="margin: 0; font-size: .84rem">{{ b.description }}</p>
        <div class="pm-muted" style="font-size: .8rem">{{ b.members.length }} عضو · {{ b.votingCount }} لهم التصويت · النصاب {{ b.quorumPercent }}%
          <template v-if="b.termEnd"> · الدورة حتى {{ fmtDate(b.termEnd) }}</template></div>
        <div class="pm-muted" style="font-size: .8rem">المعتمد: {{ b.approverName ?? 'رئيسها (أو بلا اعتماد)' }} · أمين السر: {{ b.secretaryName ?? 'أمانة المجالس' }}</div>
        <div class="cm-chips">
          <span v-for="m in b.members.slice(0, 8)" :key="m.key ?? m.name" class="cm-chip" :title="m.roleLabel"><b v-if="m.role !== 'member'">{{ m.roleLabel }}:</b> {{ m.name }}</span>
          <span v-if="b.members.length > 8" class="cm-chip">+{{ b.members.length - 8 }}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px">
          <small class="pm-muted">{{ b.stats.total }} اجتماعًا<template v-if="b.stats.last"> · آخرها {{ fmtDate(b.stats.last) }}</template></small>
          <button v-if="b.canEdit" class="btn btn-sm" @click="open(b)">تعديل</button>
        </div>
      </article>
    </div>
    <div v-if="!shown.length" class="pm-empty card">لا توجد جهات.</div>

    <div v-if="show && L" class="modal-backdrop" @click.self="show = false">
      <form class="modal card" style="max-width: 900px; width: 96vw" @submit.prevent="save">
        <h2>{{ editing ? 'تعديل الجهة' : 'جهة جديدة' }}</h2>
        <div style="display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 0 12px">
          <label class="field"><span>النوع</span><select v-model="f.kind" class="input"><option v-for="k in kindsAllowed" :key="k.value" :value="k.value">{{ k.label }}</option></select></label>
          <label class="field"><span>الرمز</span><input v-model="f.code" class="input" dir="ltr" required placeholder="BRD" /></label>
          <label class="field"><span>الاسم</span><input v-model="f.name" class="input" required /></label>
        </div>
        <label class="field"><span>الوصف والاختصاصات</span><textarea v-model="f.description" class="input" rows="2" /></label>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px">
          <div class="field"><span>معتمد خطط الاجتماعات (اختياري)</span><PersonPicker v-model="f.approverUserId" :people="L.people" placeholder="بلا معتمد: تُعتمد بمن يملك صلاحية الاعتماد" /></div>
          <div class="field"><span>أمين السر (ينظم الاجتماعات ويحرر المحاضر)</span><PersonPicker v-model="f.secretaryUserId" :people="L.people" /></div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0 12px; align-items: end">
          <label class="field"><span>النصاب (%)</span><input v-model.number="f.quorumPercent" type="number" min="1" max="100" class="input" /></label>
          <label class="field"><span>بداية الدورة</span><input v-model="f.termStart" type="date" class="input" /></label>
          <label class="field"><span>نهاية الدورة</span><input v-model="f.termEnd" type="date" class="input" /></label>
          <label v-if="f.kind === 'team'" class="field"><span>الإدارة</span><select v-model="f.unitId" class="input"><option value="">—</option><option v-for="u in L.units" :key="u.id" :value="u.id">{{ u.name }}</option></select></label>
        </div>
        <div style="display: flex; gap: 18px; margin-bottom: 8px">
          <label style="display: flex; gap: 6px; align-items: center"><input v-model="f.isConfidential" type="checkbox" /> جهة سرية (اجتماعاتها لأعضائها فقط)</label>
          <label style="display: flex; gap: 6px; align-items: center"><input v-model="f.isActive" type="checkbox" /> مفعلة</label>
        </div>
        <p class="cm-sec">الأعضاء ({{ f.members.length }})</p>
        <div style="overflow-x: auto; max-height: 340px">
          <table class="table">
            <thead><tr><th>العضو</th><th>الصفة</th><th>المسمى</th><th>الجوال</th><th>يصوّت</th><th /></tr></thead>
            <tbody>
              <tr v-for="(m, i) in f.members" :key="i">
                <td style="min-width: 230px">
                  <PersonPicker v-if="m.type === 'user'" :model-value="m.userId" :people="L.people" @update:model-value="(v) => { m.userId = v as string | null; m.name = L!.people.find((p) => p.id === v)?.fullName ?? '' }" />
                  <select v-else-if="m.type === 'member'" class="input" :value="m.memberId ?? ''" @change="pickMember(m, ($event.target as HTMLSelectElement).value)">
                    <option value="">اختر من سجل العضوية</option><option v-for="a in L.assembly" :key="a.id" :value="a.id">{{ a.memberNo }} - {{ a.fullName }}</option>
                  </select>
                  <input v-else v-model="m.name" class="input" placeholder="اسم العضو من خارج الجمعية" required />
                  <small class="pm-muted">{{ { user: 'موظف أو مستخدم', member: 'عضو جمعية عمومية', external: 'من خارج النظام' }[m.type] }}</small>
                </td>
                <td><select v-model="m.role" class="input" style="width: 120px"><option v-for="r in ROLES" :key="r.value" :value="r.value">{{ r.label }}</option></select></td>
                <td><input v-model="m.title" class="input" style="width: 140px" /></td>
                <td><input v-model="m.mobile" class="input" style="width: 120px" dir="ltr" /></td>
                <td><input v-model="m.voting" type="checkbox" /></td>
                <td><button type="button" class="btn btn-sm" title="إزالة" @click="f.members.splice(i, 1)">×</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="pm-actions" style="margin-top: 8px; flex-wrap: wrap">
          <button type="button" class="btn btn-sm" @click="f.members.push(blank('user'))">+ موظف أو مستخدم</button>
          <button type="button" class="btn btn-sm" @click="f.members.push(blank('member'))">+ عضو جمعية عمومية</button>
          <button type="button" class="btn btn-sm" @click="f.members.push(blank('external'))">+ عضو من الخارج</button>
          <button v-if="f.kind === 'general_assembly'" type="button" class="btn btn-sm mt-glow" @click="importAssembly">استيراد كل أعضاء الجمعية العمومية</button>
        </div>
        <p class="pm-muted" style="font-size: .8rem">الأعضاء من خارج النظام يوقّعون المحضر برابط شخصي ورمز تحقق يصلهم من أمين السر.</p>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ</button><button type="button" class="btn" @click="show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
