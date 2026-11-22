<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../../api';
import { useSession } from '../../../../stores/session';
import { useToast } from '../../../../stores/toast';
import { AF, useLookups } from '../../assets';
import { P, todayStr } from '../../lib';
import '../../../../shared/module.css';
import '../../acc.css';
import './assets.css';

interface St { id: string; stocktakeNo: number; title: string; date: string; scope: { label: string }; status: 'open' | 'closed'; createdByName: string; closedAt: string | null;
  counts: { total: number; found: number; missing: number; pending: number; moved: number; extras: number } }
const session = useSession();
const toast = useToast();
const router = useRouter();
const { lookups, load: loadLookups } = useLookups();
const rows = ref<St[]>([]);
const show = ref(false);
const form = reactive({ title: '', date: todayStr(), groupIds: [] as string[], location: '' });
async function load() {
  rows.value = await api<St[]>(`${AF}/stocktakes`).catch(() => []);
}
onMounted(() => { load(); loadLookups().catch(() => {}); });
async function create() {
  try {
    const s = await api<St>(`${AF}/stocktakes`, { method: 'POST', json: { ...form, location: form.location || null } });
    router.push(`/accounting/assets/stocktakes/${s.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const toggle = (id: string) => { const i = form.groupIds.indexOf(id); if (i >= 0) form.groupIds.splice(i, 1); else form.groupIds.push(id); };
</script>

<template>
  <div>
    <section class="pm-hero ac-hero fa-hero">
      <div>
        <p class="pm-kicker">الأصول الثابتة</p>
        <h1>الجرد الدوري للأصول</h1>
        <p class="pm-sub">افتح جردًا، ثم امسح ملصق QR لكل أصل بكاميرا الجوال أو اكتب رمزه. عند الإغلاق يظهر تقرير الفروقات: المفقود، والموجود في غير موقعه، والملصقات غير المسجلة في الجرد.</p>
      </div>
      <div class="pm-actions"><button v-if="session.can(P.assetsCustody)" class="btn ac-glow" @click="show = true">جرد جديد</button></div>
    </section>
    <section class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>رقم</th><th>الجرد</th><th>التاريخ</th><th>النطاق</th><th>التقدم</th><th>موجود</th><th>مفقود</th><th>في غير موقعه</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="s in rows" :key="s.id" class="ac-row-click" @click="router.push(`/accounting/assets/stocktakes/${s.id}`)">
              <td class="ac-code">{{ s.stocktakeNo }}</td><td><b>{{ s.title }}</b><span class="pm-muted">{{ s.createdByName }}</span></td><td>{{ s.date }}</td><td>{{ s.scope.label }}</td>
              <td><div class="prog"><i :style="{ width: ((s.counts.total - s.counts.pending) / Math.max(1, s.counts.total)) * 100 + '%' }" /></div><small class="pm-muted">{{ s.counts.total - s.counts.pending }} من {{ s.counts.total }}</small></td>
              <td>{{ s.counts.found }}</td><td :class="{ bad: s.counts.missing }">{{ s.counts.missing }}</td><td>{{ s.counts.moved }}</td>
              <td><span class="pm-pill" :style="{ '--c': s.status === 'open' ? '#6366f1' : '#10b981' }">{{ s.status === 'open' ? 'مفتوح' : 'مغلق' }}</span></td>
            </tr>
            <tr v-if="!rows.length"><td colspan="9" class="pm-empty">لا يوجد جرد بعد</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="show" class="modal-backdrop" @click.self="show = false">
      <form class="card modal" @submit.prevent="create">
        <h2>جرد جديد</h2>
        <div class="field-row">
          <label class="field"><span>العنوان</span><input v-model="form.title" class="input" placeholder="جرد نهاية السنة" /></label>
          <label class="field"><span>التاريخ</span><input v-model="form.date" type="date" class="input" /></label>
        </div>
        <div class="field"><span>المجموعات (اتركها فارغة لكل الأصول)</span>
          <div class="fa-row"><button v-for="g in lookups?.groups ?? []" :key="g.id" type="button" :class="['fa-chip', { on: form.groupIds.includes(g.id) }]" @click="toggle(g.id)">{{ g.name }}</button></div>
        </div>
        <label class="field"><span>الموقع (اختياري)</span><input v-model="form.location" class="input" placeholder="مثل: المقر - الدور الثاني" /></label>
        <div class="modal-actions"><button class="btn btn-primary">فتح الجرد</button><button type="button" class="btn" @click="show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped>
td .pm-muted { display: block; }
.prog { height: 6px; border-radius: 99px; background: var(--surface-2); overflow: hidden; min-width: 90px; }
.prog i { display: block; height: 100%; background: linear-gradient(90deg, #34d399, #0ea5e9); }
.bad { color: #b91c1c; font-weight: 700; }
</style>
