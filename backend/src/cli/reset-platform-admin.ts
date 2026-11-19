import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../config/data-source';
import { generateTempPassword, tempExpiry } from '../core/auth/password-reset.service';

/**
 * استعادة حساب مالك المنصة (admin) من الخادم نفسه، لأنه لا يوجد من هو أعلى منه ليسلّمه كلمة مؤقتة.
 * يطبع كلمة مرور مؤقتة صالحة 24 ساعة، ويُلزم بتغييرها عند أول دخول، وينهي الجلسات المفتوحة.
 * التشغيل على الخادم:
 *   docker compose exec backend node dist/cli/reset-platform-admin.js
 */
async function main() {
  const db = new DataSource(dataSourceOptions());
  await db.initialize();
  try {
    const [owner] = await db.query(
      `SELECT id, username, email FROM users WHERE is_platform_admin AND platform_role IS NULL ORDER BY created_at LIMIT 1`,
    );
    if (!owner) throw new Error('No platform owner account found');
    const password = generateTempPassword();
    await db.query(
      `UPDATE users SET password_hash = $2, must_change_password = true, temp_password_expires_at = $3, sessions_valid_after = now(), is_active = true WHERE id = $1`,
      [owner.id, await bcrypt.hash(password, 12), tempExpiry()],
    );
    await db.query(
      `INSERT INTO password_resets (audience, user_id, subject_name, origin, status, issued_at, issued_by, expires_at)
       VALUES ('platform', $1, 'مالك المنصة', 'direct', 'issued', now(), 'الخادم', $2)`,
      [owner.id, tempExpiry()],
    );
    console.log(`Login: ${owner.username ?? owner.email}`);
    console.log(`Temporary password (valid 24 hours, must be changed at first login): ${password}`);
  } finally {
    await db.destroy();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
