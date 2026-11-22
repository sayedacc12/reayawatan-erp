<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import { useSession } from '../stores/session';
import { daysLabel, inDays, type DeletionNotice } from '../modules/platform/lifecycle';
import { fmtDate } from '../modules/platform/labels';

/**
 * تنبيه مستخدمي جمعية التجربة بالأيام المتبقية: نهاية التجربة ثم حذف الجمعية وبياناتها إن لم يتم التعاقد.
 * يمكن إخفاؤه ليوم واحد، إلا في آخر 3 أيام فيبقى ظاهرًا.
 */
const session = useSession();
const notice = ref<DeletionNotice | null>(null);
const today = new Date().toISOString().slice(0, 10);
const key = () => `erp.trialNotice.${session.user?.organizationId}`;
const hiddenOn = ref<string | null>(null);

watch(() => session.user?.id, async () => {
  notice.value = null;
  if (!session.user?.organizationId) return;
  try { hiddenOn.value = localStorage.getItem(key()); } catch { hiddenOn.value = null; }
  const n = await api<DeletionNotice | Record<string, never>>('/organization/lifecycle').catch(() => null);
  notice.value = n && 'deleteOn' in n ? (n as DeletionNotice) : null;
}, { immediate: true });

const days = computed(() => notice.value?.daysToTrialEnd ?? 0);
const urgent = computed(() => days.value <= 3);
const show = computed(() => notice.value?.reason === 'trial' && (urgent.value || hiddenOn.value !== today));
function hide() {
  try { localStorage.setItem(key(), today); } catch { /* المتصفح يمنع التخزين */ }
  hiddenOn.value = today;
}
</script>

<template>
  <div v-if="show && notice" :class="['trial-notice', { urgent, soon: days <= 7 }]" role="status">
    <span class="count" aria-hidden="true"><b>{{ days }}</b><small>{{ days === 1 ? 'يوم' : 'أيام' }}</small></span>
    <div class="msg">
      <strong>{{ days === 0 ? 'اليوم آخر يوم في الفترة التجريبية' : `متبقٍ ${daysLabel(days)} على نهاية الفترة التجريبية` }}</strong>
      <span>تنتهي في {{ fmtDate(notice.trialEndsOn) }}، وبعدها يتوقف الدخول. وإن لم يتم التعاقد تُحذف الجمعية وكل بياناتها نهائيًا في {{ fmtDate(notice.deleteOn) }} ({{ inDays(notice.daysToDelete) }}). للاشتراك تواصلوا مع الدعم الفني.</span>
    </div>
    <button v-if="!urgent" class="close" title="إخفاء اليوم" @click="hide">×</button>
  </div>
</template>

<style scoped>
.trial-notice { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; padding: 10px 14px; border-radius: 12px;
  background: #eef6ff; border: 1px solid #c7defa; color: #1e3a5f; }
.trial-notice.soon { background: #fff7e6; border-color: #f5d79e; color: #7a4800; }
.trial-notice.urgent { background: var(--danger-soft); border-color: #f3c4bf; color: var(--danger); animation: pulse 2.4s ease-in-out infinite; }
@keyframes pulse { 50% { box-shadow: 0 0 0 4px rgba(180, 35, 24, .12); } }
.count { flex: none; width: 52px; height: 52px; border-radius: 12px; display: grid; place-items: center; align-content: center; background: rgba(255,255,255,.7); line-height: 1; }
.count b { font-size: 1.35rem; }
.count small { font-size: .72rem; }
.msg { display: flex; flex-direction: column; gap: 2px; font-size: .9rem; line-height: 1.7; flex: 1; }
.close { background: none; border: 0; font-size: 1.4rem; color: inherit; cursor: pointer; opacity: .6; flex: none; }
.close:hover { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .trial-notice.urgent { animation: none; } }
</style>
