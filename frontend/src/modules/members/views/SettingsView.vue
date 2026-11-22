<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { useToast } from '../../../stores/toast';
import FieldsEditor from '../components/FieldsEditor.vue';
import { copy, durationLabel, fmtDate, loadLookups, publicUrl, sar } from '../lib';
import '../../../shared/module.css';
import '../members.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = [
  { k: 'general', l: 'الصفحة العامة' }, { k: 'types', l: 'أنواع العضوية والاشتراكات' }, { k: 'conditions', l: 'شروط العضوية' },
  { k: 'regulation', l: 'أحكام اللائحة' }, { k: 'form', l: 'نموذج الطلب والمستندات' }, { k: 'stages', l: 'مراحل الاعتماد' },
  { k: 'payment', l: 'طرق السداد' }, { k: 'accounting', l: 'الربط المالي' }, { k: 'renewal', l: 'التجديد والتنبيهات' },
  { k: 'card', l: 'بطاقة العضوية' }, { k: 'permissions', l: 'الصلاحيات' },
] as const;
type Tab = (typeof TABS)[number]['k'];
const route = useRoute();
const toast = useToast();
const tab = ref<Tab>((TABS.some((t) => t.k === route.query.tab) ? route.query.tab : 'general') as Tab);
const s = ref<any>(null);
const secret = ref({ key: '', clear: false });
const busy = ref(false);

