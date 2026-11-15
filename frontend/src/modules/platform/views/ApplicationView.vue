<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, openProtectedFile } from '../../../api';
import RegistrationForm, { type MainData } from '../../../registration/RegistrationForm.vue';
import { useToast } from '../../../stores/toast';
import ScreensPicker, { type Access } from '../components/ScreensPicker.vue';
import { addDaysIso, APPLICATION_STATUS, copyText, CYCLES, fmtDate, fmtDateTime, HISTORY_STEP, money, todayIso, type ScreenModule } from '../labels';
import '../platform.css';

interface App {
  id: string; number: string; status: 'submitted' | 'returned' | 'approved' | 'rejected'; reviewNote: string | null;
  createdAt: string; decidedAt: string | null; data: MainData; licenseFileMime: string; hasAdminPassword: boolean;
  terms: { price: number; billingCycle: string; months: number; trialDays: number; startsOn: string; screens: string[] | null } | null;
  history: { step: string; by: string; at: string; note?: string }[];
  organization: { id: string; name: string; slug: string } | null;
}
const route = useRoute();
const router = useRouter();
const toast = useToast();
const id = route.params.id as string;
const a = ref<App | null>(null);
const catalog = ref<ScreenModule[]>([]);
const vatRate = ref(15);
const error = ref('');

