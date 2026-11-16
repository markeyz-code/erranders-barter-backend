import * as http from 'http';
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

  // A missing required field is the client's mistake, not a server fault. Mongoose throws a
  // ValidationError, which Nest reports as 500 unless it is mapped.
  app.useGlobalFilters({
    catch(exception: any, host: any) {
      const res = host.switchToHttp().getResponse();
      const first = exception?.errors ? Object.values(exception.errors)[0] : null;
      const field = (first as any)?.path;
      const message = (first as any)?.message || exception?.message || 'Bad request';

      if (exception?.name === 'ValidationError' || exception?.name === 'CastError') {
        res.status(400).json({ statusCode: 400, message, field, error: 'Bad Request' });
        return;
      }
      const status = exception?.status || exception?.statusCode || 500;
      res.status(status).json({
        statusCode: status,
        message: exception?.response?.message || message,
        error: exception?.response?.error || (status === 500 ? 'Internal Server Error' : 'Error'),
      });
    },
  } as any);

  // Root health endpoints without prefix (Railway, Docker, ALB health checkers)
  // Root health endpoints without prefix (Railway, Docker, ALB health checkers)
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use((req: any, _res: any, next: any) => {
    diagLog(`REQ | ${req.method} ${req.url} | Host=${req.headers.host}`);
    next();
  });
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

  /**
   * Listen on PORT, and keep the fallback ports alive with sockets attached.
   *
   * Railway routes to whichever port it expects; the previous code bound 3000 plus extras, and the extras had no
   * socket.io, which is why every handshake 404ed. Binding only one port fixed the socket but took the service
   * down when Railway routed somewhere else. Both problems have one solution: every listener, every protocol.
   */
  const primaryPort = Number(process.env.PORT) || 3000;
  await app.listen(primaryPort, '0.0.0.0');
  diagLog(`PRIMARY_LISTENING | port=${primaryPort} | host=0.0.0.0`);
  console.log(`🚀 Barter API running on 0.0.0.0:${primaryPort} (http + websockets)`);

  /**
   * The extra ports forward everything to the port Nest owns.
   *
   * Serving the same Express app on them was not enough: socket.io answers /socket.io/ itself, so polling
   * handshakes on a fallback port still 404ed. A one-line proxy makes every port behave identically, so it no
   * longer matters which one the platform routes to.
   */
  const nestServer = app.getHttpServer();
  const extraPorts = [3000, 3100, 3005, 8080].filter(
    (p, idx, arr) => p !== primaryPort && arr.indexOf(p) === idx,
  );
  for (const p of extraPorts) {
    try {
      const server = http.createServer((req, res) => {
        const proxy = http.request(
          { host: '127.0.0.1', port: primaryPort, path: req.url, method: req.method, headers: req.headers },
          (upstream) => {
            res.writeHead(upstream.statusCode || 502, upstream.headers);
            upstream.pipe(res);
          },
        );
        proxy.on('error', () => {
          res.writeHead(502);
          res.end('Upstream unavailable');
        });
        req.pipe(proxy);
      });

      server.on('upgrade', (req: any, socket: any, head: any) => nestServer.emit('upgrade', req, socket, head));
      server.listen(p, '0.0.0.0', () => diagLog(`EXTRA_LISTENING | port=${p}`));
      server.on('error', (err: any) => diagLog(`EXTRA_PORT_ERR | port=${p} | err=${err.message}`));
    } catch (err: any) {
      diagLog(`EXTRA_PORT_CATCH | port=${p} | err=${err.message}`);
    }
  }

}


bootstrap().catch((err) => {
  console.error('BOOTSTRAP ERROR:', err);
  diagLog(`BOOTSTRAP_ERROR: ${String(err?.stack || err)}`);
});


