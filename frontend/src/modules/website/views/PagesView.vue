<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import ImageField from '../components/ImageField.vue';
import { LINK_TARGETS, errMsg, siteUrl } from '../lib';
import '../website.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const toast = useToast();
type Tab = 'home' | 'about' | 'governance' | 'partners';
const tab = ref<Tab>('home');
const TABS: [Tab, string, string][] = [['home', 'الصفحة الرئيسية', ''], ['about', 'من نحن', '/about'], ['governance', 'الحوكمة والشفافية', '/governance'], ['partners', 'الشركاء', '/partners']];
const d = ref<any>(null);
const busy = ref(false);

function load(r: any) {
  r.governance.committees = (r.governance.committees ?? []).map((name: string) => ({ name }));
  r.governance.units = (r.governance.units ?? []).map((name: string) => ({ name }));
  d.value = r;
}
onMounted(async () => {
  try {
    load(await api('/website/pages'));
  } catch (e) {
    toast.error(errMsg(e));
  }
});
async function save() {
  busy.value = true;
  try {
    const data = tab.value === 'partners' ? { partners: d.value.partners } : d.value[tab.value];
    load(await api(`/website/pages/${tab.value}`, { method: 'PUT', json: { data } }));
    toast.success('حُفظت الصفحة وظهرت في الموقع');
  } catch (e) {
    toast.error(errMsg(e));
  } finally {
    busy.value = false;
  }
}
const preview = (path: string) => siteUrl(session.user?.organizationSlug, path, d.value?.published ? null : d.value?.previewKey);
</script>

