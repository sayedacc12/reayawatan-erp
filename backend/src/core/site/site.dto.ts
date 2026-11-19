import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { INQUIRY_KINDS, INQUIRY_STATUSES, InquiryKind, InquiryStatus, SERVICE_CODES } from './site.entity';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const emptyToUndefined = () => Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : typeof value === 'string' ? value.trim() : value));
/** أرقام سعودية أو دولية: يقبل الأرقام العربية والمسافات والشرطات ثم يوحّدها */
const normalizePhone = () => Transform(({ value }) => (typeof value === 'string'
  ? value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[\s-]/g, '')
  : value));
const PHONE = /^\+?[0-9]{9,15}$/;

/** طلب من الصفحة التعريفية: استشارة مجانية أو عرض سعر أو عرض تجريبي */
export class InquiryDto {
  @IsIn(INQUIRY_KINDS as unknown as string[], { message: 'نوع الطلب غير صحيح' })
  kind!: InquiryKind;

  @emptyToUndefined() @IsOptional() @IsIn(SERVICE_CODES, { message: 'اختر خدمة من القائمة' })
  serviceCode?: string;

  @trim() @IsString() @MinLength(3, { message: 'اكتب اسم الجمعية' }) @MaxLength(200)
  orgName!: string;

  @trim() @IsString() @MinLength(3, { message: 'اكتب اسمك' }) @MaxLength(200)
  contactName!: string;

  @emptyToUndefined() @IsOptional() @IsString() @MaxLength(120)
  jobTitle?: string;

  @normalizePhone() @Matches(PHONE, { message: 'رقم الجوال غير صحيح' })
  phone!: string;

  @emptyToUndefined() @IsOptional() @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' }) @MaxLength(200)
  email?: string;

  @emptyToUndefined() @IsOptional() @IsString() @MaxLength(100)
  city?: string;

  @emptyToUndefined() @IsOptional() @IsString() @MaxLength(3000)
  message?: string;

  /** حقل مخفي في النموذج: يملؤه برنامج الإرسال الآلي فقط */
  @IsOptional() @IsString() @MaxLength(200)
  website?: string;
}

export class InquiryUpdateDto {
  @IsOptional() @IsIn(INQUIRY_STATUSES as unknown as string[], { message: 'حالة غير صحيحة' })
  status?: InquiryStatus;

  @emptyToUndefined() @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

/** بيانات التواصل التي تظهر في الصفحة التعريفية، يحددها مدير المنصة */
export class SiteContactDto {
  @emptyToUndefined() @IsOptional() @normalizePhone() @Matches(PHONE, { message: 'رقم واتساب غير صحيح. اكتبه بالمفتاح الدولي مثل 966500000000' })
  whatsapp?: string;

  @emptyToUndefined() @IsOptional() @MaxLength(300)
  whatsappMessage?: string;

  @emptyToUndefined() @IsOptional() @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  email?: string;

  @emptyToUndefined() @IsOptional() @normalizePhone() @Matches(PHONE, { message: 'رقم الهاتف غير صحيح' })
  phone?: string;

  @emptyToUndefined() @IsOptional() @IsString() @MaxLength(200)
  address?: string;
}
