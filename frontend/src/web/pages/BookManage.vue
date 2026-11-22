<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import PageHead from '../PageHead.vue';
import { setTitle } from '../parts';
import { post } from '../site';

/** إدارة الموعد من الرابط المرسل للزائر (رمز سري، لا حساب) */
const route = useRoute();
const token = String(route.params.token ?? '');
const info = ref<{ statusLabel: string; label: string; cancellable: boolean } | null>(null);
const err = ref('');
const reason = ref('');
const busy = ref(false);
const cancelled = ref(false);

onMounted(async () => {
  setTitle('إدارة الموعد');
  try {
    const r = await fetch(`/api/public/web/booking/manage/${encodeURIComponent(token)}`);
    if (!r.ok) throw new Error(r.status === 429 ? 'محاولات كثيرة، انتظروا دقيقة' : 'الرابط غير صحيح أو انتهت صلاحيته');
    info.value = await r.json();
  } catch (e) {
    err.value = (e as Error).message;
  }
});

async function cancel() {
  busy.value = true;
  err.value = '';
  try {
    await post(`/booking/manage/${encodeURIComponent(token)}/cancel`, reason.value.trim() ? { reason: reason.value.trim() } : {});
    cancelled.value = true;
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <PageHead title="إدارة الموعد" :crumbs="[{ to: '/book', l: 'حجز جلسة' }, { l: 'إدارة الموعد' }]" />
  <section class="band"><div class="wrap" style="max-width: 640px">
    <div v-if="cancelled" class="card ok-box" role="status"><h2>أُلغي الموعد</h2><p>يمكنكم حجز موعد جديد في أي وقت.</p><RouterLink class="btn btn-primary" to="/book">حجز موعد جديد</RouterLink></div>
    <div v-else-if="info" class="card">
      <dl class="kv"><div><dt>الموعد</dt><dd>{{ info.label }}</dd></div><div><dt>الحالة</dt><dd>{{ info.statusLabel }}</dd></div></dl>
      <template v-if="info.cancellable">
        <div class="field"><label for="m-reason">سبب الإلغاء (اختياري)</label><input id="m-reason" v-model="reason" class="input" maxlength="500"></div>
        <p v-if="err" class="err">{{ err }}</p>
        <div style="display: flex; gap: 12px; flex-wrap: wrap"><button class="btn" type="button" :disabled="busy" @click="cancel">إلغاء الموعد</button><RouterLink class="btn btn-primary" to="/book">اختيار موعد آخر</RouterLink></div>
        <p class="note">لتغيير الموعد: ألغوا هذا الموعد ثم احجزوا موعدًا جديدًا.</p>
      </template>
      <p v-else class="note">لا يمكن تعديل هذا الموعد من الموقع. للاستفسار تواصلوا معنا.</p>
    </div>
    <div v-else-if="err" class="card"><p class="err">{{ err }}</p><RouterLink class="btn" to="/book">حجز موعد</RouterLink></div>
    <div v-else class="card"><p class="note">جارٍ التحميل…</p></div>
  </div></section>
</template>
