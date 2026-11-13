import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { ErpModule } from './erp-module.entity';

/** كتالوج الصلاحيات، مصدره ملفات الـ manifest للوحدات. */
@Entity('permissions')
export class Permission {
  @PrimaryColumn({ length: 128 })
  code!: string;

  @Column({ name: 'module_code', length: 64 })
  moduleCode!: string;

  @ManyToOne(() => ErpModule, (m) => m.permissions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'module_code' })
  module!: ErpModule;

  @Column({ length: 200 })
  name!: string;
}
