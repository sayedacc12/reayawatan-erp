<script setup lang="ts">
import { computed, ref } from 'vue';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import ActivitiesPane from '../components/settings/ActivitiesPane.vue';
import FormsPane from '../components/settings/FormsPane.vue';
import WorkflowsPane from '../components/settings/WorkflowsPane.vue';

const session = useSession();
const toast = useToast();
const tab = ref<'activities' | 'workflows' | 'forms' | 'portal'>('activities');
const tabs = [
  { key: 'activities', label: 'الأنشطة', hint: 'محور ← برنامج ← مشروع' },
  { key: 'workflows', label: 'سير العمل', hint: 'المراحل والقرارات' },
  { key: 'forms', label: 'النماذج', hint: 'حقول البحث وبيانات الطلب' },
  { key: 'portal', label: 'بوابة المستفيدين', hint: 'رابط التسجيل والتقديم' },
] as const;
const portalUrl = computed(() => `${location.origin}/portal/${session.user?.organizationSlug ?? ''}`);
async function copy() {
  try {
    await navigator.clipboard.writeText(portalUrl.value);
    toast.success('تم نسخ الرابط');
  } catch {
    toast.error('انسخ الرابط يدويًا');
  }
}
</script>

<template>
  <div>
    <div class="page-head"><div><h1>إعدادات المستفيدين</h1><p class="muted sub">جهّز الأنشطة وسير العمل والنماذج مرة واحدة، والطلبات تمشي عليها تلقائيًا</p></div></div>
    <nav class="stabs">
      <button v-for="(t, i) in tabs" :key="t.key" :class="['stab', { on: tab === t.key }]" :style="{ '--i': i }" @click="tab = t.key">
        <span class="n">{{ i + 1 }}</span><span><b>{{ t.label }}</b><small>{{ t.hint }}</small></span>
      </button>
    </nav>
    <Transition name="page" mode="out-in">
      <ActivitiesPane v-if="tab === 'activities'" key="a" />
      <WorkflowsPane v-else-if="tab === 'workflows'" key="w" />
      <FormsPane v-else-if="tab === 'forms'" key="f" />
      <section v-else key="p" class="card portal">
        <div class="glow" />
        <h2>رابط بوابة المستفيدين لجمعيتك</h2>
        <p class="muted">حط الرابط ده في موقع الجمعية. المستفيد بيسجل برقم هويته، ويقدم على المشاريع المتاحة، ويتابع مراحل طلباته، ويبعت شكاوى ومقترحات واستفسارات.</p>
        <div class="url"><code dir="ltr">{{ portalUrl }}</code><button class="btn btn-primary btn-sm" @click="copy">نسخ</button><a :href="portalUrl" target="_blank" class="btn btn-sm">فتح</a></div>
        <p class="muted small">المشاريع اللي بتظهر في البوابة هي المشاريع النشطة اللي عليها علامة "يظهر في البوابة" في تبويب الأنشطة.</p>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.sub { margin: 2px 0 0; font-size: .88rem; }
.stabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
.stab { display: flex; align-items: center; gap: 10px; padding: 12px 14px; text-align: right; font: inherit; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); cursor: pointer;
  transition: all .2s; animation: rise .4s calc(var(--i) * 60ms) var(--ease) both; }
.stab small { display: block; color: var(--muted); font-size: .76rem; }
.stab .n { width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; background: var(--surface-2); color: var(--muted); font-weight: 700; flex-shrink: 0; transition: all .2s; }
.stab:hover { border-color: var(--primary); }
.stab.on { border-color: var(--primary); box-shadow: 0 10px 24px rgba(20,184,166,.15); }
.stab.on .n { background: var(--grad); color: #fff; box-shadow: 0 0 14px rgba(20,184,166,.6); }
.portal { position: relative; overflow: hidden; padding: 26px; }
.portal .glow { position: absolute; inset: 0; background: radial-gradient(400px 160px at 90% 0%, rgba(45,212,191,.16), transparent 70%); pointer-events: none; }
.portal h2 { margin-bottom: 8px; position: relative; }
.url { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 16px 0; position: relative; }
.url code { flex: 1; min-width: 220px; padding: 10px 14px; border-radius: 10px; background: var(--grad-dark); color: #5eead4; font-size: .95rem; overflow-x: auto; }
.small { font-size: .84rem; }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
@media (max-width: 800px) { .stabs { grid-template-columns: 1fr 1fr; } }
</style>
