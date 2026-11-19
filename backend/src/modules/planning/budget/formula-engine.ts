/**
 * محرك معادلات آمن للموازنات: لا يستخدم eval ولا Function.
 * يحلل المعادلة إلى شجرة ثم يحسبها بالمتغيرات المعطاة فقط، ويرجع القيمة مع المتغيرات المستخدمة (للتتبع).
 *
 * المدعوم: الأرقام، المتغيرات (حروف إنجليزية وأرقام و_)، + - * / ^ %، الأقواس،
 * المقارنات < <= > >= = != ، والربط and/or/not (أو && || !)،
 * والدوال: IF(شرط، قيمة، بديل)، MIN، MAX، ROUND(قيمة، منازل)، ABS، AVG، SUM، CEIL، FLOOR، CLAMP(قيمة، أدنى، أعلى).
 * القسمة على صفر ترجع صفرًا مع تنبيه في التتبع.
 */

export type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'un'; op: '-' | '+' | 'not'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; fn: string; args: Node[] };

export class FormulaError extends Error {}

const MAX_LEN = 2000;
const MAX_TOKENS = 600;
const MAX_DEPTH = 60;
export const FUNCTIONS: Record<string, { min: number; max: number; label: string }> = {
  IF: { min: 3, max: 3, label: 'IF(الشرط، القيمة إن تحقق، القيمة إن لم يتحقق)' },
  MIN: { min: 1, max: 30, label: 'MIN(أ، ب، ...) أصغر قيمة' },
  MAX: { min: 1, max: 30, label: 'MAX(أ، ب، ...) أكبر قيمة' },
  ROUND: { min: 1, max: 2, label: 'ROUND(القيمة، عدد المنازل)' },
  ABS: { min: 1, max: 1, label: 'ABS(القيمة) القيمة المطلقة' },
  AVG: { min: 1, max: 30, label: 'AVG(أ، ب، ...) المتوسط' },
  SUM: { min: 1, max: 30, label: 'SUM(أ، ب، ...) المجموع' },
  CEIL: { min: 1, max: 1, label: 'CEIL(القيمة) تقريب لأعلى' },
  FLOOR: { min: 1, max: 1, label: 'FLOOR(القيمة) تقريب لأسفل' },
  CLAMP: { min: 3, max: 3, label: 'CLAMP(القيمة، الأدنى، الأعلى)' },
};

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string } | { k: '(' } | { k: ')' } | { k: ',' };

function tokenize(src: string): Tok[] {
  if (src.length > MAX_LEN) throw new FormulaError('المعادلة أطول من المسموح');
  const s = src.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/٫/g, '.').replace(/،/g, ',').replace(/×/g, '*').replace(/÷/g, '/');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/.exec(s.slice(i)) ?? /^[0-9]+\.?/.exec(s.slice(i));
      if (!m) throw new FormulaError(`رقم غير صحيح عند «${s.slice(i, i + 8)}»`);
      out.push({ k: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i))!;
      const w = m[0];
      const lw = w.toLowerCase();
      if (lw === 'and' || lw === 'or' || lw === 'not') out.push({ k: 'op', v: lw });
      else if (lw === 'true' || lw === 'false') out.push({ k: 'num', v: lw === 'true' ? 1 : 0 });
      else out.push({ k: 'id', v: w });
      i += w.length;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (['<=', '>=', '!=', '==', '&&', '||', '<>'].includes(two)) {
      out.push({ k: 'op', v: two === '&&' ? 'and' : two === '||' ? 'or' : two === '==' ? '=' : two === '<>' ? '!=' : two });
      i += 2;
      continue;
    }
    if ('+-*/^%<>=!'.includes(c)) { out.push({ k: 'op', v: c === '!' ? 'not' : c }); i++; continue; }
    if (c === '(') { out.push({ k: '(' }); i++; continue; }
    if (c === ')') { out.push({ k: ')' }); i++; continue; }
    if (c === ',') { out.push({ k: ',' }); i++; continue; }
    throw new FormulaError(`رمز غير مسموح في المعادلة: «${c}»`);
  }
  if (out.length > MAX_TOKENS) throw new FormulaError('المعادلة أطول من المسموح');
  return out;
}

