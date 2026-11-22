import { ErpModule } from './erp-module.entity';
import { Organization } from './organization.entity';
import { OrganizationModule } from './organization-module.entity';
import { Permission } from './permission.entity';
import { Role } from './role.entity';
import { RoleAssignment } from './role-assignment.entity';
import { User } from './user.entity';

export { ErpModule, Organization, OrganizationModule, Permission, Role, RoleAssignment, User };
export const CORE_ENTITIES = [Organization, ErpModule, OrganizationModule, Permission, Role, RoleAssignment, User];