<template>
  <div v-if="d">
    <div class="page-head">
      <div><h1>صفحات الموقع</h1><p class="muted">النصوص والصور الثابتة. الرؤية والرسالة والأهداف والشعار والألوان تأتي من <RouterLink to="/settings/identity" class="ws-link">هوية الجمعية</RouterLink>.</p></div>
      <a :href="preview(TABS.find((t) => t[0] === tab)![2])" target="_blank" rel="noopener" class="btn">معاينة الصفحة ↗</a>
    </div>
    <div class="ws-tabs"><button v-for="[k, l] in TABS" :key="k" :class="['ws-tab', { on: tab === k }]" @click="tab = k">{{ l }}</button></div>

    <!-- الرئيسية -->
    <template v-if="tab === 'home'">
      <section class="card ws-panel">
        <h2>الواجهة الرئيسية</h2>
        <div class="ws-grid2">
          <label class="field"><span>عبارة صغيرة فوق العنوان</span><input v-model="d.home.kicker" class="input" /></label>
          <label class="field"><span>العنوان الرئيسي *</span><input v-model="d.home.title" class="input" /></label>
        </div>
        <label class="field"><span>النص التعريفي</span><textarea v-model="d.home.text" class="input" rows="2" /></label>
        <ImageField :id="d.home.imageId" :url="d.home.imageUrl" label="صورة الخلفية" @update="(v) => { d.home.imageId = v.id; d.home.imageUrl = v.url; }" />
        <div class="ws-grid2">
          <div class="ws-box"><strong>الزر الأول</strong>
            <label class="field"><span>النص</span><input v-model="d.home.primaryCta.label" class="input" /></label>
            <label class="field"><span>يفتح</span><select v-model="d.home.primaryCta.target" class="input"><option v-for="(l, k) in LINK_TARGETS" :key="k" :value="k">{{ l }}</option></select></label></div>
          <div class="ws-box"><strong>الزر الثاني</strong>
            <label class="field"><span>النص</span><input v-model="d.home.secondaryCta.label" class="input" /></label>
            <label class="field"><span>يفتح</span><select v-model="d.home.secondaryCta.target" class="input"><option v-for="(l, k) in LINK_TARGETS" :key="k" :value="k">{{ l }}</option></select></label></div>
        </div>
      </section>
      <section class="card ws-panel">
        <div class="ws-row" style="justify-content: space-between"><h2>أرقام الإنجاز (حتى 6)</h2><button v-if="d.home.stats.length < 6" class="btn btn-sm" @click="d.home.stats.push({ value: '', label: '' })">+ رقم</button></div>
        <div v-for="(s, i) in d.home.stats" :key="i" class="ws-row"><input v-model="s.value" class="input" placeholder="1,240" style="width: 120px" /><input v-model="s.label" class="input" placeholder="يتيمًا مكفولًا" style="flex: 1" /><button class="btn btn-sm btn-danger" @click="d.home.stats.splice(i, 1)">×</button></div>
      </section>
      <section class="card ws-panel">
        <h2>الإعلان والأقسام</h2>
        <label class="check"><input v-model="d.home.announcement.on" type="checkbox" /> إظهار شريط إعلان أعلى الموقع</label>
        <div v-if="d.home.announcement.on" class="ws-grid2">
          <label class="field"><span>نص الإعلان</span><input v-model="d.home.announcement.text" class="input" /></label>
          <label class="field"><span>يفتح</span><select v-model="d.home.announcement.link" class="input"><option value="">بدون رابط</option><option v-for="(l, k) in LINK_TARGETS" :key="k" :value="k">{{ l }}</option></select></label>
        </div>
        <label class="check"><input v-model="d.home.showTicker" type="checkbox" /> شريط الأخبار المتحرك</label>
        <label class="check"><input v-model="d.home.showGoals" type="checkbox" /> قسم الرؤية والرسالة والأهداف</label>
        <label class="check"><input v-model="d.home.showValues" type="checkbox" /> قسم القيم</label>
      </section>
    </template>

    <!-- من نحن -->
    <section v-else-if="tab === 'about'" class="card ws-panel">
      <h2>من نحن</h2>
      <label class="field"><span>قصة الجمعية</span><textarea v-model="d.about.story" class="input" rows="8" /><small class="muted">افصل الفقرات بسطر فارغ.</small></label>
      <ImageField :id="d.about.imageId" :url="d.about.imageUrl" label="صورة الصفحة" @update="(v) => { d.about.imageId = v.id; d.about.imageUrl = v.url; }" />
      <label class="check"><input v-model="d.about.showStructure" type="checkbox" /> عرض الهيكل التنظيمي في الصفحة</label>
    </section>

    <!-- الحوكمة -->
    <template v-else-if="tab === 'governance'">
      <section class="card ws-panel">
        <h2>مقدمة الصفحة</h2>
        <textarea v-model="d.governance.intro" class="input" rows="3" />
        <label class="check"><input v-model="d.governance.showBoard" type="checkbox" /> عرض مجلس الإدارة</label>
        <label class="check"><input v-model="d.governance.showStructure" type="checkbox" /> عرض الهيكل التنظيمي</label>
        <label class="check"><input v-model="d.governance.showDocuments" type="checkbox" /> عرض اللوائح والسياسات العامة من أرشيف المعرفة</label>
      </section>
      <section class="card ws-panel">
        <div class="ws-row" style="justify-content: space-between"><h2>القيادات ومجلس الإدارة</h2><button class="btn btn-sm" @click="d.governance.leaders.push({ name: '', role: '', photoId: null, photoUrl: null })">+ عضو</button></div>
        <div class="ws-grid2">
          <div v-for="(l, i) in d.governance.leaders" :key="i" class="ws-box">
            <ImageField :id="l.photoId" :url="l.photoUrl" round @update="(v) => { l.photoId = v.id; l.photoUrl = v.url; }" />
            <input v-model="l.name" class="input" placeholder="الاسم" style="margin-bottom: 6px" />
            <div class="ws-row"><input v-model="l.role" class="input" placeholder="المنصب" style="flex: 1" /><button class="btn btn-sm btn-danger" @click="d.governance.leaders.splice(i, 1)">حذف</button></div>
          </div>
        </div>
        <h3 style="margin-top: 12px">بيانات المجلس</h3>
        <div v-for="(r, i) in d.governance.boardRows" :key="i" class="ws-row"><input v-model="r.k" class="input" placeholder="البند (مثل: مدة الدورة)" style="width: 220px" /><input v-model="r.v" class="input" placeholder="القيمة" style="flex: 1" /><button class="btn btn-sm btn-danger" @click="d.governance.boardRows.splice(i, 1)">×</button></div>
        <button class="btn btn-sm" style="align-self: flex-start" @click="d.governance.boardRows.push({ k: '', v: '' })">+ بند</button>
      </section>
      <section class="card ws-panel">
        <h2>الهيكل التنظيمي</h2>
        <div class="ws-grid2">
          <label class="field"><span>رأس الهيكل</span><input v-model="d.governance.assembly" class="input" /></label>
          <label class="field"><span>الإدارة التنفيذية</span><input v-model="d.governance.ceo" class="input" /></label>
        </div>
        <div class="ws-grid2">
          <div><strong>اللجان</strong>
            <div v-for="(c, i) in d.governance.committees" :key="i" class="ws-row"><input v-model="c.name" class="input" style="flex: 1" /><button class="btn btn-sm btn-danger" @click="d.governance.committees.splice(i, 1)">×</button></div>
            <button class="btn btn-sm" @click="d.governance.committees.push({ name: '' })">+ لجنة</button></div>
          <div><strong>الإدارات والأقسام</strong>
            <div v-for="(c, i) in d.governance.units" :key="i" class="ws-row"><input v-model="c.name" class="input" style="flex: 1" /><button class="btn btn-sm btn-danger" @click="d.governance.units.splice(i, 1)">×</button></div>
            <button class="btn btn-sm" @click="d.governance.units.push({ name: '' })">+ إدارة</button></div>
        </div>
        <ImageField :id="d.governance.structureImageId" :url="d.governance.structureImageUrl" label="صورة الهيكل (اختيارية، تحل محل الرسم التلقائي)" @update="(v) => { d.governance.structureImageId = v.id; d.governance.structureImageUrl = v.url; }" />
      </section>
      <section class="card ws-panel">
        <div class="ws-row" style="justify-content: space-between"><h2>الإفصاحات</h2><button class="btn btn-sm" @click="d.governance.disclosures.push({ title: '', text: '', status: 'منشور', docId: null })">+ إفصاح</button></div>
        <div v-for="(x, i) in d.governance.disclosures" :key="i" class="ws-box">
          <div class="ws-box-head"><input v-model="x.title" class="input" placeholder="العنوان (مثل: القوائم المالية 2025)" style="flex: 1" /><input v-model="x.status" class="input" placeholder="الحالة" style="width: 130px" /><button class="btn btn-sm btn-danger" @click="d.governance.disclosures.splice(i, 1)">×</button></div>
          <textarea v-model="x.text" class="input" rows="2" placeholder="وصف مختصر" />
          <select v-model="x.docId" class="input" style="margin-top: 6px"><option :value="null">بدون وثيقة مرفقة</option><option v-for="doc in d.documents" :key="doc.id" :value="doc.id">{{ doc.title }}</option></select>
        </div>
        <p class="ws-muted">الوثائق المتاحة هنا هي المنشورة للعامة في <RouterLink to="/knowledge" class="ws-link">أرشيف المعرفة</RouterLink>.</p>
      </section>
    </template>

    <!-- الشركاء -->
    <section v-else class="card ws-panel">
      <div class="ws-row" style="justify-content: space-between"><h2>الشركاء والداعمون</h2><button class="btn btn-sm" @click="d.partners.push({ name: '', url: '', kind: '', logoId: null, logoUrl: null })">+ شريك</button></div>
      <div v-if="!d.partners.length" class="ws-empty">لا يوجد شركاء بعد</div>
      <div class="ws-grid2">
        <div v-for="(x, i) in d.partners" :key="i" class="ws-box">
          <ImageField :id="x.logoId" :url="x.logoUrl" label="الشعار" @update="(v) => { x.logoId = v.id; x.logoUrl = v.url; }" />
          <input v-model="x.name" class="input" placeholder="اسم الجهة" style="margin-bottom: 6px" />
          <div class="ws-row"><input v-model="x.kind" class="input" placeholder="النوع (مانح، حكومي...)" style="flex: 1" /><input v-model="x.url" class="input" dir="ltr" placeholder="https://" style="flex: 1" /></div>
          <button class="btn btn-sm btn-danger" @click="d.partners.splice(i, 1)">حذف</button>
        </div>
      </div>
    </section>

    <div class="ws-actions"><button class="btn btn-primary" :disabled="busy" @click="save">حفظ {{ TABS.find((t) => t[0] === tab)![1] }}</button></div>
  </div>
</template>
