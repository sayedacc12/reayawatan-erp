<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import AppIcon from '../../../components/AppIcon.vue';
import LaunchCard from '../../../onboarding/LaunchCard.vue';
import { launchView } from '../../../onboarding/onboarding';
import { useSession } from '../../../stores/session';
import { rel } from './ess';

/**
 * لوحتي لمن ليس له ملف موظف بعد (مثل مدير نظام جمعية جديدة): ترحيب ومهام وأنظمة وخطوات الإطلاق.
 * تحل محل شاشة التطبيقات القديمة، فكل مستخدم في الجمعية يبدأ من لوحته.
 */
interface Task { id: string; title: string; subtitle?: string | null; link: string; at?: string | null; urgent?: boolean }
interface Group { module: string; name: string; color: string; items: Task[] }
const session = useSession();
const tasks = ref<{ total: number; groups: Group[] }>({ total: 0, groups: [] });
const loaded = ref(false);
onMounted(async () => {
  try {
    tasks.value = await api('/tasks');
  } catch { /* اللوحة تعمل بدون المهام */ }
  loaded.value = true;
});
const flat = computed(() => tasks.value.groups.flatMap((g) => g.items.map((t) => ({ ...t, sys: g.name, color: g.color }))).slice(0, 7));
const greeting = computed(() => {
  const h = new Date().getHours();
  return h < 12 ? 'صباح الخير' : h < 18 ? 'مساء النور' : 'مساء الخير';
});
const today = new Date().toLocaleDateString('ar-SA-u-ca-gregory', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const first = computed(() => session.user?.fullName.split(' ')[0] ?? '');
const PALETTE = ['#2f7a57', '#6366f1', '#f59e0b', '#ec4899', '#0ea5e9', '#22c55e', '#a855f7', '#ef4444'];
const tint = (i: number) => ({ '--c': PALETTE[i % PALETTE.length], '--i': i });
const canHr = computed(() => session.apps.some((a) => a.code === 'hr' && a.menu.some((m) => m.path === '/hr/employees')));
</script>

<template>
  <div>
    <section class="ess-hero" data-tour="dash">
      <div class="ess-hero-top">
        <div>
          <p class="ess-kicker">{{ today }}</p>
          <h1>{{ greeting }}، {{ first }} 👋</h1>
          <p class="sub">مرحبًا بك في لوحة {{ session.user?.organizationName }}. من هنا تتابع مهامك وتفتح أنظمتك.</p>
        </div>
      </div>
    </section>

    <LaunchCard />

    <div class="ess-kpis">
      <div class="ess-kpi" style="--a: #f59e0b; --i: 0"><span class="ic">🔔</span><span>مهام بانتظارك</span><strong>{{ tasks.total }}</strong><small>{{ tasks.total ? 'في جرس المهام أعلى الشاشة' : 'لا شيء ينتظرك الآن' }}</small></div>
      <div class="ess-kpi" style="--a: #2f7a57; --i: 1"><span class="ic">🧩</span><span>الأنظمة المتاحة لك</span><strong>{{ session.apps.length }}</strong><small>حسب صلاحياتك</small></div>
      <RouterLink v-if="launchView" to="/launch" class="ess-kpi" style="--a: #c7a27a; --i: 2"><span class="ic">🚀</span><span>خطوات الإطلاق</span><strong>{{ launchView.done }} <small>/ {{ launchView.total }}</small></strong><small>{{ launchView.complete ? 'اكتملت، مبارك!' : `أنجزت ${launchView.pct}%` }}</small></RouterLink>
    </div>

    <div class="oh-grid">
      <section class="card ess-card">
        <h2>ما ينتظرك</h2>
        <div v-if="!loaded" class="ess-skeleton"><i /><i /></div>
        <p v-else-if="!flat.length" class="pm-empty">لا توجد مهام بانتظارك. كل الطلبات والاعتمادات الموجهة إليك ستظهر هنا.</p>
        <div v-else class="oh-tasks">
          <RouterLink v-for="(t, i) in flat" :key="t.id" :to="t.link" class="oh-task" :style="{ '--c': t.color, '--i': i }">
            <span class="dot" /><span class="tx"><b>{{ t.title }}</b><small>{{ t.sys }}{{ t.subtitle ? ` · ${t.subtitle}` : '' }}</small></span>
            <small v-if="t.at" class="pm-muted">{{ rel(String(t.at)) }}</small>
          </RouterLink>
        </div>
      </section>

      <section class="card ess-card">
        <h2>أنظمتك</h2>
        <div class="oh-apps" data-tour="systems">
          <RouterLink v-for="(a, i) in session.apps" :key="a.code" :to="a.menu[0].path" class="oh-app" :style="tint(i)">
            <span class="ic"><AppIcon :name="a.icon" :size="20" /></span>
            <span class="tx"><b>{{ a.name }}</b><small v-if="a.description">{{ a.description }}</small></span>
          </RouterLink>
        </div>
        <p v-if="!session.apps.length" class="pm-empty">لا توجد أنظمة متاحة لحسابك حاليًا. تواصل مع مدير النظام لمنحك الصلاحيات.</p>
      </section>
    </div>

    <section class="card oh-link">
      <span class="ic" aria-hidden="true">🪪</span>
      <div>
        <b>اربط حسابك بملفك الوظيفي لتكتمل لوحتك</b>
        <p class="pm-muted">بعد الربط تظهر هنا بياناتك الوظيفية: رصيد الإجازات، والراتب، والحضور، وتقديم الطلبات ومتابعتها.
          {{ canHr ? 'افتح ملف موظفك في الموارد البشرية واختر حسابك في خانة «حساب الدخول».' : 'اطلب من شؤون الموظفين فتح ملفك واختيار حسابك في خانة «حساب الدخول».' }}</p>
      </div>
      <RouterLink v-if="canHr" to="/hr/employees" class="btn">الموظفون ←</RouterLink>
    </section>
  </div>
</template>

<style scoped>
.oh-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); gap: 16px; margin-bottom: 16px; }
.oh-tasks { display: flex; flex-direction: column; gap: 6px; }
.oh-task { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
  transition: transform .2s var(--ease), border-color .2s; animation: ess-in .4s calc(var(--i) * 50ms) var(--ease) both; }
