#!/usr/bin/env node
// Stop: تذكير بالبوابات الأمنية إذا لُمست ملفات حساسة ولم تُشغّل الاختبارات.
'use strict';
const { execSync } = require('child_process');
const { readInput } = require('./_lib');

const input = readInput();
if (input.stop_hook_active) process.exit(0);
let changed = '';
try { changed = execSync('git diff --name-only HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { process.exit(0); }
if (!/backend\/src\/(core\/auth|core\/roles|modules\/(accounting|fundraising|procurement|hr|planning))|\.controller\.ts|migrations\//.test(changed)) process.exit(0);
process.stdout.write(JSON.stringify({
  systemMessage: 'Sensitive files changed. Before finishing: run `npx jest test/security/route-authz.spec.ts`, '
    + '`npx jest test/security/tenant-isolation.e2e-spec.ts`, the module e2e spec, and ask the `sayed` agent to review the diff.',
}));
process.exit(0);
