import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

export function configureApp(app: NestExpressApplication) {
  app.setGlobalPrefix('api');
  app.disable('x-powered-by');
  // عنوان العميل الحقيقي: عدد الوسطاء الموثوقين أمام الخادم. التشغيل العادي: nginx فقط (1).
  // الإنتاج: Caddy ثم nginx (2)، ويضبطه deploy/compose.prod.yml. Caddy يتجاهل X-Forwarded-For القادم من الإنترنت
  // ويضع عنوان المتصل، و nginx يضيف عنوان Caddy، فيكون req.ip هو العميل الحقيقي ولا يمكن تزويره.
  // قبل ذلك كانت كل الطلبات في الإنتاج تظهر بعنوان Caddy، فيصبح حد محاولات الدخول مشتركًا بين الجميع.
  app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  return app;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  if (process.env.CORS_ORIGIN) app.enableCors({ origin: process.env.CORS_ORIGIN.split(',') });
  await app.listen(Number(process.env.PORT ?? 3000));
}

if (require.main === module) void bootstrap();
