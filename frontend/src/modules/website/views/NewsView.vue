<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { STATUS_COLOR, WP, errMsg, fmtDate, num } from '../lib';
import '../website.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const toast = useToast();
const rows = ref<any[]>([]);
const tab = ref('all');
const q = ref('');
const TABS: [string, string][] = [['all', 'الكل'], ['published', 'منشور'], ['pending', 'بانتظار الاعتماد'], ['returned', 'معاد للتعديل'], ['draft', 'مسودة']];
onMounted(async () => {
  try {
    rows.value = await api('/website/news');
  } catch (e) {
    toast.error(errMsg(e));
  }
});
const count = (s: string) => (s === 'all' ? rows.value.length : rows.value.filter((r) => r.status === s).length);
const shown = computed(() => rows.value.filter((r) => (tab.value === 'all' || r.status === tab.value) && (!q.value || r.title.includes(q.value.trim()))));
const canWrite = computed(() => session.can(WP.edit) || session.can(WP.publish));
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>الأخبار</h1><p class="muted">يكتب المحرر الخبر ويرسله للاعتماد، ولا يظهر في الموقع إلا بعد اعتماده.</p></div>
      <RouterLink v-if="canWrite" to="/website/news/new" class="btn btn-primary">+ خبر جديد</RouterLink>
    </div>
    <div class="ws-tabs">
      <button v-for="[k, l] in TABS" :key="k" :class="['ws-tab', { on: tab === k }]" @click="tab = k">{{ l }}<span :class="['count', { warn: k === 'pending' && count(k) }]">{{ count(k) }}</span></button>
    </div>
    <div class="ws-filters"><input v-model="q" class="input grow" placeholder="ابحث في العناوين..." /></div>
    <div class="card">
      <div v-if="!shown.length" class="ws-empty"><strong>لا توجد أخبار هنا</strong>أضف خبرًا جديدًا ليظهر في الموقع بعد اعتماده</div>
      <div v-else class="table-wrap"><table class="table">
        <thead><tr><th></th><th>الخبر</th><th>التاريخ</th><th>الحالة</th><th>المشاهدات</th><th>الكاتب</th></tr></thead>
        <tbody>
          <tr v-for="r in shown" :key="r.id" class="ws-click" @click="$router.push(`/website/news/${r.id}`)">
            <td style="width: 66px"><img v-if="r.imageUrl" :src="r.imageUrl" class="ws-thumb" alt="" /><span v-else class="ws-thumb" /></td>
            <td><strong>{{ r.title }}</strong><span v-if="r.ticker" class="ws-pill" style="--c: #8b5cf6; margin-inline-start: 6px">شريط الأخبار</span><div class="muted" style="font-size: .84rem">{{ r.summary }}</div></td>
            <td>{{ fmtDate(r.newsDate) }}</td>
            <td><span class="ws-pill" :style="{ '--c': STATUS_COLOR[r.status] }">{{ r.statusLabel }}</span></td>
            <td>{{ num(r.views) }}</td>
            <td class="muted">{{ r.createdByName }}</td>
          </tr>
        </tbody>
      </table></div>
    </div>
  </div>
</template>
