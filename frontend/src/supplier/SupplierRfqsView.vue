<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { fmtDateTime, sar } from '../modules/procurement/lib';
import { supplierApi } from './supplier';

const route = useRoute();
const slug = computed(() => route.params.slug as string);
const rows = ref<any[] | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    rows.value = await supplierApi('/rfqs');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>

<template>
  <div>
    <div class="page-head"><div><h1>المنافسات</h1><p class="muted">المنافسات وطلبات العروض المدعوون لها. قدّموا عرضكم قبل الموعد، ويبقى مختومًا حتى فتح العروض.</p></div></div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="rows" class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>المنافسة</th><th>آخر موعد</th><th>عرضكم</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td class="pc-code">{{ r.code }}</td>
            <td><RouterLink class="pm-link" :to="`/supplier/${slug}/rfqs/${r.id}`"><b>{{ r.title }}</b></RouterLink><small class="pm-muted" style="display: block">{{ r.methodLabel }}</small></td>
            <td style="font-size: .85rem">{{ fmtDateTime(r.closesAt) }}</td>
            <td><template v-if="r.myQuote"><span class="pc-chip">{{ r.myQuote.statusLabel }}</span> <small class="pc-num">{{ sar(r.myQuote.total) }}</small></template><span v-else-if="r.open" class="pc-warn">لم يُقدَّم بعد</span><span v-else>—</span></td>
            <td>
              <span v-if="r.result" :class="r.result.won ? 'pc-okflag' : 'pc-flag'">{{ r.result.label }}</span>
              <span v-else :class="r.open ? 'pc-okflag' : 'pm-muted'">{{ r.open ? 'مفتوحة للعروض' : r.statusLabel }}</span>
            </td>
          </tr>
          <tr v-if="!rows.length"><td colspan="5" class="pc-empty">لا توجد منافسات مدعوون لها حتى الآن</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
