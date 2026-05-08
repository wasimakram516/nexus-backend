import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Response as SupertestResponse } from 'supertest';
import request from 'supertest';
import { AppExceptionFilter } from '../src/common/filters/app-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { AppLoggerService } from '../src/common/services/app-logger.service';

describe('Health endpoint', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-12345678901234567890';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-123456789012345678';
    process.env.JWT_ACCESS_TTL = '15m';
    process.env.JWT_REFRESH_TTL_DAYS = '7';
    process.env.DATABASE_URL =
      'postgresql://postgres:postgres@localhost:5432/nexus_backend_nest';
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const moduleImport: typeof import('../src/app.module') =
      await import('../src/app.module');
    const { AppModule } = moduleImport;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new AppExceptionFilter(app.get(AppLoggerService)));
    app.useGlobalInterceptors(new ResponseInterceptor());
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Nexus API')
      .setDescription('E2E Swagger smoke test for Nexus API')
      .setVersion('1.0.0')
      .addBearerAuth()
      .addCookieAuth('refreshToken')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('/api/v1/health (GET)', async () => {
    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    ).get('/api/v1/health');
    const body = response.body as {
      success: boolean;
      message: string;
      data: { timestamp: string };
      error: null;
    };
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Health check completed');
    expect(body.error).toBeNull();
    expect(body.data).toHaveProperty('timestamp');
  });

  it('/api/v1/platform/me/runtime-config (GET) returns the standard unauthorized envelope', async () => {
    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    ).get('/api/v1/platform/me/runtime-config');
    const body = response.body as {
      success: boolean;
      message: string;
      data: null;
      error: { code: string; details: { requestId?: string } };
    };

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.data).toBeNull();
    expect(body.message).toBe('Unauthorized');
    expect(body.error.code).toBe('HTTP_ERROR');
  });

  it('/api/v1/auth/login (POST) returns the standard validation envelope', async () => {
    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/api/v1/auth/login')
      .send({
        email: 'not-an-email',
      });
    const body = response.body as {
      success: boolean;
      message: string;
      data: null;
      error: { code: string; details: { requestId?: string } };
    };

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.data).toBeNull();
    expect(body.message).toContain('email must be an email');
    expect(body.message).toContain('password must be a string');
    expect(body.error.code).toBe('HTTP_ERROR');
  });

  it('/api/docs-json (GET) exposes the Swagger document', async () => {
    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    ).get('/api/docs-json');
    const body = response.body as {
      openapi: string;
      info: { title: string };
      paths: Record<
        string,
        {
          get?: {
            security?: Array<Record<string, unknown>>;
            parameters?: Array<{ name: string }>;
            summary?: string;
          };
          post?: {
            security?: Array<Record<string, unknown>>;
            summary?: string;
          };
        }
      >;
    };

    expect(response.status).toBe(200);
    expect(body.openapi).toBeDefined();
    expect(body.info.title).toBe('Nexus API');
    expect(body.paths).toHaveProperty('/api/v1/health');
    expect(body.paths['/api/v1/platform/plans']?.get?.security).toBeUndefined();
    expect(body.paths['/api/v1/platform/institutions']?.get?.security).toEqual([
      { bearer: [] },
    ]);
    expect(body.paths['/api/v1/auth/refresh']?.post?.security).toEqual([
      { refreshToken: [] },
    ]);
    expect(body.paths['/api/v1/attendance']?.get?.summary).toBe(
      'List attendance records',
    );
    expect(body.paths['/api/v1/users/me']?.get?.summary).toBe(
      'Get the current user profile',
    );
    expect(body.paths['/api/v1/platform/me/runtime-config']?.get?.summary).toBe(
      'Get my institution runtime config',
    );
    expect(body.paths['/api/v1/custom-fields/definitions']?.get?.summary).toBe(
      'List custom field definitions',
    );
    expect(body.paths['/api/v1/finance/salaries']?.get?.summary).toBe(
      'List salary records',
    );
    expect(body.paths['/api/v1/finance/fee-vouchers']?.get?.summary).toBe(
      'List fee vouchers',
    );
    expect(body.paths['/api/v1/finance/fee-payments']?.post?.summary).toBe(
      'Create a fee payment',
    );
    expect(
      body.paths['/api/v1/attendance']?.get?.parameters?.map(
        (parameter) => parameter.name,
      ),
    ).toEqual(
      expect.arrayContaining([
        'campusId',
        'userId',
        'role',
        'status',
        'date',
        'dateFrom',
        'dateTo',
      ]),
    );
  });
});
