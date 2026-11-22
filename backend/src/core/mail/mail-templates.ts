/**
 * قوالب البريد: تصميم عربي من اليمين لليسار بألوان رعاية وطن، يعمل في Gmail وOutlook والجوال
 * (جداول وأنماط مضمّنة فقط، بلا ملفات CSS خارجية).
 */

export interface MailContent {
  subject: string;
  html: string;
  text: string;
}

export interface MailLayout {
  /** العنوان الكبير داخل الرسالة (ويُستخدم موضوعًا إن لم يُحدد) */
  title: string;
  subject?: string;
  /** سطر الترحيب، مثل: السلام عليكم أ. أحمد */
  greeting?: string;
  /** فقرات النص */
  paragraphs?: string[];
  /** جدول بيانات مختصر (العنوان: القيمة) */
  facts?: { label: string; value: string; ltr?: boolean }[];
  button?: { label: string; url: string };
  /** ملاحظة صغيرة أسفل الرسالة */
  note?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** الرابط العام للمنصة لبناء روابط مطلقة في الرسائل (PUBLIC_URL أو الدومين) */
export function publicOrigin(): string | null {
  const url = process.env.PUBLIC_URL?.trim();
  if (url) return url.replace(/\/$/, '');
  const domain = process.env.DOMAIN?.trim();
  return domain ? `https://${domain}` : null;
}

export function mailLayout(m: MailLayout): MailContent {
  const font = "'IBM Plex Sans Arabic', Tahoma, 'Segoe UI', Arial, sans-serif";
  const p = (t: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.9;color:#1f2937">${esc(t)}</p>`;
  const facts = m.facts?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border-collapse:collapse;background:#f6f8f5;border-radius:10px">${m.facts
        .map((f) => `<tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;width:38%;border-bottom:1px solid #e5ebe3">${esc(f.label)}</td><td style="padding:10px 14px;font-size:14px;color:#111827;font-weight:600;border-bottom:1px solid #e5ebe3"${f.ltr ? ' dir="ltr" align="right"' : ''}>${esc(f.value)}</td></tr>`)
        .join('')}</table>`
    : '';
  const button = m.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="border-radius:10px;background:#164e38"><a href="${esc(m.button.url)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${font};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px">${esc(m.button.label)}</a></td></tr></table>
       <p style="margin:0 0 16px;font-size:12px;color:#6b7280;line-height:1.7">إذا لم يعمل الزر، انسخ هذا الرابط في المتصفح:<br><span dir="ltr" style="word-break:break-all;color:#164e38">${esc(m.button.url)}</span></p>`
    : '';
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.subject ?? m.title)}</title></head>
<body style="margin:0;padding:0;background:#eef2ec;font-family:${font}" dir="rtl">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2ec;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.06)" dir="rtl">
<tr><td style="background:linear-gradient(135deg,#10291e,#164e38 60%,#c7a27a);background-color:#164e38;padding:22px 28px;text-align:right">
<span style="font-size:22px;font-weight:800;color:#ffffff;font-family:${font}">رعاية وطن</span>
<span style="display:block;font-size:12px;color:#e7f2ea;margin-top:4px;font-family:${font}">National Care</span>
</td></tr>
<tr><td style="padding:28px;text-align:right;font-family:${font}">
<h1 style="margin:0 0 16px;font-size:20px;color:#164e38;line-height:1.6">${esc(m.title)}</h1>
${m.greeting ? p(m.greeting) : ''}${(m.paragraphs ?? []).map(p).join('')}${facts}${button}
${m.note ? `<p style="margin:0;font-size:12px;color:#6b7280;line-height:1.8;border-top:1px solid #eef2ec;padding-top:14px">${esc(m.note)}</p>` : ''}
</td></tr>
<tr><td style="background:#f6f8f5;padding:14px 28px;text-align:center;font-size:11px;color:#9ca3af;font-family:${font}">رسالة آلية من نظام رعاية وطن. يُرجى عدم مشاركة بيانات الدخول مع أي شخص.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    m.title, '',
    ...(m.greeting ? [m.greeting, ''] : []),
    ...(m.paragraphs ?? []).flatMap((x) => [x, '']),
    ...(m.facts ?? []).map((f) => `${f.label}: ${f.value}`),
    ...(m.button ? ['', `${m.button.label}: ${m.button.url}`] : []),
    ...(m.note ? ['', m.note] : []),
    '', '— رعاية وطن',
  ].join('\n');
  return { subject: m.subject ?? m.title, html, text };
}

