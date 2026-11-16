import { inflateRawSync } from 'zlib';

/**
 * قراءة ملفات الحضور بدون مكتبات خارجية:
 * - Excel (xlsx): ملف مضغوط فيه XML، نقرأ أول ورقة فقط.
 * - الملفات النصية: ملف attlog.dat من أجهزة البصمة، أو CSV / TXT مفصول بفاصلة أو Tab أو فاصلة منقوطة.
 * ثم نستخرج من كل سطر: رقم الموظف في الجهاز، والتاريخ، والوقت.
 */

// ---------------- قراءة xlsx ----------------

function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('الملف ليس ملف Excel صالحًا (xlsx)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!name.startsWith('xl/')) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(data) : data);
  }
  return files;
}

const decodeXml = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

const texts = (xml: string) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join('');

const colIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
};

/** صفوف أول ورقة في ملف xlsx كنصوص (الأرقام كما هي، والتواريخ أرقام Excel تسلسلية) */
export function readXlsx(buf: Buffer): string[][] {
  const files = unzip(buf);
  const shared = files.get('xl/sharedStrings.xml');
  const strings = shared ? [...shared.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1])) : [];
  const sheetName = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]))[0];
  if (!sheetName) throw new Error('لم نجد ورقة بيانات في ملف Excel');
  const xml = files.get(sheetName)!.toString('utf8');
  const rows: string[][] = [];
  for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const body = c[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val = '';
      if (type === 's') val = strings[Number(v)] ?? '';
      else if (type === 'inlineStr') val = texts(body);
      else if (v !== undefined) val = decodeXml(v);
      row[ref ? colIndex(ref) : row.length] = val;
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows;
}

// ---------------- قراءة الملفات النصية ----------------

export function readText(buf: Buffer): string[][] {
  let s: string;
  if (buf[0] === 0xff && buf[1] === 0xfe) s = buf.subarray(2).toString('utf16le');
  else s = buf.toString('utf8').replace(/^﻿/, '');
  return s.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : line.includes(',') ? ',' : null;
    const cells = sep ? line.split(sep) : line.split(/\s{2,}/);
    return cells.map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim());
  });
}

// ---------------- استخراج البصمات ----------------

export interface ParsedPunch { code: string; date: string; time: string }

const pad = (n: number | string) => String(n).padStart(2, '0');

function excelSerial(n: number) {
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 19) };
}

function toTime(h: number, m: number, s: number, ampm?: string) {
  let hh = h;
  if (ampm) {
    const pm = /pm|م/i.test(ampm);
    if (pm && hh < 12) hh += 12;
    if (!pm && hh === 12) hh = 0;
  }
  if (hh > 23 || m > 59 || s > 59) return null;
  return `${pad(hh)}:${pad(m)}:${pad(s)}`;
}

function toDate(y: number, m: number, d: number) {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

const DATE_YMD = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/;
const DATE_DMY = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/;
const TIME = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|ص|م)?/i;

/** يفسر خلية: تاريخ، أو وقت، أو تاريخ ووقت معًا */
export function parseCell(raw: string): { date?: string; time?: string } {
  const v = raw.trim();
  if (!v) return {};
  if (/^\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (n > 0 && n < 1) {
      const secs = Math.round(n * 86400);
      return { time: toTime(Math.floor(secs / 3600) % 24, Math.floor(secs / 60) % 60, secs % 60) ?? undefined };
    }
    if (n >= 36526 && n < 73051) {
      const r = excelSerial(n);
      return Number.isInteger(n) ? { date: r.date } : r;
    }
    return {};
  }
  const out: { date?: string; time?: string } = {};
  const ymd = DATE_YMD.exec(v);
  const dmy = ymd ? null : DATE_DMY.exec(v);
  if (ymd) out.date = toDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3])) ?? undefined;
  else if (dmy) out.date = toDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1])) ?? undefined;
  const rest = ymd ? v.replace(ymd[0], ' ') : dmy ? v.replace(dmy[0], ' ') : v;
  const t = TIME.exec(rest);
  if (t) out.time = toTime(Number(t[1]), Number(t[2]), Number(t[3] ?? 0), t[4]) ?? undefined;
  return out;
}

const CODE = /^[A-Za-z0-9_-]{1,30}$/;
const H_CODE = /(^|\s)(ac-?no\.?|no\.?|id|pin|user ?id|emp(loyee)? ?(no|id|code)|code|رقم|الرقم|كود|رقم الموظف|رقم البصمة)(\s|$)/i;
const H_DATE = /(date|التاريخ|تاريخ)/i;
const H_TIME = /(time|الوقت|وقت)/i;

/**
 * يستخرج البصمات من صفوف ملف. إن وُجد صف عناوين (رقم، التاريخ، الوقت) نستخدمه،
 * وإلا نعتبر أول خلية رقم الموظف ونبحث في باقي الخلايا عن التاريخ والوقت.
 */
export function extractPunches(rows: string[][]): { punches: ParsedPunch[]; invalid: number } {
  let start = 0;
  let codeCol = -1;
  let dateCol = -1;
  let timeCol = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i].map((c) => c.toLowerCase());
    const c = r.findIndex((x) => H_CODE.test(x) && !H_DATE.test(x));
    const d = r.findIndex((x) => H_DATE.test(x));
    if (c >= 0 && d >= 0) {
      codeCol = c;
      dateCol = d;
      timeCol = r.findIndex((x, k) => k !== d && H_TIME.test(x));
      start = i + 1;
      break;
    }
  }
  const punches: ParsedPunch[] = [];
  let invalid = 0;
  for (const row of rows.slice(start)) {
    if (!row.some((c) => c.trim())) continue;
    let code: string | undefined;
    let date: string | undefined;
    let time: string | undefined;
    if (codeCol >= 0) {
      code = row[codeCol]?.trim().replace(/\.0$/, '');
      const d = parseCell(row[dateCol] ?? '');
      date = d.date;
      time = d.time;
      if (timeCol >= 0) time = parseCell(row[timeCol] ?? '').time ?? time;
    } else {
      const cells = row.map((c) => c.trim());
      code = cells.find((c) => c)?.replace(/\.0$/, '');
      for (const c of cells.slice(cells.indexOf(code ?? '') + 1)) {
        const p = parseCell(c);
        if (p.date && !date) date = p.date;
        if (p.time && !time) time = p.time;
        if (date && time) break;
      }
    }
    if (!code || !CODE.test(code) || !date || !time) {
      invalid++;
      continue;
    }
    punches.push({ code, date, time });
  }
  return { punches, invalid };
}

/** سطور ATTLOG التي يرسلها جهاز البصمة: الرقم ثم التاريخ والوقت مفصولة بـ Tab */
export function parseAttlog(body: string): ParsedPunch[] {
  return extractPunches(body.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('\t').map((c) => c.trim()))).punches;
}
