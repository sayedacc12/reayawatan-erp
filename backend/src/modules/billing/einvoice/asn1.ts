/**
 * ترميز DER مصغّر (ASN.1) لما تحتاجه الفوترة الإلكترونية فقط: طلب الشهادة (CSR) وقراءة توقيع الشهادة.
 * مكتوب داخليًا حتى لا نضيف مكتبة خارجية لمهمة محدودة.
 */

const len = (n: number) => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};

export const tlv = (tag: number, value: Buffer) => Buffer.concat([Buffer.from([tag]), len(value.length), value]);
export const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
export const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
export const int = (n: number | Buffer) => {
  let b = typeof n === 'number' ? Buffer.from([n]) : n;
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
};
export const bool = (v: boolean) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
export const octets = (b: Buffer) => tlv(0x04, b);
export const bits = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
export const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));
export const printable = (s: string) => tlv(0x13, Buffer.from(s, 'ascii'));
export const utcTime = (d: Date) => tlv(0x17, Buffer.from(`${d.toISOString().replace(/[-:T]/g, '').slice(2, 14)}Z`, 'ascii'));
/** وسم سياقي مُنشأ [n] */
export const ctx = (n: number, value: Buffer) => tlv(0xa0 | n, value);

export function oid(dotted: string) {
  const parts = dotted.split('.').map(Number);
  const out: number[] = [parts[0] * 40 + parts[1]];
  for (const p of parts.slice(2)) {
    const chunk: number[] = [p & 0x7f];
    for (let v = Math.floor(p / 128); v > 0; v = Math.floor(v / 128)) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

/** اسم مميز (Name): قائمة أزواج (المعرّف، القيمة)، كل زوج في مجموعة مستقلة */
export const name = (pairs: [string, Buffer][]) => seq(...pairs.map(([o, v]) => set(seq(oid(o), v))));

export interface Node { tag: number; start: number; header: number; length: number; value: Buffer; raw: Buffer }

/** قراءة عنصر DER واحد يبدأ عند الموضع المحدد */
export function read(buf: Buffer, at = 0): Node {
  const tag = buf[at];
  let length = buf[at + 1];
  let header = 2;
  if (length & 0x80) {
    const n = length & 0x7f;
    if (n < 1 || n > 4) throw new Error('DER length not supported');
    length = 0;
    for (let i = 0; i < n; i++) length = length * 256 + buf[at + 2 + i];
    header += n;
  }
  if (at + header + length > buf.length) throw new Error('DER truncated');
  return { tag, start: at, header, length, value: buf.subarray(at + header, at + header + length), raw: buf.subarray(at, at + header + length) };
}

/** عناصر حاوية (SEQUENCE أو SET أو وسم سياقي مُنشأ) */
export function children(node: Node): Node[] {
  const out: Node[] = [];
  for (let i = 0; i < node.value.length;) {
    const c = read(node.value, i);
    out.push(c);
    i += c.header + c.length;
  }
  return out;
}
