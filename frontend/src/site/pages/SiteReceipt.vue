<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import SiteIcon from '../SiteIcon.vue';
import { dateAr, num, useSite } from '../site';

/* eslint-disable @typescript-eslint/no-explicit-any */
const route = useRoute();
const site = useSite();
const token = route.params.token as string;
const giftView = route.query.gift === '1';
const r = ref<any>(null);
const err = ref('');
const fresh = route.query.new === '1';
const copied = ref(false);
onMounted(async () => {
  try {
    r.value = await site.get(`/receipt/${token}${giftView ? '?gift=1' : ''}`);
  } catch (e) {
    err.value = (e as Error).message;
  }
});
const id = computed(() => site.data.value.identity);
const base = `${window.location.origin}/w/${site.slug}`;
const giftUrl = `${base}/receipt/${token}?gift=1`;
const verifyUrl = computed(() => `${base}/verify?no=${r.value?.receiptNo ?? ''}&code=${r.value?.verifyCode ?? ''}`);
async function copyGift() {
  try {
    await navigator.clipboard.writeText(giftUrl);
    copied.value = true;
  } catch {
    /* المتصفح منع النسخ */
  }
}
const waGift = computed(() => `https://wa.me/${String(r.value?.gift?.phone ?? '').replace(/^0/, '966')}?text=${encodeURIComponent(`أهديتك تبرعًا لدى ${id.value.displayName}: ${giftUrl}`)}`);
</script>

<template>
  <div class="rc-page">
    <div v-if="fresh && r && !giftView" class="rc-confetti"><i v-for="n in 40" :key="n" :style="{ '--x': `${(n * 37) % 100}%`, '--d': `${(n % 7) * 0.15}s`, '--h': `${(n * 47) % 360}` }" /></div>
    <div class="sx-wrap rc-wrap">
      <div v-if="err" class="sx-card sx-empty"><h2>{{ err }}</h2></div>

      <!-- بطاقة الإهداء -->
      <div v-else-if="r && giftView" class="gc">
        <div class="gc-in">
          <img v-if="id.logoLightUrl || id.logoUrl" :src="id.logoLightUrl || id.logoUrl" alt="" class="gc-logo" />
          <span class="gc-k">بطاقة إهداء</span>
          <h1>إلى {{ r.to }}</h1>
          <p class="gc-msg">«{{ r.message || 'أهديتك تبرعًا، جعله الله في ميزان حسناتك' }}»</p>
          <div class="gc-for"><SiteIcon name="gift" :size="22" /> تبرّع باسمك لصالح <b>{{ r.programName }}</b></div>
          <small>من: {{ r.from }} · {{ dateAr(r.date) }}</small>
        </div>
        <i class="gc-orb a" /><i class="gc-orb b" />
      </div>

      <!-- الإيصال -->
      <div v-else-if="r" class="sx-card rc">
        <div v-if="r.status === 'paid'" class="rc-ok"><span><SiteIcon name="check" :size="40" /></span><h1>تم التبرع بنجاح</h1><p>{{ r.thanks }}</p></div>
        <div v-else class="sx-err" style="text-align: center">{{ r.statusLabel }}: لم يكتمل الدفع بعد.</div>
        <div class="rc-doc">
          <div class="rc-doc-h">
            <div><img v-if="id.logoUrl" :src="id.logoUrl" alt="" /><strong>{{ id.displayName }}</strong></div>
            <div class="rc-no"><small>إيصال تبرع</small><b dir="ltr">{{ r.receiptNo || '—' }}</b></div>
          </div>
          <dl>
            <dt>المبلغ</dt><dd class="rc-amt">{{ num(r.amount) }} ريال سعودي</dd>
            <dt>نوع التبرع</dt><dd>{{ r.kindLabel }}<template v-if="r.monthly"> (شهري)</template></dd>
            <dt>الوجهة</dt><dd>{{ r.programName }}</dd>
            <dt>المتبرع</dt><dd>{{ r.donorName || 'فاعل خير' }} · <span dir="ltr">{{ r.phone }}</span></dd>
            <dt>التاريخ</dt><dd>{{ dateAr(r.date) }}</dd>
            <template v-if="r.paymentRef"><dt>مرجع العملية</dt><dd dir="ltr" style="text-align: right">{{ r.paymentRef }}</dd></template>
            <template v-if="r.gift"><dt>إهداء إلى</dt><dd>{{ r.gift.to }}</dd></template>
          </dl>
          <div v-if="r.verifyCode" class="rc-verify"><div><small>رمز التحقق</small><b dir="ltr">{{ r.verifyCode }}</b></div><p>يمكن لأي شخص التحقق من صحة الإيصال برقمه ورمزه من صفحة <RouterLink :to="{ ...site.to('/verify'), query: { ...site.to().query, no: r.receiptNo, code: r.verifyCode } }">التحقق من الإيصال</RouterLink>.</p></div>
          <p v-if="r.receiptNote" class="rc-note">{{ r.receiptNote }}</p>
          <p v-if="r.provider === 'sandbox'" class="rc-note">صدر هذا الإيصال من البيئة التجريبية ولا يمثل تبرعًا حقيقيًا.</p>
        </div>
        <div v-if="r.status === 'paid'" class="rc-actions">
          <button class="sx-btn prim" onclick="window.print()"><SiteIcon name="download" :size="18" /> طباعة أو حفظ PDF</button>
          <template v-if="r.gift">
            <button class="sx-btn line" @click="copyGift">{{ copied ? 'نُسخ رابط البطاقة ✓' : 'نسخ رابط بطاقة الإهداء' }}</button>
            <a v-if="r.gift.phone" :href="waGift" target="_blank" rel="noopener" class="sx-btn line"><SiteIcon name="whatsapp" :size="18" /> أرسل البطاقة</a>
            <RouterLink :to="{ ...site.to(`/receipt/${token}`), query: { ...site.to().query, gift: '1' } }" class="sx-btn line"><SiteIcon name="gift" :size="18" /> عرض البطاقة</RouterLink>
          </template>
          <RouterLink :to="site.to('/donate')" class="sx-btn line">تبرع مرة أخرى</RouterLink>
        </div>
        <input type="hidden" :value="verifyUrl" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.rc-page { padding: 50px 0 80px; position: relative; overflow: hidden; background: radial-gradient(900px 420px at 50% 0%, color-mix(in srgb, var(--primary) 14%, transparent), transparent); }
