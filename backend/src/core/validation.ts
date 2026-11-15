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
