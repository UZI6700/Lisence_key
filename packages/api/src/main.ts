import { NestFactory } from '@nestjs/core';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import * as express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    preflightContinue: true,
    optionsSuccessStatus: 204,
  });

  // Serve the built React dashboard from the same Wasmer Edge app,
  // so a single deployment provides both the UI and the API.
  const publicDir = [
    join(process.cwd(), 'public'),
    join(process.cwd(), 'packages', 'api', 'public'),
    join(__dirname, '..', 'public'),
    '/public',
  ].find((dir) => existsSync(join(dir, 'index.html'))) || join(process.cwd(), 'public');
  const http = app.getHttpAdapter().getInstance();
  http.use(express.static(publicDir));
  http.use((req: any, res: any, next: any) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path === '/health') return next();
    res.sendFile(join(publicDir, 'index.html'));
  });

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`License Management app listening on port ${port}`);
}
bootstrap();
