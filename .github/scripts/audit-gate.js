#!/usr/bin/env node
// بوابة التبعيات: تفشل عند أي ثغرة high/critical في تبعيات الإنتاج، إلا المستثناة صراحة
// في audit-allowlist.json بسبب مكتوب وتاريخ انتهاء. الاستثناء المنتهي يُفشل الفحص حتى يُراجع.
// الاستخدام: (cd backend && npm audit --omit=dev --json) | node .github/scripts/audit-gate.js backend
'use strict';
const fs = require('fs');
const path = require('path');

const project = process.argv[2] ?? '';
const report = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
const allow = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit-allowlist.json'), 'utf8'))
  .filter((a) => !a.project || a.project === project);
const today = new Date().toISOString().slice(0, 10);

const blocking = [];
const accepted = [];
for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
  for (const adv of (v.via ?? []).filter((x) => typeof x === 'object')) {
    if (!['high', 'critical'].includes(adv.severity)) continue;
    const rule = allow.find((a) => a.package === name && (!a.advisory || a.advisory === adv.url));
    const line = `${adv.severity.toUpperCase()} ${name} ${adv.range} — ${adv.title} (${adv.url})`;
    if (rule && rule.until >= today) accepted.push(`${line}\n    accepted until ${rule.until}: ${rule.reason}`);
    else blocking.push(rule ? `${line}\n    allow-list entry EXPIRED on ${rule.until}` : line);
  }
}
if (accepted.length) console.log(`Accepted risks (${project}):\n` + accepted.join('\n'));
if (blocking.length) {
  console.error(`Blocking vulnerabilities (${project}):\n` + blocking.join('\n'));
  process.exit(1);
}
console.log(`No blocking high/critical advisories in ${project} production dependencies.`);
