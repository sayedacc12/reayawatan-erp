import { Controller, Get } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequirePermissions } from '../auth/decorators';
import { CORE_PERMISSIONS } from '../core.manifest';
import { ModuleCatalogService } from './module-catalog.service';

@Controller('modules')
export class ModulesController {
  constructor(private readonly catalog: ModuleCatalogService) {}

  @Get()
  @RequirePermissions(CORE_PERMISSIONS.rolesRead)
  list(@CurrentOrgUser() actor: OrgUser) {
    return this.catalog.organizationModules(actor.organizationId);
  }
}
