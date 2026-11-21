import { ref } from 'vue';
import { api } from '../api';
import { fontStack, IdentityColors, loadFont, themeVars } from './fonts';

/** هوية الشركة داخل النظام: الشعار يظهر في الشريط العلوي، والألوان تُطبق إن اختارت الشركة ذلك */
export const orgLogo = ref<string | null>(null);
const applied = new Set<string>();

export function applyIdentity(d: { applyToSystem?: boolean; colors?: IdentityColors; fonts?: { body: string; heading: string }; logoUrl?: string | null; logoLightUrl?: string | null }) {
  const root = document.documentElement;
  for (const k of applied) root.style.removeProperty(k);
  applied.clear();
  orgLogo.value = d.applyToSystem ? d.logoLightUrl || d.logoUrl || null : null;
  if (!d.applyToSystem || !d.colors) return;
  for (const [k, v] of Object.entries(themeVars(d.colors))) {
    root.style.setProperty(k, v);
    applied.add(k);
  }
  if (d.fonts?.body && d.fonts.body !== 'IBM Plex Sans Arabic') {
    loadFont(d.fonts.body);
    root.style.setProperty('font-family', fontStack(d.fonts.body));
    applied.add('font-family');
  }
}

export async function loadIdentity() {
  try {
    applyIdentity(await api('/identity'));
  } catch {
    applyIdentity({});
  }
}
export function clearIdentity() {
  applyIdentity({});
}
