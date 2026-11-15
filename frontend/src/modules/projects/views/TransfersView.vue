<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { fmtDate, label, links, sar } from '../labels';
import type { Batch, FundingType, ProjectRow, Transfer } from '../types';
import '../projects.css';

interface Target { id: string; name: string; fundingType: FundingType; zakatEligible: boolean; approvalStatus: string; problems: string[] }

const session = useSession();
const toast = useToast();
const canMove = computed(() => session.can('projects.transfers.manage'));
const projects = ref<ProjectRow[]>([]);
const history = ref<Transfer[]>([]);
const error = ref('');
const busy = ref(false);

const sourceProject = ref('');
const batches = ref<Batch[]>([]);
const batchId = ref('');
const targets = ref<Target[]>([]);
const form = ref({ targetActivityId: '', amount: null as number | null, reason: '' });

async function load() {
  try {
    [projects.value, history.value] = await Promise.all([api<ProjectRow[]>('/projects/list'), api<Transfer[]>('/projects-ops/transfers')]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

watch(sourceProject, async (id) => {
  batches.value = []; batchId.value = ''; targets.value = [];
  if (!id) return;
  try {
    batches.value = (await api<Batch[]>(`/projects-ops/support/projects/${id}/batches`)).filter((b) => b.activityId === id && b.net > 0);
  } catch (e) {
    toast.error((e as Error).message);
  }
});
const batch = computed(() => batches.value.find((b) => b.id === batchId.value));
watch(batchId, async (id) => {
  targets.value = []; form.value = { targetActivityId: '', amount: batch.value?.net ?? null, reason: '' };
  if (!id) return;
  try {
    targets.value = (await api<{ projects: Target[] }>(`/projects-ops/transfers/targets/${id}`)).projects;
  } catch (e) {
    toast.error((e as Error).message);
  }
});
const target = computed(() => targets.value.find((t) => t.id === form.value.targetActivityId));
const okTargets = computed(() => targets.value.filter((t) => !t.problems.length));
const badTargets = computed(() => targets.value.filter((t) => t.problems.length));

async function save() {
  if (!batch.value || !target.value) return;
  if (!confirm(`نقل ${sar(form.value.amount)} من «${projects.value.find((p) => p.id === sourceProject.value)?.name}» إلى «${target.value.name}» لنفس الداعم ${batch.value.donorName}؟`)) return;
  busy.value = true;
  try {
    await api('/projects-ops/transfers', { method: 'POST', json: { sourceBatchId: batchId.value, targetActivityId: form.value.targetActivityId, amount: Number(form.value.amount), reason: form.value.reason } });
    toast.success('تمت المناقلة بنفس اشتراطات الداعم');
    const id = sourceProject.value;
    sourceProject.value = '';
    await load();
    sourceProject.value = id;
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const total = computed(() => history.value.reduce((t, r) => t + r.amount, 0));
</script>

<template>
  <div>
    <section class="pm-hero">
      <div>
        <p class="pm-kicker">المناقلات</p>
        <h1>نقل صافي رصيد دفعة إلى مشروع آخر</h1>
        <p class="pm-sub">تُنقل المبالغ لنفس الداعم فقط، وتنتقل معها اشتراطاته كما هي. لا يُنقل إلا صافي الرصيد غير المحجوز وغير المخصوم.</p>
      </div>
      <div class="count"><strong>{{ history.length }}</strong><span>مناقلة · {{ sar(total) }}</span></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <form v-if="canMove" class="card pm-panel steps" @submit.prevent="save">
      <h2>مناقلة جديدة</h2>
      <div class="step">
        <b>١</b>
        <div class="field"><label>المشروع المنقول منه</label>
          <select v-model="sourceProject" class="input"><option value="">اختر المشروع</option><option v-for="p in projects.filter((x) => x.available > 0)" :key="p.id" :value="p.id">{{ p.code }} · {{ p.name }} (متاح {{ sar(p.available) }})</option></select>
        </div>
      </div>
      <div v-if="sourceProject" class="step">
        <b>٢</b>
        <div class="field"><label>الدفعة (الداعم)</label>
          <div class="opts">
            <label v-for="b in batches" :key="b.id" class="opt" :class="{ on: batchId === b.id }">
              <input v-model="batchId" type="radio" :value="b.id" />
              <span><strong>دفعة {{ b.batchNo }} · {{ b.donorName }}</strong><small class="pm-muted">صافي {{ sar(b.net) }}<template v-if="b.isZakat"> · زكاة</template><template v-if="b.conditions.endDate"> · تنتهي {{ fmtDate(b.conditions.endDate) }}</template></small></span>
            </label>
            <p v-if="!batches.length" class="pm-muted">لا توجد دفعات لها صافي رصيد على هذا المشروع</p>
          </div>
        </div>
      </div>
      <div v-if="batch" class="step">
        <b>٣</b>
        <div style="flex: 1">
          <div class="field"><label>المشروع المنقول إليه</label>
            <select v-model="form.targetActivityId" class="input" required>
              <option value="" disabled>اختر</option>
              <option v-for="t in okTargets" :key="t.id" :value="t.id">{{ t.name }} · {{ label('funding', t.fundingType) }}{{ t.zakatEligible ? ' · زكاة' : '' }}</option>
            </select>
          </div>
          <details v-if="badTargets.length" class="pm-muted"><summary>{{ badTargets.length }} مشروع لا يقبل هذه الدفعة</summary>
            <ul class="pm-viol"><li v-for="t in badTargets" :key="t.id">{{ t.name }}: {{ t.problems.join('، ') }}</li></ul>
          </details>
          <div class="pm-grid2" style="margin-top: 10px">
            <div class="field"><label>المبلغ *</label><input v-model.number="form.amount" class="input" type="number" min="0.01" step="0.01" :max="batch.net" required /><small class="pm-muted">الحد الأعلى {{ sar(batch.net) }}</small></div>
            <div class="field"><label>سبب المناقلة *</label><input v-model="form.reason" class="input" required minlength="3" /></div>
          </div>
          <button class="btn btn-primary" :disabled="busy || !form.targetActivityId">تنفيذ المناقلة</button>
        </div>
      </div>
    </form>

    <div class="card table-wrap" style="margin-top: 16px">
      <table class="table">
        <thead><tr><th>الرقم</th><th>التاريخ</th><th>الداعم</th><th>من</th><th>إلى</th><th>المبلغ</th><th>السبب</th></tr></thead>
        <tbody>
          <tr v-for="t in history" :key="t.id">
            <td>#{{ t.transferNo }}</td>
            <td>{{ fmtDate(t.createdAt) }}<span class="pm-muted">{{ t.createdByName }}</span></td>
            <td><RouterLink v-if="t.donorId" :to="links.donor(t.donorId)" class="pm-link">{{ t.donorName }}</RouterLink></td>
            <td><RouterLink v-if="t.sourceActivityId" :to="links.project(t.sourceActivityId)" class="pm-link">{{ t.sourceName }}</RouterLink><RouterLink :to="links.batch(t.sourceBatchId)" class="pm-muted">دفعة {{ t.sourceBatchNo }}</RouterLink></td>
            <td><RouterLink :to="links.project(t.targetActivityId)" class="pm-link">{{ t.targetName }}</RouterLink><RouterLink :to="links.batch(t.targetBatchId)" class="pm-muted">دفعة {{ t.targetBatchNo }}</RouterLink></td>
            <td class="pm-money">{{ sar(t.amount) }}</td>
            <td>{{ t.reason }}</td>
          </tr>
          <tr v-if="!history.length"><td colspan="7" class="pm-empty">لا توجد مناقلات بعد</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.count { text-align: center; } .count strong { display: block; font-size: 2.2rem; line-height: 1; } .count span { color: rgba(255,255,255,.7); }
.steps { display: grid; gap: 14px; }
.step { display: flex; gap: 12px; align-items: flex-start; animation: pm-rise .4s var(--ease) both; }
.step > b { flex: none; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: var(--primary-soft); color: var(--primary); }
.step .field { flex: 1; margin: 0; }
.opts { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px; }
.opt { display: flex; gap: 8px; align-items: flex-start; padding: 10px; border: 1px solid var(--border); border-radius: 12px; cursor: pointer; }
.opt span { display: flex; flex-direction: column; }
.opt.on { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
</style>
