import { reactive } from 'vue';
import { ApiError } from '../api';

/**
 * عميل بوابة المستفيدين: منفصل تمامًا عن جلسة الموظفين.
 * رمز الدخول محفوظ لكل جمعية على حدة.
 */
const key = (slug: string) => `sanabel.portal.${slug}`;

export const portalState = reactive({ slug: '', token: null as string | null });

export function usePortal(slug: string) {
  if (portalState.slug !== slug) {
    portalState.slug = slug;
    try { portalState.token = localStorage.getItem(key(slug)); } catch { portalState.token = null; }
  }
  return portalState;
}

export function setPortalToken(token: string | null) {
  portalState.token = token;
  try {
    if (token) localStorage.setItem(key(portalState.slug), token);
    else localStorage.removeItem(key(portalState.slug));
  } catch { /* التخزين غير متاح */ }
}

export async function portalApi<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (portalState.token) headers.set('Authorization', `Bearer ${portalState.token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api/portal${path}`, { ...init, headers, body });
  if (res.status === 401 && portalState.token) {
    setPortalToken(null);
    location.href = `/portal/${portalState.slug}`;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(data.message) ? data.message.join('، ') : data.message;
    throw new ApiError(res.status, msg || 'حدث خطأ غير متوقع');
  }
  return data as T;
}

export interface PortalProject {
  id: string; name: string; description: string | null; program: string; axis: string;
  applicationForm: { name: string; fields: import('../modules/beneficiaries/types').FormField[] } | null;
  services: import('../modules/beneficiaries/types').ProjectService[]; multiServices: boolean; allowConcurrent: boolean;
  recurrence: import('../modules/beneficiaries/types').Recurrence; recurrenceLabel: string;
  eligibility: { canApply: boolean; reason: string | null; nextDate: string | null } | null;
}
export interface PortalRequestRow {
  id: string; requestNo: number; status: string; createdAt: string; updatedAt: string;
  project: string; stage: string | null; stageIndex: number | null; stageCount: number;
  contributionStatus?: 'none' | 'awaiting' | 'submitted' | 'verified';
}
