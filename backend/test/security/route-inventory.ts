import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import {
  ANY_PERMISSION_KEY, AUTHENTICATED_ONLY_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY,
} from '../../src/core/auth/decorators';

export type Decision = 'permission' | 'public' | 'authenticated-only' | 'none';

export interface RouteInfo {
  /** مثل: GET /accounting/entries/:id */
  key: string;
  method: string;
  path: string;
  controller: string;
  handler: string;
  file: string;
  decision: Decision;
  guards: string[];
}

const SRC = path.join(__dirname, '../../src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

const join = (...parts: (string | undefined)[]) =>
  '/' + parts.filter((x) => x !== undefined && x !== '').map((x) => String(x).replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');

/** يقرأ كل المسارات من metadata الخاصة بـ Nest دون تشغيل التطبيق أو قاعدة البيانات */
export function routeInventory(): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const file of walk(SRC).sort()) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(file);
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function') continue;
      const ctrl = exported as any;
      const ctrlPath = Reflect.getMetadata(PATH_METADATA, ctrl);
      if (ctrlPath === undefined) continue;
      const proto = ctrl.prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        const fn = proto[name];
        if (typeof fn !== 'function') continue;
        const methodPath = Reflect.getMetadata(PATH_METADATA, fn);
        const method = Reflect.getMetadata(METHOD_METADATA, fn);
        if (methodPath === undefined || method === undefined) continue;
        const has = (k: string) => {
          const m = Reflect.getMetadata(k, fn) ?? Reflect.getMetadata(k, ctrl);
          return Array.isArray(m) ? m.length > 0 : m !== undefined && m !== false;
        };
        const decision: Decision = has(IS_PUBLIC_KEY) ? 'public'
          : has(PERMISSIONS_KEY) || has(ANY_PERMISSION_KEY) ? 'permission'
          : has(AUTHENTICATED_ONLY_KEY) ? 'authenticated-only' : 'none';
        const guards = [...(Reflect.getMetadata('__guards__', ctrl) ?? []), ...(Reflect.getMetadata('__guards__', fn) ?? [])]
          .map((g: any) => g?.name ?? String(g));
        for (const cp of Array.isArray(ctrlPath) ? ctrlPath : [ctrlPath]) {
          for (const mp of Array.isArray(methodPath) ? methodPath : [methodPath]) {
            const p = join(cp, mp);
            const m = RequestMethod[method as number];
            routes.push({
              key: `${m} ${p}`, method: m, path: p, controller: ctrl.name, handler: name,
              file: path.relative(path.join(SRC, '..'), file), decision, guards,
            });
          }
        }
      }
    }
  }
  return routes;
}
