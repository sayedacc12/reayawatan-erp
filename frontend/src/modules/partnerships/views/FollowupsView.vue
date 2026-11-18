<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { KIND_ICON, PT, fmtDate, lookups } from '../lib';
import '../../projects/projects.css';
import '../partnerships.css';

const session = useSession();
const toast = useToast();
const lk = ref<any>(null);
const rows = ref<any[]>([]);
const contracts = ref<any[]>([]);
const status = ref('open');
async function load() {
  try {
    rows.value = await api(`/partnerships/followups${status.value ? `?status=${status.value}` : ''}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(async () => {
  lk.value = await lookups().catch(() => null);
  contracts.value = await api<any[]>('/partnerships/contracts?status=signed').catch(() => []);
  await load();
});
watch(status, load);
const alertDays = computed(() => lk.value?.settings.alertDays ?? 60);
const expiring = computed(() => contracts.value.filter((c) => c.daysLeft !== null && c.daysLeft <= alertDays.value).sort((a, b) => a.daysLeft - b.daysLeft));
async function toggle(f: any) {
  try {
    await api(`/partnerships/followups/${f.id}/done`, { method: 'POST', json: { done: !f.doneAt } });
    toast.success(f.doneAt ? 'أُعيد فتح الالتزام' : 'سُجّل الإنجاز');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <div class="page-head"><div><h1>المتابعة والتنبيهات</h1><p class="muted">التزامات عقود الشراكة ومواعيدها، والعقود السارية التي تقترب من نهايتها خلال {{ alertDays }} يومًا.</p></div></div>
    <div class="pt-grid">
      <section class="card pm-panel">
        <h2>الالتزامات
          <span class="pt-chips">
            <button v-for="[k, l] in [['open', 'المفتوحة'], ['overdue', 'المتأخرة'], ['done', 'المنجزة'], ['', 'الكل']]" :key="k" :class="['pt-chip', { on: status === k }]" style="--c: #b45309" @click="status = k">{{ l }}</button>
          </span>
        </h2>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>الالتزام</th><th>الشريك والعقد</th><th>على</th><th>الاستحقاق</th><th>الحالة</th><th /></tr></thead>
            <tbody>
              <tr v-for="f in rows" :key="f.id">
                <td>{{ KIND_ICON[f.kind] }} <b>{{ f.title }}</b><span class="pm-muted">{{ f.kindLabel }}{{ f.responsible ? ` · ${f.responsible}` : '' }}</span></td>
                <td><RouterLink :to="`/partnerships/contracts/${f.contractId}`" class="pm-link">{{ f.partnerName }}</RouterLink><span class="pm-muted pt-code">{{ f.contractNumber }}</span></td>
                <td>{{ f.party === 'partner' ? 'الشريك' : 'الجمعية' }}</td>
                <td>{{ fmtDate(f.dueDate) }}</td>
                <td><span v-if="f.doneAt" class="pt-days ok">منجز</span><span v-else-if="f.overdue" class="pt-days late">متأخر {{ -f.daysLeft }} يوم</span><span v-else class="pt-days">بعد {{ f.daysLeft }} يوم</span></td>
                <td><button v-if="session.can(PT.contracts)" class="btn btn-sm" @click="toggle(f)">{{ f.doneAt ? 'إعادة فتح' : '✓ تم' }}</button></td>
              </tr>
              <tr v-if="!rows.length"><td colspan="6" class="pt-empty">لا توجد التزامات هنا</td></tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="card pm-panel">
        <h2>عقود تنتهي قريبًا</h2>
        <p v-if="!expiring.length" class="pt-empty">لا توجد عقود تنتهي خلال {{ alertDays }} يومًا</p>
        <RouterLink v-for="c in expiring" :key="c.id" :to="`/partnerships/contracts/${c.id}`" class="exp">
          <span><b>{{ c.partnerName }}</b><small class="pm-muted"><span class="pt-code">{{ c.number }}</span> · {{ c.title }}</small><small class="pm-muted">ينتهي {{ fmtDate(c.endsOn) }}</small></span>
          <span :class="['pt-days', { late: c.daysLeft < 15 }]">{{ c.daysLeft }} يوم</span>
        </RouterLink>
        <p class="pm-muted">من صفحة العقد: «تجديد العقد» ينشئ مسودة بالبنود نفسها تبدأ بعد نهايته.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.exp { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 4px; border-bottom: 1px solid var(--border); color: var(--text); }
.exp:hover { background: var(--surface-2); }
.exp small { display: block; }
</style>
