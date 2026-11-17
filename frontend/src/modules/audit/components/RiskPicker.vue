<script setup lang="ts">
import { computed, ref } from 'vue';
import { LEVEL_COLOR, LEVEL_LABEL, toRef, type Lookups, type RiskRef } from '../lib';

/** اختيار مخاطر من سجل المخاطر (وحدة المخاطر)، مع إبقاء الروابط القديمة التي لم تعد في السجل */
const props = defineProps<{ lookups: Lookups | null; modelValue: RiskRef[]; unitId?: string | null }>();
const emit = defineEmits<{ 'update:modelValue': [RiskRef[]] }>();
const q = ref('');
const onlyUnit = ref(false);
const list = computed(() => {
  const all = props.lookups?.risks ?? [];
  return all.filter((r) => (!q.value || `${r.code} ${r.title}`.includes(q.value)) && (!onlyUnit.value || !props.unitId || r.unitId === props.unitId));
});
const stale = computed(() => props.modelValue.filter((m) => !(props.lookups?.risks ?? []).some((r) => r.id === m.id)));
const checked = (id: string) => props.modelValue.some((m) => m.id === id);
function toggle(id: string) {
  const r = props.lookups?.risks.find((x) => x.id === id);
  if (checked(id)) emit('update:modelValue', props.modelValue.filter((m) => m.id !== id));
  else if (r) emit('update:modelValue', [...props.modelValue, toRef(r)]);
}
</script>

<template>
  <div>
    <p v-if="!lookups?.registerAvailable" class="pm-muted">سجل المخاطر غير مفعّل بعد في النظام. عند تفعيله تظهر المخاطر هنا للربط، ويُحدَّث مستواها تلقائيًا.</p>
    <template v-else>
      <div style="display: flex; gap: 8px; margin-bottom: 6px; align-items: center">
        <input v-model="q" class="input" placeholder="ابحث بالرمز أو العنوان" />
        <label v-if="unitId" class="check" style="white-space: nowrap"><input v-model="onlyUnit" type="checkbox" /> مخاطر الوحدة فقط</label>
      </div>
      <div class="au-pick">
        <label v-for="r in list" :key="r.id">
          <input type="checkbox" :checked="checked(r.id)" @change="toggle(r.id)" />
          <span class="au-code">{{ r.code }}</span>
          <span style="flex: 1">{{ r.title }}<span v-if="r.unitName" class="pm-muted"> · {{ r.unitName }}</span></span>
          <span class="au-lvl" :style="{ '--c': LEVEL_COLOR[r.level] ?? '#94a3b8' }">{{ r.levelLabel ?? LEVEL_LABEL[r.level] ?? r.level }} {{ r.score ?? '' }}</span>
        </label>
        <p v-if="!list.length" class="pm-empty">لا توجد مخاطر مطابقة</p>
      </div>
    </template>
    <div v-if="stale.length" style="margin-top: 6px">
      <span class="pm-muted">روابط محفوظة سابقًا:</span>
      <span v-for="s in stale" :key="s.id" class="au-risk" :style="{ '--c': LEVEL_COLOR[s.level] ?? '#94a3b8' }">
        <span class="au-code">{{ s.code }}</span>{{ s.title }}
        <button type="button" class="btn btn-sm" style="padding: 0 6px" @click="emit('update:modelValue', modelValue.filter((m) => m.id !== s.id))">✕</button>
      </span>
    </div>
  </div>
</template>
