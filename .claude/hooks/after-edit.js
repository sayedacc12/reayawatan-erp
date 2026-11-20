#!/usr/bin/env node
// PostToolUse(Edit/Write): بعد تعديل أي controller يشغّل بوابة «كل مسار له قرار صلاحية».
'use strict';
const { execSync } = require('child_process');
const path = require('path');
const { readInput } = require('./_lib');

const file = String(readInput().tool_input?.file_path ?? '').replace(/\\/g, '/');
if (!/\/backend\/src\/.*\.controller\.ts$/.test(file)) process.exit(0);

const backend = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), 'backend');
try {
  execSync('npx jest test/security/route-authz.spec.ts --silent', { cwd: backend, stdio: 'pipe', timeout: 170000 });
} catch (e) {
  const out = String(e.stdout ?? '') + String(e.stderr ?? '');
  process.stderr.write(
    'Security gate failed: every route needs @RequirePermissions, @RequireAnyPermission, @Public or @AuthenticatedOnly(reason).\n'
    + out.split('\n').filter((l) => /->|Expected|Received|✕/.test(l)).slice(0, 40).join('\n'),
  );
  process.exit(2); // يعيد الخطأ إلى Claude ليصلحه
}
process.exit(0);
