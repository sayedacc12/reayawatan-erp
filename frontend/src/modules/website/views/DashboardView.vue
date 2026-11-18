<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { WP, copy, fmtDate, fmtDateTime, num, sar, siteUrl } from '../lib';
import '../website.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const toast = useToast();
const d = ref<any>(null);
onMounted(async () => {
  try {
    d.value = await api('/website/dashboard');
  } catch (e) {
    toast.error((e as Error).message);
  }
});
const link = computed(() => (d.value ? siteUrl(d.value.slug, '', d.value.published ? null : d.value.previewKey) : ''));
const maxDay = computed(() => Math.max(1, ...(d.value?.daily ?? []).map((x: any) => x.amount)));
async function copyLink() {
  if (await copy(link.value)) toast.success('نُسخ رابط الموقع');
}
</script>

<template>
  <div v-if="d">
    <section class="wd-hero">
      <div class="wd-hero-main">
        <span :class="['wd-live', { off: !d.published }]"><i />{{ d.published ? 'الموقع منشور للزوار' : 'الموقع غير منشور (معاينة فقط)' }}</span>
        <h1>لوحة الموقع الإلكتروني</h1>
        <div class="wd-url"><span class="ws-code">{{ link }}</span><button class="btn btn-sm" @click="copyLink">نسخ</button><a :href="link" target="_blank" rel="noopener" class="btn btn-sm btn-primary">فتح الموقع ↗</a></div>
      </div>
      <div class="wd-raised">
        <small>إجمالي التبرعات من المتجر</small>
        <strong>{{ sar(d.money.total) }}</strong>
        <span>{{ num(d.money.count) }} تبرعًا · هذا الشهر {{ sar(d.money.month) }}</span>
      </div>
      <i class="orb a" /><i class="orb b" />
    </section>

    <div class="ws-kpis">
      <div class="ws-kpi" style="--c: #10b981"><span class="v">{{ sar(d.money.today) }}</span><span class="l">تبرعات اليوم</span></div>
      <div class="ws-kpi" style="--c: #0ea5e9"><span class="v">{{ d.subs.active }}</span><span class="l">متبرع شهري نشط</span><span class="s">{{ sar(d.subs.monthly) }} شهريًا</span></div>
      <div class="ws-kpi" style="--c: #8b5cf6"><span class="v">{{ d.programs.approved }}</span><span class="l">برنامج معتمد</span><span class="s">{{ d.programs.in_store }} في المتجر</span></div>
      <div class="ws-kpi" style="--c: #0f766e"><span class="v">{{ d.news.published }}</span><span class="l">خبر منشور</span><span class="s">{{ num(d.news.views) }} مشاهدة</span></div>
      <RouterLink v-if="session.can(WP.messages)" to="/website/messages" class="ws-kpi" style="--c: #f59e0b; color: inherit"><span class="v">{{ d.messages.new }}</span><span class="l">رسالة زائر جديدة</span><span class="s">{{ d.messages.open }} قيد المتابعة</span></RouterLink>
      <div v-if="d.money.voucher_errors" class="ws-kpi" style="--c: #ef4444"><span class="v">{{ d.money.voucher_errors }}</span><span class="l">تبرع بلا سند قبض</span><span class="s">أكمل الربط المالي من الإعدادات</span></div>
    </div>

    <div v-if="d.provider === 'sandbox'" class="ws-note">بوابة الدفع على <strong>البيئة التجريبية</strong>: التبرعات لا تحصّل مالًا حقيقيًا. اربط حساب ميسر من الإعدادات قبل الإطلاق.</div>

    <div class="ws-side">
      <div>
        <section class="card ws-panel">
          <h2>التبرعات خلال 30 يومًا</h2>
          <div class="wd-chart">
            <div v-for="x in d.daily" :key="x.day" class="wd-bar" :title="`${fmtDate(x.day)}: ${sar(x.amount)} (${x.count})`"><i :style="{ height: `${Math.max(2, (x.amount / maxDay) * 100)}%` }" /></div>
          </div>
          <div class="wd-axis"><span>{{ fmtDate(d.daily[0]?.day) }}</span><span>اليوم</span></div>
        </section>
        <section class="card ws-panel">
          <div class="ws-row" style="justify-content: space-between"><h2>حصيلة البرامج</h2><RouterLink to="/website/programs" class="ws-link">كل البرامج</RouterLink></div>
          <div v-if="!d.top.length" class="ws-empty">لا توجد برامج معتمدة بعد</div>
          <div v-for="p in d.top" :key="p.id" class="wd-prog">
            <RouterLink :to="`/website/programs/${p.id}`"><strong>{{ p.name }}</strong></RouterLink>
            <div class="ws-progress"><i :style="{ width: `${p.progress ?? 0}%` }" /></div>
            <span class="muted">{{ sar(p.raised) }}<template v-if="p.goal"> من {{ sar(p.goal) }} ({{ p.progress }}%)</template> · {{ p.count }} تبرع</span>
          </div>
        </section>
      </div>
      <aside>
        <section class="card ws-panel">
          <h2>بانتظار الاعتماد</h2>
          <div v-if="!d.awaiting.length" class="muted">لا يوجد ما ينتظر الاعتماد ✓</div>
          <RouterLink v-for="a in d.awaiting" :key="a.id" :to="a.kind === 'news' ? `/website/news/${a.id}` : `/website/programs/${a.id}`" class="wd-wait">
            <span class="ws-pill" style="--c: #f59e0b">{{ a.kind === 'news' ? 'خبر' : 'برنامج' }}</span><strong>{{ a.title }}</strong><small class="muted">{{ a.by }} · {{ fmtDate(a.at) }}</small>
          </RouterLink>
        </section>
        <section class="card ws-panel">
          <div class="ws-row" style="justify-content: space-between"><h2>آخر التبرعات</h2><RouterLink v-if="session.can(WP.donations)" to="/website/donations" class="ws-link">الكل</RouterLink></div>
          <div v-for="r in d.recent" :key="r.id" class="wd-don">
            <div><strong>{{ sar(r.amount) }}</strong> <span v-if="r.monthly" class="ws-pill" style="--c: #0ea5e9">شهري</span><span v-if="r.gift" class="ws-pill" style="--c: #ec4899">إهداء</span>
              <div class="muted">{{ r.program_name }} · {{ r.donor_name || 'فاعل خير' }}</div></div>
            <small class="muted">{{ fmtDateTime(r.paid_at) }}</small>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.wd-hero { position: relative; overflow: hidden; border-radius: 18px; padding: 24px 26px; margin-bottom: 16px; color: #fff; background: var(--grad-dark); display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-end; }
.wd-hero-main { flex: 1; min-width: 280px; position: relative; z-index: 1; }
.wd-hero h1 { font-size: 1.5rem; margin: 8px 0 12px; }
.wd-live { display: inline-flex; align-items: center; gap: 8px; font-size: .85rem; background: rgba(16,185,129,.18); color: #6ee7b7; padding: 4px 12px; border-radius: 999px; }
.wd-live i { width: 8px; height: 8px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 0 currentColor; animation: pulse 2s infinite; }
.wd-live.off { background: rgba(251,191,36,.18); color: #fcd34d; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(110,231,183,.7); } 70% { box-shadow: 0 0 0 10px rgba(110,231,183,0); } 100% { box-shadow: 0 0 0 0 rgba(110,231,183,0); } }
.wd-url { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.15); padding: 6px 6px 6px 12px; border-radius: 12px; }
.wd-url .ws-code { color: #a7f3e9; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.wd-raised { position: relative; z-index: 1; text-align: left; }
.wd-raised small { opacity: .75; }
.wd-raised strong { display: block; font-size: 2rem; background: linear-gradient(90deg, #fff, var(--gold)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.wd-raised span { font-size: .85rem; opacity: .8; }
.orb { position: absolute; border-radius: 50%; filter: blur(34px); opacity: .35; animation: float 10s ease-in-out infinite; }
.orb.a { width: 240px; height: 240px; background: var(--gold); inset-inline-start: -70px; top: -120px; }
.orb.b { width: 200px; height: 200px; background: #2dd4bf; inset-inline-end: 30%; bottom: -130px; animation-delay: -5s; }
@keyframes float { 50% { transform: translate(18px, 12px) scale(1.1); } }
.wd-chart { display: flex; align-items: flex-end; gap: 3px; height: 160px; padding-top: 8px; }
.wd-bar { flex: 1; height: 100%; display: flex; align-items: flex-end; }
.wd-bar i { display: block; width: 100%; border-radius: 4px 4px 0 0; background: var(--grad); opacity: .85; transition: opacity .2s; animation: grow .8s var(--ease) both; transform-origin: bottom; }
.wd-bar:hover i { opacity: 1; box-shadow: 0 0 12px rgba(20,184,166,.5); }
@keyframes grow { from { transform: scaleY(0); } }
.wd-axis { display: flex; justify-content: space-between; font-size: .75rem; color: var(--muted); margin-top: 4px; }
.wd-prog { display: grid; gap: 4px; padding: 8px 0; border-bottom: 1px dashed var(--border); }
.wd-prog:last-child { border-bottom: 0; }
.wd-prog a { color: var(--text); }
.wd-prog span { font-size: .82rem; }
.wd-wait { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 10px; color: var(--text); border: 1px solid var(--border); margin-bottom: 6px; transition: background .2s; }
.wd-wait:hover { background: var(--surface-2); }
.wd-wait .ws-pill { align-self: flex-start; }
.wd-don { display: flex; justify-content: space-between; gap: 8px; padding: 8px 0; border-bottom: 1px dashed var(--border); font-size: .88rem; }
.wd-don:last-child { border-bottom: 0; }
</style>