async function load() {
  try {
    const [app, screens, provider] = await Promise.all([
      api<App>(`/platform/applications/${id}`),
      api<ScreenModule[]>('/platform/screens'),
      api<{ vatRate: number }>('/platform/provider'),
    ]);
    a.value = app;
    catalog.value = screens;
    vatRate.value = provider.vatRate;
    approve.slug = app.data.proposedSlug;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

const viewLicense = () => openProtectedFile(`/platform/applications/${id}/license`).catch((e) => toast.error((e as Error).message));

// ---- القرار ----
const decision = ref<'approve' | 'return' | 'reject'>('approve');
const note = ref('');
const busy = ref(false);
const decisionError = ref('');
const access = ref<Access>({ allScreens: true, screens: [], modules: [] });
const approve = reactive({ slug: '', price: 0, billingCycle: 'annual', months: 12, trialDays: 14, startsOn: '' });
const startsOnDefault = computed(() => (approve.trialDays > 0 ? addDaysIso(todayIso(), approve.trialDays) : todayIso()));
const summary = computed(() => {
  const cycle = CYCLES.find((c) => c.value === approve.billingCycle)!;
  const vat = Math.round(approve.price * vatRate.value) / 100;
  const cycles = Math.ceil(approve.months / cycle.months);
  return { vat, gross: approve.price + vat, cycles, total: (approve.price + vat) * cycles, annual: (approve.price * 12) / cycle.months };
});

interface ApproveResult { organizationId: string; slug: string; contractId: string; links: { staff: string; portal: string }; generatedPassword: string | null }
const result = ref<ApproveResult | null>(null);

async function decide() {
  decisionError.value = '';
  busy.value = true;
  try {
    if (decision.value === 'approve') {
      if (!access.value.allScreens && !access.value.screens.length) throw new Error('اختر شاشة واحدة على الأقل');
      result.value = await api<ApproveResult>(`/platform/applications/${id}/approve`, {
        method: 'POST', json: { ...approve, ...access.value, startsOn: approve.startsOn || startsOnDefault.value },
      });
      toast.success('تم اعتماد الجمعية وتوليد روابطها');
    } else {
      await api(`/platform/applications/${id}/${decision.value}`, { method: 'POST', json: { note: note.value } });
      toast.success(decision.value === 'return' ? 'أعيد الطلب للجمعية لاستكماله' : 'تم رفض الطلب');
    }
    await load();
  } catch (e) {
    decisionError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

// ---- تعديل البيانات الرئيسية ----
const editing = ref(false);
const editError = ref('');
async function saveEdit(fd: FormData) {
  busy.value = true;
  editError.value = '';
  try {
    a.value = await api<App>(`/platform/applications/${id}`, { method: 'PATCH', body: fd });
    editing.value = false;
    toast.success('تم حفظ البيانات الرئيسية');
  } catch (e) {
    editError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const origin = location.origin;
const copy = (s: string) => { copyText(s); toast.success('تم النسخ'); };
</script>

<template>
  <div>
    <RouterLink to="/platform/applications" class="back">→ طلبات الاشتراك</RouterLink>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="a">
      <section class="p-hero">
        <div>
          <p class="p-kicker">طلب اشتراك <span dir="ltr">{{ a.number }}</span> · {{ fmtDate(a.createdAt) }}</p>
          <h1>{{ a.data.orgName }}</h1>
          <p class="p-sub">{{ a.data.city }} · ترخيص رقم {{ a.data.licenseNumber }}</p>
        </div>
        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
          <span :class="['tone', `tone-${APPLICATION_STATUS[a.status].tone}`]">{{ APPLICATION_STATUS[a.status].label }}</span>
          <RouterLink v-if="a.organization" :to="`/platform/organizations/${a.organization.id}`" class="btn btn-gold">ملف الجمعية</RouterLink>
          <button v-if="a.status !== 'rejected'" class="btn btn-ghost-light" @click="editing = true">تعديل البيانات</button>
        </div>
      </section>

      <div v-if="a.status === 'returned'" class="alert" style="background: #fff4e0; color: #7a4800">أعيد للجمعية لاستكماله: {{ a.reviewNote }}</div>
      <div v-if="a.status === 'rejected'" class="alert alert-error">مرفوض: {{ a.reviewNote }}</div>

      <div class="p-grid">
        <section class="card p-panel">
          <h2>بيانات الجمعية والترخيص</h2>
          <dl class="p-dl">
            <dt>البريد</dt><dd dir="ltr" style="text-align: right">{{ a.data.orgEmail }}</dd>
            <dt>الهاتف</dt><dd dir="ltr" style="text-align: right">{{ a.data.orgPhone }}</dd>
            <dt>المعرف المقترح</dt><dd dir="ltr" style="text-align: right"><code>{{ a.data.proposedSlug }}</code></dd>
            <dt>رقم الترخيص</dt><dd>{{ a.data.licenseNumber }}</dd>
            <dt>بداية الترخيص</dt><dd>{{ fmtDate(a.data.licenseStartDate) }}</dd>
            <dt>نهاية الترخيص</dt><dd>{{ fmtDate(a.data.licenseEndDate) }}</dd>
          </dl>
          <button class="btn btn-sm license-btn" @click="viewLicense">📄 عرض مستند الترخيص <small class="muted">{{ a.data.licenseFileName }}</small></button>
        </section>
        <section class="card p-panel">
          <h2>المدير التنفيذي</h2>
          <dl class="p-dl">
            <dt>الاسم</dt><dd>{{ a.data.directorName }}</dd>
            <dt>الجوال</dt><dd dir="ltr" style="text-align: right"><a :href="`tel:${a.data.directorPhone}`">{{ a.data.directorPhone }}</a></dd>
            <dt>البريد</dt><dd dir="ltr" style="text-align: right"><a :href="`mailto:${a.data.directorEmail}`">{{ a.data.directorEmail }}</a></dd>
          </dl>
          <h2 style="margin-top: 16px">عضو مجلس الإدارة</h2>
          <dl class="p-dl">
            <dt>الاسم</dt><dd>{{ a.data.boardName }} <small class="muted">({{ a.data.boardPosition }})</small></dd>
            <dt>الجوال</dt><dd dir="ltr" style="text-align: right"><a :href="`tel:${a.data.boardPhone}`">{{ a.data.boardPhone }}</a></dd>
            <dt>البريد</dt><dd dir="ltr" style="text-align: right"><a :href="`mailto:${a.data.boardEmail}`">{{ a.data.boardEmail }}</a></dd>
          </dl>
        </section>
        <section class="card p-panel">
          <h2>حساب مدير النظام وسجل الطلب</h2>
          <dl class="p-dl" style="margin-bottom: 14px">
            <dt>الاسم</dt><dd>{{ a.data.adminFullName || '—' }}</dd>
            <dt>البريد</dt><dd dir="ltr" style="text-align: right">{{ a.data.adminEmail || '—' }}</dd>
          </dl>
          <ul class="p-timeline">
            <li v-for="(h, i) in a.history" :key="i"><b>{{ HISTORY_STEP[h.step] ?? h.step }}</b> · {{ h.by }}<small>{{ fmtDateTime(h.at) }}</small><small v-if="h.note">{{ h.note }}</small></li>
          </ul>
        </section>
      </div>

      <section v-if="a.status === 'submitted'" class="card p-panel decision">
        <h2>معاملة اعتماد الطلب</h2>
        <div class="seg">
          <button :class="{ on: decision === 'approve' }" @click="decision = 'approve'">✓ اعتماد</button>
          <button :class="{ on: decision === 'return' }" @click="decision = 'return'">↩ إعادة للاستكمال</button>
          <button :class="{ on: decision === 'reject' }" @click="decision = 'reject'">✕ رفض</button>
        </div>
        <form @submit.prevent="decide">
          <template v-if="decision === 'approve'">
            <div class="steps">
              <div class="step">
                <h3><span class="n">1</span> الشاشات المسموحة للجمعية</h3>
                <ScreensPicker v-model="access" :catalog="catalog" />
              </div>
              <div class="step">
                <h3><span class="n">2</span> القيمة المالية والمدة</h3>
                <div class="p-row-2">
                  <div class="field"><label>قيمة الاشتراك لكل دورة (ريال، قبل الضريبة)</label><input v-model.number="approve.price" class="input" type="number" min="0" step="0.01" required /></div>
                  <div class="field"><label>دورة السداد</label><select v-model="approve.billingCycle" class="input"><option v-for="c in CYCLES" :key="c.value" :value="c.value">{{ c.label }}</option></select></div>
                  <div class="field"><label>مدة العقد (بالأشهر)</label><input v-model.number="approve.months" class="input" type="number" min="1" max="60" required /></div>
                  <div class="field"><label>بداية الاشتراك</label><input v-model="approve.startsOn" class="input" type="date" :placeholder="startsOnDefault" /><small class="muted">إن تُرك فارغًا: {{ fmtDate(startsOnDefault) }}</small></div>
                </div>
                <div class="sum">
                  <div><span>الضريبة {{ vatRate }}%</span><b>{{ money(summary.vat) }}</b></div>
                  <div><span>لكل دورة شامل الضريبة</span><b>{{ money(summary.gross) }}</b></div>
                  <div><span>إجمالي العقد ({{ summary.cycles }} دفعة)</span><b>{{ money(summary.total) }}</b></div>
                </div>
              </div>
              <div class="step">
                <h3><span class="n">3</span> الفترة التجريبية قبل التعاقد</h3>
                <div class="trial">
                  <button v-for="d in [0, 7, 14, 30]" :key="d" type="button" :class="['p-chip', { on: approve.trialDays === d }]" @click="approve.trialDays = d">{{ d ? `${d} يومًا` : 'بدون تجربة' }}</button>
                  <input v-model.number="approve.trialDays" class="input days" type="number" min="0" max="180" />
                </div>
                <p class="muted small">{{ approve.trialDays ? `تدخل الجمعية فورًا حتى ${fmtDate(addDaysIso(todayIso(), approve.trialDays - 1))}، ثم يتوقف الدخول ما لم يُوقَّع العقد.` : 'لن تتمكن الجمعية من الدخول حتى توقّع العقد الإلكتروني.' }}</p>
              </div>
              <div class="step">
                <h3><span class="n">4</span> اعتماد الجمعية وتوليد الروابط</h3>
                <div class="field"><label>المعرف في الروابط</label><input v-model="approve.slug" class="input" dir="ltr" pattern="[a-z0-9\-]+" required /></div>
                <div class="p-link-box"><span>دخول الموظفين</span><code>{{ origin }}/o/{{ approve.slug }}</code></div>
                <div class="p-link-box"><span>بوابة المستفيدين</span><code>{{ origin }}/portal/{{ approve.slug }}</code></div>
                <p class="muted small">ستُنشأ مسودة عقد إلكتروني من بنود العقد بهذه الشروط، فتراجعها وترسلها للجمعية للتوقيع.</p>
              </div>
            </div>
          </template>
          <div v-else class="field">
            <label>{{ decision === 'return' ? 'ما المطلوب من الجمعية استكماله؟ (يظهر لها في رابط المتابعة)' : 'سبب الرفض' }}</label>
            <textarea v-model="note" class="input" rows="4" required minlength="3" />
          </div>
          <div v-if="decisionError" class="alert alert-error">{{ decisionError }}</div>
          <button :class="['btn', decision === 'reject' ? 'btn-danger' : 'btn-primary']" :disabled="busy">
            {{ decision === 'approve' ? 'اعتماد الجمعية وتوليد الروابط' : decision === 'return' ? 'إعادة الطلب للجمعية' : 'رفض الطلب' }}
          </button>
        </form>
      </section>

      <section v-if="a.status === 'approved' && a.terms" class="card p-panel">
        <h2>شروط الاعتماد</h2>
        <dl class="p-dl">
          <dt>القيمة</dt><dd>{{ money(a.terms.price) }} · {{ CYCLES.find((c) => c.value === a!.terms!.billingCycle)?.label }}</dd>
          <dt>المدة</dt><dd>{{ a.terms.months }} شهرًا من {{ fmtDate(a.terms.startsOn) }}</dd>
          <dt>الفترة التجريبية</dt><dd>{{ a.terms.trialDays ? `${a.terms.trialDays} يومًا` : 'بدون' }}</dd>
          <dt>الشاشات</dt><dd>{{ a.terms.screens ? `${a.terms.screens.length} شاشة محددة` : 'كل الشاشات' }}</dd>
        </dl>
      </section>
    </template>

    <div v-if="result" class="modal-backdrop" @click.self="result = null">
      <div class="card modal modal-wide done">
        <div class="burst" aria-hidden="true"><i v-for="n in 12" :key="n" :style="{ '--n': n }" /></div>
        <h2>✓ تم اعتماد الجمعية</h2>
        <p class="muted">أرسل هذه الروابط للجمعية، وتظهر لها كذلك في رابط متابعة طلبها.</p>
        <div class="p-link-box"><span>دخول الموظفين</span><code>{{ origin }}{{ result.links.staff }}</code><button class="btn btn-sm" @click="copy(origin + result.links.staff)">نسخ</button></div>
        <div class="p-link-box"><span>بوابة المستفيدين</span><code>{{ origin }}{{ result.links.portal }}</code><button class="btn btn-sm" @click="copy(origin + result.links.portal)">نسخ</button></div>
        <div v-if="result.generatedPassword" class="alert" style="background: #fff4e0; color: #7a4800">
          كلمة مرور مدير النظام المولدة (لن تظهر مرة أخرى): <code dir="ltr">{{ result.generatedPassword }}</code>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" @click="router.push(`/platform/contracts/${result.contractId}`)">مراجعة مسودة العقد وإرسالها ←</button>
          <button class="btn" @click="result = null">إغلاق</button>
        </div>
      </div>
    </div>

    <div v-if="editing && a" class="modal-backdrop" @click.self="editing = false">
      <div class="card modal modal-wide">
        <h2 style="margin-bottom: 12px">تعديل البيانات الرئيسية</h2>
        <RegistrationForm mode="edit" :initial="a.data" :approved="a.status === 'approved'" :busy="busy" submit-label="حفظ" @submit="saveEdit" @cancel="editing = false">
          <template #error><div v-if="editError" class="alert alert-error">{{ editError }}</div></template>
        </RegistrationForm>
      </div>
    </div>
  </div>
</template>

<style scoped>
.back { display: inline-block; margin-bottom: 10px; font-size: .9rem; }
.license-btn { margin-top: 14px; }
.decision { border: 1px solid #f0d9a6; background: linear-gradient(180deg, #fffaf0, #fff 120px); }
.seg { display: inline-grid; grid-template-columns: repeat(3, auto); background: var(--surface-2); border-radius: 10px; padding: 3px; margin-bottom: 16px; }
.seg button { border: 0; background: none; padding: 7px 18px; border-radius: 8px; font: inherit; cursor: pointer; color: var(--muted); }
.seg button.on { background: #fff; color: var(--primary); font-weight: 600; box-shadow: var(--shadow); }
.steps { display: grid; gap: 14px; margin-bottom: 14px; }
.step { border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px; background: var(--surface); }
.step h3 { font-size: .98rem; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
.n { width: 24px; height: 24px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--grad); color: #fff; font-size: .8rem; }
.sum { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.sum div { background: var(--primary-soft); border-radius: 10px; padding: 8px 12px; display: flex; flex-direction: column; }
.sum span { font-size: .8rem; color: var(--muted); }
.sum b { color: var(--primary); }
.trial { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.days { width: 90px; }
.small { font-size: .86rem; margin: 8px 0 0; }
.p-link-box span { min-width: 110px; font-weight: 500; }
.done { position: relative; overflow: hidden; }
.done h2 { color: var(--success); }
.burst { position: absolute; top: 30px; left: 50%; pointer-events: none; }
.burst i { position: absolute; width: 8px; height: 8px; border-radius: 2px; background: hsl(calc(var(--n) * 30), 80%, 55%);
  animation: burst 1.1s cubic-bezier(.2,.8,.2,1) both; transform: rotate(calc(var(--n) * 30deg)); }
@keyframes burst { from { opacity: 1; transform: rotate(calc(var(--n) * 30deg)) translateY(0); } to { opacity: 0; transform: rotate(calc(var(--n) * 30deg)) translateY(-120px); } }
@media (max-width: 640px) { .sum { grid-template-columns: 1fr; } .seg { grid-template-columns: 1fr; } }
</style>
