<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import NodeForm from '../components/NodeForm.vue';
import { color, fmtDate, label, links, sar } from '../labels';
import type { ProjectRow, TreeNode } from '../types';
import '../projects.css';

type Item = TreeNode & { program: string | null; axis: string | null; submittedAt?: string | null };
const toast = useToast();
const session = useSession();
const router = useRouter();
const canApprove = session.can('projects.approval.process');
const canManage = session.can('projects.projects.manage');
const tab = ref<'inbox' | 'docs'>(canApprove ? 'inbox' : 'docs');
const docs = ref<ProjectRow[]>([]);
const programs = ref<TreeNode[]>([]);
const docFilter = ref('');
const shownDocs = computed(() => docs.value.filter((d) => (docFilter.value ? d.approvalStatus === docFilter.value : d.approvalStatus !== 'approved')));
const newFor = ref<string | null>(null);
const picking = ref(false);
const items = ref<Item[]>([]);
const loading = ref(true);
const error = ref('');
const deciding = ref<{ item: Item; decision: 'approve' | 'reject' | 'return' } | null>(null);
const note = ref('');

async function load() {
  loading.value = true;
  try {
    const [inbox, list, tree] = await Promise.all([
      canApprove ? api<Item[]>('/projects/approvals/inbox') : Promise.resolve([] as Item[]),
      api<ProjectRow[]>('/projects/list'),
      api<TreeNode[]>('/projects/tree'),
    ]);
    items.value = inbox; docs.value = list; programs.value = tree.filter((t) => t.level === 'program');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function open(item: Item, decision: 'approve' | 'reject' | 'return') {
  deciding.value = { item, decision };
  note.value = '';
}
async function decide() {
  if (!deciding.value) return;
  try {
    const r = await api<TreeNode>(`/projects/${deciding.value.item.id}/decision`, { method: 'POST', json: { decision: deciding.value.decision, note: note.value || null } });
    toast.success(r.approvalStatus === 'approved' ? 'اعتُمد المشروع نهائيًا' : r.approvalStatus === 'pending' ? `انتقل المشروع إلى: ${r.currentStage?.name}` : 'تم تسجيل القرار');
    deciding.value = null;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function created(n: TreeNode) {
  newFor.value = null;
  router.push(links.document(n.id));
}
const titles = { approve: 'موافقة', reject: 'رفض المشروع', return: 'طلب تعديل' };
</script>

<template>
  <div>
    <section class="pm-hero">
      <div><p class="pm-kicker">اعتماد المشاريع</p><h1>وثائق المشاريع واعتمادها</h1><p class="pm-sub">تُحرَّر وثيقة المشروع (الفكرة والأهداف والمراحل والمؤشرات والموازنة) ثم تُرسل للاعتماد. المشروع المعتمد يصبح متاحًا للتسويق في تنمية الموارد المالية.</p></div>
      <div class="pm-actions">
        <button v-if="canManage" class="btn btn-glow" @click="picking = true">+ وثيقة مشروع جديد</button>
        <div class="count"><strong>{{ items.length }}</strong><span>بانتظار قرارك</span></div>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="pm-tabs">
      <button v-if="canApprove" class="pm-tab" :class="{ on: tab === 'inbox' }" @click="tab = 'inbox'">تنتظر قراري <b>{{ items.length }}</b></button>
      <button class="pm-tab" :class="{ on: tab === 'docs' }" @click="tab = 'docs'">وثائق المشاريع <b>{{ docs.filter((d) => d.approvalStatus !== 'approved').length }}</b></button>
    </div>

    <template v-if="tab === 'docs'">
      <div class="pm-filters">
        <select v-model="docFilter" class="input">
          <option value="">غير المعتمدة</option><option value="draft">مسودة</option><option value="pending">قيد الاعتماد</option>
          <option value="returned">معادة للتعديل</option><option value="rejected">مرفوضة</option><option value="approved">معتمدة</option>
        </select>
      </div>
      <div class="card table-wrap">
        <table class="table">
          <thead><tr><th>المشروع</th><th>المحور ← البرنامج</th><th>النوع</th><th>الحالة</th><th>الميزانية</th><th></th></tr></thead>
          <tbody>
            <tr v-for="d in shownDocs" :key="d.id">
              <td><RouterLink :to="links.document(d.id)" class="pm-link">{{ d.name }}</RouterLink><span class="pm-muted">{{ d.code }}</span></td>
              <td>{{ d.axisName }} ← {{ d.programName }}</td>
              <td><span class="pm-pill" :style="{ '--c': color('funding', d.fundingType) }">{{ label('funding', d.fundingType) }}</span></td>
              <td><span class="pm-pill" :style="{ '--c': color('approval', d.approvalStatus) }">{{ label('approval', d.approvalStatus) }}</span><span v-if="d.currentStage" class="pm-muted">{{ d.currentStage.name }}</span></td>
              <td class="pm-money">{{ d.budget ? sar(d.budget) : '—' }}</td>
              <td><RouterLink :to="links.document(d.id)" class="btn btn-sm">{{ ['draft', 'returned', 'rejected'].includes(d.approvalStatus) && canManage ? 'تحرير الوثيقة' : 'عرض الوثيقة' }}</RouterLink></td>
            </tr>
            <tr v-if="!shownDocs.length"><td colspan="6" class="pm-empty">لا توجد وثائق</td></tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-if="tab === 'inbox'">
    <p v-if="!loading && !items.length && !error" class="card pm-empty" style="padding: 30px">لا توجد مشاريع تنتظر قرارك الآن ✓</p>
    <div class="list">
      <article v-for="(p, i) in items" :key="p.id" class="card item" :style="{ '--i': i }">
        <header>
          <div>
            <small class="pm-muted">{{ p.code }} · {{ p.axis }} ← {{ p.program }}</small>
            <RouterLink :to="links.project(p.id)" class="name">{{ p.name }}</RouterLink>
          </div>
          <span class="pm-pill" :style="{ '--c': color('approval', 'pending') }">{{ p.currentStage?.name }}</span>
        </header>
        <p v-if="p.description" class="desc">{{ p.description }}</p>
        <div class="facts">
          <span class="pm-pill" :style="{ '--c': color('funding', p.fundingType) }">{{ label('funding', p.fundingType) }}</span>
          <span v-if="p.zakatEligible" class="pm-tag zakat">ضمن الزكاة</span>
          <span class="pm-tag">{{ label('mode', p.spendingMode) }}</span>
          <span v-if="p.budget" class="pm-tag">الميزانية {{ sar(p.budget) }}</span>
          <span v-if="p.services.length" class="pm-tag">{{ p.services.length }} خدمة</span>
          <span v-if="p.submittedAt" class="pm-tag">أُرسل {{ fmtDate(p.submittedAt) }}</span>
        </div>
        <div class="acts">
          <RouterLink :to="links.document(p.id)" class="btn btn-sm">قراءة الوثيقة</RouterLink>
          <button class="btn btn-primary btn-sm" @click="open(p, 'approve')">✓ موافقة</button>
          <button class="btn btn-sm" @click="open(p, 'return')">↩ طلب تعديل</button>
          <button class="btn btn-sm btn-danger" @click="open(p, 'reject')">✕ رفض</button>
        </div>
      </article>
    </div>
    </template>

    <div v-if="picking" class="modal-backdrop" @click.self="picking = false">
      <form class="card modal" @submit.prevent="picking = false">
        <h2 style="margin-bottom: 10px">اختر البرنامج الذي يتبعه المشروع</h2>
        <div class="field"><select v-model="newFor" class="input" required><option :value="null" disabled>اختر البرنامج</option><option v-for="g in programs" :key="g.id" :value="g.id">{{ g.name }}</option></select></div>
        <p v-if="!programs.length" class="pm-muted">أضف محورًا وبرنامجًا أولًا من الإعدادات.</p>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="!newFor">متابعة</button><button type="button" class="btn" @click="picking = false; newFor = null">إلغاء</button></div>
      </form>
    </div>
    <NodeForm v-if="newFor && !picking" level="project" :parent-id="newFor" @close="newFor = null" @saved="created" />

    <div v-if="deciding" class="modal-backdrop" @click.self="deciding = null">
      <form class="card modal" @submit.prevent="decide">
        <h2 style="margin-bottom: 10px">{{ titles[deciding.decision] }}: {{ deciding.item.name }}</h2>
        <div class="field">
          <label>{{ deciding.decision === 'approve' ? 'ملاحظة (اختياري)' : deciding.decision === 'reject' ? 'سبب الرفض *' : 'المطلوب تعديله *' }}</label>
          <textarea v-model="note" class="input" rows="3" :required="deciding.decision !== 'approve'" />
        </div>
        <div class="modal-actions"><button class="btn btn-primary">تأكيد</button><button type="button" class="btn" @click="deciding = null">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.count { text-align: center; } .count strong { display: block; font-size: 2.2rem; line-height: 1; } .count span { color: rgba(255,255,255,.7); }
.list { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; }
.item { padding: 16px; display: flex; flex-direction: column; gap: 10px; animation: pm-rise .45s calc(var(--i) * 60ms) var(--ease) both; }
.item header { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
.name { display: block; font-weight: 700; font-size: 1.05rem; color: var(--text); }
.name:hover { color: var(--primary); }
.desc { margin: 0; color: var(--muted); font-size: .9rem; }
.facts { display: flex; flex-wrap: wrap; gap: 6px; }
.acts { display: flex; gap: 6px; margin-top: auto; }
@media (max-width: 500px) { .list { grid-template-columns: 1fr; } }
</style>
