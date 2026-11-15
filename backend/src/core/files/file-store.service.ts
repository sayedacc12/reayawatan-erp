import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join, resolve } from 'path';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

/**
 * تخزين ملفات المنصة (مثل مستندات ترخيص الجمعيات) على القرص في UPLOAD_DIR.
 * الملف يُحفظ باسم عشوائي بدون امتداد ولا يُفتح إلا من خلال الـ API بعد التحقق من الصلاحية.
 */
@Injectable()
export class FileStore {
  private readonly root = resolve(process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads'));

  /** النوع الحقيقي للملف من أول بايتات فيه، مش من الاسم */
  private detectMime(buf: Buffer): string | null {
    if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
    if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    return null;
  }

  async save(folder: string, file: Express.Multer.File | undefined, label = 'الملف') {
    if (!file?.buffer?.length) throw new BadRequestException(`أرفق ${label}`);
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException(`حجم ${label} أكبر من 10 ميجابايت`);
    const mime = this.detectMime(file.buffer);
    if (!mime || !ALLOWED.includes(mime)) {
      throw new BadRequestException(`نوع ${label} غير مسموح. المسموح: PDF أو صورة (JPG أو PNG)`);
    }
    const key = `${folder}/${randomUUID()}`;
    await mkdir(join(this.root, folder), { recursive: true });
    await writeFile(join(this.root, key), file.buffer);
    // اسم الملف كما رفعه المستخدم (multer يقرأه latin1)
    const name = Buffer.from(file.originalname ?? 'file', 'latin1').toString('utf8').slice(0, 200);
    return { key, mime, name };
  }

  open(key: string) {
    return createReadStream(this.path(key));
  }

  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }

  private path(key: string) {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + '/')) throw new BadRequestException('مسار غير صالح');
    return p;
  }
}
