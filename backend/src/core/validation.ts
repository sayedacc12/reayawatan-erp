import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** حروف إنجليزية وأرقام ورموز فقط، بدون حروف عربية أو مسافات */
export const PASSWORD_CHARS = /^[\x21-\x7E]+$/;
export const PASSWORD_CHARS_MESSAGE =
  'كلمة المرور بالحروف الإنجليزية والأرقام والرموز فقط، بدون حروف عربية أو مسافات';

/** قواعد كلمة المرور الموحدة لكل شاشات النظام */
export function IsValidPassword(minMessage = 'كلمة المرور يجب أن تكون 8 أحرف على الأقل') {
  return applyDecorators(
    IsString(),
    MinLength(8, { message: minMessage }),
    MaxLength(200),
    Matches(PASSWORD_CHARS, { message: PASSWORD_CHARS_MESSAGE }),
  );
}

export const STRONG_PASSWORD_MESSAGE = 'كلمة المرور الجديدة يجب أن تحتوي على حرف إنجليزي ورقم على الأقل';

/** كلمة المرور الجديدة التي يختارها المستخدم بنفسه (تغيير كلمة المرور، أو بعد كلمة مؤقتة): حرف ورقم على الأقل */
export function IsStrongPassword() {
  return applyDecorators(
    // رسالة الأحرف العربية والطول تظهر أولًا، ثم شرط الحرف والرقم
    Matches(/^(?=.*[A-Za-z])(?=.*[0-9])/, { message: STRONG_PASSWORD_MESSAGE }),
    IsValidPassword('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل'),
  );
}
