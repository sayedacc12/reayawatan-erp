<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { errMsg, fmtDateTime } from '../lib';
import '../website.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const toast = useToast();
const rows = ref<any[]>([]);
onMounted(async () => {
  try {
    rows.value = await api('/website/activity');
  } catch (e) {
    toast.error(errMsg(e));
  }
});
</script>

<template>
  <div>
    <div class="page-head"><div><h1>سجل نشاط الموقع</h1><p class="muted">كل تعديل على الموقع ومحتواه وإعداداته: من قام به ومتى.</p></div></div>
    <section class="card ws-panel">
      <div v-if="!rows.length" class="ws-empty">لا يوجد نشاط بعد</div>
      <ul class="ws-log"><li v-for="r in rows" :key="r.id"><div><strong>{{ r.action }}</strong><template v-if="r.target"> · {{ r.target }}</template><div class="muted">{{ r.byName }} · {{ fmtDateTime(r.at) }}</div></div></li></ul>
    </section>
  </div>
</template>
