<script setup lang="ts">
import { computed, ref } from 'vue';
import SiteIcon from '../SiteIcon.vue';
import DonateBox from '../parts/DonateBox.vue';
import PageHead from '../parts/PageHead.vue';
import { num, sar, useSite } from '../site';

/* eslint-disable @typescript-eslint/no-explicit-any */
const site = useSite();
const d = computed(() => site.data.value);
const open = computed(() => (d.value.programs as any[]).filter((p) => p.donate?.open));
const sel = ref<any>(d.value.store.general ? null : open.value[0] ?? null);
const pct = (p: any) => (p.donate.goal ? Math.min(100, Math.round((p.donate.raised / p.donate.goal) * 100)) : 0);
</script>

<template>
  <div>
    <PageHead title="تبرع الآن" text="اختر وجهة تبرعك، وادفع بأمان، واحصل على إيصال فوري برمز تحقق." />
    <section class="sx-sec">
      <div v-if="!d.sections.store || !d.store.enabled" class="sx-wrap sx-empty">التبرع الإلكتروني متوقف حاليًا. تواصل مع الجمعية لمعرفة طرق التبرع الأخرى.</div>
      <div v-else class="sx-wrap dn-grid">
        <div>
          <h2 class="dn-h">اختر وجهة التبرع</h2>
          <div class="dn-list">
            <button v-if="d.store.general" :class="['dn-opt', { on: !sel }]" @click="sel = null">
              <span class="dn-ic"><SiteIcon name="heart" :size="24" /></span>
              <div><strong>{{ d.store.generalTitle }}</strong><small>يُصرف حيث الحاجة الأكبر في برامج الجمعية</small></div>
              <i class="dn-radio" />
            </button>
            <button v-for="p in open" :key="p.id" :class="['dn-opt', { on: sel?.id === p.id }]" @click="sel = p">
              <span class="dn-ic" :style="p.imageUrl ? { backgroundImage: `url(${p.imageUrl})` } : {}"><SiteIcon v-if="!p.imageUrl" :name="p.icon" :size="24" /></span>
              <div>
                <strong>{{ p.name }} <span v-if="p.donate.kind === 'waqf'" class="dn-waqf">وقف</span></strong>
                <small>{{ p.tagline || p.summary }}</small>
                <div v-if="p.donate.goal" class="dn-prog"><div class="sx-bar"><i :style="{ width: `${Math.max(3, pct(p))}%` }" /></div><small>{{ pct(p) }}% · {{ sar(p.donate.raised) }}</small></div>
              </div>
              <i class="dn-radio" />
            </button>
          </div>
          <div v-if="d.store.totals?.count" class="dn-trust"><SiteIcon name="shield" :size="20" /> وثق بنا {{ num(d.store.totals.count) }} متبرعًا بإجمالي {{ sar(d.store.totals.raised) }} عبر الموقع.</div>
        </div>
        <aside class="dn-side"><DonateBox :key="sel?.id ?? 'general'" :program="sel ?? undefined" /></aside>
      </div>
    </section>
  </div>
</template>

<style scoped>
.dn-grid { display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: 28px; align-items: start; }
.dn-h { font-size: 1.35rem; margin-bottom: 14px !important; }
.dn-list { display: grid; gap: 10px; }
.dn-opt { display: flex; gap: 14px; align-items: center; text-align: start; padding: 14px; border-radius: 18px; border: 2px solid var(--line); background: var(--paper); font: inherit; color: inherit; cursor: pointer; transition: border-color .2s, box-shadow .2s, transform .2s; }
.dn-opt:hover { transform: translateY(-2px); }
.dn-opt.on { border-color: var(--primary); box-shadow: 0 0 0 5px color-mix(in srgb, var(--primary) 12%, transparent); }
.dn-opt > div { flex: 1; display: grid; gap: 2px; min-width: 0; }
.dn-opt small { color: var(--text-2); font-size: .86rem; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.dn-ic { width: 64px; height: 64px; border-radius: 16px; display: grid; place-items: center; background: var(--grad) center / cover; color: #fff; flex-shrink: 0; }
.dn-waqf { font-size: .72rem; padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 25%, #fff); color: var(--dark); }
.dn-prog { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.dn-prog .sx-bar { flex: 1; height: 6px; }
.dn-prog small { white-space: nowrap; -webkit-line-clamp: 1; }
.dn-radio { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--line); flex-shrink: 0; position: relative; transition: border-color .2s; }
.dn-opt.on .dn-radio { border-color: var(--primary); }
.dn-opt.on .dn-radio::after { content: ''; position: absolute; inset: 4px; border-radius: 50%; background: var(--primary); }
.dn-trust { display: flex; gap: 8px; align-items: center; margin-top: 16px; padding: 12px 16px; border-radius: 14px; background: #ecfdf5; color: #047857; font-weight: 600; font-size: .92rem; }
.dn-side { position: sticky; top: 96px; }
@media (max-width: 980px) { .dn-grid { grid-template-columns: 1fr; } .dn-side { position: static; } }
</style>
