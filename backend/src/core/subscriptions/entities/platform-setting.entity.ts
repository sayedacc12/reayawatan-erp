import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** إعدادات عامة للمنصة (مثل بيانات مقدم الخدمة في العقود) بصيغة مفتاح وقيمة */
@Entity('platform_settings')
export class PlatformSetting {
  @PrimaryColumn({ length: 64 })
  key!: string;

  @Column({ type: 'jsonb' })
  value!: Record<string, unknown>;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
