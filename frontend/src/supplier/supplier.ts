/* eslint-disable @typescript-eslint/no-explicit-any */
import { reactive, ref } from 'vue';
import { ApiError } from '../api';

/**
 * عميل بوابة الموردين: منفصل عن جلسة الموظفين وبوابة المستفيدين.
 * رمز الدخول محفوظ لكل جمعية على حدة.
 */
const key = (slug: string) => `sanabel.supplier.${slug}`;

export const supplierState = reactive({ slug: '', token: null as string | null });

export function useSupplierPortal(slug: string) {
  if (supplierState.slug !== slug) {
    supplierState.slug = slug;
    try { supplierState.token = localStorage.getItem(key(slug)); } catch { supplierState.token = null; }
  }
  return supplierState;
}

export function setSupplierToken(token: string | null) {
  supplierState.token = token;
  me.value = null;
  try {
    if (token) localStorage.setItem(key(supplierState.slug), token);
    else localStorage.removeItem(key(supplierState.slug));
  } catch { /* التخزين غير متاح */ }
}

export async function supplierApi<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (supplierState.token) headers.set('Authorization', `Bearer ${supplierState.token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api/supplier-portal${path}`, { ...init, headers, body });
  if (res.status === 401 && supplierState.token) {
    setSupplierToken(null);
    location.href = `/supplier/${supplierState.slug}`;
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(data.message) ? data.message.join('، ') : data.message;
    throw new ApiError(res.status, msg || 'حدث خطأ غير متوقع');
  }
  return data as T;
}

export function supplierUpload<T = any>(path: string, file: File | null, fields: Record<string, string | null | undefined>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined && v !== '') fd.append(k, v);
  if (file) fd.append('file', file);
  return supplierApi<T>(path, { method: 'POST', body: fd });
}

/** فتح ملف محمي من البوابة في نافذة جديدة */
export async function openSupplierFile(path: string) {
  const win = window.open('', '_blank');
  try {
    const res = await fetch(`/api/supplier-portal${path}`, { headers: supplierState.token ? { Authorization: `Bearer ${supplierState.token}` } : {} });
    if (!res.ok) throw new ApiError(res.status, 'تعذر فتح الملف');
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    win?.close();
    throw e;
  }
}

/** ملف المورد الحالي، مشترك بين شاشات البوابة */
export const me = ref<any>(null);
export async function loadMe(force = false) {
  if (!me.value || force) me.value = await supplierApi('/me');
  return me.value;
}
export function setMe(v: any) {
  me.value = v;
}
export const canDocs = (role?: string) => ['owner', 'sales', 'finance'].includes(role ?? '');
export const canBanks = (role?: string) => ['owner', 'finance'].includes(role ?? '');
