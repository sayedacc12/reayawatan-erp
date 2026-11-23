/** يحوّل الأرقام العربية والفارسية والفاصلة العشرية العربية إلى أرقام لاتينية، ويحذف ما سوى الأرقام والنقطة */
export const latinNum = (v: unknown) =>
  String(v ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٫,،]/g, '.')
    .replace(/[^\d.]/g, '');
/** قيمة رقمية من حقل نصي (فارغ أو غير صالح: NaN) */
export const num = (v: unknown) => {
  const s = latinNum(v);
  return s === '' || s === '.' ? NaN : Number(s);
};
