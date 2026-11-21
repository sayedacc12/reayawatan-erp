import { defineStore } from 'pinia';
import { api, token } from '../api';

const ORG_KEY = 'erp.org';
/** صفحة الدخول المناسبة: صفحة آخر جمعية دخل منها المستخدم، أو صفحة إدارة المنصة */
/** نظام شركة واحدة: شاشة دخول واحدة لبوابة الموظفين */
export function loginPath() {
  return '/login';
}

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  username: string | null;
  organizationId: string | null;
  organizationName: string | null;
  organizationSlug: string | null;
  isSuperadmin: boolean;
  isPlatformAdmin: boolean;
  permissions: string[];
  /** دخل بكلمة مرور مؤقتة: يغيّرها قبل استخدام النظام */
  mustChangePassword?: boolean;
}
export interface AppEntry {
  code: string;
  name: string;
  description?: string;
  icon?: string;
  menu: { label: string; path: string; group?: string }[];
}
/** الشاشات المسموحة والمحجوبة عن الجمعية (فارغة = كل الشاشات مسموحة) */
interface ScreenAccess { allowed: string[]; hidden: string[] }
interface SessionPayload {
  user: SessionUser;
  apps: AppEntry[];
  screens?: ScreenAccess;
}

export const useSession = defineStore('session', {
  state: () => ({ user: null as SessionUser | null, apps: [] as AppEntry[], screens: { allowed: [], hidden: [] } as ScreenAccess, loaded: false }),
  getters: {
    isLoggedIn: (s) => !!s.user,
  },
  actions: {
    can(permission?: string) {
      if (!permission) return true;
      return !!this.user && this.user.permissions.includes(permission);
    },
    /** هل المسار تابع لشاشة محجوبة؟ (أطول مسار شاشة يطابق بداية المسار هو المرجع) */
    screenHidden(path: string) {
      const { allowed, hidden } = this.screens;
      if (!hidden.length) return false;
      const match = (p: string) => path === p || path.startsWith(`${p}/`);
      const best = [...allowed, ...hidden].filter(match).sort((a, b) => b.length - a.length)[0];
      return !!best && hidden.includes(best);
    },
    /** login: البريد الإلكتروني أو اسم المستخدم. organization: slug صفحة دخول الجمعية */
    async login(login: string, password: string, organization?: string) {
      const res = await api<SessionPayload & { accessToken: string }>('/auth/login', {
        method: 'POST',
        json: { login, password, organization },
      });
      token.set(res.accessToken);
      if (res.user.organizationSlug) localStorage.setItem(ORG_KEY, res.user.organizationSlug);
      else localStorage.removeItem(ORG_KEY);
      this.apply(res);
    },
    async restore() {
      if (this.loaded) return;
      this.loaded = true;
      if (!token.get()) return;
      try {
        this.apply(await api<SessionPayload>('/auth/me'));
      } catch {
        token.clear();
      }
    },
    async refresh() {
      this.apply(await api<SessionPayload>('/auth/me'));
    },
    apply(p: SessionPayload) {
      this.user = p.user;
      this.apps = p.apps;
      this.screens = p.screens ?? { allowed: [], hidden: [] };
    },
    logout() {
      token.clear();
      this.user = null;
      this.apps = [];
      this.screens = { allowed: [], hidden: [] };
    },
  },
});
