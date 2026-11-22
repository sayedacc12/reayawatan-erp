import { BadRequestException } from '@nestjs/common';
import { inflateRawSync } from 'zlib';

/**
 * فحص ملف xlsx قبل فتحه بمكتبة Excel: ملف xlsx أرشيف zip، وقد يكون صغيرًا مضغوطًا ويتمدد إلى أضعاف حجمه
 * عند فكه فيستهلك ذاكرة الخادم. نفك كل جزء هنا بحد أقصى فعلي للحجم (لا نعتمد على الأحجام المكتوبة في الأرشيف)،
 * ونرفض الملف إذا تجاوز مجموع ما فُك الحد، أو كثرت أجزاؤه، أو لم يكن أرشيف zip أصلًا.
 */
const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

export function assertSafeXlsx(buf: Buffer, maxUncompressed = 25 * 1024 * 1024, maxEntries = 500): void {
  const bad = () => new BadRequestException('تعذرت قراءة الملف. تأكد أنه ملف Excel سليم بصيغة xlsx');
  const big = () => new BadRequestException('محتوى الملف أكبر من المسموح بعد فك ضغطه');
  if (buf.length < 22 || buf.readUInt32LE(0) !== LOC) throw bad();
  // نهاية الأرشيف في آخر 22 بايت + تعليق لا يتجاوز 64KB
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw bad();
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || p === 0xffffffff) throw bad(); // zip64 لا يلزم لنموذج بهذا الحجم
  if (entries > maxEntries) throw big();
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN) throw bad();
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== LOC) throw bad();
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + csize > buf.length) throw bad();
    const data = buf.subarray(start, start + csize);
    const room = maxUncompressed - total;
    if (method === 0) total += csize;
    else if (method === 8) {
      try {
        total += inflateRawSync(data, { maxOutputLength: Math.max(1, room) }).length;
      } catch (e) {
        if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw big();
        throw bad();
      }
    } else throw bad();
    if (total > maxUncompressed) throw big();
    p += 46 + nameLen + extraLen + commentLen;
  }
}
