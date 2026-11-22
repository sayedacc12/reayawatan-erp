import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/** معايير تقرير المجلس: الخطة أو الموازنة، والفترة (YYYY أو YYYY-H1 أو YYYY-Q1 أو YYYY-MM)، ورقم الاجتماع اختياريًا */
export class BoardReportQueryDto {
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsUUID() budgetId?: string;
  @IsOptional() @Matches(/^\d{4}(-(H[12]|Q[1-4]|0[1-9]|1[0-2]))?$/, { message: 'الفترة غير صحيحة' }) period?: string;
  @IsOptional() @IsString() @MaxLength(40) meetingNo?: string;
  @IsOptional() @IsIn(['html', 'pdf']) format?: 'html' | 'pdf';
}
