/** أسماء أقسام صفحات الموقع وحقولها بالعربي في محرر المحتوى */
export const SECTIONS: { key: string; label: string; hint: string; groups?: { label: string; keys: string[] }[] }[] = [
  { key: 'home', label: 'الصفحة الرئيسية', hint: 'الواجهة، ورحلة الأثر، والحاسبة، ودورة القيمة، والقيمة المزدوجة، وقصة الشعار، والتزاماتنا، ومؤشرات الأثر.',
    groups: [
      { label: 'الواجهة', keys: ['eyebrow', 'title', 'titleEm', 'lead', 'proof', 'rings'] },
      { label: 'رحلة الأثر', keys: ['storyEyebrow', 'storyTitle', 'storyLead', 'chapters'] },
      { label: 'حاسبة مضاعف الأثر', keys: ['calcEyebrow', 'calcTitle', 'calcLead', 'calcNote'] },
      { label: 'دورة القيمة', keys: ['wheelEyebrow', 'wheelTitle', 'wheelLead'] },
      { label: 'القيمة المزدوجة', keys: ['dualEyebrow', 'dualTitle', 'dual'] },
      { label: 'قصة الشعار', keys: ['logoEyebrow', 'logoTitle', 'logoText', 'logoNote'] },
      { label: 'التزامنا بالأثر', keys: ['commitEyebrow', 'commitTitle', 'commitments'] },
      { label: 'مؤشرات الأثر', keys: ['kpiEyebrow', 'kpiTitle', 'kpiLead', 'kpis'] },
      { label: 'الخاتمة', keys: ['finalTitle', 'finalText'] },
    ] },
  { key: 'about', label: 'من نحن', hint: 'قصة الشركة، والرؤية والرسالة، وبطاقة الشركة، وأسباب التأسيس، والحوكمة واللوائح، والقيم، والفريق.' },
  { key: 'contact', label: 'تواصل معنا', hint: 'بيانات التواصل التي تظهر في صفحة التواصل وتذييل الموقع، وخيارات نوع الجهة في النموذج.' },
  { key: 'assessment', label: 'تقييم الجاهزية', hint: 'الأسئلة السبعة (سؤال لكل خدمة بمعرّفها) وخيارات الإجابة. الدرجة تُحسب في الخادم.' },
  { key: 'guides', label: 'مكتبة الأدلة', hint: 'نصوص صفحة مكتبة الأدلة. الأدلة نفسها تُدار من شاشة «مكتبة الأدلة».' },
];

export const FIELD_LABELS: Record<string, string> = {
  eyebrow: 'السطر التمهيدي', title: 'العنوان', titleEm: 'تكملة العنوان (مميزة)', lead: 'المقدمة', proof: 'أرقام الواجهة', n: 'الرقم', label: 'الوصف',
  rings: 'دوائر الأثر (من المركز للخارج)', storyEyebrow: 'السطر التمهيدي', storyTitle: 'العنوان', storyLead: 'المقدمة', chapters: 'فصول الرحلة',
  tag: 'الوسم', text: 'النص', links: 'روابط الخدمات (معرّف الخدمة)', calcEyebrow: 'السطر التمهيدي', calcTitle: 'العنوان', calcLead: 'المقدمة', calcNote: 'ملاحظة النتيجة',
  wheelEyebrow: 'السطر التمهيدي', wheelTitle: 'العنوان', wheelLead: 'المقدمة', dualEyebrow: 'السطر التمهيدي', dualTitle: 'العنوان', dual: 'المسارات', steps: 'الخطوات',
  logoEyebrow: 'السطر التمهيدي', logoTitle: 'العنوان', logoText: 'النص', logoNote: 'ملاحظة الاعتماد', commitEyebrow: 'السطر التمهيدي', commitTitle: 'العنوان', commitments: 'الالتزامات',
  kpiEyebrow: 'السطر التمهيدي', kpiTitle: 'العنوان', kpiLead: 'المقدمة', kpis: 'المؤشرات', value: 'القيمة', finalTitle: 'عنوان الخاتمة', finalText: 'نص الخاتمة',
  story: 'قصتنا (فقرات)', vision: 'الرؤية', mission: 'الرسالة', card: 'بطاقة الشركة', reasonsTitle: 'عنوان أسباب التأسيس', reasons: 'أسباب التأسيس',
  govTitle: 'عنوان الحوكمة', govText: 'نص الحوكمة', govNote: 'ملاحظة حالة اللوائح', policies: 'اللوائح والسياسات', values: 'القيم', teamNote: 'فريق العمل',
  phone: 'الهاتف', email: 'البريد الإلكتروني', whatsapp: 'واتساب الأعمال', address: 'العنوان', hours: 'ساعات العمل', careers: 'نص التوظيف', orgTypes: 'أنواع الجهات في النموذج',
  successText: 'رسالة نجاح الإرسال', options: 'خيارات الإجابة (من الأفضل للأضعف)', questions: 'الأسئلة', service: 'معرّف الخدمة', advancedText: 'نص المنظمة المتقدمة',
  emptyText: 'نص عند عدم وجود أدلة',
};
