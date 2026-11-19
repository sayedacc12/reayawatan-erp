<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import WarehouseForm from '../components/WarehouseForm.vue';
import { PR, accLabel } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const router = useRouter();
const session = useSession();
const toast = useToast();
const rows = ref<any[]>([]);
const adding = ref(false);
async function load() {
  try {
    rows.value = await api('/procurement/warehouses');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
const KIND_C: Record<string, string> = { main: '#0f766e', sub: '#0369a1', field: '#b45309', temporary: '#7c3aed' };
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>المستودعات ومواقع التخزين</h1><p class="muted">المستودعات الرئيسية والفرعية والميدانية، بأمنائها وحساباتها ومواقعها الداخلية (مناطق وممرات وأرفف وخانات).</p></div>
      <button v-if="session.can(PR.warehouses)" class="btn btn-primary" @click="adding = true">+ مستودع جديد</button>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرمز</th><th>المستودع</th><th>النوع</th><th>يتبع</th><th>الأمناء</th><th>حساب المخزون</th><th>المواقع</th></tr></thead>
        <tbody>
          <tr v-for="w in rows" :key="w.id" :class="['pc-row', { off: !w.isActive }]" @click="router.push(`/procurement/warehouses/${w.id}`)">
            <td class="pc-code">{{ w.code }}</td>
            <td><b>{{ w.name }}</b><span class="pm-muted" style="display: block; font-size: .8rem">{{ [w.city, w.unitName, w.projectName].filter(Boolean).join(' · ') }}</span></td>
            <td><span class="pc-chip" :style="{ '--c': KIND_C[w.kind] }">{{ w.kindLabel }}</span> <span v-if="!w.isActive" class="pc-flag">موقوف</span></td>
            <td>{{ w.parentName ?? '—' }}</td>
            <td style="font-size: .84rem">{{ w.keepers.map((k: any) => k.name).join('، ') || '—' }}</td>
            <td style="font-size: .82rem">{{ accLabel(w.glAccount) }}</td>
            <td class="pc-num">{{ w.locations }}</td>
          </tr>
          <tr v-if="!rows.length"><td colspan="7" class="pc-empty">لا توجد مستودعات بعد</td></tr>
        </tbody>
      </table>
    </div>
    <WarehouseForm v-if="adding" :warehouses="rows" @close="adding = false" @saved="(w) => router.push(`/procurement/warehouses/${w.id}`)" />
  </div>
</template>
