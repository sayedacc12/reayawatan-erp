<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import { fontStack, loadFont, themeVars } from '../../../site/fonts';
import { applyIdentity } from '../../../site/identity';
import { useToast } from '../../../stores/toast';
import '../../website/website.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = [
  { k: 'brand', l: 'الاسم والشعار' }, { k: 'colors', l: 'الألوان والخطوط' }, { k: 'vision', l: 'الرؤية والرسالة والأهداف' }, { k: 'contact', l: 'التواصل والترخيص' },
] as const;
const PALETTES = [
  { n: 'أخضر سنابل', c: { primary: '#0f766e', secondary: '#14b8a6', accent: '#e8b04b', dark: '#0b2a2e' } },
  { n: 'أزرق ملكي', c: { primary: '#1d4ed8', secondary: '#38bdf8', accent: '#f59e0b', dark: '#0f172a' } },
  { n: 'بنفسجي', c: { primary: '#6d28d9', secondary: '#a78bfa', accent: '#f472b6', dark: '#1e1b4b' } },
  { n: 'عنابي', c: { primary: '#9f1239', secondary: '#fb7185', accent: '#fbbf24', dark: '#2a0a12' } },
  { n: 'بني ذهبي', c: { primary: '#92400e', secondary: '#d97706', accent: '#fcd34d', dark: '#1c1208' } },
  { n: 'أخضر زيتوني', c: { primary: '#3f6212', secondary: '#84cc16', accent: '#facc15', dark: '#14200a' } },
];
const SOCIAL = [
  { k: 'x', l: 'إكس (تويتر)' }, { k: 'instagram', l: 'إنستغرام' }, { k: 'youtube', l: 'يوتيوب' }, { k: 'linkedin', l: 'لينكدإن' },
  { k: 'snapchat', l: 'سناب شات' }, { k: 'tiktok', l: 'تيك توك' }, { k: 'facebook', l: 'فيسبوك' },
];
const toast = useToast();
const tab = ref<(typeof TABS)[number]['k']>('brand');
const d = ref<any>(null);
const busy = ref(false);
const goalsText = ref('');

