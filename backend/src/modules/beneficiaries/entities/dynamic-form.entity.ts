import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Organization } from '../../../core/entities';

export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox';

export interface FormField {
  /** مفتاح ثابت بالإنجليزي يُحفظ به الجواب */
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** خيارات حقل القائمة */
  options?: string[];
  placeholder?: string;
}

/** نموذج يعرّفه مدير النظام من الإعدادات (مثل نموذج البحث الاجتماعي) */
@Entity('dynamic_forms')
export class DynamicForm {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: Organization;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  fields!: FormField[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
