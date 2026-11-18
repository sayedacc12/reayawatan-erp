<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SiteIcon from '../SiteIcon.vue';
import { num, useSite } from '../site';

/* eslint-disable @typescript-eslint/no-explicit-any */
const route = useRoute();
const router = useRouter();
const site = useSite();
const token = route.params.token as string;
const info = ref<any>(null);
const err = ref('');
const busy = ref(false);
const card = reactive({ name: '', number: '4111 1111 1111 1111', exp: '12/30', cvc: '123' });
onMounted(async () => {
  try {
    info.value = await site.get(`/pay/${token}`);
    if (info.value.status === 'paid') router.replace({ ...site.to(`/receipt/${token}`) });
  } catch (e) {
    err.value = (e as Error).message;
  }
});
const brand = computed(() => (card.number.startsWith('4') ? 'VISA' : card.number.startsWith('5') ? 'MASTERCARD' : 'مدى'));
async function pay() {
  busy.value = true;
  err.value = '';
  try {
    await new Promise((r) => setTimeout(r, 900));
    await site.post(`/pay/${token}/sandbox`, { ref: info.value.gatewayId });
    router.replace({ ...site.to(`/receipt/${token}`), query: { ...site.to().query, new: '1' } });
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="py-page">
    <div class="sx-wrap py-wrap">
      <div v-if="err && !info" class="sx-card py-box sx-empty"><h2>{{ err }}</h2></div>
      <div v-else-if="info" class="sx-card py-box">
        <div class="py-sum">
          <small>{{ info.kindLabel }}</small>
          <h2>{{ info.programName }}</h2>
          <strong>{{ num(info.amount) }} <span>ر.س</span></strong>
          <small v-if="info.monthly">تبرع شهري</small>
        </div>
        <template v-if="info.status === 'pending'">
          <template v-if="info.provider === 'sandbox'">
            <div class="py-note"><SiteIcon name="shield" :size="18" /> بيئة دفع تجريبية: لن يُخصم أي مبلغ حقيقي.</div>
            <div class="py-card">
              <div class="py-card-top"><span class="py-chip" /><b>{{ brand }}</b></div>
              <div class="py-card-no" dir="ltr">{{ card.number || '•••• •••• •••• ••••' }}</div>
              <div class="py-card-bot"><span>{{ card.name || 'اسم حامل البطاقة' }}</span><span dir="ltr">{{ card.exp }}</span></div>
            </div>
            <form @submit.prevent="pay">
              <label class="sx-field"><span>اسم حامل البطاقة</span><input v-model="card.name" class="sx-input" /></label>
              <label class="sx-field"><span>رقم البطاقة</span><input v-model="card.number" class="sx-input" dir="ltr" inputmode="numeric" /></label>
              <div class="py-row">
                <label class="sx-field"><span>تاريخ الانتهاء</span><input v-model="card.exp" class="sx-input" dir="ltr" /></label>
                <label class="sx-field"><span>CVC</span><input v-model="card.cvc" class="sx-input" dir="ltr" /></label>
              </div>
              <div v-if="err" class="sx-err">{{ err }}</div>
              <button class="sx-btn main block" :disabled="busy">{{ busy ? 'جارٍ تأكيد الدفع...' : `ادفع ${num(info.amount)} ريال` }}</button>
            </form>
          </template>
          <template v-else>
            <p style="text-align: center">أكمل الدفع في صفحة بوابة الدفع الآمنة.</p>
            <a v-if="info.gatewayUrl" :href="info.gatewayUrl" class="sx-btn main block">المتابعة إلى الدفع</a>
          </template>
        </template>
        <div v-else class="sx-err" style="text-align: center">{{ info.status === 'cancelled' ? 'أُلغي طلب التبرع هذا.' : 'لم يكتمل الدفع. يمكنك المحاولة بتبرع جديد.' }}<br /><RouterLink :to="site.to('/donate')" class="sx-btn line sm" style="margin-top: 10px">تبرع جديد</RouterLink></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.py-page { padding: 50px 0 80px; background: radial-gradient(800px 400px at 50% 0%, color-mix(in srgb, var(--primary) 14%, transparent), transparent); }
.py-wrap { max-width: 520px; }
.py-box { padding: 28px; }
.py-sum { text-align: center; padding-bottom: 18px; margin-bottom: 18px; border-bottom: 1px dashed var(--line); display: grid; gap: 4px; }
.py-sum small { color: var(--text-2); }
.py-sum strong { font-family: var(--sx-head); font-size: 2.6rem; color: var(--primary); line-height: 1.2; }
.py-sum strong span { font-size: 1rem; }
.py-note { display: flex; gap: 8px; align-items: center; padding: 10px 14px; border-radius: 12px; background: #fffbeb; color: #92400e; font-size: .9rem; margin-bottom: 16px; }
.py-card { aspect-ratio: 1.6; max-width: 340px; margin: 0 auto 20px; border-radius: 18px; padding: 20px; color: #fff; background: var(--grad-dark); box-shadow: 0 20px 40px rgba(0,0,0,.25); display: flex; flex-direction: column; justify-content: space-between; position: relative; overflow: hidden; }
.py-card::before { content: ''; position: absolute; width: 240px; height: 240px; border-radius: 50%; background: radial-gradient(circle, color-mix(in srgb, var(--accent) 50%, transparent), transparent 70%); top: -100px; inset-inline-start: -60px; }
.py-card-top { display: flex; justify-content: space-between; align-items: center; position: relative; }
.py-chip { width: 42px; height: 30px; border-radius: 6px; background: linear-gradient(135deg, #f6d365, #c99a2e); }
.py-card-no { font-size: 1.3rem; letter-spacing: 2px; font-family: ui-monospace, monospace; position: relative; }
.py-card-bot { display: flex; justify-content: space-between; font-size: .85rem; opacity: .85; position: relative; }
.py-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
</style>
