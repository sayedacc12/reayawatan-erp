import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * الجمعية (المستأجر في المنصة). كل جدول بيانات في أي وحدة يحمل organization_id،
 * وكل استعلام يُقيَّد بجمعية المستخدم الحالي، فلا ترى جمعية بيانات جمعية أخرى.
 */
@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 200 })
  name!: string;

  /** معرف قصير بالإنجليزية (يصلح لاحقًا كنطاق فرعي: slug.example.com) */
  @Index({ unique: true })
  @Column({ length: 64 })
  slug!: string;

  /** إيقاف الجمعية يمنع كل مستخدميها من الدخول */
  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
