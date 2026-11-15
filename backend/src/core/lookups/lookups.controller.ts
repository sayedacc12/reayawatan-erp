import { Body, Controller, Get, Put } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';
import { CurrentOrgUser, OrgUser, RequireAnyPermission } from '../auth/decorators';
import { LookupsService } from './lookups.service';

export class NationalitiesDto {
  @IsArray() @ArrayMaxSize(300) @IsString({ each: true }) @MaxLength(60, { each: true })
  nationalities!: string[];
}

/** القوائم المرجعية المشتركة: يقرؤها أي موظف، ويعدّلها من يدير إعدادات المستفيدين أو الموارد المالية */
@Controller('lookups')
export class LookupsController {
  constructor(private readonly lookups: LookupsService) {}

  @Get('nationalities')
  nationalities(@CurrentOrgUser() user: OrgUser) {
    return this.lookups.nationalities(user.organizationId);
  }

  @Put('nationalities')
  @RequireAnyPermission('beneficiaries.settings.manage', 'fundraising.settings.manage')
  setNationalities(@CurrentOrgUser() user: OrgUser, @Body() dto: NationalitiesDto) {
    return this.lookups.setNationalities(user.organizationId, dto.nationalities);
  }
}