.rc-wrap { max-width: 680px; position: relative; z-index: 1; }
.rc { padding: 30px; }
.rc-ok { text-align: center; margin-bottom: 22px; }
.rc-ok span { width: 86px; height: 86px; margin: 0 auto 12px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, #34d399, #059669); box-shadow: 0 0 0 10px #d1fae5, 0 16px 34px rgba(5,150,105,.35); animation: rc-pop .7s var(--ease2); }
@keyframes rc-pop { 0% { transform: scale(.3); opacity: 0; } 70% { transform: scale(1.1); } }
.rc-ok h1 { font-size: 1.8rem; }
.rc-ok p { color: var(--text-2); }
.rc-doc { border: 1.5px solid var(--line); border-radius: 18px; padding: 22px; background: linear-gradient(180deg, color-mix(in srgb, var(--primary) 4%, #fff), #fff); }
.rc-doc-h { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-bottom: 14px; border-bottom: 2px solid var(--primary); margin-bottom: 14px; }
.rc-doc-h > div:first-child { display: flex; gap: 10px; align-items: center; }
.rc-doc-h img { height: 46px; }
.rc-no { display: grid; text-align: left; }
.rc-no small { color: var(--text-2); }
.rc-no b { font-size: 1.2rem; color: var(--primary); }
.rc-doc dl { display: grid; grid-template-columns: 130px 1fr; gap: 10px 14px; margin: 0; }
.rc-doc dt { color: var(--text-2); }
.rc-doc dd { margin: 0; font-weight: 600; }
.rc-amt { font-size: 1.25rem; color: var(--primary); }
.rc-verify { display: flex; gap: 14px; align-items: center; margin-top: 16px; padding: 14px; border-radius: 14px; background: var(--soft); }
.rc-verify > div { display: grid; text-align: center; padding: 6px 14px; border-radius: 10px; background: var(--paper); border: 1.5px dashed var(--primary); }
.rc-verify b { font-family: ui-monospace, monospace; font-size: 1.25rem; letter-spacing: 3px; color: var(--primary); }
.rc-verify p { margin: 0; font-size: .88rem; color: var(--text-2); }
.rc-verify a { color: var(--primary); font-weight: 700; }
.rc-note { font-size: .82rem; color: var(--text-2); margin: 12px 0 0; }
.rc-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 20px; }
.rc-confetti { position: absolute; inset: 0; pointer-events: none; }
.rc-confetti i { position: absolute; top: -20px; left: var(--x); width: 9px; height: 14px; border-radius: 2px; background: hsl(var(--h) 80% 60%); animation: rc-fall 3.2s var(--d) ease-in forwards; }
@keyframes rc-fall { to { transform: translateY(105vh) rotate(720deg); opacity: 0; } }

.gc { position: relative; overflow: hidden; border-radius: 30px; padding: 56px 34px; text-align: center; color: #fff; background: var(--grad-dark); box-shadow: 0 30px 70px rgba(0,0,0,.25); }
.gc-in { position: relative; z-index: 1; display: grid; gap: 12px; justify-items: center; }
.gc-logo { height: 64px; }
.gc-k { padding: 4px 16px; border-radius: 999px; border: 1px solid rgba(255,255,255,.3); font-size: .9rem; }
.gc h1 { font-size: clamp(2rem, 5vw, 3rem); background: linear-gradient(90deg, #fff, var(--accent), #fff); background-size: 200%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: hm-sheen 5s linear infinite; }
@keyframes hm-sheen { to { background-position: -200% center; } }
.gc-msg { font-size: 1.3rem; max-width: 480px; line-height: 1.8; font-family: var(--sx-head); }
.gc-for { display: flex; gap: 8px; align-items: center; padding: 12px 20px; border-radius: 14px; background: rgba(255,255,255,.1); }
.gc-for b { color: var(--accent); }
.gc small { opacity: .75; }
.gc-orb { position: absolute; border-radius: 50%; filter: blur(50px); opacity: .5; }
.gc-orb.a { width: 300px; height: 300px; background: var(--accent); top: -140px; right: -80px; }
.gc-orb.b { width: 260px; height: 260px; background: var(--secondary); bottom: -120px; left: -60px; }
@media print {
  .rc-actions, .rc-ok span, .rc-confetti { display: none !important; }
  .rc { box-shadow: none; border: 0; }
}
@media (max-width: 520px) { .rc-doc dl { grid-template-columns: 1fr; gap: 2px; } .rc-doc dd { margin-bottom: 8px; } .rc-verify { flex-direction: column; } }
</style>
