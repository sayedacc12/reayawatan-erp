<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { useToast } from '../../../stores/toast';
import NodeForm from '../components/NodeForm.vue';
import { color, label, links, sar } from '../labels';
import type { Stage, TreeNode } from '../types';
import '../projects.css';

const toast = useToast();
type Tab = 'tree' | 'stages' | 'accounting' | 'permissions';
const tabs = [
  { key: 'tree', label: 'المحاور والمشاريع', hint: 'محور ← برنامج ← مشروع ← خدمة' },
  { key: 'stages', label: 'مراحل الاعتماد', hint: 'موافقة، رفض، طلب تعديل' },
  { key: 'accounting', label: 'التوجيه المحاسبي', hint: 'قيد الصرف من المشاريع' },
  { key: 'permissions', label: 'الصلاحيات', hint: 'مهام كل دور في المشاريع' },
] as const;
const tab = ref<Tab>('tree');

// ---------------- الشجرة ----------------
const rows = ref<TreeNode[]>([]);
const error = ref('');
const search = ref('');
async function load() {
  try {
    rows.value = await api<TreeNode[]>('/projects/tree');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const children = (id: string | null) => rows.value.filter((r) => r.parentId === id);
const axes = computed(() => rows.value.filter((r) => r.level === 'axis'));
const match = (p: TreeNode) => !search.value || p.name.includes(search.value) || (p.code ?? '').includes(search.value.toUpperCase());
const editing = ref<{ node: TreeNode | null; level: TreeNode['level']; parentId: string | null } | null>(null);
async function saved() {
  editing.value = null;
  await load();
}
async function remove(n: TreeNode) {
  if (!confirm(`حذف "${n.name}"؟`)) return;
  try {
    await api(`/projects/nodes/${n.id}`, { method: 'DELETE' });
    toast.success('تم الحذف');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function submit(n: TreeNode) {
  try {
    const r = await api<TreeNode>(`/projects/${n.id}/submit`, { method: 'POST' });
    toast.success(r.approvalStatus === 'approved' ? 'اعتُمد المشروع' : 'أُرسل المشروع للاعتماد');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}

// ---------------- المراحل ----------------
const stages = ref<Stage[]>([]);
const roles = ref<{ id: string; name: string }[]>([]);
const stageError = ref('');
async function loadStages() {
  const [s, r] = await Promise.all([
    api<Stage[]>('/projects/stages'),
    api<{ roles: { id: string; name: string }[] }>('/roles/module/projects').catch(() => ({ roles: [] })),
  ]);
  stages.value = s;
  roles.value = r.roles;
}
function move(i: number, d: number) {
  const s = stages.value;
  [s[i], s[i + d]] = [s[i + d], s[i]];
}
async function saveStages() {
  stageError.value = '';
  try {
    stages.value = await api<Stage[]>('/projects/stages', {
      method: 'PUT', json: { stages: stages.value.map((s) => ({ id: s.id, name: s.name, instructions: s.instructions || null, roleId: s.roleId || null })) },
    });
    toast.success('تم حفظ مراحل الاعتماد');
  } catch (e) {
    stageError.value = (e as Error).message;
  }
}

// ---------------- التوجيه المحاسبي ----------------
const acc = reactive({ expenseDebitCode: '', expenseDebitName: '', paymentCreditCode: '', paymentCreditName: '' });
async function loadAcc() {
  Object.assign(acc, await api('/projects-ops/settings/accounting'));
}
async function saveAcc() {
  try {
    await api('/projects-ops/settings/accounting', { method: 'PUT', json: { ...acc } });
    toast.success('تم حفظ التوجيه المحاسبي');
  } catch (e) {
    toast.error((e as Error).message);
  }
}

onMounted(() => { load(); loadStages().catch(() => {}); loadAcc().catch(() => {}); });
</script>

<template>
  <div>
    <div class="page-head"><div><h1>إعدادات إدارة المشاريع</h1><p class="muted">عرّف المحاور والبرامج والمشاريع وخدماتها، ومراحل اعتماد المشاريع</p></div></div>
    <nav class="stabs">
      <button v-for="(t, i) in tabs" :key="t.key" :class="['stab', { on: tab === t.key }]" :style="{ '--i': i }" @click="tab = t.key">
        <span class="n">{{ i + 1 }}</span><span><b>{{ t.label }}</b><small>{{ t.hint }}</small></span>
      </button>
    </nav>

    <Transition name="page" mode="out-in">
      <section v-if="tab === 'tree'" key="t">
        <div class="pm-filters">
          <input v-model="search" class="input" placeholder="ابحث باسم المشروع أو رقمه" />
          <span class="grow" />
          <button class="btn btn-primary btn-sm" @click="editing = { node: null, level: 'axis', parentId: null }">+ محور جديد</button>
        </div>
        <div v-if="error" class="alert alert-error">{{ error }}</div>
        <p v-if="!axes.length && !error" class="card pm-empty" style="padding: 26px">ابدأ بإضافة أول محور، مثل "الرعاية الصحية".</p>
        <div class="tree">
          <article v-for="(axis, i) in axes" :key="axis.id" class="card axis" :style="{ '--i': i }">
            <header class="node lvl-axis">
              <span class="tag">محور</span><b>{{ axis.name }}</b>
              <span v-if="!axis.isActive" class="pm-tag">موقوف</span>
              <span class="acts">
                <button class="btn btn-sm" @click="editing = { node: null, level: 'program', parentId: axis.id }">+ برنامج</button>
                <button class="icon" title="تعديل" @click="editing = { node: axis, level: 'axis', parentId: null }">✎</button>
                <button class="icon danger" title="حذف" @click="remove(axis)">✕</button>
              </span>
            </header>
            <div v-for="program in children(axis.id)" :key="program.id" class="branch">
              <div class="node lvl-program">
                <span class="tag">برنامج</span><b>{{ program.name }}</b>
                <span v-if="!program.isActive" class="pm-tag">موقوف</span>
                <span class="acts">
                  <button class="btn btn-sm" @click="editing = { node: null, level: 'project', parentId: program.id }">+ مشروع</button>
                  <button class="icon" title="تعديل" @click="editing = { node: program, level: 'program', parentId: null }">✎</button>
                  <button class="icon danger" title="حذف" @click="remove(program)">✕</button>
                </span>
              </div>
              <div v-for="p in children(program.id).filter(match)" :key="p.id" class="node lvl-project">
                <span class="tag">مشروع</span>
                <span class="grow">
                  <RouterLink :to="links.project(p.id)" class="pname">{{ p.name }}</RouterLink>
                  <small class="muted">{{ p.code }} · {{ label('funding', p.fundingType) }} · {{ label('mode', p.spendingMode) }}<template v-if="p.budget"> · {{ sar(p.budget) }}</template></small>
                  <span class="rtags">
                    <span class="pm-pill" :style="{ '--c': color('approval', p.approvalStatus) }">{{ label('approval', p.approvalStatus) }}<template v-if="p.currentStage">: {{ p.currentStage.name }}</template></span>
                    <span v-if="p.zakatEligible" class="pm-tag zakat">ضمن الزكاة</span>
                    <span v-for="s in p.services" :key="s.name" class="pm-tag" :title="s.portalVisible === false ? 'لا تظهر في البوابة' : 'تظهر في البوابة'">🧾 {{ s.name }}<template v-if="s.portalVisible === false"> (داخلية)</template></span>
                  </span>
                </span>
                <span class="acts">
                  <button v-if="['draft', 'returned', 'rejected'].includes(p.approvalStatus ?? '')" class="btn btn-sm btn-primary" @click="submit(p)">إرسال للاعتماد</button>
                  <button class="icon" title="تعديل" @click="editing = { node: p, level: 'project', parentId: null }">✎</button>
                  <button class="icon danger" title="حذف" @click="remove(p)">✕</button>
                </span>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section v-else-if="tab === 'stages'" key="s" class="card pm-panel">
        <h2>مراحل اعتماد المشاريع</h2>
        <p class="muted small">يمر كل مشروع جديد على هذه المراحل بالترتيب. الموافقة تنقله للمرحلة التالية (والأخيرة تعتمده)، والرفض يلغيه مع ذكر السبب، وطلب التعديل يعيده للمرحلة السابقة. بدون مراحل يُعتمد المشروع مباشرة عند إرساله.</p>
        <div v-if="stageError" class="alert alert-error">{{ stageError }}</div>
        <ol class="stages">
          <li v-for="(s, i) in stages" :key="s.id ?? i" class="stage">
            <span class="sn">{{ i + 1 }}</span>
            <div class="sbody">
              <input v-model="s.name" class="input" placeholder="اسم المرحلة، مثل: مراجعة مدير المشاريع" />
              <div class="srow">
                <select v-model="s.roleId" class="input"><option :value="null">أي مستخدم معه صلاحية الاعتماد</option><option v-for="r in roles" :key="r.id" :value="r.id">الدور: {{ r.name }}</option></select>
                <input v-model="s.instructions" class="input" placeholder="تعليمات للمعتمد (اختياري)" />
              </div>
              <small v-if="s.pendingCount" class="muted">{{ s.pendingCount }} مشروع في هذه المرحلة الآن</small>
            </div>
            <div class="sacts">
              <button class="icon" :disabled="i === 0" @click="move(i, -1)">▲</button>
              <button class="icon" :disabled="i === stages.length - 1" @click="move(i, 1)">▼</button>
              <button class="icon danger" @click="stages.splice(i, 1)">✕</button>
            </div>
          </li>
        </ol>
        <div class="modal-actions">
          <button class="btn btn-sm" @click="stages.push({ name: '', roleId: null, instructions: '' })">+ إضافة مرحلة</button>
          <button class="btn btn-primary btn-sm" @click="saveStages">حفظ المراحل</button>
        </div>
      </section>

      <section v-else-if="tab === 'accounting'" key="a" class="card pm-panel">
        <h2>توجيه قيد الصرف</h2>
        <p class="muted small">عند تنفيذ المالية لطلب صرف (سند صرف أو فاتورة) يصدر قيد تلقائي بهذا التوجيه، ويُربط بالمشروع والدفعة.</p>
        <div class="pm-grid2">
          <div class="field"><label>الحساب المدين (رقم)</label><input v-model="acc.expenseDebitCode" class="input" placeholder="5100" dir="ltr" /></div>
          <div class="field"><label>الحساب المدين (اسم)</label><input v-model="acc.expenseDebitName" class="input" placeholder="مصروفات المشاريع" /></div>
          <div class="field"><label>الحساب الدائن (رقم)</label><input v-model="acc.paymentCreditCode" class="input" placeholder="1110" dir="ltr" /></div>
          <div class="field"><label>الحساب الدائن (اسم)</label><input v-model="acc.paymentCreditName" class="input" placeholder="البنك" /></div>
        </div>
        <button class="btn btn-primary btn-sm" @click="saveAcc">حفظ</button>
      </section>

      <ModulePermissionsPane v-else key="p" module="projects" />
    </Transition>

    <NodeForm v-if="editing" :node="editing.node" :level="editing.level" :parent-id="editing.parentId" @close="editing = null" @saved="saved" />
  </div>
</template>

<style scoped>
.stabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
.stab { display: flex; gap: 10px; align-items: center; text-align: right; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 10px 12px; cursor: pointer; font: inherit; color: var(--text); transition: all .2s var(--ease); animation: pm-rise .4s calc(var(--i) * 60ms) var(--ease) both; }
.stab small { display: block; color: var(--muted); font-size: .74rem; }
.stab .n { width: 28px; height: 28px; border-radius: 9px; display: grid; place-items: center; background: var(--surface-2); font-weight: 700; flex-shrink: 0; }
.stab.on { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.stab.on .n { background: var(--grad); color: #fff; }
.grow { flex: 1; min-width: 0; }
.small { font-size: .82rem; }
.tree { display: flex; flex-direction: column; gap: 14px; }
.axis { padding: 6px; animation: pm-rise .45s calc(var(--i) * 70ms) var(--ease) both; }
.node { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; }
.node:hover { background: var(--surface-2); }
.lvl-axis { background: linear-gradient(90deg, var(--primary-soft), transparent); }
.branch { margin-inline-start: 22px; border-inline-start: 2px solid var(--primary-soft); padding-inline-start: 10px; margin-top: 4px; }
.lvl-project { margin-inline-start: 22px; position: relative; align-items: flex-start; }
.lvl-project::before { content: ''; position: absolute; inset-inline-start: -22px; top: 22px; width: 16px; height: 2px; background: var(--primary-soft); }
.tag { font-size: .7rem; font-weight: 700; padding: 2px 8px; border-radius: 6px; color: #fff; flex-shrink: 0; }
.lvl-axis .tag { background: linear-gradient(135deg, #14b8a6, #0f766e); }
.lvl-program .tag { background: linear-gradient(135deg, #818cf8, #4f46e5); }
.lvl-project .tag { background: linear-gradient(135deg, #f5c66b, #d99a2b); color: #3b2a06; margin-top: 2px; }
.pname { font-weight: 700; color: var(--text); }
.pname:hover { color: var(--primary); }
.grow small { display: block; font-size: .76rem; }
.rtags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.acts { margin-inline-start: auto; display: flex; gap: 4px; align-items: center; flex-shrink: 0; }
.icon { background: none; border: 0; cursor: pointer; width: 30px; height: 30px; border-radius: 8px; color: var(--muted); }
.icon:hover:not(:disabled) { background: var(--surface); color: var(--text); }
.icon.danger:hover { background: var(--danger-soft); color: var(--danger); }
.icon:disabled { opacity: .3; cursor: default; }
.stages { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-direction: column; gap: 10px; }
.stage { display: flex; gap: 10px; align-items: flex-start; border: 1px solid var(--border); border-radius: 12px; padding: 10px; animation: pm-rise .35s var(--ease) both; }
.sn { width: 30px; height: 30px; border-radius: 50%; background: var(--grad); color: #fff; display: grid; place-items: center; font-weight: 700; flex-shrink: 0; }
.sbody { flex: 1; display: flex; flex-direction: column; gap: 6px; }
.srow { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.sacts { display: flex; flex-direction: column; }
@media (max-width: 900px) { .stabs { grid-template-columns: 1fr 1fr; } }
@media (max-width: 600px) { .srow { grid-template-columns: 1fr; } .branch, .lvl-project { margin-inline-start: 8px; } .lvl-project { flex-wrap: wrap; } }
</style>
