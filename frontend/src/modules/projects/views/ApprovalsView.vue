<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { color, fmtDate, label, links, sar } from '../labels';
import type { TreeNode } from '../types';
import '../projects.css';

type Item = TreeNode & { program: string | null; axis: string | null; submittedAt?: string | null };
const toast = useToast();
const items = ref<Item[]>([]);
const loading = ref(true);
const error = ref('');
const deciding = ref<{ item: Item; decision: 'approve' | 'reject' | 'return' } | null>(null);
const note = ref('');

async function load() {
  loading.value = true;
  try {
    items.value = await api<Item[]>('/projects/approvals/inbox');
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
const titles = { approve: 'موافقة', reject: 'رفض المشروع', return: 'طلب تعديل' };
</script>

<template>
  <div>
    <section class="pm-hero">
      <div><p class="pm-kicker">اعتماد المشاريع</p><h1>مشاريع تنتظر قرارك</h1><p class="pm-sub">الموافقة تنقل المشروع للمرحلة التالية، والرفض يلغيه مع ذكر السبب، وطلب التعديل يعيده للمرحلة السابقة.</p></div>
      <div class="count"><strong>{{ items.length }}</strong><span>مشروع</span></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
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
          <button class="btn btn-primary btn-sm" @click="open(p, 'approve')">✓ موافقة</button>
          <button class="btn btn-sm" @click="open(p, 'return')">↩ طلب تعديل</button>
          <button class="btn btn-sm btn-danger" @click="open(p, 'reject')">✕ رفض</button>
        </div>
      </article>
    </div>

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