.oh-task:hover { transform: translateX(-3px); border-color: var(--c); }
.oh-task .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 20%, transparent); flex-shrink: 0; }
.oh-task .tx { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.oh-task small { color: var(--muted); }
.oh-apps { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.oh-app { position: relative; overflow: hidden; display: flex; gap: 10px; align-items: center; padding: 12px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); color: var(--text);
  transition: transform .25s var(--ease), box-shadow .25s, border-color .25s; animation: ess-in .45s calc(var(--i) * 40ms) var(--ease) both; }
.oh-app:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--c) 50%, var(--border)); box-shadow: 0 12px 26px color-mix(in srgb, var(--c) 20%, transparent); }
.oh-app .ic { width: 40px; height: 40px; flex-shrink: 0; border-radius: 12px; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, var(--c), color-mix(in srgb, var(--c) 65%, #000)); }
.oh-app .tx { display: flex; flex-direction: column; min-width: 0; }
.oh-app small { color: var(--muted); font-size: .78rem; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.oh-link { display: flex; gap: 14px; align-items: center; padding: 16px 18px; border-style: dashed; }
.oh-link .ic { font-size: 1.8rem; }
.oh-link div { flex: 1; }
.oh-link p { margin: 4px 0 0; }
/* على الجوال تكفي قائمة الأنظمة في اللوحة، فتُخفى من الجانب حتى تظهر اللوحة أولًا */
@media (max-width: 900px) { :global(.ess-shell.unlinked .ess-apps), :global(.ess-shell.unlinked .ess-apps-title) { display: none; } }
@media (max-width: 980px) { .oh-grid { grid-template-columns: 1fr; } .oh-link { flex-wrap: wrap; } }
</style>
