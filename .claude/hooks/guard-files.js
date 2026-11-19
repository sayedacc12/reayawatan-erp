#!/usr/bin/env node
// PreToolUse(Read/Edit/Write): يمنع الوصول للأسرار، ويمنع كتابة أسرار في الكود،
// ويطلب موافقة بشرية لتعديل الملفات المالية والصلاحيات والـ migrations والنشر.
'use strict';
const { readInput, decide, isSecretPath, secretInContent } = require('./_lib');

const input = readInput();
const tool = input.tool_name;
const ti = input.tool_input ?? {};
const file = String(ti.file_path ?? ti.notebook_path ?? ti.path ?? '');
const norm = file.replace(/\\/g, '/');

if (isSecretPath(norm)) decide('deny', 'Blocked by Sanabel security policy: this file holds secrets and must not be read or modified by Claude.');
if (tool === 'Read') process.exit(0);

const written = [ti.content, ti.new_string, ti.new_source, ...(Array.isArray(ti.edits) ? ti.edits.map((e) => e.new_string) : [])]
  .filter(Boolean).join('\n');
const secret = secretInContent(written);
if (secret) decide('deny', `Blocked by Sanabel security policy: the change appears to contain a ${secret}. Use environment variables; never commit secrets.`);

const SENSITIVE = [
  [/\/backend\/src\/migrations\//, 'database migration'],
  [/\/deploy\//, 'deployment/production configuration'],
  [/\/docker-compose[^/]*\.ya?ml$|\/Dockerfile$|\/Caddyfile$|\/nginx\.conf$/, 'infrastructure configuration'],
  [/\/backend\/src\/core\/auth\//, 'authentication/authorization core'],
  [/\/backend\/src\/core\/roles\//, 'roles and permissions'],
  [/\/backend\/src\/modules\/accounting\//, 'financial accounting'],
  [/\/backend\/src\/modules\/fundraising\//, 'donations and restricted funds'],
  [/\/backend\/src\/modules\/procurement\//, 'procurement/inventory/supplier portal'],
  [/\/backend\/src\/modules\/planning\/budget/, 'budgets'],
  [/\/backend\/src\/modules\/hr\/(payroll|separation)/, 'payroll and end-of-service'],
  [/\/backend\/src\/core\/(payments|subscriptions|lifecycle|backups)\//, 'payments/subscriptions/data lifecycle'],
  [/\/backend\/test\/security\//, 'security gates'],
  [/\/\.github\//, 'CI/CD pipeline'],
  [/\/\.claude\//, 'Claude security configuration'],
  [/\/CLAUDE\.md$/, 'mandatory secure-coding rules'],
];
const hit = SENSITIVE.find(([re]) => re.test(norm));
if (hit) decide('ask', `Sanabel security policy: editing ${hit[1]} (${file}) requires human approval. Check CLAUDE.md sections 2-6 before approving.`);
process.exit(0);