async function load() {
  try {
    s.value = await api('/members/settings');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
async function save(section: Exclude<Tab, 'permissions'>, data: Record<string, unknown>) {
  busy.value = true;
  try {
    s.value = await api(`/members/settings/${section}`, { method: 'PUT', json: { data } });
    await loadLookups(true);
    toast.success('حُفظت الإعدادات');
    if (section === 'payment') secret.value = { key: '', clear: false };
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
function move(list: unknown[], i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}
const COLORS = ['#164e38', '#1e3a8a', '#b45309', '#7c3aed', '#be123c', '#0369a1', '#4d7c0f'];
function addType() {
  s.value.types.push({ name: '', description: '', fee: 0, joiningFee: 0, durationMonths: 12, votingRights: false, votingAfterDays: 0, minAge: 18, saudiOnly: false,
    publicApply: true, benefits: '', revenueAccountId: null, color: COLORS[s.value.types.length % COLORS.length], isActive: true });
}
const link = (p: string) => publicUrl(p);
async function copyLink(p: string) {
  if (await copy(link(p))) toast.success('نُسخ الرابط');
}
const VARS = ['اسم العضو', 'رقم العضوية', 'نوع العضوية', 'اسم الشركة', 'تاريخ الانتهاء', 'المبلغ', 'رابط السداد'];
const reminderText = ref('');
function syncReminders() {
  reminderText.value = (s.value?.renewal.reminderDays ?? []).join('، ');
}
function savePayment() {
  const p = s.value.payment;
  void save('payment', { ...p, secretKey: secret.value.key.trim() || null, clearSecret: secret.value.clear });
}
function saveRenewal() {
  const days = reminderText.value.split(/[،,\s]+/).map((x) => Number(x)).filter((n) => n > 0);
  void save('renewal', { ...s.value.renewal, reminderDays: days });
}
const accLabel = (a: any) => `${a.code} · ${a.name}`;
</script>

<template>
  <div>
    <div class="page-head"><div><h1>إعدادات العضوية</h1><p class="muted">كل ما يخص العضوية مرن من هنا: الأنواع واشتراكاتها، الشروط وأحكام اللائحة الأساسية، النموذج والمستندات، مراحل الاعتماد، السداد والربط المالي، والتجديد.</p></div></div>
    <div class="mb-tabs"><button v-for="t in TABS" :key="t.k" :class="['mb-tab', { on: tab === t.k }]" @click="tab = t.k; t.k === 'renewal' && syncReminders()">{{ t.l }}</button></div>
    <template v-if="s">
      <Transition name="page" mode="out-in">
        <section v-if="tab === 'general'" key="g" class="card pm-panel" style="max-width: 820px">
          <h2>صفحة العضوية العامة</h2>
          <p class="pm-muted">صفحة بدون دخول يطلع فيها الزائر على أنواع العضوية وشروطها وأحكام اللائحة، ويقدم طلبه ويتابعه، ويستعرض العضو عضويته ويجدد اشتراكه.</p>
          <label class="check" style="margin-bottom: 12px"><input v-model="s.publicEnabled" type="checkbox" /> استقبال طلبات العضوية من الموقع</label>
          <label class="field"><span>نبذة تظهر أعلى الصفحة</span><textarea v-model="s.intro" class="input" rows="4" placeholder="مثل: انضم إلى الجمعية العمومية وكن شريكًا في القرار..." /></label>
          <div class="mb-chips" style="flex-direction: column; align-items: stretch">
            <div class="mb-chip" style="border-radius: 10px; padding: 8px 12px">صفحة العضوية: <span class="mb-code" style="flex: 1">{{ link(`/m/${s.slug}`) }}</span><button class="btn btn-sm" @click="copyLink(`/m/${s.slug}`)">نسخ</button></div>
            <div class="mb-chip" style="border-radius: 10px; padding: 8px 12px">التحقق من البطاقات: <span class="mb-code" style="flex: 1">{{ link('/m/verify') }}</span><button class="btn btn-sm" @click="copyLink('/m/verify')">نسخ</button></div>
          </div>
          <div class="modal-actions"><button class="btn btn-primary" :disabled="busy" @click="save('general', { publicEnabled: s.publicEnabled, intro: s.intro })">حفظ</button></div>
        </section>

        <section v-else-if="tab === 'types'" key="t" class="card pm-panel">
          <h2>أنواع العضوية وقيمة الاشتراك</h2>
          <p class="pm-muted">النوع المستخدم لعضو أو طلب لا يُحذف، أوقفه بدلًا من ذلك. رسوم الانتساب تُدفع مرة واحدة مع أول اشتراك.</p>
          <div v-for="(t, i) in s.types" :key="t.code ?? i" class="box" :style="{ '--c': t.color }">
            <div class="box-head">
              <input v-model="t.color" type="color" class="color" />
              <input v-model="t.name" class="input" placeholder="اسم النوع، مثل: عضو عامل" style="flex: 1; font-weight: 700" />
              <label class="check"><input v-model="t.isActive" type="checkbox" /> مفعّل</label>
              <button class="btn btn-sm" @click="move(s.types, i, -1)">↑</button><button class="btn btn-sm" @click="move(s.types, i, 1)">↓</button>
              <button class="btn btn-sm btn-danger" @click="s.types.splice(i, 1)">حذف</button>
            </div>
            <div class="mb-fields">
              <label class="field"><span>الاشتراك (ريال)</span><input v-model.number="t.fee" type="number" min="0" class="input" /></label>
              <label class="field"><span>رسوم الانتساب (مرة واحدة)</span><input v-model.number="t.joiningFee" type="number" min="0" class="input" /></label>
              <label class="field"><span>المدة بالأشهر</span><input v-model.number="t.durationMonths" type="number" min="1" max="120" class="input" /><small class="pm-muted">{{ durationLabel(t.durationMonths) }}</small></label>
              <label class="field"><span>أقل عمر (فارغ = بلا شرط)</span><input v-model.number="t.minAge" type="number" min="0" class="input" /></label>
              <label class="field"><span>حساب إيراد خاص بالنوع</span>
                <select v-model="t.revenueAccountId" class="input"><option :value="null">حساب الإيراد العام</option><option v-for="a in s.accounts.filter((x: any) => x.nature === 'revenue')" :key="a.id" :value="a.id">{{ accLabel(a) }}</option></select></label>
              <label class="field"><span>حق التصويت بعد (يوم من الانضمام)</span><input v-model.number="t.votingAfterDays" type="number" min="0" class="input" :disabled="!t.votingRights" /></label>
            </div>
            <div class="flags">
              <label class="check"><input v-model="t.votingRights" type="checkbox" /> له حق حضور الجمعية العمومية والتصويت</label>
              <label class="check"><input v-model="t.saudiOnly" type="checkbox" /> للسعوديين فقط</label>
              <label class="check"><input v-model="t.publicApply" type="checkbox" /> يظهر في صفحة التقديم العامة</label>
            </div>
            <div class="pm-grid2">
              <label class="field"><span>الوصف</span><textarea v-model="t.description" class="input" rows="2" /></label>
              <label class="field"><span>المزايا (سطر لكل ميزة)</span><textarea v-model="t.benefits" class="input" rows="2" /></label>
            </div>
            <p class="pm-muted" style="margin: 0; font-size: .8rem">أول اشتراك: {{ sar((t.fee || 0) + (t.joiningFee || 0)) }} · التجديد: {{ sar(t.fee) }} {{ durationLabel(t.durationMonths) }}</p>
          </div>
          <div class="modal-actions" style="justify-content: space-between"><button class="btn" @click="addType">+ نوع جديد</button>
            <button class="btn btn-primary" :disabled="busy" @click="save('types', { types: s.types })">حفظ الأنواع</button></div>
        </section>

        <section v-else-if="tab === 'conditions'" key="c" class="card pm-panel">
          <h2>شروط العضوية</h2>
          <p class="pm-muted">يقر المتقدم بكل شرط مفعّل قبل إرسال طلبه. اذكر المادة من اللائحة الأساسية ليرجع إليها المعتمد.</p>
          <div v-for="(c, i) in s.conditions" :key="c.key ?? i" class="row">
            <span class="mb-num">{{ i + 1 }}</span>
            <textarea v-model="c.text" class="input" rows="2" style="flex: 3" placeholder="نص الشرط" />
            <input v-model="c.reference" class="input" style="flex: 1" placeholder="المرجع، مثل: المادة 9" />
            <label class="check"><input v-model="c.isActive" type="checkbox" /> مفعّل</label>
            <button class="btn btn-sm" @click="move(s.conditions, i, -1)">↑</button>
            <button class="btn btn-sm btn-danger" @click="s.conditions.splice(i, 1)">حذف</button>
          </div>
          <div class="modal-actions" style="justify-content: space-between"><button class="btn" @click="s.conditions.push({ text: '', reference: '', isActive: true })">+ شرط</button>
            <button class="btn btn-primary" :disabled="busy" @click="save('conditions', { conditions: s.conditions })">حفظ الشروط</button></div>
        </section>

        <section v-else-if="tab === 'regulation'" key="r" class="card pm-panel">
          <h2>أحكام العضوية في اللائحة الأساسية</h2>
          <p class="pm-muted">الإصدار الحالي {{ s.regulation.version }}، سارٍ من {{ fmtDate(s.regulation.effectiveDate) }}{{ s.regulation.updatedByName ? ` · حدّثه ${s.regulation.updatedByName}` : '' }}. كل حفظ يرفع رقم الإصدار.</p>
          <div class="pm-grid2">
            <label class="field"><span>العنوان</span><input v-model="s.regulation.title" class="input" /></label>
            <label class="field"><span>تاريخ السريان</span><input v-model="s.regulation.effectiveDate" type="date" class="input" /></label>
          </div>
          <div v-for="(x, i) in s.regulation.sections" :key="i" class="box">
            <div class="box-head"><input v-model="x.title" class="input" style="flex: 1; font-weight: 700" placeholder="عنوان القسم، مثل: المادة العاشرة: حقوق العضو" />
              <button class="btn btn-sm" @click="move(s.regulation.sections, i, -1)">↑</button><button class="btn btn-sm btn-danger" @click="s.regulation.sections.splice(i, 1)">حذف</button></div>
            <textarea v-model="x.body" class="input" rows="4" />
          </div>
          <div class="modal-actions" style="justify-content: space-between"><button class="btn" @click="s.regulation.sections.push({ title: '', body: '' })">+ قسم</button>
            <button class="btn btn-primary" :disabled="busy" @click="save('regulation', s.regulation)">حفظ وإصدار نسخة جديدة</button></div>
        </section>

        <section v-else-if="tab === 'form'" key="f" class="card pm-panel">
          <h2>حقول إضافية في نموذج الطلب</h2>
          <FieldsEditor v-model="s.applicationFields" hint="البيانات الأساسية ثابتة (الاسم، الهوية وانتهاؤها، الجنسية، الجنس، الميلاد، الجوال، البريد، المدينة، العنوان، المهنة، جهة العمل، المؤهل). أضف هنا ما تحتاجه الشركة فوقها." />
          <div class="mb-sec">المستندات المطلوبة</div>
          <p class="pm-muted">تُرفع صورة أو PDF مع الطلب وتُحفظ في ملف العضو. المستند ذو المفتاح id_front هو صورة الهوية، وphoto الصورة الشخصية التي تظهر في البطاقة.</p>
          <div v-for="(d, i) in s.documents" :key="d.key ?? i" class="row">
            <input v-model="d.name" class="input" style="flex: 2" placeholder="اسم المستند" />
            <span v-if="d.key" class="mb-code pm-muted">{{ d.key }}</span>
            <label class="check"><input v-model="d.required" type="checkbox" /> إلزامي</label>
            <label class="check"><input v-model="d.isActive" type="checkbox" /> مفعّل</label>
            <button class="btn btn-sm btn-danger" @click="s.documents.splice(i, 1)">حذف</button>
          </div>
          <div class="modal-actions" style="justify-content: space-between"><button class="btn" @click="s.documents.push({ name: '', required: false, isActive: true })">+ مستند</button>
            <button class="btn btn-primary" :disabled="busy" @click="save('form', { applicationFields: s.applicationFields, documents: s.documents })">حفظ النموذج</button></div>
        </section>

        <section v-else-if="tab === 'stages'" key="s" class="card pm-panel" style="max-width: 820px">
          <h2>مراحل اعتماد طلب العضوية</h2>
          <p class="pm-muted">يمر الطلب بالمراحل بالترتيب، ويقرر في كل مرحلة أصحاب الدور المحدد (أو أي من لديه صلاحية الاعتماد إن لم يُحدد دور). بعد آخر مرحلة تصدر مطالبة الاشتراك.</p>
          <div v-for="(st, i) in s.stages" :key="i" class="row">
            <span class="mb-num">{{ i + 1 }}</span>
            <input v-model="st.name" class="input" style="flex: 2" placeholder="اسم المرحلة، مثل: مراجعة شؤون الأعضاء" />
            <select v-model="st.roleId" class="input" style="flex: 1"><option :value="null">أي معتمد</option><option v-for="r in s.roles" :key="r.id" :value="r.id">{{ r.name }}</option></select>
            <button class="btn btn-sm" @click="move(s.stages, i, -1)">↑</button>
            <button class="btn btn-sm btn-danger" :disabled="s.stages.length === 1" @click="s.stages.splice(i, 1)">حذف</button>
          </div>
          <div class="modal-actions" style="justify-content: space-between"><button class="btn" :disabled="s.stages.length >= 8" @click="s.stages.push({ name: '', roleId: null })">+ مرحلة</button>
            <button class="btn btn-primary" :disabled="busy" @click="save('stages', { stages: s.stages })">حفظ المراحل</button></div>
        </section>

        <section v-else-if="tab === 'payment'" key="p" class="card pm-panel" style="max-width: 820px">
          <h2>طرق سداد الاشتراك</h2>
          <div class="flags">
            <label class="check"><input v-model="s.payment.online" type="checkbox" /> دفع إلكتروني (مدى، فيزا، ماستركارد، Apple Pay)</label>
            <label class="check"><input v-model="s.payment.transfer" type="checkbox" /> تحويل بنكي مع رفع الإيصال</label>
            <label class="check"><input v-model="s.payment.cash" type="checkbox" /> في مقر الشركة</label>
          </div>
          <label class="field"><span>مهلة السداد (يوم من إصدار المطالبة)</span><input v-model.number="s.payment.dueDays" type="number" min="1" max="180" class="input" style="max-width: 160px" /></label>
          <template v-if="s.payment.online">
            <div class="mb-sec">بوابة الدفع الإلكتروني</div>
            <label class="field"><span>البوابة</span>
              <select v-model="s.payment.provider" class="input"><option value="sandbox">بيئة تجريبية (لا يُخصم أي مبلغ)</option><option value="moyasar">ميسّر Moyasar</option></select></label>
            <template v-if="s.payment.provider === 'moyasar'">
              <p class="pm-muted">من لوحة ميسّر: الإعدادات ← مفاتيح API. يُحفظ المفتاح السري مشفّرًا ولا يظهر مرة أخرى.</p>
              <label class="field"><span>المفتاح العام (Publishable key)</span><input v-model="s.payment.publishableKey" class="input" dir="ltr" placeholder="pk_live_..." /></label>
              <label class="field"><span>المفتاح السري (Secret key) {{ s.payment.hasSecretKey ? '· محفوظ، اتركه فارغًا للإبقاء عليه' : '' }}</span><input v-model="secret.key" type="password" class="input" dir="ltr" placeholder="sk_live_..." autocomplete="off" /></label>
              <label v-if="s.payment.hasSecretKey" class="check"><input v-model="secret.clear" type="checkbox" /> حذف المفتاح السري المحفوظ</label>
            </template>
          </template>
          <template v-if="s.payment.transfer">
            <div class="mb-sec">حساب التحويل البنكي</div>
            <div class="pm-grid2">
              <label class="field"><span>البنك</span><input v-model="s.payment.bankName" class="input" /></label>
              <label class="field"><span>اسم الحساب</span><input v-model="s.payment.accountName" class="input" /></label>
            </div>
            <label class="field"><span>الآيبان</span><input v-model="s.payment.iban" class="input" dir="ltr" placeholder="SA0000000000000000000000" /></label>
          </template>
          <div class="modal-actions"><button class="btn btn-primary" :disabled="busy" @click="savePayment">حفظ</button></div>
        </section>

        <section v-else-if="tab === 'accounting'" key="a" class="card pm-panel" style="max-width: 820px">
          <h2>الربط بالنظام المالي</h2>
          <p class="pm-muted">كل سداد يُنشئ سند قبض (مسودة) في النظام المالي، مدينه حساب التحصيل حسب طريقة السداد، ودائنه حساب إيراد الاشتراكات (أو حساب النوع إن حُدد). يمر السند بمراحل اعتماد سندات القبض المعتادة.</p>
          <label class="field"><span>حساب إيراد الاشتراكات</span>
            <select v-model="s.accounting.revenueAccountId" class="input"><option :value="null">اختر</option><option v-for="a in s.accounts.filter((x: any) => x.nature === 'revenue')" :key="a.id" :value="a.id">{{ accLabel(a) }}</option></select></label>
          <div class="pm-grid2">
            <label class="field"><span>تحصيل الدفع الإلكتروني</span><select v-model="s.accounting.onlineCashAccountId" class="input"><option :value="null">اختر</option><option v-for="c in s.cashAccounts" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
            <label class="field"><span>التحويلات البنكية</span><select v-model="s.accounting.transferCashAccountId" class="input"><option :value="null">اختر</option><option v-for="c in s.cashAccounts" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
            <label class="field"><span>التحصيل النقدي في المقر</span><select v-model="s.accounting.cashCashAccountId" class="input"><option :value="null">اختر</option><option v-for="c in s.cashAccounts" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
          </div>
          <p v-if="!s.accounts.length || !s.cashAccounts.length" class="pm-viol">أنشئ دليل الحسابات والبنوك والصناديق في النظام المالي أولًا.</p>
          <div class="modal-actions"><button class="btn btn-primary" :disabled="busy" @click="save('accounting', s.accounting)">حفظ</button></div>
        </section>

        <section v-else-if="tab === 'renewal'" key="n" class="card pm-panel" style="max-width: 820px">
          <h2>التجديد والتنبيهات</h2>
          <div class="pm-grid2">
            <label class="field"><span>التنبيه قبل الانتهاء بـ (أيام، افصل بفاصلة)</span><input v-model="reminderText" class="input" placeholder="30، 7" /></label>
            <label class="field"><span>مهلة السماح بعد الانتهاء (يوم)</span><input v-model.number="s.renewal.graceDays" type="number" min="0" class="input" /></label>
            <label class="field"><span>إصدار مطالبة التجديد تلقائيًا قبل الانتهاء بـ (يوم، فارغ = يدويًا)</span><input v-model.number="s.renewal.autoInvoiceDays" type="number" min="1" max="120" class="input" /></label>
          </div>
          <p class="pm-muted">التجديد داخل مهلة السماح يكمل من تاريخ الانتهاء السابق دون انقطاع. بعدها تبدأ العضوية من تاريخ السداد.</p>
          <label class="field"><span>نص رسالة التذكير</span><textarea v-model="s.renewal.message" class="input" rows="6" /></label>
          <p class="pm-muted" style="font-size: .8rem">المتغيرات: <span v-for="v in VARS" :key="v" class="mb-code" style="margin-inline-end: 6px" v-text="`{${v}}`" /></p>
          <div class="modal-actions"><button class="btn btn-primary" :disabled="busy" @click="saveRenewal">حفظ</button></div>
        </section>

        <section v-else-if="tab === 'card'" key="k" class="card pm-panel" style="max-width: 820px">
          <h2>بطاقة العضوية</h2>
          <div class="pm-grid2">
            <label class="field"><span>عنوان البطاقة</span><input v-model="s.card.title" class="input" /></label>
            <label class="field"><span>ملاحظة أسفل البطاقة</span><input v-model="s.card.note" class="input" /></label>
            <label class="field"><span>اسم المعتمد</span><input v-model="s.card.signatoryName" class="input" /></label>
            <label class="field"><span>صفته</span><input v-model="s.card.signatoryTitle" class="input" placeholder="رئيس مجلس الإدارة" /></label>
          </div>
          <div class="modal-actions"><button class="btn btn-primary" :disabled="busy" @click="save('card', s.card)">حفظ</button></div>
        </section>

        <section v-else key="perm" class="card pm-panel">
          <ModulePermissionsPane module="members" />
        </section>
      </Transition>
    </template>
  </div>
</template>

<style scoped>
.box { border: 1px solid var(--border); border-inline-start: 4px solid var(--c, var(--border)); border-radius: 14px; padding: 12px; margin-bottom: 12px; }
.box-head { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
.color { width: 40px; height: 36px; padding: 2px; border: 1px solid var(--border); border-radius: 8px; background: none; }
.flags { display: flex; gap: 16px; flex-wrap: wrap; margin: 8px 0 12px; }
.row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
</style>
