<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import SiteIcon from '../../../site/SiteIcon.vue';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import IconPicker from '../components/IconPicker.vue';
import ImageField from '../components/ImageField.vue';
import { STATUS_COLOR, errMsg, fmtDateTime, sar, siteUrl } from '../lib';
import '../website.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id?: string }>();
const router = useRouter();
const session = useSession();
const toast = useToast();
const p = ref<any>(null);
const lk = ref<any>({ activities: [], docs: [], accounts: [] });
const f = reactive({
  slug: '', name: '', tagline: '', summary: '', about: '', audience: '', timing: '', icon: 'heart', imageId: null as string | null, imageUrl: null as string | null,
  kitDocId: null as string | null, activityId: null as string | null, services: [] as any[], points: [] as string[],
});
const st = reactive({ on: false, kind: 'project', goal: 0, endDate: '', min: 0, max: 0, presets: '', stop: false, monthly: true, gift: true, revenueAccountId: null as string | null });
const pub = reactive({ showOnSite: true, featured: false });
const note = ref('');
const busy = ref(false);
const isNew = computed(() => !props.id);
const editable = computed(() => isNew.value || p.value?.can?.edit);
const LEVEL: Record<string, string> = { axis: 'محور', program: 'برنامج', project: 'مشروع' };

function fill(r: any) {
  p.value = r;
  Object.assign(f, {
    slug: r.slug, name: r.name, tagline: r.tagline ?? '', summary: r.summary, about: r.about ?? '', audience: r.audience ?? '', timing: r.timing ?? '', icon: r.icon,
    imageId: r.imageId, imageUrl: r.imageUrl, kitDocId: r.kitDocId, activityId: r.activityId, services: (r.services ?? []).map((s: any) => ({ ...s })), points: [...(r.points ?? [])],
  });
  Object.assign(st, { ...r.store, endDate: r.store.endDate ?? '', presets: (r.store.presets ?? []).join('، ') });
  Object.assign(pub, { showOnSite: r.status === 'approved' ? r.showOnSite : true, featured: r.featured });
}
onMounted(async () => {
  try {
    lk.value = await api('/website/programs/lookups');
    if (props.id) fill(await api(`/website/programs/${props.id}`));
  } catch (e) {
    toast.error(errMsg(e));
  }
});
function autoSlug() {
  if (f.slug || !isNew.value) return;
  f.slug = `p-${Date.now().toString(36)}`;
}
async function save(action: 'draft' | 'submit') {
  busy.value = true;
  try {
    const body = {
      slug: f.slug.trim(), name: f.name, tagline: f.tagline || null, summary: f.summary, about: f.about || null, audience: f.audience || null, timing: f.timing || null,
      services: f.services.filter((s) => s.title.trim()), points: f.points.map((x) => x.trim()).filter(Boolean), icon: f.icon, imageId: f.imageId, kitDocId: f.kitDocId, activityId: f.activityId, action,
    };
    const r: any = isNew.value ? await api('/website/programs', { method: 'POST', json: body }) : await api(`/website/programs/${props.id}`, { method: 'PUT', json: body });
    toast.success(action === 'draft' ? 'حُفظ البرنامج' : 'أُرسل البرنامج للاعتماد');
    if (isNew.value) router.replace(`/website/programs/${r.id}`);
    fill(r);
  } catch (e) {
    toast.error(errMsg(e));
  } finally {
    busy.value = false;
  }
}
async function decide(decision: string) {
  busy.value = true;
  try {
    const store = {
      on: st.on, kind: st.kind, goal: Number(st.goal) || 0, endDate: st.endDate || null, min: Number(st.min) || 0, max: Number(st.max) || 0,
      presets: String(st.presets).split(/[،,\s]+/).map(Number).filter((x) => x > 0), stop: st.stop, monthly: st.monthly, gift: st.gift, revenueAccountId: st.revenueAccountId,
    };
    const body: any = { decision, note: note.value || undefined };
    if (decision === 'approve') Object.assign(body, { store, showOnSite: pub.showOnSite, featured: pub.featured });
    fill(await api(`/website/programs/${props.id}/decision`, { method: 'POST', json: body }));
    note.value = '';
    toast.success({ approve: 'حُفظ قرار الاعتماد', return: 'أُعيد البرنامج للمحرر', reject: 'رُفض البرنامج', unpublish: 'أُخفي البرنامج من الموقع والمتجر' }[decision] ?? 'تم');
  } catch (e) {
    toast.error(errMsg(e));
  } finally {
    busy.value = false;
  }
}
async function remove() {
  if (!confirm('حذف هذا البرنامج نهائيًا؟')) return;
  try {
    await api(`/website/programs/${props.id}`, { method: 'DELETE' });
    toast.success('حُذف البرنامج');
    router.push('/website/programs');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
const canDecide = computed(() => p.value?.can?.decide || (p.value?.can?.store && p.value?.status === 'approved'));
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <RouterLink to="/website/programs" class="ws-link">→ البرامج</RouterLink>
        <h1>{{ isNew ? 'برنامج جديد' : f.name }}</h1>
        <span v-if="p" class="ws-pill" :style="{ '--c': STATUS_COLOR[p.status] }">{{ p.statusLabel }}</span>
      </div>
      <a v-if="p?.status === 'approved' && p.showOnSite" :href="siteUrl(session.user?.organizationSlug, `/programs/${p.slug}`)" target="_blank" rel="noopener" class="btn">صفحة البرنامج ↗</a>
    </div>
    <div v-if="p?.reviewNote && ['returned', 'rejected'].includes(p.status)" class="ws-note"><strong>ملاحظة المعتمد:</strong> {{ p.reviewNote }}</div>
    <div class="ws-side">
      <div>
        <section class="card ws-panel">
          <h2>بيانات البرنامج</h2>
          <fieldset :disabled="!editable" style="border: 0; padding: 0; margin: 0">
            <div class="ws-grid2">
              <label class="field"><span>اسم البرنامج *</span><input v-model="f.name" class="input" @blur="autoSlug" /></label>
              <label class="field"><span>الرمز في الرابط *</span><input v-model="f.slug" class="input" dir="ltr" placeholder="orphans-care" /><small class="muted ws-code">/programs/{{ f.slug || '...' }}</small></label>
            </div>
            <label class="field"><span>عبارة قصيرة</span><input v-model="f.tagline" class="input" placeholder="مثل: كن سندًا ليتيم حتى يشتد عوده" /></label>
            <label class="field"><span>نبذة مختصرة *</span><textarea v-model="f.summary" class="input" rows="2" /></label>
            <label class="field"><span>عن البرنامج (تفصيل)</span><textarea v-model="f.about" class="input" rows="5" /></label>
            <div class="ws-grid2">
              <label class="field"><span>الفئة المستهدفة</span><input v-model="f.audience" class="input" /></label>
              <label class="field"><span>مدة التنفيذ أو موعده</span><input v-model="f.timing" class="input" placeholder="على مدار العام" /></label>
              <label class="field"><span>مرتبط بمشروع في إدارة المشاريع</span><select v-model="f.activityId" class="input"><option :value="null">بدون ربط</option><option v-for="a in lk.activities" :key="a.id" :value="a.id">{{ LEVEL[a.level] ?? '' }}: {{ a.name }}</option></select></label>
              <label class="field"><span>الحقيبة التعريفية (من أرشيف المعرفة)</span><select v-model="f.kitDocId" class="input"><option :value="null">بدون</option><option v-for="d in lk.docs" :key="d.id" :value="d.id">{{ d.title }}</option></select></label>
            </div>
            <ImageField :id="f.imageId" :url="f.imageUrl" label="صورة البرنامج" @update="(v) => { f.imageId = v.id; f.imageUrl = v.url; }" />
            <div class="field"><span>الأيقونة</span><IconPicker v-model="f.icon" /></div>
          </fieldset>
        </section>
        <section class="card ws-panel">
          <div class="ws-row" style="justify-content: space-between"><h2>الخدمات التي يقدمها البرنامج</h2><button v-if="editable" class="btn btn-sm" @click="f.services.push({ icon: 'check', title: '', text: '' })">+ خدمة</button></div>
          <div v-if="!f.services.length" class="muted">لا توجد خدمات بعد.</div>
          <div v-for="(s, i) in f.services" :key="i" class="ws-box">
            <div class="ws-box-head"><span class="pe-ic"><SiteIcon :name="s.icon" :size="18" /></span><input v-model="s.title" class="input" placeholder="اسم الخدمة" style="flex: 1" :disabled="!editable" /><button v-if="editable" class="btn btn-sm btn-danger" @click="f.services.splice(i, 1)">حذف</button></div>
            <textarea v-model="s.text" class="input" rows="2" placeholder="وصف الخدمة" :disabled="!editable" />
            <details v-if="editable" style="margin-top: 6px"><summary class="ws-link">تغيير الأيقونة</summary><IconPicker v-model="s.icon" /></details>
          </div>
        </section>
        <section class="card ws-panel">
          <div class="ws-row" style="justify-content: space-between"><h2>مزايا البرنامج (نقاط)</h2><button v-if="editable" class="btn btn-sm" @click="f.points.push('')">+ نقطة</button></div>
          <div v-for="(_, i) in f.points" :key="i" class="ws-row"><input v-model="f.points[i]" class="input" style="flex: 1" :disabled="!editable" /><button v-if="editable" class="btn btn-sm btn-danger" @click="f.points.splice(i, 1)">×</button></div>
        </section>
        <div v-if="editable" class="ws-actions">
          <button class="btn" :disabled="busy" @click="save('draft')">{{ p?.status === 'approved' ? 'حفظ التعديلات' : 'حفظ كمسودة' }}</button>
          <button v-if="!p || p.status !== 'approved'" class="btn btn-primary" :disabled="busy" @click="save('submit')">إرسال للاعتماد</button>
          <button v-if="p?.can?.remove" class="btn btn-danger" style="margin-inline-start: auto" @click="remove">حذف</button>
        </div>
      </div>
      <aside v-if="p">
        <section v-if="canDecide" class="card ws-panel">
          <h2>{{ p.status === 'approved' ? 'النشر والمتجر' : 'قرار الاعتماد' }}</h2>
          <label class="check"><input v-model="pub.showOnSite" type="checkbox" /> يظهر في الموقع</label>
          <label class="check"><input v-model="pub.featured" type="checkbox" /> برنامج مميز في الصفحة الرئيسية</label>
          <hr />
          <label class="check"><input v-model="st.on" type="checkbox" /> <strong>يستقبل تبرعات في المتجر</strong></label>
          <template v-if="st.on">
            <label class="field"><span>نوع التبرع</span><select v-model="st.kind" class="input"><option value="project">تبرع لمشروع</option><option value="waqf">وقف</option></select></label>
            <div class="ws-grid2">
              <label class="field"><span>المستهدف (ريال)</span><input v-model.number="st.goal" type="number" min="0" class="input" /></label>
              <label class="field"><span>تنتهي الحملة في</span><input v-model="st.endDate" type="date" class="input" /></label>
              <label class="field"><span>أقل مبلغ</span><input v-model.number="st.min" type="number" min="0" class="input" /></label>
              <label class="field"><span>أعلى مبلغ</span><input v-model.number="st.max" type="number" min="0" class="input" /></label>
            </div>
            <small class="muted">صفر في الحدود يعني استخدام حدود المتجر العامة.</small>
            <label class="field"><span>مبالغ مقترحة</span><input v-model="st.presets" class="input" placeholder="100، 200، 500" /></label>
            <label class="field"><span>حساب الإيراد</span><select v-model="st.revenueAccountId" class="input"><option :value="null">حساب الإعدادات العام</option><option v-for="a in lk.accounts" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select></label>
            <label class="check"><input v-model="st.stop" type="checkbox" /> إيقاف التبرع عند اكتمال المستهدف</label>
            <label class="check"><input v-model="st.monthly" type="checkbox" /> يسمح بالتبرع الشهري</label>
            <label class="check"><input v-model="st.gift" type="checkbox" /> يسمح بالإهداء</label>
          </template>
          <label class="field" style="margin-top: 8px"><span>ملاحظة {{ p.status === 'pending' ? '(إلزامية عند الإرجاع أو الرفض)' : '' }}</span><textarea v-model="note" class="input" rows="2" /></label>
          <div class="ws-actions">
            <button class="btn btn-primary" :disabled="busy" @click="decide('approve')">{{ p.status === 'pending' ? 'اعتماد' : 'حفظ' }}</button>
            <template v-if="p.status === 'pending'"><button class="btn" :disabled="busy" @click="decide('return')">إرجاع</button><button class="btn btn-danger" :disabled="busy" @click="decide('reject')">رفض</button></template>
            <button v-else-if="p.showOnSite || p.store.on" class="btn" :disabled="busy" @click="decide('unpublish')">إخفاء</button>
          </div>
        </section>
        <section v-if="p.status === 'approved'" class="card ws-panel">
          <h2>الحصيلة</h2>
          <strong style="font-size: 1.4rem; color: var(--primary)">{{ sar(p.raised) }}</strong>
          <div v-if="p.store.goal" class="ws-progress"><i :style="{ width: `${p.progress}%` }" /></div>
          <span class="muted">{{ p.donationsCount }} تبرع<template v-if="p.store.goal"> · {{ p.progress }}% من {{ sar(p.store.goal) }}</template></span>
          <div v-if="p.storeBlock" class="ws-note" style="margin: 8px 0 0">{{ p.storeBlock }}</div>
          <RouterLink :to="{ path: '/website/donations', query: { program: p.id } }" class="ws-link">تبرعات البرنامج</RouterLink>
        </section>
        <section class="card ws-panel">
          <h2>السجل</h2>
          <ul class="ws-log"><li v-for="(l, i) in [...(p.log ?? [])].reverse()" :key="i"><div><strong>{{ l.action }}</strong> · {{ l.byName }}<div class="muted">{{ fmtDateTime(l.at) }}</div><div v-if="l.note">{{ l.note }}</div></div></li></ul>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.pe-ic { width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; background: var(--primary-soft); color: var(--primary); }
hr { border: 0; border-top: 1px solid var(--border); margin: 8px 0; width: 100%; }
</style>
