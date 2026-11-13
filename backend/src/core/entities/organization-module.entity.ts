import { CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { ErpModule } from './erp-module.entity';
import { Organization } from './organization.entity';

/** الوحدات الاختيارية المفعلة لكل جمعية (الوحدات الأساسية مفعلة دائمًا ولا تُسجل هنا). */
@Entity('organization_modules')
export class OrganizationModule {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: Organization;

  @PrimaryColumn({ name: 'module_code', length: 64 })
  moduleCode!: string;

  @ManyToOne(() => ErpModule, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'module_code' })
  module!: ErpModule;

  @CreateDateColumn({ name: 'enabled_at', type: 'timestamptz' })
  enabledAt!: Date;
}
