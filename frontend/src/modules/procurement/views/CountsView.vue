<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { COUNT_COLOR, PR, fmtDate, groupTree, indent, lookups, sar, stockLookups, today } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const router = useRouter();
const toast = useToast();
const session = useSession();
const lk = ref<any>(null);
const slk = ref<any>(null);
const rows = ref<any[]>([]);
const loading = ref(true);
const f = ref({ status: '', warehouse: '' });
const open = ref(false);
const busy = ref(false);
const form = ref<any>({ kind: 'periodic', warehouseId: '', groupId: '', date: today(), committeeIds: [] as string[], notes: '' });
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/procurement/counts?${q}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  [lk.value, slk.value] = await Promise.all([lookups().catch(() => null), stockLookups().catch(() => null)]);
  await load();
});
watch(() => [f.value.status, f.value.warehouse], load);
async function create() {
  busy.value = true;
  const x = form.value;
  try {
    const c = await api<any>('/procurement/counts', {
      method: 'POST', json: { kind: x.kind, warehouseId: x.warehouseId, groupId: x.groupId || null, date: x.date, committeeIds: x.committeeIds, notes: x.notes || null },
    });
    toast.success(`فُتح محضر الجرد ${c.code} بأرصدة النظام الحالية`);
    router.push(`/procurement/counts/${c.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>الجرد الفعلي</h1><p class="muted">الجرد المستمر يحدّث الأرصدة مع كل حركة، والجرد الفعلي للتحقق منها. تُعتمد الفروقات من مسؤول غير من رفع المحضر، وتصدر بقيد تسوية على حساب فروقات المخزون.</p></div>
      <div v-if="session.can(PR.stockOperate)"><button class="btn btn-primary" @click="open = true">جرد جديد</button></div>
    </div>
    <div class="pc-toolbar">
      <select v-model="f.status" class="input"><option value="">كل الحالات</option><option v-for="(l, k) in slk?.countStatus ?? {}" :key="k" :value="k">{{ l }}</option></select>
      <select v-model="f.warehouse" class="input"><option value="">كل المستودعات</option><option v-for="w in lk?.activeWarehouses ?? []" :key="w.id" :value="w.id">{{ w.code }} · {{ w.name }}</option></select>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>النوع</th><th>المستودع</th><th>التاريخ</th><th>المعدود</th><th>العجز</th><th>الزيادة</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="pc-row" @click="router.push(`/procurement/counts/${r.id}`)">
            <td class="pc-code">{{ r.code }}</td>
            <td>{{ r.kindLabel }}<small v-if="r.groupName" class="pm-muted" style="display: block">{{ r.groupName }}</small></td>
            <td>{{ r.warehouseName }}</td>
            <td style="font-size: .85rem">{{ fmtDate(r.date) }}</td>
            <td class="pc-num">{{ r.counted }} / {{ r.lines }}</td>
            <td class="pc-num" style="color: #b91c1c">{{ r.shortage ? sar(r.shortage) : '—' }}</td>
            <td class="pc-num" style="color: #047857">{{ r.surplus ? sar(r.surplus) : '—' }}</td>
            <td>
              <span class="pm-pill" :style="{ '--c': COUNT_COLOR[r.status] }">{{ r.statusLabel }}</span>
              <span v-if="r.myApproval" class="pc-warn" style="display: flex; margin-top: 2px">بانتظار اعتمادك</span>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="8" class="pc-empty">لا توجد محاضر جرد.</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="open" class="modal-backdrop" @click.self="open = false">
      <form class="card modal" @submit.prevent="create">
        <h2>جرد جديد</h2>
        <p class="pm-muted" style="font-size: .85rem">يأخذ المحضر صورة من أرصدة النظام عند فتحه بالتشغيلة والصلاحية، ثم تُدخل اللجنة الكميات المعدودة.</p>
        <label class="field"><span>النوع</span><select v-model="form.kind" class="input"><option v-for="(l, k) in slk?.countKinds ?? {}" :key="k" :value="k">{{ l }}</option></select></label>
        <label class="field"><span>المستودع</span><select v-model="form.warehouseId" class="input" required><option value="">اختر…</option><option v-for="w in lk?.activeWarehouses ?? []" :key="w.id" :value="w.id">{{ w.code }} · {{ w.name }}</option></select></label>
        <label class="field"><span>مجموعة أصناف (اختياري)</span><select v-model="form.groupId" class="input"><option value="">كل الأصناف</option><option v-for="g in groupTree(lk?.groups ?? [])" :key="g.id" :value="g.id">{{ indent(g.depth) }}{{ g.name }}</option></select></label>
        <label class="field"><span>تاريخ الجرد</span><input v-model="form.date" type="date" class="input" :max="today()" required /></label>
        <label class="field"><span>لجنة الجرد</span>
          <select v-model="form.committeeIds" class="input" multiple size="5"><option v-for="u in lk?.users ?? []" :key="u.id" :value="u.id">{{ u.fullName }}</option></select>
        </label>
        <label class="field"><span>ملاحظات</span><textarea v-model="form.notes" class="input" rows="2" /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">فتح المحضر</button><button type="button" class="btn" @click="open = false">رجوع</button></div>
      </form>
    </div>
  </div>
</template>
