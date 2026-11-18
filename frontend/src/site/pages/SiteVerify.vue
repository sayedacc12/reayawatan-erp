<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import SiteIcon from '../SiteIcon.vue';
import PageHead from '../parts/PageHead.vue';
import { dateAr, num, useSite } from '../site';

/* eslint-disable @typescript-eslint/no-explicit-any */
const route = useRoute();
const site = useSite();
const f = reactive({ no: String(route.query.no ?? ''), code: String(route.query.code ?? '') });
const r = ref<any>(null);
const err = ref('');
const busy = ref(false);
async function check() {
  err.value = '';
  r.value = null;
  busy.value = true;
  try {
    r.value = await site.get(`/verify?no=${encodeURIComponent(f.no.trim())}&code=${encodeURIComponent(f.code.trim())}`);
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
if (f.no && f.code) check();
</script>

<template>
  <div>
    <PageHead title="التحقق من إيصال تبرع" text="اكتب رقم الإيصال ورمز التحقق المطبوعين عليه." />
    <section class="sx-sec">
      <div class="sx-wrap" style="max-width: 560px">
        <form class="sx-card" style="padding: 26px" @submit.prevent="check">
          <div class="vf-row">
            <label class="sx-field"><span>رقم الإيصال</span><input v-model="f.no" class="sx-input" dir="ltr" placeholder="W-000001" required /></label>
            <label class="sx-field"><span>رمز التحقق</span><input v-model="f.code" class="sx-input" dir="ltr" placeholder="ABC123" required /></label>
          </div>
          <button class="sx-btn prim block" :disabled="busy">تحقق</button>
          <div v-if="err" class="sx-err" style="margin-top: 14px">{{ err }}</div>
          <div v-if="r" :class="['vf-res', { bad: !r.valid }]">
            <SiteIcon :name="r.valid ? 'check' : 'x'" :size="34" />
            <div v-if="r.valid"><strong>إيصال صحيح</strong><p>تبرع بمبلغ <b>{{ num(r.amount) }} ريال</b> ({{ r.kindLabel }}) لصالح {{ r.programName }} بتاريخ {{ dateAr(r.date) }}.</p></div>
            <div v-else><strong>لم نجد إيصالًا بهذه البيانات</strong><p>تأكد من رقم الإيصال ورمز التحقق.</p></div>
          </div>
        </form>
      </div>
    </section>
  </div>
</template>

<style scoped>
.vf-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.vf-res { display: flex; gap: 14px; align-items: center; margin-top: 18px; padding: 18px; border-radius: 16px; background: #ecfdf5; color: #047857; animation: vf-in .5s var(--ease2); }
.vf-res.bad { background: #fef2f2; color: #b91c1c; }
.vf-res p { margin: 4px 0 0; color: var(--ink); }
@keyframes vf-in { from { opacity: 0; transform: scale(.95); } }
</style>
