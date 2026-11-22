import { computed, reactive } from 'vue';
import { api } from '../api';
import { useSession } from '../stores/session';

/** التعريف بالنظام: الترحيب والجولة الإرشادية وخطوات إطلاق الجمعية والتهاني */
export interface LaunchStep {
  key: string; phase: string; title: string; hint: string; link: string; app: string;
  auto: boolean; done: boolean; skipped: boolean;
}
export interface LaunchPhase { key: string; title: string; icon: string; hint: string }
export interface OnboardingState {
  welcomeSeen: boolean; tourDone: boolean; launchHidden: boolean; celebrated: string[];
  launch: { phases: LaunchPhase[]; steps: LaunchStep[] } | null;
}
export interface Celebration { key: string; kind: 'step' | 'phase' | 'all' | 'tour'; title: string; text: string; icon: string; cta?: { label: string; to: string } }

export const onboarding = reactive({
  state: null as OnboardingState | null,
  /** المرحلة الظاهرة الآن من التعريف */
  stage: 'idle' as 'idle' | 'welcome' | 'tour',
  celebration: null as Celebration | null,
  queue: [] as Celebration[],
});

const patch = async (body: Record<string, unknown>) => {
  try {
    const s = await api<OnboardingState>('/onboarding', { method: 'PATCH', json: body });
    absorb(s);
  } catch { /* التعريف لا يعطل العمل */ }
};

/** يحمل الحالة، ويحتفل بما أُنجز منذ آخر مرة */
export async function loadOnboarding() {
  try {
    absorb(await api<OnboardingState>('/onboarding'));
  } catch { /* التعريف لا يعطل العمل */ }
  return onboarding.state;
}

export function resetOnboarding() {
  onboarding.state = null;
  onboarding.stage = 'idle';
  onboarding.celebration = null;
  onboarding.queue = [];
}

/** الخطوات الظاهرة: التابعة لأنظمة متاحة للجمعية فقط */
export function visibleSteps(s: OnboardingState | null) {
  const session = useSession();
  if (!s?.launch) return [];
  const apps = new Set(session.apps.map((a) => a.code));
  return s.launch.steps.filter((st) => st.app === 'core' || apps.has(st.app));
}

export const launchView = computed(() => {
  const s = onboarding.state;
  const steps = visibleSteps(s);
  if (!s?.launch || !steps.length) return null;
  const phases = s.launch.phases
    .map((p) => {
      const list = steps.filter((st) => st.phase === p.key);
      return { ...p, steps: list, done: list.filter((x) => x.done || x.skipped).length, complete: list.every((x) => x.done || x.skipped) };
    })
    .filter((p) => p.steps.length);
  const done = steps.filter((x) => x.done || x.skipped).length;
  const next = steps.find((x) => !x.done && !x.skipped) ?? null;
  return { phases, total: steps.length, done, pct: Math.round((done / steps.length) * 100), next, complete: !next };
});

/** يقارن ما أُنجز بما احتُفل به ويضيف التهاني للطابور (خطوة، مرحلة، اكتمال الإطلاق) */
function absorb(s: OnboardingState) {
  // أول تحميل لمستخدم لم يُحتفل له بشيء من قبل: نسجل ما أنجزه سابقًا بصمت
  const silent = !onboarding.state && !s.celebrated.length && !s.welcomeSeen;
  const first = !onboarding.state;
  onboarding.state = s;
  const view = launchView.value;
  if (!view) return;
  const seen = new Set(s.celebrated);
  const fresh: Celebration[] = [];
  const keys: string[] = [];
  for (const p of view.phases) {
    for (const st of p.steps) {
      if (st.done && !seen.has(`step:${st.key}`)) {
        keys.push(`step:${st.key}`);
        // عند أول تحميل لا نحتفل بكل خطوة قديمة على حدة؛ يكفي الاحتفال بالمراحل
        if (!first) fresh.push({ key: `step:${st.key}`, kind: 'step', icon: '✅', title: 'أحسنت!', text: `أنجزت خطوة «${st.title}».` });
      }
    }
    if (p.complete && !seen.has(`phase:${p.key}`)) {
      keys.push(`phase:${p.key}`);
      fresh.push({ key: `phase:${p.key}`, kind: 'phase', icon: p.icon, title: `اكتملت مرحلة ${p.title}`, text: 'خطوة كبيرة نحو إطلاق النظام. واصل إلى المرحلة التالية.', cta: view.next ? { label: `التالي: ${view.next.title}`, to: view.next.link } : undefined });
    }
  }
  if (view.complete && !seen.has('launch:all')) {
    keys.push('launch:all');
    fresh.push({ key: 'launch:all', kind: 'all', icon: '🎉', title: 'مبارك! جمعيتك جاهزة للانطلاق', text: 'أكملت كل خطوات الإطلاق. صار نظامك جاهزًا لخدمة المستفيدين والداعمين بكفاءة. نتمنى لكم التوفيق.' });
  }
  if (!keys.length) return;
  if (silent) {
    patch({ celebrate: keys });
    return;
  }
  // التهنئة الكبرى تغني عن تهاني المراحل في اللحظة نفسها
  const show = fresh.some((c) => c.kind === 'all') ? fresh.filter((c) => c.kind === 'all') : fresh.filter((c) => c.kind === 'phase').length ? fresh.filter((c) => c.kind === 'phase') : fresh;
  onboarding.queue.push(...show);
  if (!onboarding.celebration) nextCelebration();
  patch({ celebrate: keys });
}

export function celebrate(c: Celebration) {
  onboarding.queue.push(c);
  if (!onboarding.celebration) nextCelebration();
}
export function nextCelebration() {
  onboarding.celebration = onboarding.queue.shift() ?? null;
}

export const markWelcomeSeen = () => {
  if (onboarding.state) onboarding.state.welcomeSeen = true;
  return patch({ welcomeSeen: true });
};
export const markTourDone = () => {
  if (onboarding.state) onboarding.state.tourDone = true;
  return patch({ tourDone: true });
};
export const setLaunchHidden = (v: boolean) => {
  if (onboarding.state) onboarding.state.launchHidden = v;
  return patch({ launchHidden: v });
};
export const markStep = (key: string, status: 'done' | 'skipped' | null) => patch({ mark: { key, status } });

/** إعادة التعريف: شاشة الترحيب ثم الجولة */
export async function replayWelcome() {
  try {
    absorb(await api<OnboardingState>('/onboarding/replay', { method: 'POST' }));
  } catch { /* لا شيء */ }
  onboarding.stage = 'welcome';
}
export function startTour() {
  onboarding.stage = 'tour';
}
