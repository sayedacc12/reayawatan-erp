/** تحميل خط عربي من Google Fonts عند الحاجة (مرة واحدة لكل خط) */
const loaded = new Set<string>(['IBM Plex Sans Arabic']);
export function loadFont(name: string | null | undefined) {
  if (!name || loaded.has(name)) return;
  loaded.add(name);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@400;500;700&display=swap`;
  document.head.appendChild(link);
}
export const fontStack = (name: string | null | undefined) => `'${name || 'IBM Plex Sans Arabic'}', 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif`;

/** تفتيح أو تغميق لون #RRGGBB بنسبة (موجبة للتفتيح وسالبة للتغميق) */
export function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount)));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
export function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export interface IdentityColors { primary: string; secondary: string; accent: string; dark: string }
/** متغيرات CSS من ألوان الهوية، تُطبق على الموقع أو داخل النظام */
export function themeVars(c: IdentityColors) {
  return {
    '--primary': c.primary, '--primary-hover': shade(c.primary, -0.18), '--primary-soft': shade(c.primary, 0.9),
    '--grad': `linear-gradient(135deg, ${c.secondary}, ${c.primary} 55%, ${shade(c.primary, -0.15)})`,
    '--grad-dark': `linear-gradient(120deg, ${shade(c.dark, -0.35)}, ${c.dark} 55%, ${shade(c.dark, 0.12)})`,
    '--gold': c.accent, '--accent': c.accent, '--secondary': c.secondary, '--dark': c.dark,
  } as Record<string, string>;
}
