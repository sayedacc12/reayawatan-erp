<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { STATUS_COLOR, WP, copy, errMsg, fmtDate, sar, waLink } from '../lib';
import '../website.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const toast = useToast();
const rows = ref<any[]>([]);
async function load() {
  try {
    rows.value = await api('/website/subscriptions');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
onMounted(load);
const active = computed(() => rows.value.filter((r) => r.status === 'active'));
const monthly = computed(() => active.value.reduce((a, r) => a + r.amount, 0));
const due = computed(() => rows.value.filter((r) => r.payLink));
async function setStatus(r: any, status: string) {
  const label = { active: 'تفعيل', paused: 'إيقاف مؤقت', cancelled: 'إلغاء' }[status];
  if (!confirm(`${label} التبرع الشهري للمتبرع ${r.donorName || ''}؟`)) return;
  try {
    await api(`/website/subscriptions/${r.id}/status`, { method: 'POST', json: { status } });
    toast.success('تم تحديث التبرع الشهري');
    load();
  } catch (e) {
    toast.error(errMsg(e));
  }
}
async function copyLink(r: any) {
  if (await copy(r.payLink)) toast.success('نُسخ رابط الدفع');
}
const waText = (r: any) => `السلام عليكم ${r.donorName || ''}، حان موعد تبرعك الشهري (${r.amount} ريال) لـ«${r.programName}». رابط الدفع: ${r.payLink} جزاكم الله خيرًا.`;
</script>

<template>
  <div>
    <div class="page-head"><div><h1>التبرعات الشهرية</h1><p class="muted">عند حلول موعد التبرع يُنشأ رابط دفع جديد، وترسله للمتبرع بضغطة عبر واتساب.</p></div></div>
    <div class="ws-kpis">
      <div class="ws-kpi" style="--c: #10b981"><span class="v">{{ active.length }}</span><span class="l">متبرع شهري نشط</span></div>
      <div class="ws-kpi" style="--c: #0ea5e9"><span class="v">{{ sar(monthly) }}</span><span class="l">المتوقع شهريًا</span></div>
      <div class="ws-kpi" style="--c: #f59e0b"><span class="v">{{ due.length }}</span><span class="l">رابط دفع مستحق الإرسال</span></div>
    </div>
    <div class="ws-note info">التبرع الشهري لا يُخصم تلقائيًا من البطاقة في هذه النسخة، بل يصل المتبرع رابط دفع كل شهر.</div>
    <div class="card">
      <div v-if="!rows.length" class="ws-empty"><strong>لا توجد تبرعات شهرية</strong>تظهر هنا عندما يختار المتبرع «تبرع شهري» في المتجر</div>
      <div v-else class="table-wrap"><table class="table">
        <thead><tr><th>المتبرع</th><th>الوجهة</th><th>المبلغ</th><th>الحالة</th><th>الدفعات</th><th>الموعد القادم</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td>{{ r.donorName || 'فاعل خير' }}<div class="muted ws-code" style="font-size: .78rem">{{ r.donorPhone }}</div></td>
            <td>{{ r.programName }}</td>
            <td><strong>{{ sar(r.amount) }}</strong></td>
            <td><span class="ws-pill" :style="{ '--c': STATUS_COLOR[r.status] }">{{ r.statusLabel }}</span></td>
            <td>{{ r.charges }}</td>
            <td>{{ fmtDate(r.nextDue) }}</td>
            <td>
              <div class="ws-row" style="margin: 0; flex-wrap: nowrap">
                <template v-if="r.payLink">
                  <a :href="waLink(r.donorPhone, waText(r))" target="_blank" rel="noopener" class="btn btn-sm btn-primary">واتساب</a>
                  <button class="btn btn-sm" @click="copyLink(r)">نسخ الرابط</button>
                </template>
                <template v-if="session.can(WP.settings)">
                  <button v-if="r.status === 'active'" class="btn btn-sm" @click="setStatus(r, 'paused')">إيقاف</button>
                  <button v-if="r.status === 'paused'" class="btn btn-sm" @click="setStatus(r, 'active')">تفعيل</button>
                  <button v-if="r.status !== 'cancelled'" class="btn btn-sm btn-danger" @click="setStatus(r, 'cancelled')">إلغاء</button>
                </template>
              </div>
            </td>
          </tr>
        </tbody>
      </table></div>
    </div>
  </div>
</template>
