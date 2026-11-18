<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import SiteIcon from '../SiteIcon.vue';
import PageHead from '../parts/PageHead.vue';
import { SOCIAL, socialHref, useSite } from '../site';

const route = useRoute();
const site = useSite();
const id = computed(() => site.data.value.identity);
const TOPICS: [string, string][] = [['inquiry', 'استفسار'], ['suggestion', 'اقتراح'], ['complaint', 'شكوى'], ['partnership', 'شراكة وتعاون'], ['other', 'أخرى']];
const f = reactive({ name: '', phone: '', email: '', topic: TOPICS.some(([k]) => k === route.query.topic) ? String(route.query.topic) : 'inquiry', body: '' });
const busy = ref(false);
const err = ref('');
const done = ref(false);
async function send() {
  err.value = '';
  if (!f.phone.trim() && !f.email.trim()) return void (err.value = 'اكتب رقم الجوال أو البريد الإلكتروني لنتواصل معك');
  busy.value = true;
  try {
    await site.post('/contact', { name: f.name, phone: f.phone.trim() || undefined, email: f.email.trim() || undefined, topic: f.topic, body: f.body });
    done.value = true;
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const social = computed(() => SOCIAL.filter(([k]) => id.value.contact?.social?.[k]).map(([k, l]) => ({ k, l, href: socialHref(k, id.value.contact.social[k]) })));
</script>

<template>
  <div>
    <PageHead title="تواصل معنا" text="يسعدنا تواصلك واستفساراتك واقتراحاتك، ونرد عليك في أقرب وقت." />
    <section class="sx-sec">
      <div class="sx-wrap ct-grid">
        <div class="ct-info">
          <div v-if="id.contact?.phone" class="sx-card ct-item"><span><SiteIcon name="phone" :size="22" /></span><div><small>الهاتف</small><a :href="`tel:${id.contact.phone}`" dir="ltr">{{ id.contact.phone }}</a></div></div>
          <div v-if="id.contact?.email" class="sx-card ct-item"><span><SiteIcon name="mail" :size="22" /></span><div><small>البريد الإلكتروني</small><a :href="`mailto:${id.contact.email}`">{{ id.contact.email }}</a></div></div>
          <div v-if="id.contact?.address" class="sx-card ct-item"><span><SiteIcon name="pin" :size="22" /></span><div><small>العنوان</small>{{ id.contact.address }}<template v-if="id.contact.city">، {{ id.contact.city }}</template><a v-if="id.contact.mapUrl" :href="id.contact.mapUrl" target="_blank" rel="noopener" class="ct-map">عرض على الخريطة ↗</a></div></div>
          <div v-if="id.contact?.workingHours" class="sx-card ct-item"><span><SiteIcon name="clock" :size="22" /></span><div><small>ساعات العمل</small>{{ id.contact.workingHours }}</div></div>
          <div v-if="id.contact?.poBox" class="sx-card ct-item"><span><SiteIcon name="mail" :size="22" /></span><div><small>العنوان البريدي</small>{{ id.contact.poBox }}</div></div>
          <div v-if="social.length" class="ct-social"><a v-for="s in social" :key="s.k" :href="s.href" target="_blank" rel="noopener" :title="s.l"><SiteIcon :name="s.k" :size="20" /></a></div>
        </div>
        <div class="sx-card ct-form">
          <div v-if="done" class="ct-done"><span><SiteIcon name="check" :size="42" /></span><h2>وصلت رسالتك</h2><p>شكرًا لتواصلك، سيتواصل معك فريق الجمعية قريبًا.</p><button class="sx-btn line" @click="done = false; f.body = ''">رسالة أخرى</button></div>
          <form v-else @submit.prevent="send">
            <h2>أرسل رسالة</h2>
            <div class="ct-topics"><button v-for="[k, l] in TOPICS" :key="k" type="button" :class="{ on: f.topic === k }" @click="f.topic = k">{{ l }}</button></div>
            <label class="sx-field"><span>الاسم *</span><input v-model="f.name" class="sx-input" required /></label>
            <div class="ct-row">
              <label class="sx-field"><span>الجوال</span><input v-model="f.phone" class="sx-input" dir="ltr" inputmode="tel" placeholder="05XXXXXXXX" /></label>
              <label class="sx-field"><span>البريد الإلكتروني</span><input v-model="f.email" type="email" class="sx-input" dir="ltr" /></label>
            </div>
            <label class="sx-field"><span>رسالتك *</span><textarea v-model="f.body" class="sx-input" rows="6" required /></label>
            <div v-if="err" class="sx-err">{{ err }}</div>
            <button class="sx-btn prim" :disabled="busy">{{ busy ? 'جارٍ الإرسال...' : 'إرسال' }}</button>
          </form>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ct-grid { display: grid; grid-template-columns: 380px minmax(0, 1fr); gap: 26px; align-items: start; }
.ct-info { display: grid; gap: 12px; }
.ct-item { display: flex; gap: 14px; padding: 16px 18px; align-items: flex-start; }
.ct-item > span { width: 46px; height: 46px; border-radius: 14px; display: grid; place-items: center; background: var(--grad); color: #fff; flex-shrink: 0; }
.ct-item div { display: grid; }
.ct-item small { color: var(--text-2); }
.ct-item a { font-weight: 700; color: var(--primary); }
.ct-map { font-size: .88rem; font-weight: 600 !important; }
.ct-social { display: flex; gap: 8px; flex-wrap: wrap; }
.ct-social a { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--paper); border: 1px solid var(--line); color: var(--primary); transition: all .25s; }
.ct-social a:hover { background: var(--primary); color: #fff; transform: translateY(-3px); }
.ct-form { padding: 30px; }
.ct-form h2 { margin-bottom: 16px; }
.ct-topics { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
.ct-topics button { padding: 7px 14px; border-radius: 999px; border: 1.5px solid var(--line); background: var(--paper); font: inherit; cursor: pointer; transition: all .2s; }
.ct-topics button.on { background: var(--primary); color: #fff; border-color: var(--primary); }
.ct-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ct-done { text-align: center; padding: 30px 10px; }
.ct-done > span { width: 84px; height: 84px; margin: 0 auto 14px; border-radius: 50%; display: grid; place-items: center; background: #ecfdf5; color: #10b981; animation: ct-pop .6s var(--ease2); }
@keyframes ct-pop { from { transform: scale(.4); opacity: 0; } }
@media (max-width: 900px) { .ct-grid { grid-template-columns: 1fr; } }
@media (max-width: 520px) { .ct-row { grid-template-columns: 1fr; gap: 0; } }
</style>
