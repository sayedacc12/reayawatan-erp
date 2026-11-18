<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import SiteIcon from '../SiteIcon.vue';
import { num, useSite } from '../site';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** صندوق التبرع: لبرنامج محدد أو للتبرع العام */
const props = defineProps<{ program?: any; title?: string }>();
const site = useSite();
const router = useRouter();
const store = computed(() => site.data.value.store);
const rules = computed(() => props.program?.donate ?? { min: store.value.min, max: store.value.max, presets: store.value.presets, monthly: store.value.monthly, gift: store.value.gift, open: true });
const presets = computed(() => (rules.value.presets?.length ? rules.value.presets : store.value.presets) as number[]);
const f = reactive({ amount: presets.value[1] ?? presets.value[0] ?? 100, custom: '', name: '', phone: '', email: '', monthly: false, giftOn: false, giftTo: '', giftPhone: '', giftMsg: '' });
const busy = ref(false);
const err = ref('');
const amount = computed(() => (f.custom ? Math.round(Number(f.custom)) : f.amount));

async function give() {
  err.value = '';
  if (!amount.value || amount.value < rules.value.min) return void (err.value = `أقل مبلغ للتبرع ${num(rules.value.min)} ريال`);
  if (amount.value > rules.value.max) return void (err.value = `أعلى مبلغ للتبرع الواحد ${num(rules.value.max)} ريال`);
  if (!/^(05\d{8}|9665\d{8})$/.test(f.phone.replace(/\s/g, ''))) return void (err.value = 'اكتب رقم جوال سعودي صحيحًا يبدأ بـ 05');
  busy.value = true;
  try {
    const body: any = { programId: props.program?.id ?? null, amount: amount.value, phone: f.phone.replace(/\s/g, ''), monthly: f.monthly };
    if (f.name.trim()) body.name = f.name.trim();
    if (f.email.trim()) body.email = f.email.trim();
    if (f.giftOn) body.gift = { to: f.giftTo, phone: f.giftPhone || undefined, message: f.giftMsg || undefined };
    const r = await site.post('/donate', body);
    // صفحة الدفع التجريبية داخل الموقع نفسه، وبوابة الدفع الحقيقية رابط خارجي
    const u = new URL(r.url, window.location.origin);
    if (u.pathname.startsWith(`/w/${site.slug}/pay/`)) {
      router.push({ path: u.pathname, query: { ...Object.fromEntries(u.searchParams), ...site.to().query } });
    } else window.location.href = r.url;
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div id="donate" class="sx-card db">
    <div class="db-head"><SiteIcon name="heart" :size="22" /><div><strong>{{ title || (program ? `تبرع لـ${program.name}` : store.generalTitle) }}</strong><small v-if="program?.donate?.kind === 'waqf'">صدقة جارية يبقى أصلها ويُصرف ريعها</small></div></div>
    <div v-if="!rules.open" class="sx-closed" style="margin: 16px">{{ rules.block }}</div>
    <form v-else class="db-body" @submit.prevent="give">
      <div class="db-amounts">
        <button v-for="a in presets" :key="a" type="button" :class="['db-amt', { on: !f.custom && f.amount === a }]" @click="f.amount = a; f.custom = ''">{{ num(a) }} <small>ر.س</small></button>
      </div>
      <label class="sx-field"><span>أو اكتب مبلغًا آخر</span><input v-model="f.custom" type="number" inputmode="numeric" :min="rules.min" :max="rules.max" class="sx-input" placeholder="المبلغ بالريال" /></label>
      <label v-if="rules.monthly" class="db-check"><input v-model="f.monthly" type="checkbox" /><span><strong>اجعله تبرعًا شهريًا</strong><small>يصلك رابط الدفع كل شهر على جوالك</small></span></label>
      <div class="db-row">
        <label class="sx-field"><span>الاسم (اختياري)</span><input v-model="f.name" class="sx-input" placeholder="فاعل خير" /></label>
        <label class="sx-field"><span>رقم الجوال *</span><input v-model="f.phone" class="sx-input" inputmode="tel" dir="ltr" placeholder="05XXXXXXXX" /></label>
      </div>
      <label class="sx-field"><span>البريد الإلكتروني (اختياري)</span><input v-model="f.email" type="email" class="sx-input" dir="ltr" /></label>
      <label v-if="rules.gift" class="db-check"><input v-model="f.giftOn" type="checkbox" /><span><strong><SiteIcon name="gift" :size="16" /> إهداء التبرع</strong><small>نرسل بطاقة إهداء أنيقة باسم من تحب</small></span></label>
      <div v-if="f.giftOn" class="db-gift">
        <div class="db-row">
          <label class="sx-field"><span>اسم المُهدى إليه *</span><input v-model="f.giftTo" class="sx-input" /></label>
          <label class="sx-field"><span>جواله</span><input v-model="f.giftPhone" class="sx-input" dir="ltr" placeholder="05XXXXXXXX" /></label>
        </div>
        <label class="sx-field"><span>رسالة الإهداء</span><input v-model="f.giftMsg" class="sx-input" maxlength="200" /></label>
      </div>
      <div v-if="err" class="sx-err">{{ err }}</div>
      <button class="sx-btn main block db-go" :disabled="busy">{{ busy ? 'جارٍ التحويل للدفع...' : `تبرع بـ ${num(amount)} ريال${f.monthly ? ' شهريًا' : ''}` }}</button>
      <p class="db-safe"><SiteIcon name="shield" :size="15" /> دفع آمن ببطاقة مدى أو البطاقات الائتمانية<template v-if="store.provider === 'sandbox'"> (بيئة تجريبية)</template>، وإيصال فوري برمز تحقق.</p>
    </form>
  </div>
</template>

<style scoped>
.db { overflow: hidden; }
.db-head { display: flex; gap: 12px; align-items: center; padding: 18px 20px; color: #fff; background: var(--grad); }
.db-head div { display: grid; }
.db-head small { opacity: .85; font-size: .82rem; }
.db-body { padding: 20px; }
.db-amounts { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 8px; margin-bottom: 14px; }
.db-amt { padding: 12px 6px; border-radius: 14px; border: 1.5px solid var(--line); background: var(--paper); font: inherit; font-weight: 700; font-size: 1.05rem; cursor: pointer; color: var(--ink); transition: all .2s var(--ease2); }
.db-amt small { font-weight: 400; font-size: .72rem; color: var(--text-2); }
.db-amt:hover { border-color: var(--primary); }
.db-amt.on { background: var(--primary); border-color: var(--primary); color: #fff; transform: scale(1.04); box-shadow: 0 8px 20px color-mix(in srgb, var(--primary) 35%, transparent); }
.db-amt.on small { color: rgba(255,255,255,.8); }
.db-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.db-check { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 14px; background: color-mix(in srgb, var(--primary) 6%, #fff); margin-bottom: 14px; cursor: pointer; }
.db-check input { margin-top: 6px; accent-color: var(--primary); width: 18px; height: 18px; }
.db-check span { display: grid; }
.db-check strong { display: inline-flex; gap: 6px; align-items: center; }
.db-check small { color: var(--text-2); }
.db-gift { border: 1.5px dashed color-mix(in srgb, var(--accent) 60%, #fff); border-radius: 14px; padding: 14px 14px 0; margin-bottom: 14px; }
.db-go { font-size: 1.08rem; padding: 15px; }
.db-safe { display: flex; gap: 6px; align-items: flex-start; font-size: .8rem; color: var(--text-2); margin: 12px 0 0; }
.db-safe svg { margin-top: 4px; flex-shrink: 0; color: var(--primary); }
@media (max-width: 480px) { .db-row { grid-template-columns: 1fr; gap: 0; } }
</style>
