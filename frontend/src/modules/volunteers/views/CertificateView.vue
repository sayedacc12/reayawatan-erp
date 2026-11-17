<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import BrandMark from '../../../components/BrandMark.vue';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, fmtDate, hijri, publicUrl } from '../lib';
import '../../projects/projects.css';
import '../volunteers.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const c = ref<any>(null);
const load = async () => (c.value = await api(`/volunteers/certificates/${props.id}`));
onMounted(() => load().catch((e) => toast.error((e as Error).message)));
async function revoke() {
  if (!confirm('إلغاء الشهادة؟ ستظهر ملغاة عند التحقق منها.')) return;
  await api(`/volunteers/certificates/${props.id}/revoke`, { method: 'POST' });
  toast.success('أُلغيت الشهادة');
  load();
}
const printNow = () => window.print();
</script>

<template>
  <div v-if="c">
    <div class="vt-toolbar no-print">
      <RouterLink :to="`/volunteers/list/${c.volunteerId}`" class="btn btn-sm">ملف المتطوع</RouterLink>
      <span class="grow" />
      <button class="btn btn-primary" @click="printNow">طباعة الشهادة</button>
      <button v-if="session.can(P.certificates) && !c.isRevoked" class="btn btn-danger" @click="revoke">إلغاء الشهادة</button>
    </div>
    <div v-if="c.isRevoked" class="alert alert-error no-print">هذه الشهادة ملغاة</div>
    <article :class="['cert vt-print', c.kind]">
      <div class="frame">
        <header><BrandMark :size="54" /><div><b>{{ c.organizationName }}</b><small>{{ c.certificateNo }}</small></div></header>
        <h1>{{ c.title }}</h1>
        <div class="name">{{ c.volunteerName }}</div>
        <p class="body">{{ c.body }}</p>
        <div v-if="c.kind === 'hours'" class="hours"><b>{{ c.hours }}</b><span>ساعة تطوعية</span></div>
        <footer>
          <div><span>تاريخ الإصدار</span><b>{{ fmtDate(c.issuedOn) }}</b><small>{{ hijri(c.issuedOn) }}</small></div>
          <div class="sign"><span>{{ c.signatoryTitle }}</span><b>{{ c.signatoryName || '........................' }}</b><i>التوقيع</i></div>
          <div><span>رمز التحقق</span><b class="vt-code">{{ c.verifyCode }}</b><small class="vt-code">{{ publicUrl('/v/verify') }}</small></div>
        </footer>
      </div>
    </article>
  </div>
</template>

<style scoped>
.cert { max-width: 900px; margin: 0 auto; background: #fffdf7; padding: 18px; border-radius: 10px; box-shadow: var(--shadow); color: #1f2937; }
.frame { border: 3px double #b8860b; border-radius: 6px; padding: 36px 44px; text-align: center; position: relative;
  background: radial-gradient(500px 220px at 50% 0%, rgba(250,204,21,.12), transparent 70%), radial-gradient(400px 200px at 0% 100%, rgba(16,185,129,.1), transparent 70%); }
.thanks .frame { border-color: #047857; }
header { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 18px; }
header div { display: flex; flex-direction: column; text-align: start; }
header b { font-size: 1.15rem; }
header small { color: #6b7280; font-family: ui-monospace, monospace; direction: ltr; }
h1 { font-size: 2rem; color: #92400e; margin: 6px 0 18px; letter-spacing: .5px; }
.thanks h1 { color: #065f46; }
.name { font-size: 1.6rem; font-weight: 800; color: #0f766e; margin-bottom: 14px; border-bottom: 1px dashed #d1d5db; display: inline-block; padding: 0 30px 6px; }
.body { font-size: 1.08rem; line-height: 2.1; max-width: 680px; margin: 0 auto 18px; }
.hours { display: inline-flex; flex-direction: column; align-items: center; padding: 10px 24px; border-radius: 14px; background: linear-gradient(135deg, #fef3c7, #d1fae5); margin-bottom: 18px; }
.hours b { font-size: 2rem; color: #92400e; }
footer { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-top: 18px; font-size: .86rem; }
footer div { display: flex; flex-direction: column; gap: 2px; }
footer span { color: #6b7280; }
footer small { color: #9ca3af; font-size: .72rem; }
.sign i { font-style: normal; color: #9ca3af; border-top: 1px solid #d1d5db; margin-top: 18px; padding-top: 2px; }
@media (max-width: 640px) { .frame { padding: 20px 14px; } h1 { font-size: 1.4rem; } footer { grid-template-columns: 1fr; } }
@media print { .cert { box-shadow: none; max-width: none; } }
</style>
