<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import ImageField from '../components/ImageField.vue';
import { STATUS_COLOR, WP, errMsg, fmtDateTime, siteUrl, todayStr } from '../lib';
import '../website.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id?: string }>();
const router = useRouter();
const session = useSession();
const toast = useToast();
const n = ref<any>(null);
const f = reactive({ title: '', summary: '', body: '', imageId: null as string | null, imageUrl: null as string | null, newsDate: todayStr(), ticker: false });
const note = ref('');
const busy = ref(false);
const isNew = computed(() => !props.id);
const canPublish = computed(() => session.can(WP.publish));
const editable = computed(() => isNew.value || n.value?.can?.edit);

onMounted(async () => {
  if (!props.id) return;
  try {
    n.value = await api(`/website/news/${props.id}`);
    Object.assign(f, { title: n.value.title, summary: n.value.summary, body: n.value.body, imageId: n.value.imageId, imageUrl: n.value.imageUrl, newsDate: n.value.newsDate, ticker: n.value.ticker });
  } catch (e) {
    toast.error(errMsg(e));
  }
});

async function save(action: 'draft' | 'submit' | 'publish') {
  busy.value = true;
  try {
    const body = { title: f.title, summary: f.summary, body: f.body, imageId: f.imageId, newsDate: f.newsDate, ticker: f.ticker, action };
    const r: any = isNew.value ? await api('/website/news', { method: 'POST', json: body }) : await api(`/website/news/${props.id}`, { method: 'PUT', json: body });
    toast.success(action === 'draft' ? 'حُفظ الخبر كمسودة' : action === 'submit' ? 'أُرسل الخبر للاعتماد' : 'نُشر الخبر في الموقع');
    if (isNew.value) router.replace(`/website/news/${r.id}`);
    n.value = r;
  } catch (e) {
    toast.error(errMsg(e));
  } finally {
    busy.value = false;
  }
}
async function decide(decision: string) {
  busy.value = true;
  try {
    n.value = await api(`/website/news/${props.id}/decision`, { method: 'POST', json: { decision, note: note.value || undefined } });
    note.value = '';
    toast.success({ approve: 'اعتُمد الخبر ونُشر', return: 'أُعيد الخبر للمحرر', unpublish: 'أُخفي الخبر من الموقع' }[decision] ?? 'تم');
  } catch (e) {
    toast.error(errMsg(e));
  } finally {
    busy.value = false;
  }
}
async function remove() {
  if (!confirm('حذف هذا الخبر نهائيًا؟')) return;
  try {
    await api(`/website/news/${props.id}`, { method: 'DELETE' });
    toast.success('حُذف الخبر');
    router.push('/website/news');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <RouterLink to="/website/news" class="ws-link">→ الأخبار</RouterLink>
        <h1>{{ isNew ? 'خبر جديد' : f.title || 'خبر' }}</h1>
        <span v-if="n" class="ws-pill" :style="{ '--c': STATUS_COLOR[n.status] }">{{ n.statusLabel }}</span>
      </div>
      <a v-if="n?.status === 'published'" :href="siteUrl(session.user?.organizationSlug, `/news/${n.id}`)" target="_blank" rel="noopener" class="btn">عرض في الموقع ↗</a>
    </div>
    <div v-if="n?.reviewNote && n.status === 'returned'" class="ws-note"><strong>ملاحظة المعتمد:</strong> {{ n.reviewNote }}</div>
    <div class="ws-side">
      <section class="card ws-panel">
        <fieldset :disabled="!editable" style="border: 0; padding: 0; margin: 0">
          <label class="field"><span>عنوان الخبر *</span><input v-model="f.title" class="input" maxlength="250" /></label>
          <label class="field"><span>ملخص يظهر في البطاقات *</span><textarea v-model="f.summary" class="input" rows="2" maxlength="600" /></label>
          <label class="field"><span>نص الخبر *</span><textarea v-model="f.body" class="input" rows="10" /><small class="muted">افصل الفقرات بسطر فارغ.</small></label>
          <div class="ws-grid2">
            <label class="field"><span>تاريخ الخبر</span><input v-model="f.newsDate" type="date" class="input" /></label>
            <label class="check" style="align-self: center"><input v-model="f.ticker" type="checkbox" /> يظهر في شريط الأخبار المتحرك</label>
          </div>
          <ImageField :id="f.imageId" :url="f.imageUrl" label="صورة الخبر" @update="(v) => { f.imageId = v.id; f.imageUrl = v.url; }" />
        </fieldset>
        <div v-if="editable" class="ws-actions">
          <button class="btn" :disabled="busy" @click="save('draft')">حفظ كمسودة</button>
          <button v-if="!canPublish" class="btn btn-primary" :disabled="busy" @click="save('submit')">إرسال للاعتماد</button>
          <button v-else class="btn btn-primary" :disabled="busy" @click="save('publish')">حفظ ونشر</button>
          <button v-if="n?.can?.remove" class="btn btn-danger" style="margin-inline-start: auto" @click="remove">حذف</button>
        </div>
      </section>
      <aside v-if="n">
        <section v-if="n.can?.decide && n.status === 'pending'" class="card ws-panel">
          <h2>قرار الاعتماد</h2>
          <label class="field"><span>ملاحظة (إلزامية عند الإرجاع)</span><textarea v-model="note" class="input" rows="3" /></label>
          <div class="ws-actions"><button class="btn btn-primary" :disabled="busy" @click="decide('approve')">اعتماد ونشر</button><button class="btn" :disabled="busy" @click="decide('return')">إرجاع للتعديل</button></div>
        </section>
        <section v-if="n.can?.unpublish" class="card ws-panel">
          <h2>الخبر منشور</h2>
          <p class="ws-muted">نشره {{ n.publishedByName }} في {{ fmtDateTime(n.publishedAt) }} · {{ n.views }} مشاهدة</p>
          <button class="btn" :disabled="busy" @click="decide('unpublish')">إخفاء من الموقع</button>
        </section>
        <section class="card ws-panel">
          <h2>معاينة البطاقة</h2>
          <div class="ne-card"><img v-if="f.imageUrl" :src="f.imageUrl" alt="" /><div class="ne-body"><small>{{ f.newsDate }}</small><strong>{{ f.title || 'عنوان الخبر' }}</strong><p>{{ f.summary }}</p></div></div>
          <p class="ws-muted" style="margin-top: 8px">كتبه {{ n.createdByName }}</p>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.ne-card { border-radius: 14px; overflow: hidden; border: 1px solid var(--border); background: var(--surface); }
.ne-card img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; }
.ne-body { padding: 12px; display: grid; gap: 4px; }
.ne-body small { color: var(--primary); }
.ne-body p { margin: 0; color: var(--muted); font-size: .86rem; }
</style>
