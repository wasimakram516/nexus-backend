import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import type { Response as SupertestResponse } from 'supertest';
import request from 'supertest';
import { AppExceptionFilter } from '../src/common/filters/app-exception.filter';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import type { CurrentUser } from '../src/common/interfaces/current-user.interface';
import { AppLoggerService } from '../src/common/services/app-logger.service';
import { AcademicsController } from '../src/modules/academics/academics.controller';
import { AcademicsService } from '../src/modules/academics/academics.service';
import { AuditLogsController } from '../src/modules/audit-logs/audit-logs.controller';
import { AuditLogsService } from '../src/modules/audit-logs/audit-logs.service';
import { AttendanceController } from '../src/modules/attendance/attendance.controller';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { PlatformPublicController } from '../src/modules/platform/platform-public.controller';
import { PlatformService } from '../src/modules/platform/platform.service';
import { FinanceController } from '../src/modules/finance/finance.controller';
import { FinanceService } from '../src/modules/finance/finance.service';
import { PeopleController } from '../src/modules/people/people.controller';
import { PeopleService } from '../src/modules/people/people.service';
import { RecycleBinController } from '../src/modules/recycle-bin/recycle-bin.controller';
import { RecycleBinService } from '../src/modules/recycle-bin/recycle-bin.service';
import { UsersController } from '../src/modules/users/users.controller';
import { UsersService } from '../src/modules/users/users.service';

type RequestWithUser = Request & { user?: CurrentUser };

class TestJwtAuthGuard implements CanActivate {
  private readonly usersByToken: Record<string, CurrentUser> = {
    'teacher-token': {
      sub: 'teacher-user-1',
      email: 'teacher@nexus.test',
      role: 'TEACHER',
      institutionId: 'institution-1',
      sessionId: 'session-teacher-1',
    },
    'admin-token': {
      sub: 'admin-user-1',
      email: 'admin@nexus.test',
      role: 'ADMIN',
      institutionId: 'institution-1',
      sessionId: 'session-admin-1',
    },
    'superadmin-token': {
      sub: 'superadmin-user-1',
      email: 'superadmin@nexus.test',
      role: 'SUPERADMIN',
      institutionId: null,
      sessionId: 'session-superadmin-1',
    },
  };

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Unauthorized');
    }

    const user = this.usersByToken[authorization.slice(7)];
    if (!user) {
      throw new UnauthorizedException('Unauthorized');
    }

    request.user = user;
    return true;
  }
}

