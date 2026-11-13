import { defineStore } from 'pinia';
import { api, token } from '../api';

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  organizationId: string | null;
  organizationName: string | null;
  isSuperadmin: boolean;
  isPlatformAdmin: boolean;
  permissions: string[];
}
export interface AppEntry {
  code: string;
  name: string;
  description?: string;
  icon?: string;
  menu: { label: string; path: string }[];
}
interface SessionPayload {
  user: SessionUser;
  apps: AppEntry[];
}

export const useSession = defineStore('session', {
  state: () => ({ user: null as SessionUser | null, apps: [] as AppEntry[], loaded: false }),
  getters: {
    isLoggedIn: (s) => !!s.user,
  },
  actions: {
    can(permission?: string) {
      if (!permission) return true;
      return !!this.user && this.user.permissions.includes(permission);
    },
    async login(email: string, password: string) {
      const res = await api<SessionPayload & { accessToken: string }>('/auth/login', {
        method: 'POST',
        json: { email, password },
      });
      token.set(res.accessToken);
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
    },
    logout() {
      token.clear();
      this.user = null;
      this.apps = [];
    },
  },
});
