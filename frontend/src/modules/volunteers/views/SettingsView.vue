<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { useToast } from '../../../stores/toast';
import FieldsEditor from '../components/FieldsEditor.vue';
import LookupEditor from '../components/LookupEditor.vue';
import { copy, loadLookups, publicUrl } from '../lib';
import '../../../shared/module.css';
import '../volunteers.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = [
  { k: 'general', l: 'الصفحة العامة' }, { k: 'registration', l: 'نموذج تسجيل المتطوع' }, { k: 'lookups', l: 'أنواع التطوع ومجالاته' },
  { k: 'events', l: 'نموذج الفعالية ومراحل اعتمادها' }, { k: 'closure', l: 'تقرير الإغلاق' }, { k: 'surveys', l: 'استبانات الرضا' },
  { k: 'certificates', l: 'قوالب الشهادات' }, { k: 'contract', l: 'فقرات عقد التطوع' }, { k: 'permissions', l: 'الصلاحيات' },
] as const;
type Tab = (typeof TABS)[number]['k'];
const route = useRoute();
const toast = useToast();
const tab = ref<Tab>((TABS.some((t) => t.k === route.query.tab) ? route.query.tab : 'general') as Tab);
const s = ref<any>(null);
onMounted(async () => {
  try {
    s.value = await api('/volunteers/settings');
  } catch (e) {
    toast.error((e as Error).message);
  }
});
async function save(section: Tab, data: Record<string, unknown>) {
  try {
    s.value = await api(`/volunteers/settings/${section}`, { method: 'PUT', json: { data } });
    await loadLookups(true);
    toast.success('حُفظت الإعدادات');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const QTYPES = [{ value: 'rating', label: 'تقييم من 1 إلى 5' }, { value: 'yesno', label: 'نعم أو لا' }, { value: 'text', label: 'نص (ملاحظات)' }];
function moveIn(list: unknown[], i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}
const link = (p: string) => publicUrl(p);
async function copyLink(p: string) {
  if (await copy(link(p))) toast.success('نُسخ الرابط');
}
const CONTRACT_VARS = ['اسم الشركة', 'اسم المتطوع', 'رقم الهوية', 'رقم الجوال', 'رقم العقد', 'تاريخ العقد', 'تاريخ البداية', 'تاريخ النهاية', 'مجالات التطوع', 'نوع التطوع'];
const CERT_VARS = ['اسم الشركة', 'اسم المتطوع', 'رقم الهوية', 'عدد الساعات', 'الفعاليات', 'اسم الفعالية', 'من تاريخ', 'إلى تاريخ', 'تاريخ الإصدار'];
</script>

<template>
  <div>
    <div class="page-head"><div><h1>إعدادات التطوع</h1><p class="muted">كل النماذج والقوائم والقوالب هنا مرنة: أضف واحذف وعدّل بما يناسب الشركة. اللائحة والميثاق في <RouterLink to="/volunteers/policy" class="pm-link">لائحة التطوع وميثاقه</RouterLink>.</p></div></div>
    <div class="vt-tabs"><button v-for="t in TABS" :key="t.k" :class="['vt-tab', { on: tab === t.k }]" @click="tab = t.k">{{ t.l }}</button></div>
    <template v-if="s">
      <Transition name="page" mode="out-in">
        <section v-if="tab === 'general'" key="g" class="card pm-panel" style="max-width: 760px">
          <h2>صفحة التطوع العامة للشركة</h2>
          <p class="pm-muted">صفحة بدون دخول يسجل منها المتطوع نفسه (ويظهر طلبه «بانتظار القبول»)، ويرسل منها أي شخص شكوى أو مقترحًا أو استفسارًا ويتابعه.</p>
          <label class="check" style="margin-bottom: 12px"><input v-model="s.publicRegistration" type="checkbox" /> السماح بالتسجيل الذاتي للمتطوعين</label>
          <div class="vt-chips" style="flex-direction: column; align-items: stretch">
            <div class="vt-chip" style="border-radius: 10px; padding: 8px 12px">صفحة التطوع: <span class="vt-code" style="flex: 1">{{ link(`/v/${s.slug}`) }}</span><button class="btn btn-sm" @click="copyLink(`/v/${s.slug}`)">نسخ</button></div>
            <div class="vt-chip" style="border-radius: 10px; padding: 8px 12px">التحقق من الشهادات: <span class="vt-code" style="flex: 1">{{ link('/v/verify') }}</span><button class="btn btn-sm" @click="copyLink('/v/verify')">نسخ</button></div>
          </div>
          <div class="modal-actions"><button class="btn btn-primary" @click="save('general', { publicRegistration: s.publicRegistration })">حفظ</button></div>
        </section>

        <section v-else-if="tab === 'registration'" key="r" class="card pm-panel">
          <h2>نموذج تسجيل المتطوع</h2>
          <FieldsEditor v-model="s.registrationFields" hint="البيانات الأساسية ثابتة (الاسم، الهوية، الجوال، البريد، الجنس، الميلاد، المدينة، المؤهل، نوع التطوع، المجالات، الإتاحة، المهارات). أضف هنا ما تحتاجه الشركة فوقها، ويظهر في التسجيل الذاتي وتسجيل الموظف." />
          <div class="modal-actions"><button class="btn btn-primary" @click="save('registration', { registrationFields: s.registrationFields })">حفظ النموذج</button></div>
        </section>

        <section v-else-if="tab === 'lookups'" key="l" class="card pm-panel">
          <div class="vt-grid3">
            <LookupEditor v-model="s.volunteerTypes" title="أنواع التطوع" hint="مثل: ميداني، عن بعد، تخصصي" with-description />
            <LookupEditor v-model="s.volunteerFields" title="مجالات التطوع المتاحة" hint="المجالات التي يختار منها المتطوع وتُصنف بها الفعاليات" />
            <LookupEditor v-model="s.eventCategories" title="تصنيفات الفعاليات" hint="مثل: توعوية، توزيع، تدريبية" />
          </div>
          <p class="pm-muted">العنصر المستخدم لا يُحذف، ويمكن إيقافه فلا يظهر في الاختيارات الجديدة.</p>
          <div class="modal-actions"><button class="btn btn-primary" @click="save('lookups', { volunteerTypes: s.volunteerTypes, volunteerFields: s.volunteerFields, eventCategories: s.eventCategories })">حفظ القوائم</button></div>
        </section>

        <section v-else-if="tab === 'events'" key="e" class="card pm-panel">
          <h2>مراحل اعتماد الفعاليات</h2>
          <p class="pm-muted">تمر كل فعالية بالمراحل بالترتيب قبل تنفيذها. حدد دورًا لكل مرحلة ليقرر فيها أصحاب هذا الدور فقط، أو اتركه لأي مستخدم معه صلاحية اعتماد الفعاليات. التعديل يسري على الفعاليات التي تُرسل بعده.</p>
          <div v-for="(st, i) in s.eventStages" :key="i" style="display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-wrap: wrap">
            <span class="pm-tag">{{ i + 1 }}</span>
            <input v-model="st.name" class="input" style="flex: 1; min-width: 180px" placeholder="اسم المرحلة" />
            <select v-model="st.roleId" class="input" style="max-width: 240px"><option :value="null">أي معتمد</option><option v-for="r in s.roles" :key="r.id" :value="r.id">{{ r.name }}</option></select>
            <button class="btn btn-sm" :disabled="i === 0" @click="moveIn(s.eventStages, i, -1)">▲</button>
            <button class="btn btn-sm" :disabled="i === s.eventStages.length - 1" @click="moveIn(s.eventStages, i, 1)">▼</button>
            <button class="btn btn-sm btn-danger" :disabled="s.eventStages.length === 1" @click="s.eventStages.splice(i, 1)">✕</button>
          </div>
          <button class="btn btn-sm" :disabled="s.eventStages.length >= 8" @click="s.eventStages.push({ name: '', roleId: null })">+ مرحلة</button>
          <div class="vt-sec">حقول إضافية في نموذج الفعالية</div>
          <FieldsEditor v-model="s.eventFields" hint="الحقول الأساسية ثابتة (الاسم، النوع ميداني أو عن بعد، الموقع أو المنصة، الموعد، الساعات، المستهدفات، الوصف). أضف ما تحتاجه الشركة فوقها." />
          <div class="modal-actions"><button class="btn btn-primary" @click="save('events', { eventFields: s.eventFields, eventStages: s.eventStages })">حفظ</button></div>
        </section>

        <section v-else-if="tab === 'closure'" key="c" class="card pm-panel">
          <h2>نموذج تقرير إغلاق الفعالية</h2>
          <FieldsEditor v-model="s.closureFields" hint="الأساسي ثابت: المستفيدون الفعليون، ملخص التنفيذ، الإنجازات، التحديات، التوصيات، التكلفة الفعلية. أضف حقولًا أخرى هنا." />
          <div class="modal-actions"><button class="btn btn-primary" @click="save('closure', { closureFields: s.closureFields })">حفظ</button></div>
        </section>

        <section v-else-if="tab === 'surveys'" key="s" class="card pm-panel">
          <div class="vt-grid" style="grid-template-columns: 1fr 1fr">
            <div v-for="a in (['volunteer', 'beneficiary'] as const)" :key="a">
              <h2>{{ a === 'volunteer' ? 'استبانة المتطوعين' : 'استبانة المستفيدين' }}</h2>
              <div v-for="(q, i) in s.surveyQuestions[a]" :key="i" class="card" style="padding: 10px; margin-bottom: 8px">
                <div style="display: flex; gap: 6px; align-items: center">
                  <span class="pm-tag">{{ i + 1 }}</span><input v-model="q.text" class="input" placeholder="نص السؤال" />
                  <button class="btn btn-sm" :disabled="i === 0" @click="moveIn(s.surveyQuestions[a], i, -1)">▲</button>
                  <button class="btn btn-sm btn-danger" @click="s.surveyQuestions[a].splice(i, 1)">✕</button>
                </div>
                <div style="display: flex; gap: 10px; align-items: center; margin-top: 6px">
                  <select v-model="q.type" class="input" style="max-width: 200px"><option v-for="t in QTYPES" :key="t.value" :value="t.value">{{ t.label }}</option></select>
                  <label class="check"><input v-model="q.required" type="checkbox" /> إلزامي</label>
                </div>
              </div>
              <button class="btn btn-sm" @click="s.surveyQuestions[a].push({ key: '', text: '', type: 'rating', required: true })">+ سؤال</button>
            </div>
          </div>
          <p class="pm-muted">نسبة الرضا = متوسط أسئلة التقييم (1 = 0% و5 = 100%) وأسئلة نعم/لا. الاستبانات الصادرة تحتفظ بأسئلتها وقت إصدارها.</p>
          <div class="modal-actions"><button class="btn btn-primary" @click="save('surveys', { surveyQuestions: s.surveyQuestions })">حفظ الأسئلة</button></div>
        </section>

        <section v-else-if="tab === 'certificates'" key="ce" class="card pm-panel">
          <div class="pm-grid2">
            <label class="field"><span>اسم الموقّع على الشهادات</span><input v-model="s.certificateTemplates.signatoryName" class="input" /></label>
            <label class="field"><span>صفته</span><input v-model="s.certificateTemplates.signatoryTitle" class="input" /></label>
          </div>
          <div class="vt-grid" style="grid-template-columns: 1fr 1fr">
            <div><div class="vt-sec">شهادة الساعات التطوعية</div>
              <label class="field"><span>العنوان</span><input v-model="s.certificateTemplates.hoursTitle" class="input" /></label>
              <label class="field"><span>النص</span><textarea v-model="s.certificateTemplates.hoursBody" class="input" rows="6" /></label></div>
            <div><div class="vt-sec">شهادة الشكر والتقدير</div>
              <label class="field"><span>العنوان</span><input v-model="s.certificateTemplates.thanksTitle" class="input" /></label>
              <label class="field"><span>النص</span><textarea v-model="s.certificateTemplates.thanksBody" class="input" rows="6" /></label></div>
          </div>
          <p class="pm-muted">المتغيرات المتاحة: <span v-for="v in CERT_VARS" :key="v" class="pm-tag" style="margin: 2px">{{ '{' + v + '}' }}</span></p>
          <div class="modal-actions"><button class="btn btn-primary" @click="save('certificates', { certificateTemplates: s.certificateTemplates })">حفظ القوالب</button></div>
        </section>

        <section v-else-if="tab === 'contract'" key="ct" class="card pm-panel">
          <h2>فقرات عقد التطوع</h2>
          <p class="pm-muted">مسودة مقترحة قابلة للتعديل: أضف فقرة، أو أوقفها فلا تظهر في العقود الجديدة، أو احذفها، أو غيّر ترتيبها. العقود الصادرة تحتفظ بنصها وقت إصدارها.</p>
          <div v-for="(c, i) in s.contractClauses" :key="c.key || i" class="card" :style="{ padding: '12px', marginBottom: '10px', opacity: c.isActive ? 1 : 0.55 }">
            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap">
              <span class="pm-tag">{{ i + 1 }}</span><input v-model="c.title" class="input" style="flex: 1; min-width: 180px" placeholder="عنوان الفقرة" />
              <label class="check"><input v-model="c.isActive" type="checkbox" /> مفعّلة</label>
              <button class="btn btn-sm" :disabled="i === 0" @click="moveIn(s.contractClauses, i, -1)">▲</button>
              <button class="btn btn-sm" :disabled="i === s.contractClauses.length - 1" @click="moveIn(s.contractClauses, i, 1)">▼</button>
              <button class="btn btn-sm btn-danger" @click="s.contractClauses.splice(i, 1)">✕</button>
            </div>
            <textarea v-model="c.body" class="input" rows="3" style="margin-top: 6px" />
          </div>
          <button class="btn btn-sm" @click="s.contractClauses.push({ key: '', title: '', body: '', isActive: true })">+ فقرة جديدة</button>
          <p class="pm-muted">المتغيرات المتاحة: <span v-for="v in CONTRACT_VARS" :key="v" class="pm-tag" style="margin: 2px">{{ '{' + v + '}' }}</span></p>
          <div class="modal-actions"><button class="btn btn-primary" @click="save('contract', { contractClauses: s.contractClauses })">حفظ فقرات العقد</button></div>
        </section>

        <ModulePermissionsPane v-else key="p" module="volunteers" />
      </Transition>
    </template>
  </div>
</template>
