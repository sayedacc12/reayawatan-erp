import { Column, Entity, OneToMany, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { Permission } from './permission.entity';

/** نسخة في قاعدة البيانات من الوحدات المثبتة، تُحدَّث تلقائيًا عند التشغيل. */
@Entity('erp_modules')
export class ErpModule {
  @PrimaryColumn({ length: 64 })
  code!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  icon!: string | null;

  @Column({ length: 32 })
  version!: string;

  @Column({ type: 'int', default: 100 })
  sequence!: number;

  @OneToMany(() => Permission, (p) => p.module)
  permissions!: Permission[];

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