/** تحليل المعادلة إلى شجرة (يرمي FormulaError برسالة عربية عند الخطأ) */
export function parse(src: string): Node {
  if (!src?.trim()) throw new FormulaError('المعادلة فارغة');
  const toks = tokenize(src);
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => { const t = toks[p]; return t?.k === 'op' && t.v === v; };
  const enter = () => { if (++depth > MAX_DEPTH) throw new FormulaError('المعادلة متداخلة أكثر من المسموح'); };

  const binary = (next: () => Node, ops: string[]) => (): Node => {
    let a = next();
    for (;;) {
      const t = peek();
      if (t?.k === 'op' && ops.includes(t.v)) { p++; a = { t: 'bin', op: t.v, a, b: next() }; } else return a;
    }
  };
  const primary = (): Node => {
    enter();
    try {
      const t = peek();
      if (!t) throw new FormulaError('المعادلة ناقصة في آخرها');
      if (t.k === 'num') { p++; return { t: 'num', v: t.v }; }
      if (t.k === '(') {
        p++;
        const e = orE();
        if (peek()?.k !== ')') throw new FormulaError('قوس مفتوح لم يُغلق');
        p++;
        return e;
      }
      if (t.k === 'id') {
        p++;
        if (peek()?.k === '(') {
          const fn = t.v.toUpperCase();
          const def = FUNCTIONS[fn];
          if (!def) throw new FormulaError(`الدالة ${t.v} غير معروفة`);
          p++;
          const args: Node[] = [];
          if (peek()?.k !== ')') {
            for (;;) {
              args.push(orE());
              if (peek()?.k === ',') { p++; continue; }
              break;
            }
          }
          if (peek()?.k !== ')') throw new FormulaError(`أغلق قوس الدالة ${fn}`);
          p++;
          if (args.length < def.min || args.length > def.max) throw new FormulaError(`عدد مدخلات الدالة ${fn} غير صحيح: ${def.label}`);
          return { t: 'call', fn, args };
        }
        return { t: 'var', name: t.v };
      }
      if (t.k === 'op' && (t.v === '-' || t.v === '+' || t.v === 'not')) { p++; return { t: 'un', op: t.v as '-' | '+' | 'not', a: power() }; }
      throw new FormulaError('ترتيب الرموز في المعادلة غير صحيح');
    } finally {
      depth--;
    }
  };
  const power = (): Node => {
    const a = primary();
    if (isOp('^')) { p++; return { t: 'bin', op: '^', a, b: unary() }; }
    return a;
  };
  const unary = (): Node => {
    const t = peek();
    if (t?.k === 'op' && (t.v === '-' || t.v === '+' || t.v === 'not')) { p++; enter(); try { return { t: 'un', op: t.v as '-' | '+' | 'not', a: unary() }; } finally { depth--; } }
    return power();
  };
  const mul = binary(unary, ['*', '/', '%']);
  const add = binary(mul, ['+', '-']);
  const cmp = binary(add, ['<', '<=', '>', '>=', '=', '!=']);
  const notE = (): Node => cmp();
  const andE = binary(notE, ['and']);
  const orE: () => Node = binary(andE, ['or']);
  const tree = orE();
  if (p < toks.length) throw new FormulaError('يوجد رمز زائد في المعادلة');
  return tree;
}

/** أسماء المتغيرات التي تستخدمها المعادلة */
export function variablesOf(n: Node, out = new Set<string>()): Set<string> {
  if (n.t === 'var') out.add(n.name);
  else if (n.t === 'un') variablesOf(n.a, out);
  else if (n.t === 'bin') { variablesOf(n.a, out); variablesOf(n.b, out); }
  else if (n.t === 'call') n.args.forEach((a) => variablesOf(a, out));
  return out;
}

export interface EvalResult { value: number; used: Record<string, number>; warnings: string[] }

export function evaluate(tree: Node, vars: Record<string, number>): EvalResult {
  const used: Record<string, number> = {};
  const warnings = new Set<string>();
  const ev = (n: Node): number => {
    switch (n.t) {
      case 'num': return n.v;
      case 'var': {
        if (!Object.prototype.hasOwnProperty.call(vars, n.name)) throw new FormulaError(`المتغير ${n.name} غير معرّف`);
        const v = Number(vars[n.name]);
        if (!Number.isFinite(v)) throw new FormulaError(`قيمة المتغير ${n.name} ليست رقمًا`);
        used[n.name] = v;
        return v;
      }
      case 'un': { const a = ev(n.a); return n.op === '-' ? -a : n.op === 'not' ? (a ? 0 : 1) : a; }
      case 'bin': {
        if (n.op === 'and') return ev(n.a) && ev(n.b) ? 1 : 0;
        if (n.op === 'or') return ev(n.a) || ev(n.b) ? 1 : 0;
        const a = ev(n.a), b = ev(n.b);
        switch (n.op) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/': if (b === 0) { warnings.add('قسمة على صفر اعتُبرت صفرًا'); return 0; } return a / b;
          case '%': if (b === 0) { warnings.add('باقي قسمة على صفر اعتُبر صفرًا'); return 0; } return a % b;
          case '^': return a ** b;
          case '<': return a < b ? 1 : 0;
          case '<=': return a <= b ? 1 : 0;
          case '>': return a > b ? 1 : 0;
          case '>=': return a >= b ? 1 : 0;
          case '=': return Math.abs(a - b) < 1e-9 ? 1 : 0;
          case '!=': return Math.abs(a - b) >= 1e-9 ? 1 : 0;
        }
        throw new FormulaError('عملية غير معروفة');
      }
      case 'call': {
        if (n.fn === 'IF') return ev(n.args[0]) ? ev(n.args[1]) : ev(n.args[2]);
        const xs = n.args.map(ev);
        switch (n.fn) {
          case 'MIN': return Math.min(...xs);
          case 'MAX': return Math.max(...xs);
          case 'ROUND': { const f = 10 ** Math.max(0, Math.min(6, Math.trunc(xs[1] ?? 0))); return Math.round(xs[0] * f) / f; }
          case 'ABS': return Math.abs(xs[0]);
          case 'AVG': return xs.reduce((s, x) => s + x, 0) / xs.length;
          case 'SUM': return xs.reduce((s, x) => s + x, 0);
          case 'CEIL': return Math.ceil(xs[0]);
          case 'FLOOR': return Math.floor(xs[0]);
          case 'CLAMP': return Math.min(Math.max(xs[0], xs[1]), xs[2]);
        }
        throw new FormulaError(`الدالة ${n.fn} غير معروفة`);
      }
    }
  };
  const value = ev(tree);
  if (!Number.isFinite(value)) throw new FormulaError('نتيجة المعادلة ليست رقمًا محددًا');
  return { value, used, warnings: [...warnings] };
}

const cache = new Map<string, Node>();
/** تحليل مع ذاكرة مؤقتة (المعادلة نفسها تُحسب لآلاف الصفوف) */
export function compile(src: string): Node {
  let t = cache.get(src);
  if (!t) {
    t = parse(src);
    if (cache.size > 500) cache.clear();
    cache.set(src, t);
  }
  return t;
}

export function run(src: string, vars: Record<string, number>): EvalResult {
  return evaluate(compile(src), vars);
}

export const VAR_KEY = /^[a-z][a-z0-9_]{0,39}$/;
