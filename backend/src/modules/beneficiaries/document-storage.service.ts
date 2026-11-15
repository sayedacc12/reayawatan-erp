import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { ALLOWED_MIME, MAX_DOCUMENT_BYTES } from './constants';

/**
 * تخزين ملفات المستندات على القرص (UPLOAD_DIR، وفي Docker مجلد دائم /app/uploads).
 * كل جمعية لها مجلد باسم organization_id، واسم الملف uuid بدون امتداد،
 * فلا يمكن الوصول لملف إلا من خلال الـ API بعد التحقق من الصلاحية والجمعية.
 */
@Injectable()
export class DocumentStorage {
  private readonly root = resolve(process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads'));

  /** يتحقق من النوع الحقيقي للملف من أول بايتات فيه، مش من الاسم بس */
  detectMime(buf: Buffer): string | null {
    if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
    if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    return null;
  }

  async save(organizationId: string, file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('اختر ملفًا لرفعه');
    if (file.size > MAX_DOCUMENT_BYTES) throw new BadRequestException('حجم الملف أكبر من 10 ميجا');
    const mime = this.detectMime(file.buffer);
    if (!mime || !ALLOWED_MIME.includes(mime)) {
      throw new BadRequestException('نوع الملف غير مسموح. المسموح: صور (JPG أو PNG) أو PDF');
    }
    const key = `${organizationId}/${randomUUID()}`;
    await mkdir(join(this.root, organizationId), { recursive: true });
    await writeFile(join(this.root, key), file.buffer);
    return { key, mime };
  }

  open(key: string) {
    return createReadStream(this.path(key));
  }

  async remove(keys: string[]) {
    await Promise.all(keys.map((k) => rm(this.path(k), { force: true })));
  }

  private path(key: string) {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + '/')) throw new BadRequestException('مسار غير صالح');
    return p;
  }
}
