import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateIf, ValidateNested } from 'class-validator';

export class StepMarkDto {
  @IsString()
  @MaxLength(40)
  key!: string;

  /** null = إلغاء التعليم اليدوي */
  @ValidateIf((o: StepMarkDto) => o.status !== null)
  @IsIn(['done', 'skipped'])
  status!: 'done' | 'skipped' | null;
}

export class UpdateOnboardingDto {
  @IsOptional() @IsBoolean() welcomeSeen?: boolean;
  @IsOptional() @IsBoolean() tourDone?: boolean;
  @IsOptional() @IsBoolean() launchHidden?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => StepMarkDto)
  mark?: StepMarkDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  celebrate?: string[];
}
