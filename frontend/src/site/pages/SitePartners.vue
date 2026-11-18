<script setup lang="ts">
import { computed } from 'vue';
import SiteIcon from '../SiteIcon.vue';
import PageHead from '../parts/PageHead.vue';
import { useSite, vReveal } from '../site';

/* eslint-disable @typescript-eslint/no-explicit-any */
const site = useSite();
const groups = computed(() => {
  const m = new Map<string, any[]>();
  for (const p of site.data.value.partners as any[]) {
    const k = p.kind || 'شركاؤنا';
    m.set(k, [...(m.get(k) ?? []), p]);
  }
  return [...m.entries()];
});
</script>

<template>
  <div>
    <PageHead title="شركاء النجاح" text="نعتز بشراكاتنا مع الجهات الحكومية والخاصة وغير الربحية التي تصنع معنا الأثر." />
    <section class="sx-sec">
      <div class="sx-wrap">
        <div v-if="!groups.length" class="sx-empty">لا يوجد شركاء معروضون بعد</div>
        <div v-for="[k, list] in groups" :key="k" class="pt-group">
          <h2 class="pt-h">{{ k }}</h2>
          <div class="sx-grid g4">
            <component :is="p.url ? 'a' : 'div'" v-for="p in list" :key="p.name" v-reveal :href="p.url || undefined" target="_blank" rel="noopener" class="sx-card pt-card">
              <div class="pt-logo"><img v-if="p.logoUrl" :src="p.logoUrl" :alt="p.name" /><SiteIcon v-else name="handshake" :size="36" /></div>
              <strong>{{ p.name }}</strong>
              <small v-if="p.url">زيارة الموقع ↗</small>
            </component>
          </div>
        </div>
        <div v-if="site.data.value.sections.contact" class="pt-cta sx-card"><div><h3>هل ترغب في الشراكة معنا؟</h3><p>نرحب بالشراكات المجتمعية وبرامج المسؤولية الاجتماعية.</p></div><RouterLink :to="{ ...site.to('/contact'), query: { ...site.to().query, topic: 'partnership' } }" class="sx-btn prim">تواصل معنا</RouterLink></div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pt-group { margin-bottom: 40px; }
.pt-h { font-size: 1.35rem; margin-bottom: 16px !important; color: var(--primary); }
.pt-card { padding: 24px; text-align: center; display: grid; gap: 8px; justify-items: center; transition: transform .3s var(--ease2), box-shadow .3s; }
.pt-card:hover { transform: translateY(-5px); box-shadow: 0 16px 32px color-mix(in srgb, var(--primary) 14%, transparent); }
.pt-logo { width: 100%; height: 90px; display: grid; place-items: center; color: var(--primary); }
.pt-logo img { max-height: 80px; max-width: 80%; object-fit: contain; }
.pt-card small { color: var(--primary); }
.pt-cta { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 28px; flex-wrap: wrap; background: color-mix(in srgb, var(--primary) 6%, #fff); }
.pt-cta p { margin: 4px 0 0; color: var(--text-2); }
</style>