describe('Auth and protected flows', () => {
  let app: INestApplication;

  const authServiceMock = {
    getSessions: jest.fn(),
    revokeSession: jest.fn(),
  };

  const financeServiceMock = {
    createSalary: jest.fn(),
    getSalary: jest.fn(),
    updateSalary: jest.fn(),
    deleteSalary: jest.fn(),
    listFeeVouchers: jest.fn(),
    createFeeVoucher: jest.fn(),
    createFeePayment: jest.fn(),
  };

  const peopleServiceMock = {
    createStudent: jest.fn(),
    getStudent: jest.fn(),
    updateStudent: jest.fn(),
    deleteStudent: jest.fn(),
  };

  const usersServiceMock = {
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
    listUsers: jest.fn(),
  };

  const attendanceServiceMock = {
    getAttendanceSummary: jest.fn(),
    getAttendanceRecord: jest.fn(),
    updateAttendanceRecord: jest.fn(),
  };

  const platformServiceMock = {
    listPlans: jest.fn(),
  };

  const academicsServiceMock = {
    deleteLevel: jest.fn(),
    deleteClass: jest.fn(),
    deleteSection: jest.fn(),
    deleteSubject: jest.fn(),
  };

  const auditLogsServiceMock = {
    listAuditLogs: jest.fn(),
  };

  const recycleBinServiceMock = {
    listDeletedItems: jest.fn(),
    restoreRecord: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        AuthController,
        UsersController,
        AttendanceController,
        AcademicsController,
        FinanceController,
        PeopleController,
        PlatformPublicController,
        AuditLogsController,
        RecycleBinController,
      ],
      providers: [
        AppLoggerService,
        {
          provide: AuthService,
          useValue: authServiceMock,
        },
        {
          provide: UsersService,
          useValue: usersServiceMock,
        },
        {
          provide: AttendanceService,
          useValue: attendanceServiceMock,
        },
        {
          provide: AcademicsService,
          useValue: academicsServiceMock,
        },
        {
          provide: FinanceService,
          useValue: financeServiceMock,
        },
        {
          provide: PeopleService,
          useValue: peopleServiceMock,
        },
        {
          provide: PlatformService,
          useValue: platformServiceMock,
        },
        {
          provide: AuditLogsService,
          useValue: auditLogsServiceMock,
        },
        {
          provide: RecycleBinService,
          useValue: recycleBinServiceMock,
        },
        {
          provide: RolesGuard,
          useClass: RolesGuard,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(TestJwtAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new AppExceptionFilter(app.get(AppLoggerService)));
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('allows public plan listing without authentication', async () => {
    platformServiceMock.listPlans.mockResolvedValue({
      message: 'Plans retrieved successfully',
      data: [{ id: 'plan-1', name: 'Starter' }],
    });

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    ).get('/api/v1/platform/plans');
    const body = response.body as {
      success: boolean;
      message: string;
      data: Array<{ id: string; name: string }>;
      error: null;
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Plans retrieved successfully');
    expect(body.data).toEqual([{ id: 'plan-1', name: 'Starter' }]);
    expect(body.error).toBeNull();
  });

  it('returns the standard unauthorized envelope for protected session listing without a bearer token', async () => {
    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    ).get('/api/v1/auth/sessions');
    const body = response.body as {
      success: boolean;
      message: string;
      data: null;
      error: { code: string };
    };

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.message).toBe('Unauthorized');
    expect(body.data).toBeNull();
    expect(body.error.code).toBe('HTTP_ERROR');
  });

  it('returns sessions for an authenticated user', async () => {
    authServiceMock.getSessions.mockResolvedValue({
      message: 'Sessions retrieved successfully',
      data: [{ id: 'session-teacher-1', revokedAt: null }],
    });

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get('/api/v1/auth/sessions')
      .set('Authorization', 'Bearer teacher-token');
    const body = response.body as {
      success: boolean;
      message: string;
      data: Array<{ id: string; revokedAt: null }>;
      error: null;
    };

    expect(response.status).toBe(200);
    expect(authServiceMock.getSessions).toHaveBeenCalledWith({
      sub: 'teacher-user-1',
      email: 'teacher@nexus.test',
      role: 'TEACHER',
      institutionId: 'institution-1',
      sessionId: 'session-teacher-1',
    });
    expect(body.success).toBe(true);
    expect(body.data).toEqual([{ id: 'session-teacher-1', revokedAt: null }]);
    expect(body.error).toBeNull();
  });

  it('forbids teacher access to admin-only user listing', async () => {
    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get('/api/v1/users')
      .set('Authorization', 'Bearer teacher-token');
    const body = response.body as {
      success: boolean;
      message: string;
      data: null;
      error: { code: string };
    };

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.message).toBe('Forbidden resource');
    expect(body.data).toBeNull();
    expect(body.error.code).toBe('HTTP_ERROR');
  });

  it('allows admin access to user listing with the standard envelope', async () => {
    usersServiceMock.listUsers.mockResolvedValue({
      message: 'Users retrieved successfully',
      data: {
        items: [{ id: 'user-1', email: 'user@nexus.test' }],
        total: 1,
        page: 1,
        limit: 10,
      },
    });

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get('/api/v1/users?page=1&limit=10')
      .set('Authorization', 'Bearer admin-token');
    const body = response.body as {
      success: boolean;
      message: string;
      data: {
        items: Array<{ id: string; email: string }>;
        total: number;
        page: number;
        limit: number;
      };
      error: null;
    };

    expect(response.status).toBe(200);
    expect(usersServiceMock.listUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'admin-user-1',
        role: 'ADMIN',
      }),
      expect.objectContaining({
        page: 1,
        limit: 10,
      }),
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Users retrieved successfully');
    expect(body.data.total).toBe(1);
    expect(body.error).toBeNull();
  });

  it('allows an authenticated user to update their own profile', async () => {
    usersServiceMock.updateProfile.mockResolvedValue({
      message: 'Profile updated successfully',
      data: {
        id: 'teacher-user-1',
        name: 'Updated Teacher',
        email: 'teacher.updated@nexus.test',
      },
    });

    const payload = {
      name: 'Updated Teacher',
      email: 'teacher.updated@nexus.test',
      password: 'new-password-123',
    };

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .put('/api/v1/users/me')
      .set('Authorization', 'Bearer teacher-token')
      .send(payload);
    const body = response.body as {
      success: boolean;
      message: string;
      data: { id: string; name: string; email: string };
      error: null;
    };

    expect(response.status).toBe(200);
    expect(usersServiceMock.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'teacher-user-1',
        role: 'TEACHER',
      }),
      expect.objectContaining(payload),
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Profile updated successfully');
    expect(body.data).toEqual({
      id: 'teacher-user-1',
      name: 'Updated Teacher',
      email: 'teacher.updated@nexus.test',
    });
    expect(body.error).toBeNull();
  });

  it('returns attendance summary for an authenticated teacher with filters', async () => {
    attendanceServiceMock.getAttendanceSummary.mockResolvedValue({
      message: 'Attendance summary retrieved successfully',
      data: {
        totalRecords: 2,
        presentCount: 1,
        absentCount: 0,
        lateCount: 1,
        leaveCount: 0,
        halfDayCount: 0,
        checkedInCount: 2,
        checkedOutCount: 1,
      },
    });

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get('/api/v1/attendance/summary?dateFrom=2026-05-01&dateTo=2026-05-31')
      .set('Authorization', 'Bearer teacher-token');
    const body = response.body as {
      success: boolean;
      message: string;
      data: { totalRecords: number; lateCount: number };
      error: null;
    };

    expect(response.status).toBe(200);
    expect(attendanceServiceMock.getAttendanceSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'teacher-user-1',
        role: 'TEACHER',
      }),
      expect.objectContaining({
        dateFrom: '2026-05-01',
        dateTo: '2026-05-31',
      }),
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Attendance summary retrieved successfully');
    expect(body.data.totalRecords).toBe(2);
    expect(body.data.lateCount).toBe(1);
    expect(body.error).toBeNull();
  });

  it('returns an attendance record for an authenticated teacher', async () => {
    attendanceServiceMock.getAttendanceRecord.mockResolvedValue({
      message: 'Attendance record retrieved successfully',
      data: {
        id: '77777777-7777-4777-8777-777777777777',
        status: 'PRESENT',
      },
    });

    const attendanceId = '77777777-7777-4777-8777-777777777777';
    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get(`/api/v1/attendance/${attendanceId}`)
      .set('Authorization', 'Bearer teacher-token');
    const body = response.body as {
      success: boolean;
      message: string;
      data: { id: string; status: string };
      error: null;
    };

    expect(response.status).toBe(200);
    expect(attendanceServiceMock.getAttendanceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'teacher-user-1',
        role: 'TEACHER',
      }),
      attendanceId,
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Attendance record retrieved successfully');
    expect(body.data).toEqual({
      id: attendanceId,
      status: 'PRESENT',
    });
    expect(body.error).toBeNull();
  });

  it('allows admin to update an attendance record', async () => {
    attendanceServiceMock.updateAttendanceRecord.mockResolvedValue({
      message: 'Attendance record updated successfully',
      data: {
        id: '88888888-8888-4888-8888-888888888888',
        status: 'LATE',
        halfDay: false,
      },
    });

    const attendanceId = '88888888-8888-4888-8888-888888888888';
    const payload = {
      status: 'LATE',
      remarks: 'Traffic delay',
      halfDay: false,
    };

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .patch(`/api/v1/attendance/${attendanceId}`)
      .set('Authorization', 'Bearer admin-token')
      .send(payload);
    const body = response.body as {
      success: boolean;
      message: string;
      data: { id: string; status: string; halfDay: boolean };
      error: null;
    };

    expect(response.status).toBe(200);
    expect(attendanceServiceMock.updateAttendanceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'admin-user-1',
        role: 'ADMIN',
      }),
      attendanceId,
      expect.objectContaining(payload),
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Attendance record updated successfully');
    expect(body.data).toEqual({
      id: attendanceId,
      status: 'LATE',
      halfDay: false,
    });
    expect(body.error).toBeNull();
  });

  it('revokes all sessions for an authenticated user', async () => {
    authServiceMock.revokeSession.mockResolvedValue({
      message: 'All active sessions revoked successfully',
      data: null,
    });

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/api/v1/auth/sessions/revoke')
      .set('Authorization', 'Bearer teacher-token')
      .send({});
    const body = response.body as {
      success: boolean;
      message: string;
      data: null;
      error: null;
    };

    expect(response.status).toBe(201);
    expect(authServiceMock.revokeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'teacher-user-1',
        role: 'TEACHER',
      }),
      undefined,
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('All active sessions revoked successfully');
    expect(body.data).toBeNull();
    expect(body.error).toBeNull();
  });

  it('forbids teacher access to create a student record', async () => {
    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/api/v1/people/students')
      .set('Authorization', 'Bearer teacher-token')
      .send({
        userId: '11111111-1111-4111-8111-111111111111',
        regNo: 'REG-100',
        dob: '2012-01-15',
        gender: 'MALE',
        campusId: '22222222-2222-4222-8222-222222222222',
        admissionDate: '2026-05-01',
      });

    expect(response.status).toBe(403);
    expect(peopleServiceMock.createStudent).not.toHaveBeenCalled();
  });

  it('allows admin to create a student record', async () => {
    peopleServiceMock.createStudent.mockResolvedValue({
      message: 'Student created successfully',
      data: {
        id: 'student-1',
        regNo: 'REG-100',
      },
    });

    const payload = {
      userId: '11111111-1111-4111-8111-111111111111',
      regNo: 'REG-100',
      dob: '2012-01-15',
      gender: 'MALE',
      campusId: '22222222-2222-4222-8222-222222222222',
      admissionDate: '2026-05-01',
    };

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/api/v1/people/students')
      .set('Authorization', 'Bearer admin-token')
      .send(payload);
    const body = response.body as {
      success: boolean;
      message: string;
      data: { id: string; regNo: string };
      error: null;
    };

    expect(response.status).toBe(201);
    expect(peopleServiceMock.createStudent).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'admin-user-1',
        role: 'ADMIN',
      }),
      expect.objectContaining(payload),
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Student created successfully');
    expect(body.data).toEqual({
      id: 'student-1',
      regNo: 'REG-100',
    });
    expect(body.error).toBeNull();
  });

  it('returns a student detail record for an authenticated teacher', async () => {
    const studentId = '12121212-1212-4212-8212-121212121212';
    peopleServiceMock.getStudent.mockResolvedValue({
      message: 'Student retrieved successfully',
      data: {
        id: studentId,
        regNo: 'REG-100',
      },
    });

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get(`/api/v1/people/students/${studentId}`)
      .set('Authorization', 'Bearer teacher-token');
    const body = response.body as {
      success: boolean;
      message: string;
      data: { id: string; regNo: string };
      error: null;
    };

    expect(response.status).toBe(200);
    expect(peopleServiceMock.getStudent).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'teacher-user-1',
        role: 'TEACHER',
      }),
      studentId,
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Student retrieved successfully');
    expect(body.data).toEqual({
      id: studentId,
      regNo: 'REG-100',
    });
    expect(body.error).toBeNull();
  });

  it('allows admin to update a student record', async () => {
    const studentId = '13131313-1313-4313-8313-131313131313';
    peopleServiceMock.updateStudent.mockResolvedValue({
      message: 'Student updated successfully',
      data: {
        id: studentId,
        regNo: 'REG-101',
      },
    });

    const payload = {
      regNo: 'REG-101',
      picture: 'https://cdn.nexus.test/student-101.png',
    };

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .patch(`/api/v1/people/students/${studentId}`)
      .set('Authorization', 'Bearer admin-token')
      .send(payload);
    const body = response.body as {
      success: boolean;
      message: string;
      data: { id: string; regNo: string };
      error: null;
    };

    expect(response.status).toBe(200);
    expect(peopleServiceMock.updateStudent).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'admin-user-1',
        role: 'ADMIN',
      }),
      studentId,
      expect.objectContaining(payload),
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Student updated successfully');
    expect(body.data).toEqual({
      id: studentId,
      regNo: 'REG-101',
    });
    expect(body.error).toBeNull();
  });

  it('allows admin to soft-delete a student record', async () => {
    const studentId = '14141414-1414-4414-8414-141414141414';
    peopleServiceMock.deleteStudent.mockResolvedValue({
      message: 'Student moved to recycle bin successfully',
      data: null,
    });

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .delete(`/api/v1/people/students/${studentId}`)
      .set('Authorization', 'Bearer admin-token')
      .send({
        reason: 'Duplicate enrollment record',
      });
    const body = response.body as {
      success: boolean;
      message: string;
      data: null;
      error: null;
    };

    expect(response.status).toBe(200);
    expect(peopleServiceMock.deleteStudent).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'admin-user-1',
        role: 'ADMIN',
      }),
      studentId,
      'Duplicate enrollment record',
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Student moved to recycle bin successfully');
    expect(body.data).toBeNull();
    expect(body.error).toBeNull();
  });

  it('forbids teacher access to create a salary record', async () => {
    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/api/v1/finance/salaries')
      .set('Authorization', 'Bearer teacher-token')
      .send({
        userId: '11111111-1111-4111-8111-111111111111',
        campusId: '22222222-2222-4222-8222-222222222222',
        role: 'TEACHER',
        joiningDate: '2026-01-01',
        baseSalary: 25000,
        effectiveDate: '2026-05-01',
      });

    expect(response.status).toBe(403);
    expect(financeServiceMock.createSalary).not.toHaveBeenCalled();
  });

  it('forbids teacher access to soft-delete an academic level', async () => {
    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .delete('/api/v1/academics/levels/99999999-9999-4999-8999-999999999999')
      .set('Authorization', 'Bearer teacher-token')
      .send({
        reason: 'No longer needed',
      });

    expect(response.status).toBe(403);
    expect(academicsServiceMock.deleteLevel).not.toHaveBeenCalled();
  });

  it('allows admin to soft-delete an academic level', async () => {
    const levelId = '99999999-9999-4999-8999-999999999999';
    academicsServiceMock.deleteLevel.mockResolvedValue({
      message: 'Level moved to recycle bin successfully',
      data: {
        id: levelId,
      },
    });

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .delete(`/api/v1/academics/levels/${levelId}`)
      .set('Authorization', 'Bearer admin-token')
      .send({
        reason: 'Merged into another level',
      });
    const body = response.body as {
      success: boolean;
      message: string;
      data: { id: string };
      error: null;
    };

    expect(response.status).toBe(200);
    expect(academicsServiceMock.deleteLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'admin-user-1',
        role: 'ADMIN',
      }),
      levelId,
      'Merged into another level',
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Level moved to recycle bin successfully');
    expect(body.data).toEqual({ id: levelId });
    expect(body.error).toBeNull();
  });

  it('allows admin to create a salary record', async () => {
    financeServiceMock.createSalary.mockResolvedValue({
      message: 'Salary created successfully',
      data: {
        id: 'salary-1',
        baseSalary: 25000,
      },
    });

    const payload = {
      userId: '11111111-1111-4111-8111-111111111111',
      campusId: '22222222-2222-4222-8222-222222222222',
      role: 'TEACHER',
      joiningDate: '2026-01-01',
      baseSalary: 25000,
      effectiveDate: '2026-05-01',
    };

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/api/v1/finance/salaries')
      .set('Authorization', 'Bearer admin-token')
      .send(payload);
    const body = response.body as {
      success: boolean;
      message: string;
      data: { id: string; baseSalary: number };
      error: null;
    };

    expect(response.status).toBe(201);
    expect(financeServiceMock.createSalary).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'admin-user-1',
        role: 'ADMIN',
      }),
      expect.objectContaining(payload),
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Salary created successfully');
    expect(body.data).toEqual({
      id: 'salary-1',
      baseSalary: 25000,
    });
    expect(body.error).toBeNull();
  });

  it('returns a salary record for an authenticated teacher', async () => {
    const salaryId = '15151515-1515-4515-8515-151515151515';
    financeServiceMock.getSalary.mockResolvedValue({
      message: 'Salary retrieved successfully',
      data: {
        id: salaryId,
        baseSalary: 25000,
      },
    });

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get(`/api/v1/finance/salaries/${salaryId}`)
      .set('Authorization', 'Bearer teacher-token');
    const body = response.body as {
      success: boolean;
      message: string;
      data: { id: string; baseSalary: number };
      error: null;
    };

    expect(response.status).toBe(200);
    expect(financeServiceMock.getSalary).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'teacher-user-1',
        role: 'TEACHER',
      }),
      salaryId,
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Salary retrieved successfully');
    expect(body.data).toEqual({
      id: salaryId,
      baseSalary: 25000,
    });
    expect(body.error).toBeNull();
  });

  it('allows admin to update a salary record', async () => {
    const salaryId = '16161616-1616-4616-8616-161616161616';
    financeServiceMock.updateSalary.mockResolvedValue({
      message: 'Salary updated successfully',
      data: {
        id: salaryId,
        baseSalary: 27500,
      },
    });

    const payload = {
      baseSalary: 27500,
      status: 'UPDATED',
    };

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .patch(`/api/v1/finance/salaries/${salaryId}`)
      .set('Authorization', 'Bearer admin-token')
      .send(payload);
    const body = response.body as {
      success: boolean;
      message: string;
      data: { id: string; baseSalary: number };
      error: null;
    };

    expect(response.status).toBe(200);
    expect(financeServiceMock.updateSalary).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'admin-user-1',
        role: 'ADMIN',
      }),
      salaryId,
      expect.objectContaining(payload),
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Salary updated successfully');
    expect(body.data).toEqual({
      id: salaryId,
      baseSalary: 27500,
    });
    expect(body.error).toBeNull();
  });

  it('allows admin to soft-delete a salary record', async () => {
    const salaryId = '17171717-1717-4717-8717-171717171717';
    financeServiceMock.deleteSalary.mockResolvedValue({
      message: 'Salary moved to recycle bin successfully',
      data: {
        id: salaryId,
      },
    });

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .delete(`/api/v1/finance/salaries/${salaryId}`)
      .set('Authorization', 'Bearer admin-token')
      .send({
        reason: 'Superseded by a new payroll setup',
      });
    const body = response.body as {
      success: boolean;
      message: string;
      data: { id: string };
      error: null;
    };

    expect(response.status).toBe(200);
    expect(financeServiceMock.deleteSalary).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'admin-user-1',
        role: 'ADMIN',
      }),
      salaryId,
      'Superseded by a new payroll setup',
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Salary moved to recycle bin successfully');
    expect(body.data).toEqual({ id: salaryId });
    expect(body.error).toBeNull();
  });

  it('returns fee vouchers for an authenticated teacher', async () => {
    financeServiceMock.listFeeVouchers.mockResolvedValue({
      message: 'Fee vouchers retrieved successfully',
      data: [
        {
          id: 'voucher-1',
          studentId: '33333333-3333-4333-8333-333333333333',
        },
      ],
    });

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get(
        '/api/v1/finance/fee-vouchers?campusId=22222222-2222-4222-8222-222222222222',
      )
      .set('Authorization', 'Bearer teacher-token');
    const body = response.body as {
      success: boolean;
      message: string;
      data: Array<{ id: string; studentId: string }>;
      error: null;
    };

    expect(response.status).toBe(200);
    expect(financeServiceMock.listFeeVouchers).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'teacher-user-1',
        role: 'TEACHER',
      }),
      '22222222-2222-4222-8222-222222222222',
      undefined,
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Fee vouchers retrieved successfully');
    expect(body.data).toEqual([
      {
        id: 'voucher-1',
        studentId: '33333333-3333-4333-8333-333333333333',
      },
    ]);
    expect(body.error).toBeNull();
  });

  it('allows admin to create a fee voucher', async () => {
    financeServiceMock.createFeeVoucher.mockResolvedValue({
      message: 'Fee voucher created successfully',
      data: {
        id: 'voucher-1',
        month: 5,
        year: 2026,
      },
    });

    const payload = {
      studentId: '33333333-3333-4333-8333-333333333333',
      feeStructureId: '44444444-4444-4444-8444-444444444444',
      month: 5,
      year: 2026,
      dueDate: '2026-05-20',
    };

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/api/v1/finance/fee-vouchers')
      .set('Authorization', 'Bearer admin-token')
      .send(payload);
    const body = response.body as {
      success: boolean;
      message: string;
      data: { id: string; month: number; year: number };
      error: null;
    };

    expect(response.status).toBe(201);
    expect(financeServiceMock.createFeeVoucher).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'admin-user-1',
        role: 'ADMIN',
      }),
      expect.objectContaining(payload),
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Fee voucher created successfully');
    expect(body.data).toEqual({
      id: 'voucher-1',
      month: 5,
      year: 2026,
    });
    expect(body.error).toBeNull();
  });

  it('allows admin to create a fee payment', async () => {
    financeServiceMock.createFeePayment.mockResolvedValue({
      message: 'Fee payment created successfully',
      data: {
        id: 'payment-1',
        paidAmount: 1500,
      },
    });

    const payload = {
      voucherId: '55555555-5555-4555-8555-555555555555',
      month: 5,
      year: 2026,
      paidAmount: 1500,
      paymentMethod: 'CASH',
      paymentDate: '2026-05-21',
    };

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/api/v1/finance/fee-payments')
      .set('Authorization', 'Bearer admin-token')
      .send(payload);
    const body = response.body as {
      success: boolean;
      message: string;
      data: { id: string; paidAmount: number };
      error: null;
    };

    expect(response.status).toBe(201);
    expect(financeServiceMock.createFeePayment).toHaveBeenCalledWith(
      expect.objectContaining(payload),
      expect.objectContaining({
        sub: 'admin-user-1',
        role: 'ADMIN',
      }),
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Fee payment created successfully');
    expect(body.data).toEqual({
      id: 'payment-1',
      paidAmount: 1500,
    });
    expect(body.error).toBeNull();
  });

  it('forbids admin access to the superadmin audit dashboard', async () => {
    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get('/api/v1/audit-logs?page=1&limit=10')
      .set('Authorization', 'Bearer admin-token');
    const body = response.body as {
      success: boolean;
      message: string;
      data: null;
      error: { code: string };
    };

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.message).toBe('Forbidden resource');
    expect(body.data).toBeNull();
    expect(body.error.code).toBe('HTTP_ERROR');
  });

  it('allows superadmin to list audit logs with frontend-friendly pagination fields', async () => {
    auditLogsServiceMock.listAuditLogs.mockResolvedValue({
      message: 'Audit logs retrieved successfully',
      data: {
        items: [
          {
            id: 'audit-1',
            action: 'STUDENT_RESTORED',
            entity: 'Student',
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get(
        '/api/v1/audit-logs?page=1&limit=10&search=nexus&entity=student&action=restored',
      )
      .set('Authorization', 'Bearer superadmin-token');
    const body = response.body as {
      success: boolean;
      message: string;
      data: {
        items: Array<{ id: string; action: string; entity: string }>;
        total: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
      };
      error: null;
    };

    expect(response.status).toBe(200);
    expect(auditLogsServiceMock.listAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        limit: 10,
        search: 'nexus',
        entity: 'student',
        action: 'restored',
      }),
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Audit logs retrieved successfully');
    expect(body.data.totalPages).toBe(1);
    expect(body.data.hasNextPage).toBe(false);
    expect(body.data.hasPreviousPage).toBe(false);
    expect(body.error).toBeNull();
  });

  it('allows admin to list recycle-bin records with the standard envelope', async () => {
    recycleBinServiceMock.listDeletedItems.mockResolvedValue({
      message: 'Recycle bin items retrieved successfully',
      data: {
        items: [
          {
            id: 'student-1',
            entity: 'student',
            label: 'REG-100',
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      },
    });

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get('/api/v1/recycle-bin?page=1&limit=10&entity=student')
      .set('Authorization', 'Bearer admin-token');
    const body = response.body as {
      success: boolean;
      message: string;
      data: {
        items: Array<{ id: string; entity: string; label: string }>;
        total: number;
      };
      error: null;
    };

    expect(response.status).toBe(200);
    expect(recycleBinServiceMock.listDeletedItems).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'admin-user-1',
        role: 'ADMIN',
      }),
      expect.objectContaining({
        page: 1,
        limit: 10,
        entity: 'student',
      }),
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Recycle bin items retrieved successfully');
    expect(body.data.total).toBe(1);
    expect(body.error).toBeNull();
  });

  it('allows admin to restore a recycle-bin record', async () => {
    const recordId = '66666666-6666-4666-8666-666666666666';

    recycleBinServiceMock.restoreRecord.mockResolvedValue({
      message: 'Student restored successfully',
      data: {
        id: recordId,
      },
    });

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post(`/api/v1/recycle-bin/student/${recordId}/restore`)
      .set('Authorization', 'Bearer admin-token');
    const body = response.body as {
      success: boolean;
      message: string;
      data: { id: string };
      error: null;
    };

    expect(response.status).toBe(201);
    expect(recycleBinServiceMock.restoreRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'admin-user-1',
        role: 'ADMIN',
      }),
      'student',
      recordId,
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Student restored successfully');
    expect(body.data).toEqual({ id: recordId });
    expect(body.error).toBeNull();
  });

  it('allows admin to restore a deleted academic level through recycle bin', async () => {
    const recordId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    recycleBinServiceMock.restoreRecord.mockResolvedValue({
      message: 'Level restored successfully',
      data: {
        id: recordId,
      },
    });

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post(`/api/v1/recycle-bin/level/${recordId}/restore`)
      .set('Authorization', 'Bearer admin-token');
    const body = response.body as {
      success: boolean;
      message: string;
      data: { id: string };
      error: null;
    };

    expect(response.status).toBe(201);
    expect(recycleBinServiceMock.restoreRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'admin-user-1',
        role: 'ADMIN',
      }),
      'level',
      recordId,
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Level restored successfully');
    expect(body.data).toEqual({ id: recordId });
    expect(body.error).toBeNull();
  });

  it('allows admin to restore a deleted student through recycle bin', async () => {
    const recordId = '18181818-1818-4818-8818-181818181818';
    recycleBinServiceMock.restoreRecord.mockResolvedValue({
      message: 'Student restored successfully',
      data: {
        id: recordId,
      },
    });

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post(`/api/v1/recycle-bin/student/${recordId}/restore`)
      .set('Authorization', 'Bearer admin-token');
    const body = response.body as {
      success: boolean;
      message: string;
      data: { id: string };
      error: null;
    };

    expect(response.status).toBe(201);
    expect(recycleBinServiceMock.restoreRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'admin-user-1',
        role: 'ADMIN',
      }),
      'student',
      recordId,
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Student restored successfully');
    expect(body.data).toEqual({ id: recordId });
    expect(body.error).toBeNull();
  });

  it('allows admin to restore a deleted salary through recycle bin', async () => {
    const recordId = '19191919-1919-4919-8919-191919191919';
    recycleBinServiceMock.restoreRecord.mockResolvedValue({
      message: 'Salary restored successfully',
      data: {
        id: recordId,
      },
    });

    const response: SupertestResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post(`/api/v1/recycle-bin/salary/${recordId}/restore`)
      .set('Authorization', 'Bearer admin-token');
    const body = response.body as {
      success: boolean;
      message: string;
      data: { id: string };
      error: null;
    };

    expect(response.status).toBe(201);
    expect(recycleBinServiceMock.restoreRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'admin-user-1',
        role: 'ADMIN',
      }),
      'salary',
      recordId,
    );
    expect(body.success).toBe(true);
    expect(body.message).toBe('Salary restored successfully');
    expect(body.data).toEqual({ id: recordId });
    expect(body.error).toBeNull();
  });
});
