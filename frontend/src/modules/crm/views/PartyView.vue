<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import ActivityForm from '../components/ActivityForm.vue';
import ActivityTimeline from '../components/ActivityTimeline.vue';
import PartyForm from '../components/PartyForm.vue';
import { CHANNEL_ICON, LEAD_COLOR, ROLE_COLOR, fmtDate, fmtDateTime, lookups, sar } from '../lib';
import '../../../shared/module.css';
import '../crm.css';

/** ملف الجهة (360°): أدوارها وسجلاتها في الأنظمة الأخرى، وأشخاص الاتصال، والموافقات، والأنشطة، والسجل */
const props = defineProps<{ id: string }>();
const router = useRouter();
const toast = useToast();
const lk = ref<any>(null);
const p = ref<any>(null);
const tab = ref<'activities' | 'contacts' | 'consents' | 'log'>('activities');
const editing = ref(false);
const addingAct = ref(false);
const contact = ref<any>(null);
const consent = ref<any>(null);
const linking = ref<any>(null);
const busy = ref(false);

async function load() {
  try {
    [lk.value, p.value] = await Promise.all([lookups(), api(`/crm/parties/${props.id}`)]);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
watch(() => props.id, load);
const roles = computed(() => [...new Set((p.value?.records ?? []).map((r: any) => r.role))] as string[]);
const openActs = computed(() => (p.value?.activities ?? []).filter((a: any) => !a.doneAt).length);

async function setOwner(ownerId: string) {
  try {
    await api(`/crm/parties/${props.id}/owner`, { method: 'PUT', json: { ownerId: ownerId || null } });
    toast.success('تغيّر المسؤول');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}

// أشخاص الاتصال
function editContact(c?: any) {
  contact.value = c
    ? { id: c.id, name: c.name, title: c.title ?? '', phone: c.phone ?? '', email: c.email ?? '', decisionRole: c.decisionRole, isPrimary: c.isPrimary, notes: c.notes ?? '' }
    : { name: '', title: '', phone: '', email: '', decisionRole: 'decision_maker', isPrimary: !p.value.contacts.length, notes: '' };
}
async function saveContact() {
  busy.value = true;
  try {
    const c = contact.value;
    const json = { name: c.name, title: c.title || null, phone: c.phone || null, email: c.email || null, decisionRole: c.decisionRole, isPrimary: c.isPrimary, notes: c.notes || null };
    await api(c.id ? `/crm/parties/${props.id}/contacts/${c.id}` : `/crm/parties/${props.id}/contacts`, { method: c.id ? 'PUT' : 'POST', json });
    contact.value = null;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function removeContact(c: any) {
  if (!confirm(`حذف ${c.name} من أشخاص الاتصال؟`)) return;
  try {
    await api(`/crm/parties/${props.id}/contacts/${c.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}

// الموافقات التسويقية
function editConsents() {
  consent.value = {
    doNotContact: p.value.doNotContact,
    items: Object.keys(lk.value.labels.channels).map((ch) => ({ channel: ch, granted: !!p.value.consents?.[ch]?.granted, source: '' })),
  };
}
async function saveConsents() {
  busy.value = true;
  try {
    const changed = consent.value.items.filter((i: any) => i.granted !== !!p.value.consents?.[i.channel]?.granted);
    await api(`/crm/parties/${props.id}/consents`, { method: 'PUT', json: { doNotContact: consent.value.doNotContact, items: changed } });
    toast.success('حُفظت الموافقات');
    consent.value = null;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}

// ربط سجل من نظام آخر، وفصل ربط خاطئ
const linkRoles = { customer: 'عميل', member: 'عضو', volunteer: 'متطوع', partner: 'شريك' };
function startLink() {
  linking.value = { role: 'customer', q: '', rows: [] };
  searchLink();
}
async function searchLink() {
  try {
    const q = new URLSearchParams({ role: linking.value.role, ...(linking.value.q ? { q: linking.value.q } : {}) });
    linking.value.rows = await api(`/crm/parties/${props.id}/link-candidates?${q}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function link(r: any) {
  try {
    await api(`/crm/parties/${props.id}/links`, { method: 'POST', json: { role: linking.value.role, refId: r.id } });
    toast.success('رُبط السجل');
    linking.value = null;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function detach(r: any) {
  if (!confirm(`فصل «${r.title}» عن هذه الجهة؟ سيصبح جهة مستقلة في السجل.`)) return;
  try {
    const x = await api<any>(`/crm/parties/${props.id}/links/${r.linkId}/detach`, { method: 'POST' });
    toast.success('فُصل السجل وأصبح جهة مستقلة');
    router.push(`/crm/parties/${x.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const statValue = (s: any) => (s.money ? sar(s.value) : s.date ? fmtDate(s.value) : s.value);
</script>

<template>
  <div v-if="p && lk">
    <div class="page-head">
      <div>
        <p class="pm-muted" style="margin: 0; font-size: .85rem"><span class="cr-code">{{ p.code }}</span> · {{ p.kindLabel }}</p>
        <h1 style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap">
          {{ p.name }}
          <span v-for="r in roles" :key="r" class="cr-chip" :style="{ '--c': ROLE_COLOR[r] }">{{ lk.labels.roles[r] }}</span>
          <span v-if="p.doNotContact" class="cr-flag">لا تتواصل</span>
          <span v-if="!p.isActive" class="cr-flag">مدموجة في جهة أخرى</span>
        </h1>
        <p class="muted cr-ltr" style="text-align: start">{{ [p.phone, p.email].filter(Boolean).join(' · ') }}</p>
      </div>
      <div v-if="p.isActive" style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
        <select v-if="p.can.assign" class="input" style="width: auto" :value="p.ownerId ?? ''" @change="setOwner(($event.target as HTMLSelectElement).value)">
          <option value="">بلا مسؤول</option><option v-for="u in lk.users" :key="u.id" :value="u.id">المسؤول: {{ u.fullName }}</option>
        </select>
        <span v-else class="pm-muted">المسؤول: {{ p.ownerName ?? '—' }}</span>
        <button v-if="p.can.manage" class="btn" @click="editing = true">تعديل</button>
        <button v-if="p.can.manage" class="btn btn-primary" @click="addingAct = true">+ نشاط</button>
      </div>
    </div>
    <div v-if="!p.isActive && p.mergedInto" class="cr-warn">دُمجت هذه الجهة في <RouterLink :to="`/crm/parties/${p.mergedInto}`">الجهة الأصلية</RouterLink>، وتُتابع من ملفها.</div>

    <section class="card pm-panel" style="margin-bottom: 16px">
      <h2 style="display: flex; justify-content: space-between">
        سجلاتها في الأنظمة
        <button v-if="p.can.merge && p.isActive" class="btn btn-sm" @click="startLink">+ ربط سجل</button>
      </h2>
      <div v-if="!p.records.length" class="cr-empty">لا توجد سجلات مرتبطة بعد</div>
      <div class="cr-records">
        <div v-for="r in p.records" :key="r.linkId" class="cr-rec" :style="{ '--c': ROLE_COLOR[r.role] }">
          <h3>
            <span>{{ r.roleLabel }}</span>
            <button v-if="p.can.merge && r.role !== 'lead' && p.records.length > 1" class="btn btn-sm" title="الربط خاطئ؟ افصله ليصبح جهة مستقلة" @click="detach(r)">فصل</button>
          </h3>
          <template v-if="r.hidden"><p class="pm-muted" style="font-size: .84rem">لا تملك صلاحية الاطلاع على تفاصيل هذا السجل</p></template>
          <template v-else>
            <p style="margin: 0">
              <RouterLink v-if="r.link" class="pm-link" :to="r.link">{{ r.title }}</RouterLink><template v-else>{{ r.title }}</template>
              <span v-if="r.no" class="cr-code" style="margin-inline-start: 6px">#{{ r.no }}</span>
              <span v-if="r.status" class="cr-chip" style="margin-inline-start: 6px">{{ r.status }}</span>
            </p>
            <div v-if="r.stats" class="cr-stats">
              <div v-for="s in r.stats" :key="s.label" :class="{ 'alert-v': s.alert }"><b>{{ statValue(s) }}</b>{{ s.label }}</div>
            </div>
            <div v-if="r.items?.length" class="cr-items">
              <RouterLink v-for="i in r.items" :key="i.id" :to="i.link"><span>{{ i.title }} <small class="pm-muted">{{ i.status }}</small></span><span>{{ sar(i.amount) }}</span></RouterLink>
            </div>
          </template>
          <small class="pm-muted">رُبط {{ fmtDate(r.linkedAt) }}{{ r.linkedByName ? ` · ${r.linkedByName}` : '' }}</small>
        </div>
      </div>
    </section>

    <div class="cr-grid">
      <section class="card pm-panel">
        <div class="pm-tabs">
          <button :class="['pm-tab', { on: tab === 'activities' }]" @click="tab = 'activities'">الأنشطة {{ openActs ? `(${openActs})` : '' }}</button>
          <button :class="['pm-tab', { on: tab === 'contacts' }]" @click="tab = 'contacts'">أشخاص الاتصال ({{ p.contacts.length }})</button>
          <button :class="['pm-tab', { on: tab === 'consents' }]" @click="tab = 'consents'">الموافقات التسويقية</button>
          <button :class="['pm-tab', { on: tab === 'log' }]" @click="tab = 'log'">السجل</button>
        </div>
        <ActivityTimeline v-if="tab === 'activities'" :items="p.activities" :lk="lk" :can-manage="p.can.manage" @changed="load" />
        <template v-else-if="tab === 'contacts'">
          <div v-if="!p.contacts.length" class="cr-empty">لا يوجد أشخاص اتصال</div>
          <table v-else class="table">
            <thead><tr><th>الاسم</th><th>دوره</th><th>التواصل</th><th /></tr></thead>
            <tbody>
              <tr v-for="c in p.contacts" :key="c.id">
                <td><b>{{ c.name }}</b> <span v-if="c.isPrimary" class="cr-ok">رئيسي</span><br /><small class="pm-muted">{{ c.title }}</small></td>
                <td>{{ c.decisionRoleLabel }}</td>
                <td class="cr-ltr" style="font-size: .84rem">{{ c.phone }}<br v-if="c.phone && c.email" />{{ c.email }}</td>
                <td style="white-space: nowrap"><template v-if="p.can.manage"><button class="btn btn-sm" @click="editContact(c)">تعديل</button> <button class="btn btn-sm" @click="removeContact(c)">حذف</button></template></td>
              </tr>
            </tbody>
          </table>
          <button v-if="p.can.manage" class="btn btn-sm" style="margin-top: 10px" @click="editContact()">+ شخص اتصال</button>
        </template>
        <template v-else-if="tab === 'consents'">
          <p class="pm-muted" style="font-size: .86rem">لا تصل الحملات التسويقية إلا لمن وافق على القناة، وتُحفظ لكل موافقة مصدرها وتاريخها. «لا تتواصل» يمنع كل الحملات مهما كانت الموافقات.</p>
          <dl class="cr-kv">
            <template v-for="(l, ch) in lk.labels.channels" :key="ch">
              <dt>{{ CHANNEL_ICON[ch] }} {{ l }}</dt>
              <dd>
                <template v-if="p.consents?.[ch]">
                  <span :class="p.consents[ch].granted ? 'cr-ok' : 'cr-flag'">{{ p.consents[ch].granted ? 'موافق' : 'غير موافق' }}</span>
                  <small class="pm-muted"> {{ p.consents[ch].source }} · {{ fmtDateTime(p.consents[ch].at) }} · {{ p.consents[ch].byName }}</small>
                </template>
                <span v-else class="pm-muted">لم تُسجل موافقة</span>
              </dd>
            </template>
            <dt>لا تتواصل</dt><dd>{{ p.doNotContact ? 'نعم' : 'لا' }}</dd>
          </dl>
          <button v-if="p.can.manage" class="btn btn-sm" style="margin-top: 12px" @click="editConsents">تحديث الموافقات</button>
        </template>
        <template v-else>
          <div class="cr-timeline">
            <div v-for="(e, i) in [...p.log].reverse()" :key="i" class="cr-act" style="--c: #64748b">
              <span class="ic">•</span>
              <div><h4>{{ e.action }}</h4><p v-if="e.note">{{ e.note }}</p><div class="meta">{{ e.byName }} · {{ fmtDateTime(e.at) }}</div></div>
            </div>
          </div>
          <template v-if="p.merges.length">
            <p class="cr-sec">جهات دُمجت فيها</p>
            <div v-for="m in p.merges" :key="m.removedId" style="font-size: .86rem">{{ m.name }} · {{ m.byName }} · {{ fmtDateTime(m.createdAt) }}</div>
          </template>
        </template>
      </section>
      <section class="card pm-panel">
        <h2>البيانات</h2>
        <dl class="cr-kv">
          <dt>المدينة</dt><dd>{{ p.city ?? '—' }}</dd>
          <template v-if="p.kind === 'org'"><dt>الرقم الضريبي</dt><dd class="cr-code">{{ p.vatNumber ?? '—' }}</dd><dt>السجل التجاري</dt><dd class="cr-code">{{ p.crNumber ?? '—' }}</dd></template>
          <dt>المصدر</dt><dd>{{ p.sourceLabel ?? '—' }}</dd>
          <dt>أُضيفت</dt><dd>{{ fmtDate(p.createdAt) }} · {{ p.createdByName ?? 'آليًا من الأنظمة' }}</dd>
        </dl>
        <div v-if="p.tags.length" class="cr-chips" style="margin-top: 10px"><span v-for="t in p.tags" :key="t" class="cr-chip">{{ t }}</span></div>
        <p v-if="p.notes" style="white-space: pre-line; font-size: .88rem; margin-top: 10px">{{ p.notes }}</p>
        <template v-if="p.leads.length">
          <p class="cr-sec">العملاء المحتملون المرتبطون</p>
          <RouterLink v-for="l in p.leads" :key="l.id" :to="`/crm/leads/${l.id}`" style="display: flex; justify-content: space-between; padding: 4px 0; font-size: .86rem">
            <span>{{ l.name }} <span class="cr-code">{{ l.code }}</span></span><span class="cr-chip" :style="{ '--c': LEAD_COLOR[l.status] }">{{ l.statusLabel }}</span>
          </RouterLink>
        </template>
      </section>
    </div>

    <PartyForm v-if="editing" :lk="lk" :party="p" @close="editing = false" @saved="editing = false; load()" />
    <ActivityForm v-if="addingAct" :lk="lk" :party-id="p.id" @close="addingAct = false" @saved="addingAct = false; load()" />

    <div v-if="contact" class="modal-backdrop" @click.self="contact = null">
      <form class="card modal cr-modal" @submit.prevent="saveContact">
        <h2>{{ contact.id ? 'تعديل شخص الاتصال' : 'شخص اتصال جديد' }}</h2>
        <div class="cr-fields">
          <label class="field"><span>الاسم</span><input v-model="contact.name" class="input" maxlength="200" required /></label>
          <label class="field"><span>المسمى الوظيفي</span><input v-model="contact.title" class="input" maxlength="150" /></label>
          <label class="field"><span>الجوال</span><input v-model="contact.phone" class="input" maxlength="20" dir="ltr" /></label>
          <label class="field"><span>البريد</span><input v-model="contact.email" type="email" class="input" maxlength="200" dir="ltr" /></label>
          <label class="field"><span>دوره في القرار</span><select v-model="contact.decisionRole" class="input"><option v-for="(l, k) in lk.labels.decisionRoles" :key="k" :value="k">{{ l }}</option></select></label>
        </div>
        <label style="display: flex; gap: 6px; margin-bottom: 10px"><input v-model="contact.isPrimary" type="checkbox" /> شخص الاتصال الرئيسي</label>
        <label class="field"><span>ملاحظات</span><textarea v-model="contact.notes" class="input" rows="2" maxlength="1000" /></label>
        <div class="modal-actions"><button type="button" class="btn" @click="contact = null">إلغاء</button><button class="btn btn-primary" :disabled="busy">حفظ</button></div>
      </form>
    </div>

    <div v-if="consent" class="modal-backdrop" @click.self="consent = null">
      <form class="card modal cr-modal" @submit.prevent="saveConsents">
        <h2>الموافقات التسويقية</h2>
        <div v-for="i in consent.items" :key="i.channel" class="cr-dup-row" style="grid-template-columns: 170px 1fr">
          <label style="display: flex; gap: 6px"><input v-model="i.granted" type="checkbox" /> {{ lk.labels.channels[i.channel] }}</label>
          <input v-if="i.granted !== !!p.consents?.[i.channel]?.granted" v-model="i.source" class="input" maxlength="200" required placeholder="مصدر الموافقة أو الإلغاء، مثل: نموذج المعرض" />
          <small v-else class="pm-muted">بلا تغيير</small>
        </div>
        <label style="display: flex; gap: 6px; margin: 14px 0"><input v-model="consent.doNotContact" type="checkbox" /> <b>لا تتواصل</b> (يمنع كل الحملات)</label>
        <div class="modal-actions"><button type="button" class="btn" @click="consent = null">إلغاء</button><button class="btn btn-primary" :disabled="busy">حفظ</button></div>
      </form>
    </div>

    <div v-if="linking" class="modal-backdrop" @click.self="linking = null">
      <div class="card modal cr-modal">
        <h2>ربط سجل من نظام آخر</h2>
        <p class="pm-muted" style="font-size: .86rem">اختر السجل الذي يخص هذه الجهة نفسها. إن كان مربوطًا بجهة أخرى فادمج الجهتين من شاشة المكرر بدل ربطه هنا.</p>
        <div class="cr-toolbar">
          <select v-model="linking.role" class="input" @change="searchLink"><option v-for="(l, k) in linkRoles" :key="k" :value="k">{{ l }}</option></select>
          <input v-model="linking.q" class="input grow" placeholder="بحث بالاسم أو الجوال" @keyup.enter="searchLink" />
          <button class="btn" @click="searchLink">بحث</button>
        </div>
        <div v-if="!linking.rows.length" class="cr-empty">لا توجد نتائج</div>
        <div v-for="r in linking.rows" :key="r.id" class="cr-dup-row">
          <div><b>{{ r.name }}</b> <small class="pm-muted cr-ltr">{{ r.phone }} {{ r.email }}</small><br /><small v-if="r.linkedTo" class="pm-muted">مربوط حاليًا بـ {{ r.linkedTo }}</small></div>
          <button class="btn btn-sm btn-primary" :disabled="!!r.linkedTo" @click="link(r)">ربط</button>
        </div>
        <div class="modal-actions"><button class="btn" @click="linking = null">إغلاق</button></div>
      </div>
    </div>
  </div>
</template>
