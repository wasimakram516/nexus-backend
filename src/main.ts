import compression from 'compression';
import cookieParser from 'cookie-parser';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppExceptionFilter } from './common/filters/app-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AppLoggerService } from './common/services/app-logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  const logger = app.get(AppLoggerService);

  app.useLogger(logger);

  app.enableCors({
    origin:
      process.env.CORS_ORIGINS?.split(',').map((value) => value.trim()) ?? true,
    credentials: true,
  });
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AppExceptionFilter(logger));
  app.useGlobalInterceptors(new ResponseInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Nexus API')
    .setDescription(
      'Versioned REST API for Nexus, an all-in-one education platform for multi-campus institutions covering authentication, campus administration, academics, people management, attendance, finance, and realtime workflows.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addCookieAuth('refreshToken')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  const port = Number(process.env.PORT ?? 4000);
  process.on('unhandledRejection', (reason) => {
    logger.logUnhandledError({
      type: 'unhandledRejection',
      reason,
    });
  });
  process.on('uncaughtException', (error) => {
    logger.logUnhandledError(
      {
        type: 'uncaughtException',
        name: error.name,
        message: error.message,
      },
      error.stack,
    );
  });

  await app.listen(port);
  logger.log(
    `Nexus backend is running on http://localhost:${port}/api/v1`,
    'Bootstrap',
  );
}

void bootstrap();
