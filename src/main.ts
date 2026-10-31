import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';

function diagLog(msg: string) {
  try {
    fetch('https://ntfy.sh/erranders_barter_diag_test_8392', {
      method: 'POST',
      body: `[${new Date().toISOString()}] ${msg}`,
    }).catch(() => {});
  } catch {}
}

const railwayEnv = Object.keys(process.env)
  .filter((k) => k.startsWith('RAILWAY') || k === 'PORT' || k === 'NODE_ENV')
  .map((k) => `${k}=${process.env[k]}`)
  .join(' | ');

diagLog(`RAILWAY_ENV: ${railwayEnv}`);


process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  diagLog(`UNHANDLED_REJECTION: ${String(reason)}`);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
  diagLog(`UNCAUGHT_EXCEPTION: ${String(err?.stack || err)}`);
});

async function bootstrap() {
  diagLog('bootstrap() started');
  // `rawBody` is REQUIRED for the Paystack webhook: its signature is an HMAC over
  // the exact request bytes, so the parsed-and-reserialised JSON would never match.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  diagLog('NestFactory.create completed');


  // Attach Socket.io adapter explicitly
  app.useWebSocketAdapter(new IoAdapter(app));

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
  await app.listen(port, '0.0.0.0');
  diagLog(`APP_LISTENING | port=${port} | host=0.0.0.0`);
  console.log(`🚀 Barter API running on 0.0.0.0:${port}`);
  console.log(`📚 Swagger docs at http://localhost:${port}/api/docs`);
}
bootstrap().catch((err) => {
  console.error('BOOTSTRAP ERROR:', err);
  diagLog(`BOOTSTRAP_ERROR: ${String(err?.stack || err)}`);
});


