<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import StatusPill from '../components/StatusPill.vue';
import { CONTRACT_STATUS, P, copy, fmtDate, fmtDateTime, publicUrl } from '../lib';
import '../../../shared/module.css';
import '../volunteers.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const c = ref<any>(null);
const load = async () => (c.value = await api(`/volunteers/contracts/${props.id}`));
onMounted(() => load().catch((e) => toast.error((e as Error).message)));
async function act(action: 'paper' | 'cancel') {
  if (!confirm(action === 'paper' ? 'تأكيد أن المتطوع وقّع العقد ورقيًا؟' : 'إلغاء العقد؟')) return;
  try {
    c.value = await api(`/volunteers/contracts/${props.id}/${action}`, { method: 'POST' });
    toast.success(action === 'paper' ? 'سُجل توقيع العقد' : 'أُلغي العقد');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function copyLink() {
  if (await copy(publicUrl(`/v/contract/${c.value.signToken}`))) toast.success('نُسخ رابط التوقيع');
}
const printNow = () => window.print();
</script>

<template>
  <div v-if="c">
    <div class="vt-toolbar no-print">
      <RouterLink :to="`/volunteers/list/${c.volunteerId}`" class="btn btn-sm">ملف المتطوع</RouterLink>
      <StatusPill :status="c.status" :label="CONTRACT_STATUS[c.status]" />
      <span class="grow" />
      <template v-if="c.status === 'issued' && session.can(P.contracts)">
        <button class="btn" @click="copyLink">نسخ رابط التوقيع الإلكتروني</button>
        <button class="btn" @click="act('paper')">تسجيل توقيع ورقي</button>
      </template>
      <button class="btn btn-primary" @click="printNow">طباعة</button>
      <button v-if="c.status !== 'cancelled' && session.can(P.contracts)" class="btn btn-danger" @click="act('cancel')">إلغاء العقد</button>
    </div>
    <article class="card contract vt-print">
      <h1>عقد تطوع</h1>
      <p class="no">رقم العقد <span class="vt-code">{{ c.contractNo }}</span> · من {{ fmtDate(c.startDate) }} إلى {{ fmtDate(c.endDate) }}</p>
      <section v-for="(cl, i) in c.clauses" :key="i"><h3>{{ i + 1 }}. {{ cl.title }}</h3><p>{{ cl.body }}</p></section>
      <div class="sig">
        <div><span>الطرف الأول: الشركة</span><b>........................</b></div>
        <div><span>الطرف الثاني: المتطوع</span><b>{{ c.signedName ?? '........................' }}</b>
          <small v-if="c.signedAt">{{ c.signedVia === 'paper' ? 'وُقّع ورقيًا' : 'وُقّع إلكترونيًا' }} · {{ fmtDateTime(c.signedAt) }}</small></div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.contract { max-width: 820px; margin: 0 auto; padding: 36px 44px; line-height: 2; }
h1 { text-align: center; font-size: 1.6rem; margin-bottom: 4px; }
.no { text-align: center; color: var(--muted); margin-bottom: 20px; }
h3 { font-size: 1rem; margin: 14px 0 2px; color: #065f46; }
section p { margin: 0; }
.sig { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 30px; }
.sig div { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--border); padding-top: 10px; }
.sig span { color: var(--muted); font-size: .86rem; }
.sig small { color: #047857; }
@media (max-width: 640px) { .contract { padding: 20px 16px; } .sig { grid-template-columns: 1fr; } }
</style>
