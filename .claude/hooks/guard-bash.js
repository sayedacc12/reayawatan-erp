#!/usr/bin/env node
// PreToolUse(Bash): يمنع أوامر الإنتاج والقاعدة والأسرار، ويطلب موافقة بشرية للعمليات الحساسة.
'use strict';
const { readInput, decide } = require('./_lib');

const cmd = String(readInput().tool_input?.command ?? '');
const c = cmd.replace(/\s+/g, ' ');

const DENY = [
  [/\b(ssh|scp|sftp|rsync)\b/, 'Remote access to servers is a human-only operation.'],
  [/81\.208\.167\.28|sanabelerp\.com/i, 'Commands targeting production (sanabelerp.com) are human-only.'],
  [/deploy\/(setup|backup|mail-setup)\.sh/, 'Deployment, backup and mail setup scripts run on the server by the owner only.'],
  [/compose\.prod\.yml/, 'Production compose file: human-only.'],
  [/migration:(run|revert)|typeorm(-ts-node-commonjs)?\s+migration:(run|revert)|schema:(sync|drop)/, 'Running migrations is human-only. Create the migration file; the owner applies it.'],
  [/\b(pg_dump|pg_restore|pg_dumpall)\b/, 'Database dumps/restores are human-only.'],
  [/\bdocker\s+(compose\s+)?(down\s+.*-v|volume\s+rm|system\s+prune)/, 'Destroying Docker volumes deletes data: human-only.'],
  [/\bgit\s+push\b.*(\s--force\b|\s-f\b|\s--force-with-lease\b)/, 'Force push is not allowed.'],
  [/\bgit\s+push\b.*\b(main|master)\b/, 'Pushing to main is not allowed. Open a PR; the owner merges.'],
  [/\bgh\s+pr\s+merge\b|merge_pull_request/, 'Merging is done by the owner.'],
  [/(^|[;&|]\s*)(printenv|env|set)\s*($|[;&|>])/, 'Dumping the environment can expose secrets.'],
  [/(cat|less|more|head|tail|bat|grep|rg|awk|sed|cp|mv|type)\b[^|;&]*(^|[\s\/'"])\.env(?!\.example)(\.[a-z]+)?(\s|$|['"])/i, 'Reading .env files is not allowed (secrets).'],
  [/\/etc\/sanabel-backup|\.ssh\/|rclone(\.conf|\s+config)/, 'Backup keys, SSH keys and rclone config are secrets.'],
  [/\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME|\.\.?)(\s|$)/, 'Recursive delete of root/home/project is not allowed.'],
  [/\bcurl\b[^|]*\|\s*(sh|bash)\b|\bwget\b[^|]*\|\s*(sh|bash)\b/, 'Download-and-execute is not allowed.'],
];

const ASK = [
  [/\bpsql\b(?![^;&|]*charity_erp_test)/, 'psql outside the local test database needs human approval.'],
  [/\bdocker\b/, 'Docker commands need human approval.'],
  [/\bgit\s+push\b/, 'Pushing code needs human approval.'],
  [/\bnpm\s+(i|install|add|uninstall|update)\b(?!\s*$)(?!\s+--)/, 'Changing dependencies needs human approval (supply-chain risk).'],
  [/\b(curl|wget)\b/, 'Outbound network calls need human approval.'],
  [/\b(DROP|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE|UPDATE\s+\w+\s+SET)\b/i, 'Destructive SQL needs human approval.'],
];

for (const [re, why] of DENY) if (re.test(c)) decide('deny', `Blocked by Sanabel security policy: ${why}`);
for (const [re, why] of ASK) if (re.test(c)) decide('ask', `Sanabel security policy: ${why}`);
process.exit(0);
