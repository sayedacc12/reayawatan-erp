import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { ServiceDto } from '../beneficiaries/settings.dto';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));
const FUNDING = ['restricted', 'unrestricted', 'operational'];

/** بيانات المشروع في نظام إدارة المشاريع (كلها اختيارية في التعديل) */
export class ProjectFieldsDto {
  @IsOptional() @trim() @IsString() @MinLength(2, { message: 'الاسم قصير جدًا' }) @MaxLength(200)
  name?: string;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  description?: string | null;

  @IsOptional() @IsIn(FUNDING, { message: 'اختر نوع المشروع: مقيد أو غير مقيد أو تشغيلي' })
  fundingType?: 'restricted' | 'unrestricted' | 'operational';

  @IsOptional() @IsBoolean()
  zakatEligible?: boolean;

  @IsOptional() @IsIn(['beneficiaries', 'general'], { message: 'اختر طريقة الصرف' })
  spendingMode?: 'beneficiaries' | 'general';

  @IsOptional() @trim() @IsString() @MaxLength(200)
  managerName?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString({}, { message: 'تاريخ البداية غير صحيح' })
  startDate?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString({}, { message: 'تاريخ النهاية غير صحيح' })
  endDate?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({}, { message: 'الميزانية يجب أن تكون رقمًا' }) @Min(0)
  budget?: number | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt({ message: 'عدد المستفيدين المستهدف يجب أن يكون رقمًا صحيحًا' }) @Min(0)
  targetBeneficiaries?: number | null;

  @IsOptional() @trim() @IsString() @MaxLength(3000)
  goals?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ServiceDto)
  services?: ServiceDto[];

  @IsOptional() @IsBoolean()
  multiServices?: boolean;

  @IsOptional() @IsBoolean()
  portalVisible?: boolean;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class CreateNodeDto extends ProjectFieldsDto {
  @IsIn(['axis', 'program', 'project'], { message: 'اختر المستوى' })
  level!: 'axis' | 'program' | 'project';

  @IsOptional() @IsUUID()
  parentId?: string | null;

  @trim() @IsString() @MinLength(2, { message: 'الاسم قصير جدًا' }) @MaxLength(200)
  declare name: string;
}

export class StageDto {
  @IsOptional() @IsUUID()
  id?: string;

  @trim() @IsString() @MinLength(2, { message: 'اسم المرحلة قصير جدًا' }) @MaxLength(200)
  name!: string;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  instructions?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  roleId?: string | null;
}

export class StagesDto {
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => StageDto)
  stages!: StageDto[];
}

export class DecisionDto {
  @IsIn(['approve', 'reject', 'return'], { message: 'اختر القرار' })
  decision!: 'approve' | 'reject' | 'return';

  @IsOptional() @trim() @IsString() @MaxLength(2000)
  note?: string | null;
}

export class ListProjectsQuery {
  @IsOptional() @trim() @IsString() @MaxLength(100)
  search?: string;

  @IsOptional() @IsIn(['draft', 'pending', 'returned', 'approved', 'rejected'])
  status?: string;

  @IsOptional() @IsIn(FUNDING)
  fundingType?: string;

  @IsOptional() @IsUUID()
  parentId?: string;
}

export class ReopenDto {
  @IsOptional() @trim() @IsString() @MaxLength(2000)
  note?: string | null;
}
