<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import StatusPill from '../components/StatusPill.vue';
import { EVENT_STATUS, P, STATUS_COLOR, fmtDate, num, type EventRow } from '../lib';
import '../../../shared/module.css';
import '../volunteers.css';

/** الفعاليات، وشاشة «اعتماد الفعاليات» نفسها بتصفية ما ينتظر قرار المستخدم */
const props = defineProps<{ approvals?: boolean }>();
const session = useSession();
const route = useRoute();
const rows = ref<EventRow[]>([]);
const error = ref('');
const q = reactive({ status: (route.query.status as string) ?? '', kind: '' });
async function load() {
  try {
    const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    if (props.approvals) params.set('awaiting', '1');
    rows.value = await api<EventRow[]>(`/volunteers/events?${params}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(() => ({ ...q }), load);
const counts = computed(() => ({ field: rows.value.filter((r) => r.kind === 'field').length, online: rows.value.filter((r) => r.kind === 'online').length }));
</script>

<template>
  <div>
    <section class="pm-hero vt-hero">
      <div><p class="pm-kicker">الفعاليات</p><h1>{{ approvals ? 'فعاليات بانتظار قرارك' : 'الفعاليات التطوعية' }}</h1>
        <p class="pm-sub">{{ approvals ? 'الفعاليات التي وصلت لمرحلة اعتماد من صلاحيتك. افتح الفعالية لمراجعتها كاملة ثم اتخذ القرار.' : 'فعاليات ميدانية في موقع محدد، أو عن بعد عبر منصة إلكترونية. كل فعالية تمر بمراحل الاعتماد، ثم التحضير، ثم تقرير الإغلاق واستبانة الرضا.' }}</p></div>
      <div class="pm-actions">
        <RouterLink v-if="session.can(P.events)" to="/volunteers/events/new" class="btn vt-glow">فعالية جديدة</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="!approvals" class="vt-toolbar">
      <div class="vt-tabs" style="margin: 0">
        <button :class="['vt-tab', { on: !q.kind }]" @click="q.kind = ''">الكل</button>
        <button :class="['vt-tab', { on: q.kind === 'field' }]" @click="q.kind = 'field'">ميدانية</button>
        <button :class="['vt-tab', { on: q.kind === 'online' }]" @click="q.kind = 'online'">عن بعد</button>
      </div>
      <span class="grow" />
      <select v-model="q.status" class="input"><option value="">كل الحالات</option><option v-for="s in EVENT_STATUS" :key="s.value" :value="s.value">{{ s.label }}</option></select>
      <span class="pm-muted">{{ counts.field }} ميدانية · {{ counts.online }} عن بعد</span>
    </div>
    <p v-if="!rows.length" class="card vt-empty">{{ approvals ? 'لا توجد فعاليات بانتظار قرارك' : 'لا توجد فعاليات بهذه التصفية' }}</p>
    <div class="vt-cards">
      <article v-for="(e, i) in rows" :key="e.id" class="vt-card" :style="{ '--c': STATUS_COLOR[e.status], '--i': i }" @click="$router.push(`/volunteers/events/${e.id}`)">
        <div class="meta"><span :class="['vt-kind', e.kind]">{{ e.kindLabel }}</span><span class="vt-code">{{ e.eventNo }}</span><span style="margin-inline-start: auto"><StatusPill :status="e.status" :label="e.statusLabel" /></span></div>
        <h3>{{ e.title }}</h3>
        <div class="meta">
          <span>📅 {{ fmtDate(e.startDate) }}{{ e.endDate !== e.startDate ? ` إلى ${fmtDate(e.endDate)}` : '' }}</span>
          <span>{{ e.kind === 'field' ? `📍 ${e.location ?? ''}` : `💻 ${e.platform ?? 'رابط إلكتروني'}` }}</span>
        </div>
        <div class="meta" style="margin-top: 6px">
          <span v-if="e.categoryName" class="pm-tag">{{ e.categoryName }}</span>
          <span v-for="f in e.fields" :key="f" class="pm-tag">{{ f }}</span>
        </div>
        <div v-if="e.status === 'in_review'" class="pm-muted" style="margin-top: 8px">المرحلة {{ e.stageIndex + 1 }} من {{ e.stagesCount }}: <b>{{ e.stageName }}</b>
          <span v-if="e.canDecide" class="pm-pill" style="--c: #f59e0b; margin-inline-start: 6px">بانتظار قرارك</span></div>
        <div style="margin-top: 10px">
          <div class="vt-bar"><i :style="{ width: Math.min(100, ((e.status === 'closed' ? e.attended : e.volunteers) / Math.max(1, e.volunteersNeeded)) * 100) + '%' }" /></div>
          <div class="meta" style="margin-top: 4px">
            <span>{{ e.status === 'closed' ? `حضر ${e.attended}` : `${e.volunteers} مرشح` }} من {{ e.volunteersNeeded || '—' }} متطوع</span>
            <span v-if="e.hours">· {{ num(e.hours) }} ساعة</span>
            <span v-if="e.satisfaction !== null" style="margin-inline-start: auto">رضا {{ num(e.satisfaction) }}%</span>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>
