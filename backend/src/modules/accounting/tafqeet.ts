/** تفقيط المبالغ بالريال السعودي: 1250.5 ← «فقط ألف ومائتان وخمسون ريالًا سعوديًا وخمسون هللة لا غير» */

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
  'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

/** [مفرد، مثنى، جمع (3-10)، تمييز (11+)] */
const SCALES: [string, string, string, string][] = [
  ['', '', '', ''],
  ['ألف', 'ألفان', 'آلاف', 'ألف'],
  ['مليون', 'مليونان', 'ملايين', 'مليون'],
  ['مليار', 'ملياران', 'مليارات', 'مليار'],
];

function below1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    if (r < 20) parts.push(ONES[r]);
    else parts.push(r % 10 ? `${ONES[r % 10]} و${TENS[Math.floor(r / 10)]}` : TENS[Math.floor(r / 10)]);
  }
  return parts.join(' و');
}

export function numberToArabic(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'صفر';
  const groups: string[] = [];
  for (let s = 0; n > 0 && s < SCALES.length; s++) {
    const g = n % 1000;
    n = Math.floor(n / 1000);
    if (!g) continue;
    if (s === 0) groups.unshift(below1000(g));
    else {
      const [one, two, few, many] = SCALES[s];
      if (g === 1) groups.unshift(one);
      else if (g === 2) groups.unshift(two);
      else if (g <= 10) groups.unshift(`${below1000(g)} ${few}`);
      else groups.unshift(`${below1000(g)} ${many}`);
    }
  }
  return groups.join(' و');
}

/** تمييز العدد: ريال / ريالان / ريالات / ريالًا */
function counted(n: number, [one, two, few, many]: [string, string, string, string], single: string) {
  const r = n % 100;
  if (n === 1) return `${one} ${single}`;
  if (n === 2) return two;
  if (r >= 3 && r <= 10) return `${numberToArabic(n)} ${few}`;
  return `${numberToArabic(n)} ${r === 0 || r < 3 ? one : many}`;
}

export function tafqeetSar(amount: number): string {
  const total = Math.round(Number(amount) * 100);
  const riyals = Math.floor(total / 100);
  const halalas = total % 100;
  const parts: string[] = [];
  if (riyals) parts.push(counted(riyals, ['ريال سعودي', 'ريالان سعوديان', 'ريالات سعودية', 'ريالًا سعوديًا'], 'واحد'));
  if (halalas) parts.push(counted(halalas, ['هللة', 'هللتان', 'هللات', 'هللة'], 'واحدة'));
  if (!parts.length) return 'صفر ريال';
  return `فقط ${parts.join(' و')} لا غير`;
}
