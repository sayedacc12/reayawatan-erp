<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import DynamicFields from '../modules/beneficiaries/components/DynamicFields.vue';
import { money } from '../modules/beneficiaries/labels';
import { portalApi, type PortalProject } from './portal';

const route = useRoute();
const router = useRouter();
const slug = route.params.slug as string;
const projects = ref<PortalProject[]>([]);
const chosen = ref<PortalProject | null>(null);
const form = reactive({ description: '', applicationData: {} as Record<string, unknown>, services: [] as string[] });
const error = ref('');
const busy = ref(false);

onMounted(async () => {
  try {
    projects.value = await portalApi<PortalProject[]>('/projects');
  } catch (e) {
    error.value = (e as Error).message;
  }
});

function pickService(name: string) {
  if (!chosen.value?.multiServices) { form.services = [name]; return; }
  const i = form.services.indexOf(name);
  if (i >= 0) form.services.splice(i, 1);
  else form.services.push(name);
}
const servicesTotal = computed(() => {
  const list = chosen.value?.services.filter((x) => form.services.includes(x.name)) ?? [];
  return list.length && list.every((x) => typeof x.cost === 'number') ? list.reduce((a, x) => a + (x.cost ?? 0), 0) : null;
});
const grouped = computed(() => {
  const m = new Map<string, Map<string, PortalProject[]>>();
  for (const p of projects.value) {
    if (!m.has(p.axis)) m.set(p.axis, new Map());
    const progs = m.get(p.axis)!;
    progs.set(p.program, [...(progs.get(p.program) ?? []), p]);
  }
  return [...m.entries()].map(([axis, progs]) => ({ axis, programs: [...progs.entries()] }));
});