const link = (path: string) => {
  const o = publicOrigin();
  return o ? `${o}${path}` : null;
};
const btn = (label: string, path: string, origin?: string | null) => {
  const url = origin ? `${origin}${path}` : link(path);
  return url ? { label, url } : undefined;
};

export const templates = {
  test: (by: string) => mailLayout({
    title: 'رسالة تجريبية من رعاية وطن',
    paragraphs: ['وصلتك هذه الرسالة لأن إعدادات البريد في نظام رعاية وطن تعمل بشكل صحيح.', `أرسلها: ${by}`],
    note: 'لا يلزم أي إجراء.',
  }),

  contractLink: (v: { orgName: string; number: string; name?: string; path: string; origin?: string | null }) => mailLayout({
    title: `عقد الاشتراك ${v.number} جاهز للتوقيع`,
    subject: `عقد الاشتراك ${v.number} - منصة سنابل`,
    greeting: v.name ? `السلام عليكم ${v.name}،` : 'السلام عليكم،',
    paragraphs: [
      `نرفق لكم رابط عقد اشتراك ${v.orgName} في منصة سنابل. يمكنكم قراءة العقد كاملًا ثم توقيعه إلكترونيًا، أو طلب تعديل عليه.`,
      'سيُطلب منكم رقم ترخيص الجمعية للتحقق قبل التوقيع.',
    ],
    button: btn('فتح العقد وتوقيعه', v.path, v.origin),
    note: 'الرابط خاص بجمعيتكم، فلا تشاركوه خارجها.',
  }),

  adminWelcome: (v: { orgName: string; name: string; login: string; path: string; password: string | null; origin?: string | null }) => mailLayout({
    title: `مرحبًا بكم في سنابل: تم اعتماد ${v.orgName}`,
    greeting: `السلام عليكم ${v.name}،`,
    paragraphs: [
      'تم اعتماد طلب اشتراك جمعيتكم، وأصبح حساب مدير النظام جاهزًا.',
      v.password ? 'هذه كلمة مرور مؤقتة، غيّرها بعد أول دخول من صفحة «حسابي».' : 'ادخل بكلمة المرور التي اخترتها عند التسجيل.',
    ],
    facts: [
      { label: 'اسم الدخول', value: v.login, ltr: true },
      ...(v.password ? [{ label: 'كلمة المرور المؤقتة', value: v.password, ltr: true }] : []),
    ],
    button: btn('الدخول إلى المنصة', v.path, v.origin),
    note: 'إذا لم تطلبوا الاشتراك في سنابل فتجاهلوا هذه الرسالة.',
  }),

  tempPassword: (v: { orgName: string; name: string; login: string; password: string; path: string; origin?: string | null }) => mailLayout({
    title: 'كلمة مرور مؤقتة جديدة',
    greeting: `السلام عليكم ${v.name}،`,
    paragraphs: [`أنشأت إدارة منصة سنابل كلمة مرور مؤقتة جديدة لحساب مدير النظام في ${v.orgName}.`, 'كلمة المرور صالحة 24 ساعة، وسيطلب منك النظام اختيار كلمة مرور جديدة عند أول دخول.'],
    facts: [{ label: 'اسم الدخول', value: v.login, ltr: true }, { label: 'كلمة المرور المؤقتة', value: v.password, ltr: true }],
    button: btn('الدخول إلى المنصة', v.path, v.origin),
    note: 'إذا لم تطلب كلمة مرور جديدة فتواصل مع إدارة المنصة فورًا.',
  }),

  lifecycle: (v: { orgName: string; stage: 'trial_ending' | 'trial_expired' | 'mutual' | 'final'; endsOn: string | null; deleteOn: string; days: number; slug: string }) => {
    const titles = {
      trial_ending: 'الفترة التجريبية تنتهي قريبًا',
      trial_expired: 'انتهت الفترة التجريبية',
      mutual: 'تأكيد إنهاء العقد وموعد حذف البيانات',
      final: 'تنبيه أخير: حذف بيانات الجمعية',
    } as const;
    const daysText = v.days === 0 ? 'اليوم' : v.days === 1 ? 'غدًا' : v.days === 2 ? 'بعد يومين' : v.days <= 10 ? `بعد ${v.days} أيام` : `بعد ${v.days} يومًا`;
    const paragraphs = {
      trial_ending: [`تنتهي الفترة التجريبية لـ${v.orgName} في ${v.endsOn}.`, `إذا لم يتم التعاقد، ستُحذف الجمعية وكل بياناتها نهائيًا في ${v.deleteOn}. للتعاقد أو التمديد تواصلوا مع إدارة المنصة.`],
      trial_expired: [`انتهت الفترة التجريبية لـ${v.orgName} وتوقف الدخول.`, `ستُحذف الجمعية وكل بياناتها نهائيًا ${daysText} (${v.deleteOn}) ما لم يتم التعاقد.`],
      mutual: [`تم إنهاء عقد ${v.orgName} بالتراضي، وتوقف الدخول.`, `ستُحذف الجمعية وكل بياناتها نهائيًا في ${v.deleteOn}. إذا رغبتم في نسخة من بياناتكم فاطلبوها من إدارة المنصة قبل هذا الموعد.`],
      final: [`ستُحذف ${v.orgName} وكل بياناتها نهائيًا ${daysText} (${v.deleteOn}).`, 'بعد الحذف لا يمكن استرجاع أي بيانات. للتعاقد أو طلب نسخة من البيانات تواصلوا مع إدارة المنصة الآن.'],
    } as const;
    return mailLayout({
      title: titles[v.stage],
      subject: `${titles[v.stage]} - ${v.orgName}`,
      greeting: 'السلام عليكم،',
      paragraphs: [...paragraphs[v.stage]],
      button: btn('صفحة دخول الجمعية', `/o/${v.slug}`),
    });
  },

  inquiryAdmin: (v: { number: number; kindLabel: string; serviceLabel: string | null; orgName: string; contactName: string; jobTitle: string | null; phone: string; email: string | null; city: string | null; message: string | null }) => mailLayout({
    title: `طلب خدمة جديد رقم ${v.number}`,
    subject: `طلب جديد رقم ${v.number}: ${v.kindLabel} - ${v.orgName}`,
    paragraphs: ['وصل طلب جديد من الصفحة الرئيسية لسنابل.'],
    facts: [
      { label: 'نوع الطلب', value: v.kindLabel },
      ...(v.serviceLabel ? [{ label: 'الخدمة', value: v.serviceLabel }] : []),
      { label: 'الجهة', value: v.orgName },
      { label: 'مقدم الطلب', value: v.jobTitle ? `${v.contactName} (${v.jobTitle})` : v.contactName },
      { label: 'الجوال', value: v.phone, ltr: true },
      ...(v.email ? [{ label: 'البريد', value: v.email, ltr: true }] : []),
      ...(v.city ? [{ label: 'المدينة', value: v.city }] : []),
      ...(v.message ? [{ label: 'الرسالة', value: v.message }] : []),
    ],
    button: btn('فتح طلبات الخدمات', '/platform/inquiries'),
  }),

  inquiryAck: (v: { number: number; contactName: string; kindLabel: string }) => mailLayout({
    title: 'استلمنا طلبكم',
    subject: `استلمنا طلبكم رقم ${v.number} - سنابل`,
    greeting: `السلام عليكم ${v.contactName}،`,
    paragraphs: [`شكرًا لتواصلكم مع سنابل. استلمنا طلبكم (${v.kindLabel}) برقم ${v.number}، وسيتواصل معكم فريقنا قريبًا.`],
    button: btn('زيارة موقع سنابل', '/'),
  }),

  /** استعادة كلمة المرور (للاستخدام من خدمة «نسيت كلمة المرور») */
  passwordReset: (v: { name?: string; url: string; minutes: number }) => mailLayout({
    title: 'إعادة تعيين كلمة المرور',
    greeting: v.name ? `السلام عليكم ${v.name}،` : 'السلام عليكم،',
    paragraphs: [`وصلنا طلب لإعادة تعيين كلمة المرور لحسابك في سنابل. الرابط صالح لمدة ${v.minutes} دقيقة ويُستخدم مرة واحدة.`],
    button: { label: 'تعيين كلمة مرور جديدة', url: v.url },
    note: 'إذا لم تطلب ذلك فتجاهل هذه الرسالة، وستبقى كلمة مرورك كما هي.',
  }),

  backupAlert: (v: { target: string; problem: string; lastSuccess: string; detail?: string | null }) => mailLayout({
    title: `تنبيه: ${v.problem} (${v.target})`,
    subject: `تنبيه النسخ الاحتياطي: ${v.problem} - سنابل`,
    paragraphs: ['يحتاج النسخ الاحتياطي لمنصة سنابل إلى مراجعة. البيانات الحالية لم تتأثر، لكن آخر نسخة سليمة أقدم من المعتاد.'],
    facts: [
      { label: 'الوجهة', value: v.target },
      { label: 'المشكلة', value: v.problem },
      { label: 'آخر نسخة ناجحة', value: v.lastSuccess },
      ...(v.detail ? [{ label: 'التفاصيل', value: v.detail.slice(0, 400), ltr: true }] : []),
    ],
    button: btn('فتح شاشة النسخ الاحتياطي', '/platform/backups'),
    note: 'تصل هذه الرسالة مرة واحدة لكل مشكلة. يمكن إيقافها من إعدادات البريد.',
  }),

  securityAlert: (v: { severity: string; title: string; summary: string; facts: { label: string; value: string; ltr?: boolean }[]; actions: string[]; pending?: string | null }) => mailLayout({
    title: `${v.severity}: ${v.title}`,
    subject: `تنبيه أمني (${v.severity}): ${v.title} - سنابل`,
    paragraphs: [
      v.summary,
      ...(v.actions.length ? [`ما فعله «سيد» تلقائيًا: ${v.actions.join('، ')}.`] : ['لم يتخذ «سيد» أي إجراء تلقائي، والتنبيه للعلم والمراجعة.']),
      ...(v.pending ? [`ينتظر موافقتك: ${v.pending}. افتح شاشة المراقب الأمني للموافقة أو الرفض.`] : []),
      'الأنظمة تعمل كالمعتاد، ولم يتأثر بقية المستخدمين.',
    ],
    facts: v.facts,
    button: btn('فتح شاشة المراقب الأمني', '/platform/security'),
    note: 'تصل رسالة واحدة لكل حادثة، ولا تتكرر لنفس المصدر خلال 6 ساعات. يمكن تغيير المستلمين من إعدادات المراقب الأمني.',
  }),

  securityDaily: (v: { day: string; status: string; paragraphs: string[]; facts: { label: string; value: string; ltr?: boolean }[]; recommendations: string[] }) => mailLayout({
    title: `التقرير اليومي للمراقب الأمني «سيد»: ${v.day}`,
    subject: `تقرير سنابل اليومي (${v.day}): ${v.status}`,
    greeting: 'السلام عليكم،',
    paragraphs: [...v.paragraphs, ...(v.recommendations.length ? ['التوصيات:', ...v.recommendations.map((r, i) => `${i + 1}. ${r}`)] : [])],
    facts: v.facts,
    button: btn('فتح شاشة المراقب الأمني', '/platform/security'),
    note: 'يصل هذا التقرير كل يوم. يمكن تغيير موعده ومستلميه أو إيقافه من إعدادات المراقب الأمني.',
  }),
};
