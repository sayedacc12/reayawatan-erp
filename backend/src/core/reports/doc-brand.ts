import { Logger } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { FileStore } from '../files/file-store.service';
import { COMPANY_BRAND } from '../identity/company-brand';
import { OrgIdentity } from '../identity/identity.entity';
import { BoardDoc } from './board-doc';

const MAX_LOGO = 2 * 1024 * 1024;

/**
 * هوية الوثائق الرسمية (تقارير المجلس، ملف القوائم المالية): اسم الشركة وألوانها وشعارها مضمّنًا،
 * وتشكيل مجلس المديرين غير السري من نظام الاجتماعات لصفحة التوقيعات. قراءة فقط.
 */
export type DocBrand = Pick<BoardDoc, 'organizationName' | 'englishName' | 'logo' | 'colors'>;

/** الشعار من هوية الشركة، وإلا الشعار الافتراضي المرفق مع النظام. يتوقف عند تجاوز الحد بدل قراءة ملف كبير في الذاكرة */
export async function docLogo(files: FileStore, id: OrgIdentity | null, log: Logger): Promise<string | null> {
  const read = async () => {
    if (id?.logo?.key) {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of files.open(id.logo.key)) {
        size += (c as Buffer).length;
        if (size > MAX_LOGO) throw new Error('logo too large');
        chunks.push(c as Buffer);
      }
      return { buf: Buffer.concat(chunks), mime: id.logo.mime };
    }
    const dir = process.env.BRAND_DIR ?? join(process.cwd(), 'assets', 'brand');
    return { buf: await readFile(join(dir, COMPANY_BRAND.logos.logo)), mime: 'image/png' };
  };
  try {
    const { buf, mime } = await read();
    if (!/^image\/(png|jpeg|webp)$/.test(mime) || buf.length > MAX_LOGO) return null;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (e) {
    log.warn(`Logo not embedded: ${(e as Error).message}`);
    return null;
  }
}

export async function docBrand(db: DataSource, files: FileStore, org: string, log: Logger): Promise<DocBrand> {
  const id = await db.getRepository(OrgIdentity).findOne({ where: { organizationId: org } });
  const [o] = await db.query('SELECT name FROM organizations WHERE id = $1', [org]);
  return {
    organizationName: id?.displayName || o?.name || COMPANY_BRAND.displayName, englishName: id?.englishName ?? null,
    logo: await docLogo(files, id, log),
    colors: { primary: id?.colors?.primary ?? COMPANY_BRAND.colors.primary, accent: id?.colors?.accent ?? COMPANY_BRAND.colors.accent, dark: id?.colors?.dark ?? COMPANY_BRAND.colors.dark },
  };
}

export interface BoardBody { name: string; members: { role: string; name: string; title: string | null }[] }

/** مجلس المديرين من نظام الاجتماعات. الجهة السرية لا تُقرأ هنا، لأن نظام الاجتماعات يخفيها عن غير أعضائها */
export async function boardBody(db: DataSource, org: string, log: Logger): Promise<BoardBody | null> {
  const rows: BoardBody[] = await db.query(
    `SELECT name, members FROM mtg_bodies WHERE organization_id = $1 AND kind = 'board' AND is_active = true AND is_confidential = false ORDER BY created_at LIMIT 1`, [org])
    .catch((e: Error) => { log.warn(`Board body not read: ${e.message}`); return []; });
  return rows[0] ?? null;
}

export const BOARD_ROLE: Record<string, string> = { chair: 'رئيس المجلس', vice: 'نائب الرئيس', member: 'عضو المجلس', secretary: 'أمين سر المجلس', rapporteur: 'مقرر المجلس', advisor: 'مستشار' };
export const BOARD_ROLE_ORDER = ['chair', 'vice', 'member', 'rapporteur', 'secretary'];