async function load() {
  try {
    d.value = await api('/identity');
    goalsText.value = (d.value.goals ?? []).join('\n');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
watch(() => [d.value?.fonts.body, d.value?.fonts.heading], () => { loadFont(d.value?.fonts.body); loadFont(d.value?.fonts.heading); });
watch(() => d.value?.fontsList, (l: string[] | undefined) => l?.forEach((f) => loadFont(f)));

const preview = computed(() => (d.value ? { ...themeVars(d.value.colors), '--pv-body': fontStack(d.value.fonts.body), '--pv-head': fontStack(d.value.fonts.heading) } : {}));

async function save() {
  const v = d.value;
  busy.value = true;
  try {
    d.value = await api('/identity', {
      method: 'PUT',
      json: {
        displayName: v.displayName ?? '', shortName: v.shortName ?? '', englishName: v.englishName ?? '', slogan: v.slogan ?? '', about: v.about ?? '',
        vision: v.vision ?? '', mission: v.mission ?? '', goals: goalsText.value.split('\n').map((x: string) => x.trim()).filter(Boolean),
        values: v.values.filter((x: any) => x.title?.trim()), colors: v.colors, fonts: v.fonts,
        contact: v.contact, licenseNo: v.licenseNo ?? '', licenseAuthority: v.licenseAuthority ?? '', foundedOn: v.foundedOn || undefined, applyToSystem: !!v.applyToSystem,
      },
    });
    goalsText.value = d.value.goals.join('\n');
    applyIdentity(d.value);
    toast.success('حُفظت هوية الجمعية');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function upload(kind: 'logo' | 'logoLight', ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0];
  (ev.target as HTMLInputElement).value = '';
  if (!f) return;
  const fd = new FormData();
  fd.append('file', f);
  busy.value = true;
  try {
    const r: any = await api(`/identity/${kind}`, { method: 'POST', body: fd });
    d.value.logoUrl = r.logoUrl;
    d.value.logoLightUrl = r.logoLightUrl;
    applyIdentity(r);
    toast.success('رُفع الشعار');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function removeLogo(kind: 'logo' | 'logoLight') {
  try {
    const r: any = await api(`/identity/${kind}`, { method: 'DELETE' });
    d.value.logoUrl = r.logoUrl;
    d.value.logoLightUrl = r.logoLightUrl;
    applyIdentity(r);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>هوية الجمعية</h1><p class="muted">الاسم والشعار والألوان والخطوط والرؤية والرسالة والأهداف. يستخدمها الموقع الإلكتروني وصفحات الجمعية العامة، ويمكن تطبيقها داخل النظام.</p></div>
      <button v-if="d" class="btn btn-primary" :disabled="busy" @click="save">حفظ الهوية</button>
    </div>
    <div v-if="d" class="id-layout">
      <div>
        <div class="ws-tabs"><button v-for="t in TABS" :key="t.k" :class="['ws-tab', { on: tab === t.k }]" @click="tab = t.k">{{ t.l }}</button></div>
        <Transition name="page" mode="out-in">
          <section v-if="tab === 'brand'" key="b" class="card ws-panel">
            <div class="ws-grid2">
              <label class="field"><span>اسم الجمعية الظاهر</span><input v-model="d.displayName" class="input" :placeholder="d.organizationName" /><small class="muted">فارغ = الاسم المسجل في المنصة: {{ d.organizationName }}</small></label>
              <label class="field"><span>الاسم المختصر</span><input v-model="d.shortName" class="input" placeholder="مثل: سنابل الخير" /></label>
              <label class="field"><span>الاسم بالإنجليزية</span><input v-model="d.englishName" class="input" dir="ltr" /></label>
              <label class="field"><span>العبارة التعريفية</span><input v-model="d.slogan" class="input" placeholder="مثل: نزرع الخير.. ليحصده المحتاج" /></label>
            </div>
            <label class="field"><span>نبذة عن الجمعية</span><textarea v-model="d.about" class="input" rows="4" /></label>
            <div class="ws-grid2">
              <div class="logo-box">
                <div class="logo-prev light"><img v-if="d.logoUrl" :src="d.logoUrl" alt="" /><span v-else class="muted">لا يوجد شعار</span></div>
                <div><strong>الشعار الأساسي</strong><p class="muted small">للخلفيات الفاتحة. PNG بخلفية شفافة أفضل، بحد 2 ميجابايت.</p>
                  <label class="btn btn-sm">رفع<input type="file" accept="image/png,image/jpeg,image/webp" hidden @change="upload('logo', $event)" /></label>
                  <button v-if="d.logoUrl" class="btn btn-sm btn-danger" @click="removeLogo('logo')">إزالة</button></div>
              </div>
              <div class="logo-box">
                <div class="logo-prev dark"><img v-if="d.logoLightUrl || d.logoUrl" :src="d.logoLightUrl || d.logoUrl" alt="" /><span v-else class="muted">لا يوجد شعار</span></div>
                <div><strong>الشعار للخلفيات الداكنة</strong><p class="muted small">اختياري، يظهر في الشريط العلوي الداكن وتذييل الموقع.</p>
                  <label class="btn btn-sm">رفع<input type="file" accept="image/png,image/jpeg,image/webp" hidden @change="upload('logoLight', $event)" /></label>
                  <button v-if="d.logoLightUrl" class="btn btn-sm btn-danger" @click="removeLogo('logoLight')">إزالة</button></div>
              </div>
            </div>
          </section>

          <section v-else-if="tab === 'colors'" key="c" class="card ws-panel">
            <h2>الألوان</h2>
            <div class="palettes">
              <button v-for="p in PALETTES" :key="p.n" class="palette" :title="p.n" @click="d.colors = { ...p.c }">
                <i v-for="c in Object.values(p.c)" :key="c" :style="{ background: c }" /><span>{{ p.n }}</span>
              </button>
            </div>
            <div class="ws-grid4">
              <label class="field color-field"><span>اللون الأساسي</span><div><input v-model="d.colors.primary" type="color" /><input v-model="d.colors.primary" class="input" dir="ltr" /></div><small class="muted">الأزرار والعناوين</small></label>
              <label class="field color-field"><span>اللون الثانوي</span><div><input v-model="d.colors.secondary" type="color" /><input v-model="d.colors.secondary" class="input" dir="ltr" /></div><small class="muted">التدرجات</small></label>
              <label class="field color-field"><span>لون الإبراز</span><div><input v-model="d.colors.accent" type="color" /><input v-model="d.colors.accent" class="input" dir="ltr" /></div><small class="muted">الأرقام والتنبيهات</small></label>
              <label class="field color-field"><span>اللون الداكن</span><div><input v-model="d.colors.dark" type="color" /><input v-model="d.colors.dark" class="input" dir="ltr" /></div><small class="muted">الشريط العلوي والتذييل</small></label>
            </div>
            <h2 style="margin-top: 10px">الخطوط</h2>
            <div class="ws-grid2">
              <label class="field"><span>خط النصوص</span><select v-model="d.fonts.body" class="input"><option v-for="f in d.fontsList" :key="f" :value="f" :style="{ fontFamily: fontStack(f) }">{{ f }}</option></select></label>
              <label class="field"><span>خط العناوين</span><select v-model="d.fonts.heading" class="input"><option v-for="f in d.fontsList" :key="f" :value="f" :style="{ fontFamily: fontStack(f) }">{{ f }}</option></select></label>
            </div>
            <div class="font-samples">
              <div v-for="f in d.fontsList" :key="f" :class="['font-sample', { on: d.fonts.heading === f || d.fonts.body === f }]" :style="{ fontFamily: fontStack(f) }" @click="d.fonts.heading = f">
                <strong>نزرع الخير</strong><span>{{ f }}</span>
              </div>
            </div>
            <label class="check" style="margin-top: 14px"><input v-model="d.applyToSystem" type="checkbox" /> تطبيق ألوان الهوية وشعارها داخل النظام لموظفي الجمعية</label>
          </section>

          <section v-else-if="tab === 'vision'" key="v" class="card ws-panel">
            <label class="field"><span>الرؤية</span><textarea v-model="d.vision" class="input" rows="2" /></label>
            <label class="field"><span>الرسالة</span><textarea v-model="d.mission" class="input" rows="3" /></label>
            <label class="field"><span>الأهداف (هدف في كل سطر)</span><textarea v-model="goalsText" class="input" rows="6" /></label>
            <h2>القيم</h2>
            <div v-for="(v, i) in d.values" :key="i" class="ws-row">
              <input v-model="v.title" class="input" placeholder="القيمة، مثل: الأمانة" style="flex: 1" />
              <input v-model="v.text" class="input" placeholder="وصف قصير" style="flex: 3" />
              <button class="btn btn-sm btn-danger" @click="d.values.splice(i, 1)">حذف</button>
            </div>
            <button class="btn btn-sm" :disabled="d.values.length >= 12" @click="d.values.push({ title: '', text: '' })">+ قيمة</button>
          </section>

          <section v-else key="t" class="card ws-panel">
            <div class="ws-grid2">
              <label class="field"><span>الهاتف</span><input v-model="d.contact.phone" class="input" dir="ltr" /></label>
              <label class="field"><span>البريد الإلكتروني</span><input v-model="d.contact.email" class="input" dir="ltr" /></label>
              <label class="field"><span>المدينة</span><input v-model="d.contact.city" class="input" /></label>
              <label class="field"><span>العنوان</span><input v-model="d.contact.address" class="input" /></label>
              <label class="field"><span>صندوق البريد</span><input v-model="d.contact.poBox" class="input" /></label>
              <label class="field"><span>أوقات العمل</span><input v-model="d.contact.workingHours" class="input" /></label>
              <label class="field"><span>رابط الموقع على الخريطة</span><input v-model="d.contact.mapUrl" class="input" dir="ltr" placeholder="https://maps.google.com/..." /></label>
              <label class="field"><span>واتساب (رقم دولي)</span><input v-model="d.contact.social.whatsapp" class="input" dir="ltr" placeholder="9665XXXXXXXX" /></label>
            </div>
            <h2>حسابات التواصل الاجتماعي</h2>
            <div class="ws-grid2">
              <label v-for="s in SOCIAL" :key="s.k" class="field"><span>{{ s.l }}</span><input v-model="d.contact.social[s.k]" class="input" dir="ltr" placeholder="https://" /></label>
            </div>
            <h2>الترخيص</h2>
            <div class="ws-grid2">
              <label class="field"><span>رقم الترخيص</span><input v-model="d.licenseNo" class="input" /></label>
              <label class="field"><span>جهة الترخيص</span><input v-model="d.licenseAuthority" class="input" placeholder="المركز الوطني لتنمية القطاع غير الربحي" /></label>
              <label class="field"><span>تاريخ التأسيس</span><input v-model="d.foundedOn" type="date" class="input" /></label>
            </div>
          </section>
        </Transition>
      </div>

      <aside class="id-preview card" :style="preview">
        <p class="muted small" style="margin: 0 0 8px">معاينة مباشرة</p>
        <div class="pv-site">
          <div class="pv-top">
            <img v-if="d.logoLightUrl || d.logoUrl" :src="d.logoLightUrl || d.logoUrl" alt="" />
            <span>{{ d.shortName || d.displayName || d.organizationName }}</span>
            <i /><i /><i />
          </div>
          <div class="pv-hero">
            <small>{{ d.slogan || 'العبارة التعريفية' }}</small>
            <h3>{{ d.displayName || d.organizationName }}</h3>
            <p>{{ (d.vision || 'الرؤية تظهر هنا').slice(0, 90) }}</p>
            <div><b>تبرّع الآن</b><em>برامجنا</em></div>
          </div>
          <div class="pv-cards">
            <div v-for="n in 3" :key="n"><span /><strong>برنامج {{ n }}</strong><div class="pv-bar"><i :style="{ width: `${30 + n * 20}%` }" /></div></div>
          </div>
        </div>
        <div class="pv-swatches"><i v-for="c in Object.values(d.colors)" :key="String(c)" :style="{ background: String(c) }" /></div>
        <p v-if="d.updatedByName" class="muted small" style="margin: 10px 0 0">آخر تعديل: {{ d.updatedByName }}</p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.id-layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 18px; align-items: start; }
.small { font-size: .8rem; }
.logo-box { display: flex; gap: 12px; align-items: center; border: 1px dashed var(--border); border-radius: 12px; padding: 12px; }
.logo-prev { width: 96px; height: 96px; border-radius: 14px; display: grid; place-items: center; flex-shrink: 0; overflow: hidden; }
.logo-prev img { max-width: 84px; max-height: 84px; }
.logo-prev.light { background: var(--surface-2); border: 1px solid var(--border); }
.logo-prev.dark { background: #0b2a2e; color: #94a3b8; }
.palettes { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 14px; }
.palette { display: flex; align-items: center; gap: 3px; border: 1px solid var(--border); background: var(--surface); border-radius: 999px; padding: 5px 10px; cursor: pointer; font: inherit; font-size: .82rem; }
.palette i { width: 14px; height: 14px; border-radius: 50%; }
.palette span { margin-inline-start: 6px; }
.palette:hover { border-color: var(--primary); }
.color-field div { display: flex; gap: 6px; }
.color-field input[type='color'] { width: 44px; height: 40px; border: 1px solid var(--border); border-radius: 8px; padding: 2px; background: #fff; }
.font-samples { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
.font-sample { border: 1px solid var(--border); border-radius: 10px; padding: 10px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; transition: border-color .2s, transform .2s; }
.font-sample:hover { transform: translateY(-2px); }
.font-sample.on { border-color: var(--primary); background: var(--primary-soft); }
.font-sample strong { font-size: 1.2rem; }
.font-sample span { font-size: .72rem; color: var(--muted); font-family: 'IBM Plex Sans Arabic', sans-serif; }
.id-preview { position: sticky; top: 80px; padding: 14px; }
.pv-site { border-radius: 12px; overflow: hidden; border: 1px solid var(--border); font-family: var(--pv-body); }
.pv-top { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--grad-dark); color: #fff; font-size: .8rem; font-family: var(--pv-head); }
.pv-top img { width: 24px; height: 24px; object-fit: contain; }
.pv-top span { flex: 1; font-weight: 700; }
.pv-top i { width: 18px; height: 4px; border-radius: 3px; background: rgba(255,255,255,.35); }
.pv-hero { padding: 16px 12px; background: var(--grad-dark); color: #fff; position: relative; }
.pv-hero::after { content: ''; position: absolute; inset-inline-end: -20px; top: -20px; width: 90px; height: 90px; border-radius: 50%; background: var(--accent); opacity: .25; filter: blur(10px); }
.pv-hero small { color: var(--accent); font-weight: 700; }
.pv-hero h3 { font-family: var(--pv-head); font-size: 1.15rem; margin: 4px 0; }
.pv-hero p { font-size: .78rem; opacity: .85; margin: 0 0 10px; }
.pv-hero div { display: flex; gap: 6px; }
.pv-hero b { background: var(--grad); padding: 5px 12px; border-radius: 999px; font-size: .75rem; }
.pv-hero em { font-style: normal; border: 1px solid rgba(255,255,255,.4); padding: 4px 12px; border-radius: 999px; font-size: .75rem; }
.pv-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 10px; background: #f8fafb; }
.pv-cards > div { background: #fff; border-radius: 8px; padding: 6px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.pv-cards span { display: block; height: 30px; border-radius: 6px; background: var(--grad); margin-bottom: 4px; }
.pv-cards strong { font-size: .68rem; font-family: var(--pv-head); color: var(--primary); }
.pv-bar { height: 4px; border-radius: 3px; background: #e2e8f0; margin-top: 4px; }
.pv-bar i { display: block; height: 100%; border-radius: 3px; background: var(--accent); }
.pv-swatches { display: flex; gap: 6px; margin-top: 10px; }
.pv-swatches i { flex: 1; height: 22px; border-radius: 6px; }
@media (max-width: 1000px) { .id-layout { grid-template-columns: 1fr; } .id-preview { position: static; } }
</style>