function choose(p: PortalProject) {
  if (p.eligibility && !p.eligibility.canApply) return;
  chosen.value = p;
  form.services = p.services.length === 1 ? [p.services[0].name] : [];
  form.applicationData = {};
  form.description = '';
  error.value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submit() {
  if (!chosen.value) return;
  if (chosen.value.services.length && !form.services.length) { error.value = 'اختار الخدمة اللي محتاجها'; return; }
  busy.value = true;
  error.value = '';
  try {
    const r = await portalApi<{ id: string }>('/requests', { method: 'POST', json: { projectId: chosen.value.id, ...form, services: chosen.value.services.length ? form.services : undefined } });
    router.push({ path: `/portal/${slug}/requests/${r.id}`, query: { new: '1' } });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <h1 class="title">تقديم طلب جديد</h1>
    <ol class="wizard">
      <li :class="{ on: !chosen, done: chosen }"><span>1</span>اختيار المشروع</li>
      <li :class="{ on: chosen }"><span>2</span>بيانات الطلب</li>
      <li><span>3</span>المتابعة</li>
    </ol>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <Transition name="page" mode="out-in">
      <div v-if="!chosen" key="pick">
        <p v-if="!projects.length && !error" class="card empty">لا توجد مشاريع متاحة للتقديم حاليًا.</p>
        <section v-for="g in grouped" :key="g.axis" class="axis">
          <h2>{{ g.axis }}</h2>
          <div v-for="[program, list] in g.programs" :key="program">
            <p class="program">{{ program }}</p>
            <div class="grid">
              <button v-for="(p, i) in list" :key="p.id" :class="['card proj', { blocked: p.eligibility && !p.eligibility.canApply }]" :style="{ '--i': i }" @click="choose(p)">
                <b>{{ p.name }}</b>
                <span v-if="p.description" class="muted">{{ p.description }}</span>
                <span class="ptags">
                  <span class="ptag">🔁 الدعم {{ p.recurrenceLabel }}</span>
                  <span v-if="p.services.length" class="ptag">🧾 {{ p.services.length }} خدمة</span>
                </span>
                <span v-if="p.eligibility && !p.eligibility.canApply" class="why">🔒 {{ p.eligibility.reason }}</span>
                <span v-else class="go">قدّم على المشروع ←</span>
              </button>
            </div>
          </div>
        </section>
      </div>

      <form v-else key="form" class="card apply" @submit.prevent="submit">
        <div class="chosen">
          <div><small>{{ chosen.axis }} ‹ {{ chosen.program }}</small><h2>{{ chosen.name }}</h2><small class="rec">🔁 الدعم في المشروع ده {{ chosen.recurrenceLabel }}</small></div>
          <button type="button" class="btn btn-sm" @click="chosen = null">تغيير المشروع</button>
        </div>
        <div v-if="chosen.services.length" class="svc-box">
          <p class="form-name">{{ chosen.multiServices ? 'اختار الخدمات اللي محتاجها (تقدر تختار أكتر من خدمة)' : 'اختار الخدمة اللي محتاجها' }}</p>
          <div class="svcs">
            <label v-for="x in chosen.services" :key="x.name" :class="['svc', { on: form.services.includes(x.name) }]">
              <input :type="chosen.multiServices ? 'checkbox' : 'radio'" :checked="form.services.includes(x.name)" name="svc" @change="pickService(x.name)" />
              <span class="mark" />
              <span class="sn">{{ x.name }}</span>
              <small v-if="typeof x.cost === 'number'" class="muted">{{ money(x.cost) }} ج</small>
            </label>
          </div>
          <p v-if="servicesTotal !== null && form.services.length" class="muted small">التكلفة التقديرية: {{ money(servicesTotal) }} جنيه</p>
        </div>
        <template v-if="chosen.applicationForm">
          <p class="form-name">{{ chosen.applicationForm.name }}</p>
          <DynamicFields v-model="form.applicationData" :fields="chosen.applicationForm.fields" />
        </template>
        <div class="field"><label>تفاصيل إضافية (اختياري)</label><textarea v-model="form.description" class="input" rows="3" /></div>
        <button class="btn btn-primary send" :disabled="busy">{{ busy ? 'جارٍ الإرسال...' : 'إرسال الطلب' }}</button>
      </form>
    </Transition>
  </div>
</template>

<style scoped>
.title { font-size: 1.5rem; margin-bottom: 14px; }
.wizard { list-style: none; padding: 0; margin: 0 0 20px; display: flex; gap: 8px; flex-wrap: wrap; }
.wizard li { display: flex; align-items: center; gap: 8px; padding: 6px 14px 6px 8px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); font-size: .9rem; }
.wizard span { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--surface-2); font-weight: 700; font-size: .8rem; }
.wizard .on { border-color: var(--primary); color: var(--primary); font-weight: 600; }
.wizard .on span { background: var(--grad); color: #fff; box-shadow: 0 0 12px rgba(20,184,166,.6); }
.wizard .done span { background: #10b981; color: #fff; }
.empty { padding: 30px; text-align: center; }
.axis { margin-bottom: 20px; }
.axis h2 { font-size: 1.1rem; margin-bottom: 4px; }
.program { color: var(--primary); font-weight: 600; margin: 10px 0 8px; font-size: .92rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.proj { font: inherit; text-align: right; cursor: pointer; padding: 18px; display: flex; flex-direction: column; gap: 6px; color: var(--text); border-top: 3px solid var(--gold);
  transition: transform .25s var(--ease), box-shadow .25s; animation: rise .45s calc(var(--i) * 60ms) var(--ease) both; }
.proj:hover { transform: translateY(-4px); box-shadow: 0 16px 34px rgba(16,24,40,.1); }
.proj .muted { font-size: .86rem; }
.go { margin-top: auto; padding-top: 8px; color: var(--primary); font-weight: 600; font-size: .88rem; }
.apply { padding: 22px; }
.chosen { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding-bottom: 14px; margin-bottom: 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.chosen small { color: var(--muted); }
.form-name { font-weight: 700; color: var(--primary); margin: 0 0 12px; }
textarea.input { resize: vertical; }
.ptags { display: flex; flex-wrap: wrap; gap: 4px; }
.ptag { font-size: .74rem; padding: 2px 8px; border-radius: 99px; background: var(--surface-2); color: var(--muted); }
.proj.blocked { opacity: .75; cursor: not-allowed; border-top-color: var(--border); }
.proj.blocked:hover { transform: none; box-shadow: none; }
.why { margin-top: auto; padding: 8px 10px; border-radius: 8px; background: #fffbeb; color: #92400e; font-size: .82rem; }
.rec { display: block; color: var(--primary) !important; margin-top: 2px; }
.svc-box { margin-bottom: 16px; }
.svcs { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
.svc { position: relative; display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 12px; border: 1.5px solid var(--border); cursor: pointer; transition: all .2s; }
.svc input { position: absolute; opacity: 0; pointer-events: none; }
.svc .mark { width: 18px; height: 18px; border-radius: 6px; border: 2px solid var(--border); flex-shrink: 0; transition: all .2s; }
.svc.on { border-color: var(--primary); background: var(--primary-soft); box-shadow: 0 6px 18px rgba(20,184,166,.15); }
.svc.on .mark { background: var(--primary); border-color: var(--primary); box-shadow: inset 0 0 0 3px #fff; }
.sn { flex: 1; font-weight: 600; }
.small { font-size: .84rem; margin: 8px 0 0; }
.send { width: 100%; min-height: 48px; font-size: 1.05rem; }
@keyframes rise { from { opacity: 0; transform: translateY(12px); } }
</style>
