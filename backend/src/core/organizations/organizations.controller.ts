import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators';
import { PLATFORM_PERMISSIONS } from '../core.manifest';
import { CreateOrganizationDto, SetOrganizationModulesDto, UpdateOrganizationDto } from './organizations.dto';
import { OrganizationsService } from './organizations.service';

@Controller('platform')
@RequirePermissions(PLATFORM_PERMISSIONS.organizationsManage)
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get('modules')
  optionalModules() {
    return this.orgs.optionalModules();
  }

  @Get('organizations')
  list() {
    return this.orgs.list();
  }

  @Post('organizations')
  create(@Body() dto: CreateOrganizationDto) {
    return this.orgs.create(dto);
  }

  @Patch('organizations/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrganizationDto) {
    return this.orgs.update(id, dto);
  }

  /** تفعيل/إيقاف الوحدات الاختيارية لجمعية */
  @Put('organizations/:id/modules')
  setModules(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetOrganizationModulesDto) {
    return this.orgs.setModules(id, dto.modules);
  }
}
