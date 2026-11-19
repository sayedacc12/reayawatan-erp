#!/usr/bin/env node
// قياس سرعة كل شاشات سنابل (طلبات GET) لموظف جمعية، ثم محاكاة مستخدمين متزامنين.
// يُشغَّل على نسخة اختبار معزولة فقط. لا يحتاج أي مكتبة خارجية (Node 18+).
//
//   node loadtest/measure.mjs --base http://localhost:3000 --org lt-001 \
//        --login lt001-demo-admin@sanabelerp.com --password Demo-xxxx \
//        --routes loadtest/routes.txt --out loadtest/results/before.json [--users 200 --seconds 60] [--load-exclude '^/api/reports/run/']
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const BASE = args.base ?? 'http://localhost:3000';
const REPEAT = Number(args.repeat ?? 3);
const USERS = Number(args.users ?? 0);
const SECONDS = Number(args.seconds ?? 60);
const TIMEOUT = Number(args.timeout ?? 60000);

// كل مستخدم افتراضي يأتي من عنوان IP مختلف (الخادم يثق في X-Forwarded-For خلف nginx)، كما في الواقع
const ipFor = (n) => `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;

async function call(path, token, ip, method = 'GET', body) {
  const t0 = performance.now();
  let status = 0;
  let bytes = 0;
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { authorization: token ? `Bearer ${token}` : '', 'x-forwarded-for': ip, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    status = res.status;
    bytes = (await res.arrayBuffer()).byteLength;
  } catch (e) {
    status = e.name === 'TimeoutError' ? 'timeout' : 'error';
  }
  return { ms: performance.now() - t0, status, bytes };
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ipFor(1) },
    body: JSON.stringify({ login: args.login, password: args.password, organization: args.org }),
  });
  const json = await res.json();
  if (!json.accessToken) throw new Error(`login failed: ${JSON.stringify(json)}`);
  return json.accessToken;
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function main() {
  const token = await login();
  const routes = readFileSync(args.routes, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  // تقارير كل نظام (من سجل التقارير الموحد) تُضاف للقياس بإعداداتها الافتراضية
  for (const mod of (args.reports ?? '').split(',').filter(Boolean)) {
    const res = await fetch(`${BASE}/api/reports/catalog/${mod}`, { headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': ipFor(2) } });
    const json = await res.json().catch(() => ({}));
    for (const r of json.reports ?? []) routes.push(`/api/reports/run/${r.code}`);
  }

  // 1) كل شاشة على حدة: أول طلب (بارد) ثم متوسط التكرارات
  const screens = [];
  for (const route of routes) {
    const runs = [];
    // كل طلب من عنوان مختلف حتى لا يوقفه حد الطلبات لكل مستخدم (300 في الدقيقة)
    for (let i = 0; i < REPEAT; i++) runs.push(await call(route, token, ipFor(100000 + screens.length * 10 + i)));
    const ok = runs.filter((r) => typeof r.status === 'number' && r.status < 400);
    const ms = runs.map((r) => r.ms).sort((a, b) => a - b);
    screens.push({
      route,
      status: runs[runs.length - 1].status,
      ms: Math.round(ms[Math.floor(ms.length / 2)]),
      max: Math.round(ms[ms.length - 1]),
      kb: Math.round((ok[0]?.bytes ?? 0) / 1024),
    });
    process.stderr.write(`${String(screens.at(-1).ms).padStart(6)} ms  ${screens.at(-1).status}  ${route}\n`);
  }

  // 2) مستخدمون متزامنون: كل مستخدم يفتح شاشات عشوائية بلا توقف لمدة محددة
  let load = null;
  if (USERS > 0) {
    // مزيج الاستخدام اليومي: الشاشات فقط، والتقارير تُستثنى لأنها تُفتح نادرًا (يمكن تغييره بـ --load-exclude)
    const exclude = new RegExp(args['load-exclude'] ?? '^/api/reports/run/');
    const okRoutes = screens.filter((s) => s.status === 200 && !exclude.test(s.route)).map((s) => s.route);
    const lat = [];
    let errors = 0;
    const end = Date.now() + SECONDS * 1000;
    const user = async (n) => {
      while (Date.now() < end) {
        const r = await call(okRoutes[Math.floor(Math.random() * okRoutes.length)], token, ipFor(1000 + n));
        lat.push(r.ms);
        if (r.status !== 200) errors++;
        // زمن "تفكير" المستخدم بين شاشة وأخرى (1 إلى 3 ثوان)
        await new Promise((ok) => setTimeout(ok, 1000 + Math.random() * 2000));
      }
    };
    await Promise.all(Array.from({ length: USERS }, (_, n) => user(n)));
    lat.sort((a, b) => a - b);
    load = {
      users: USERS,
      seconds: SECONDS,
      requests: lat.length,
      perSecond: Math.round(lat.length / SECONDS),
      errors,
      p50: Math.round(pct(lat, 50)),
      p95: Math.round(pct(lat, 95)),
      p99: Math.round(pct(lat, 99)),
      max: Math.round(lat.at(-1) ?? 0),
    };
    process.stderr.write(`load: ${JSON.stringify(load)}\n`);
  }

  const result = {
    at: new Date().toISOString(),
    org: args.org,
    screens: screens.sort((a, b) => b.ms - a.ms),
    summary: {
      screens: screens.length,
      over1s: screens.filter((s) => s.ms > 1000).length,
      over300ms: screens.filter((s) => s.ms > 300).length,
      failed: screens.filter((s) => !(typeof s.status === 'number' && s.status < 400)).length,
    },
    load,
  };
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify(result.summary), result.load ? JSON.stringify(result.load) : '');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
