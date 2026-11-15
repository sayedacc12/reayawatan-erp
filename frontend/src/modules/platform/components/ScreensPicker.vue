<script setup lang="ts">
import { computed } from 'vue';
import type { ScreenModule } from '../labels';

/** اختيار الشاشات المسموحة لجمعية، مجمعة حسب الوحدة */
export interface Access { allScreens: boolean; screens: string[]; modules: string[] }
const props = defineProps<{ catalog: ScreenModule[]; modelValue: Access; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [Access] }>();

const v = computed(() => props.modelValue);
const set = (patch: Partial<Access>) => emit('update:modelValue', { ...v.value, ...patch });

const moduleOn = (m: ScreenModule) => !m.optional || v.value.modules.includes(m.code);
const selectedIn = (m: ScreenModule) => m.screens.filter((s) => v.value.allScreens || v.value.screens.includes(s.path)).length;

function toggleScreen(path: string, on: boolean) {
  // أول تخصيص: نبدأ من كل الشاشات المتاحة ثم نشيل المطلوب
  const base = v.value.allScreens ? allPaths.value : v.value.screens;
  set({ allScreens: false, screens: on ? [...new Set([...base, path])] : base.filter((p) => p !== path) });
}
function toggleModule(m: ScreenModule, on: boolean) {
  const base = v.value.allScreens ? allPaths.value : v.value.screens;
  const paths = m.screens.map((s) => s.path);
  set({ allScreens: false, screens: on ? [...new Set([...base, ...paths])] : base.filter((p) => !paths.includes(p)) });
}
function toggleOptional(m: ScreenModule, on: boolean) {
  set({ modules: on ? [...v.value.modules, m.code] : v.value.modules.filter((c) => c !== m.code) });
}
const allPaths = computed(() => props.catalog.filter((m) => !m.locked).flatMap((m) => m.screens.map((s) => s.path)));
const total = computed(() => (v.value.allScreens ? allPaths.value.length : v.value.screens.length));
</script>

<template>
  <div class="picker" :class="{ disabled }">
    <div class="picker-head">
      <label class="check all">
        <input type="checkbox" :checked="v.allScreens" :disabled="disabled" @change="set({ allScreens: ($event.target as HTMLInputElement).checked, screens: [] })" />
        <span><strong>كل الشاشات</strong> <span class="muted">(تشمل أي شاشة تُضاف للمنصة مستقبلًا)</span></span>
      </label>
      <span class="count">{{ total }} من {{ allPaths.length }} شاشة</span>
    </div>
    <div class="mods">
      <section v-for="(m, i) in catalog" :key="m.code" class="mod" :class="{ locked: m.locked, off: !moduleOn(m) }" :style="{ '--i': i }">
        <header>
          <label v-if="!m.locked" class="check">
            <input type="checkbox" :disabled="disabled || !moduleOn(m)" :checked="selectedIn(m) === m.screens.length"
              :indeterminate.prop="selectedIn(m) > 0 && selectedIn(m) < m.screens.length"
              @change="toggleModule(m, ($event.target as HTMLInputElement).checked)" />
            <strong>{{ m.name }}</strong>
          </label>
          <strong v-else>{{ m.name }}</strong>
          <span v-if="m.locked" class="tone tone-muted">متاحة دائمًا</span>
          <label v-else-if="m.optional" class="check opt">
            <input type="checkbox" :disabled="disabled" :checked="moduleOn(m)" @change="toggleOptional(m, ($event.target as HTMLInputElement).checked)" />
            خدمة إضافية مفعّلة
          </label>
        </header>
        <div class="screens">
          <label v-for="s in m.screens" :key="s.path" class="screen" :class="{ on: m.locked || v.allScreens || v.screens.includes(s.path) }">
            <input type="checkbox" :disabled="disabled || m.locked || !moduleOn(m)" :checked="m.locked || v.allScreens || v.screens.includes(s.path)"
              @change="toggleScreen(s.path, ($event.target as HTMLInputElement).checked)" />
            <span>{{ s.label }}</span>
          </label>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.picker-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.count { font-size: .85rem; color: var(--primary); background: var(--primary-soft); padding: 2px 12px; border-radius: 999px; font-weight: 600; }
.mods { display: grid; gap: 10px; }
.mod { border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; background: var(--surface); animation: p-rise .35s var(--ease) both; animation-delay: calc(var(--i) * 50ms); }
.mod.locked { background: var(--surface-2); }
.mod.off .screens { opacity: .45; }
.mod header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.opt { font-size: .85rem; color: var(--muted); }
.screens { display: flex; flex-wrap: wrap; gap: 8px; }
.screen { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border); cursor: pointer; font-size: .9rem; transition: all .2s var(--ease); }
.screen input { accent-color: var(--primary); }
.screen.on { border-color: var(--primary); background: var(--primary-soft); color: var(--primary); }
.disabled { pointer-events: none; opacity: .7; }
</style>
