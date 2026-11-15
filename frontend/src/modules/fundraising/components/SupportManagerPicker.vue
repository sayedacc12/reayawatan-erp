<script setup lang="ts">
/**
 * مدير الدعم: موظف من مستخدمي النظام (قائمة بحث تفاعلي بأسماء موظفي الجمعية)
 * أو من خارج الجمعية (يُكتب اسمه نصًا). يُرسَل للخادم بصيغة supportManager.
 */
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import SearchSelect, { type SelectOption } from './SearchSelect.vue';

export interface ManagerRef { kind: 'employee' | 'external'; userId: string | null; name: string }
const model = defineModel<ManagerRef | null>({ required: true });
const props = defineProps<{ externalNames?: string[] }>();

const users = ref<SelectOption[]>([]);
onMounted(async () => {
  const r = await api<{ id: string; fullName: string }[]>('/fundraising/settings/users').catch(() => []);
  users.value = r.map((u) => ({ id: u.id, label: u.fullName }));
});
const kind = computed(() => model.value?.kind ?? null);
function setKind(k: 'employee' | 'external' | null) {
  model.value = k ? { kind: k, userId: null, name: '' } : null;
}
const userName = computed(() => users.value.find((u) => u.id === model.value?.userId)?.label ?? model.value?.name ?? '');
</script>

<template>
  <div class="smp">
    <div class="seg" role="radiogroup">
      <button type="button" :class="{ on: !kind }" @click="setKind(null)">بدون</button>
      <button type="button" :class="{ on: kind === 'employee' }" @click="setKind('employee')">من موظفي الجمعية</button>
      <button type="button" :class="{ on: kind === 'external' }" @click="setKind('external')">من خارج الجمعية</button>
    </div>
    <SearchSelect
      v-if="model?.kind === 'employee'" :model-value="model.userId" :options="users" :selected-label="userName"
      placeholder="ابحث باسم الموظف" empty-text="لا يوجد موظف بهذا الاسم" required
      @update:model-value="(v) => model && (model = { ...model, userId: v })"
    />
    <template v-else-if="model?.kind === 'external'">
      <input
        :value="model.name" class="input" placeholder="اكتب اسم مدير الدعم أو الجهة" list="smp-external" required minlength="2"
        @input="model = { ...model!, name: ($event.target as HTMLInputElement).value }"
      />
      <datalist id="smp-external"><option v-for="n in props.externalNames ?? []" :key="n" :value="n" /></datalist>
    </template>
  </div>
</template>

<style scoped>
.smp { display: flex; flex-direction: column; gap: 8px; }
.seg { display: inline-flex; padding: 3px; gap: 2px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border); align-self: flex-start; flex-wrap: wrap; }
.seg button { border: 0; background: none; padding: 5px 12px; border-radius: 8px; font: inherit; font-size: .84rem; color: var(--muted); cursor: pointer; transition: all .2s; }
.seg button.on { background: var(--surface); color: var(--primary); font-weight: 600; box-shadow: 0 2px 6px rgba(15, 23, 42, .08); }
</style>
