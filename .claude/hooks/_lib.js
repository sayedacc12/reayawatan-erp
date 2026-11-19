// أدوات مشتركة لـ hooks الأمان. تقرأ JSON من stdin وتعيد قرار PreToolUse.
'use strict';
const fs = require('fs');

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

/** decision: 'deny' | 'ask' | 'allow' */
function decide(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason },
  }));
  process.exit(0);
}

const SECRET_PATH = [
  /(^|[\/\\])\.env(\.[^\/\\]*)?$/i,
  /\.(pem|key|p12|pfx|jks)$/i,
  /(^|[\/\\])id_(rsa|ed25519|ecdsa)(\.pub)?$/i,
  /[\/\\]etc[\/\\]sanabel-backup([\/\\]|$)/i,
  /[\/\\]\.ssh([\/\\]|$)/i,
  /rclone\.conf$/i,
  /(^|[\/\\])\.?credentials(\.json)?$/i,
  /\.claude[\/\\]settings\.local\.json$/i,
];
const isSecretPath = (p) => !!p && SECRET_PATH.some((r) => r.test(p)) && !/\.env\.example$/i.test(p);

const SECRET_CONTENT = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
  [/\bsk-(ant-)?[A-Za-z0-9_-]{20,}\b/, 'API key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'Slack token'],
  [/\b(SMTP_PASS|JWT_SECRET|DB_PASSWORD|PLATFORM_ADMIN_PASSWORD)\s*[:=]\s*['"]?(?!change-me|ChangeMe|\$\{|process\.env|test-secret)[^\s'"]{8,}/, 'hard-coded secret variable'],
  [/postgres(ql)?:\/\/[^:\s]+:(?!erp@|\$\{|password@)[^@\s]{6,}@(?!localhost|db:|127\.0\.0\.1)/, 'database URL with password'],
];
const secretInContent = (s) => (s ? SECRET_CONTENT.find(([r]) => r.test(s))?.[1] : undefined);

module.exports = { readInput, decide, isSecretPath, secretInContent };
