import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

export function configureApp(app: NestExpressApplication) {
  app.setGlobalPrefix('api');
  app.disable('x-powered-by');
  // عنوان العميل الحقيقي: الطلب يمر بـ Caddy ثم nginx (شبكة Docker خاصة). نثق فقط بالعناوين الخاصة،
  // فيكون req.ip أول عنوان عام من اليمين في X-Forwarded-For. Caddy يتجاهل X-Forwarded-For القادم من الإنترنت
  // ويضع عنوان المتصل الحقيقي، فلا يمكن تزويره. بدونه كانت كل الطلبات تظهر بعنوان Caddy،
  // فيصبح حد محاولات الدخول مشتركًا بين كل المستخدمين.
  app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal');
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
