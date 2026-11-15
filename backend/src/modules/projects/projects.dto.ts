import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { ServiceDto } from '../beneficiaries/settings.dto';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));
const FUNDING = ['restricted', 'unrestricted', 'operational', 'endowment'];
const optDate = (msg: string) => [IsOptional(), ValidateIf((_: unknown, v: unknown) => v !== null && v !== ''), IsDateString({}, { message: msg })];
const OptDate = (msg: string): PropertyDecorator => (t, k) => optDate(msg).forEach((d) => d(t, k));
const OptNum = (): PropertyDecorator => (t, k) => [IsOptional(), ValidateIf((_: unknown, v: unknown) => v !== null), IsNumber({}, { message: 'أدخل رقمًا صحيحًا' })].forEach((d) => d(t, k));

export class PhaseDto {
  @trim() @IsString({ message: 'اكتب اسم المرحلة' }) @MinLength(2, { message: 'اكتب اسم المرحلة' }) @MaxLength(200)
  name!: string;

  @OptDate('تاريخ بداية المرحلة غير صحيح')
  startDate?: string | null;

  @OptDate('تاريخ نهاية المرحلة غير صحيح')
  endDate?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  deliverables?: string | null;
}

export class KpiDto {
  @trim() @IsString({ message: 'اكتب اسم المؤشر' }) @MinLength(2, { message: 'اكتب اسم المؤشر' }) @MaxLength(200)
  name!: string;

  @OptNum()
  baseline?: number | null;

  @OptNum()
  target?: number | null;

  @IsOptional() @trim() @IsString() @MaxLength(40)
  unit?: string | null;
}

export class BudgetLineDto {
  @trim() @IsString({ message: 'اكتب بند الموازنة' }) @MinLength(2, { message: 'اكتب بند الموازنة' }) @MaxLength(200)
  item!: string;

  @OptNum()
  quantity?: number | null;

  @OptNum()
  unitCost?: number | null;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'مبلغ بند الموازنة يجب أن يكون رقمًا' }) @Min(0)
  amount!: number;

  @IsOptional() @trim() @IsString() @MaxLength(300)
  notes?: string | null;
}

/** بيانات المشروع في نظام إدارة المشاريع (كلها اختيارية في التعديل) */
export class ProjectFieldsDto {
  @IsOptional() @trim() @IsString() @MinLength(2, { message: 'الاسم قصير جدًا' }) @MaxLength(200)
  name?: string;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  description?: string | null;

  @IsOptional() @IsIn(FUNDING, { message: 'اختر نوع المشروع: مقيد أو غير مقيد أو تشغيلي أو وقف' })
  fundingType?: 'restricted' | 'unrestricted' | 'operational' | 'endowment';

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

  // ---- وثيقة المشروع ----
  @IsOptional() @IsIn(['annual', 'continuous'], { message: 'اختر مدة المشروع: سنوي أو مستمر' })
  durationType?: 'annual' | 'continuous';

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt({ message: 'السنة المالية غير صحيحة' }) @Min(2000)
  fiscalYear?: number | null;

  @IsOptional() @trim() @IsString() @MaxLength(5000)
  idea?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(2000)
  targetGroups?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(300)
  location?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(3000)
  outcomes?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(3000)
  risks?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => PhaseDto)
  phases?: PhaseDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => KpiDto)
  kpis?: KpiDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => BudgetLineDto)
  budgetLines?: BudgetLineDto[];

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
