import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  // `rawBody` is REQUIRED for the Paystack webhook: its signature is an HMAC over
  // the exact request bytes, so the parsed-and-reserialised JSON would never match.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Root health endpoints without prefix (Railway, Docker, ALB health checkers)
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.get('/', (_req: any, res: any) =>
    res.status(200).json({ status: 'ok', service: 'barter-backend-api', version: '1.0.0' }),
  );
  expressApp.get('/health', (_req: any, res: any) =>
    res.status(200).json({ status: 'ok', service: 'barter-backend-api', timestamp: new Date().toISOString() }),
  );

  // CORS
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Validation
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Swagger API Documentation
  const config = new DocumentBuilder()
    .setTitle('Erranders Barter API')
    .setDescription('API for the Barter marketplace — Buy, Sell & Swap on campus')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3005;
  await app.listen(port);
  console.log(`🚀 Barter API running on port ${port}`);
  console.log(`📚 Swagger docs at http://localhost:${port}/api/docs`);
}
bootstrap();
