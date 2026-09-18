import { Test } from '@nestjs/testing';
import { UserRole } from '../../prisma/client';
import { CurrentUser } from '../interfaces/current-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  let service: AuditLogService;

  const prismaMock = {
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const txMock = {
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };

  const currentUser: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'institution-1',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = moduleRef.get<AuditLogService>(AuditLogService);
  });

  it('records the acting user and falls back to their institutionId', async () => {
    await service.log(currentUser, {
      action: 'CAMPUS_CREATED',
      entity: 'Campus',
      entityId: 'campus-1',
      metadata: { name: 'City Campus' },
    });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'admin-1',
        institutionId: 'institution-1',
        action: 'CAMPUS_CREATED',
        entity: 'Campus',
        entityId: 'campus-1',
        metadata: { name: 'City Campus' },
      },
    });
  });

  it('prefers an explicit institutionId over the current user institution', async () => {
    await service.log(currentUser, {
      action: 'INSTITUTION_UPDATED',
      entity: 'Institution',
      institutionId: 'institution-9',
    });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        institutionId: 'institution-9',
      }) as never,
    });
  });

  it('records a null userId/institutionId when no current user is available', async () => {
    await service.log(null, {
      action: 'SYSTEM_EVENT',
      entity: 'System',
    });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: null,
        institutionId: null,
        action: 'SYSTEM_EVENT',
        entity: 'System',
        entityId: null,
        metadata: undefined,
      },
    });
  });

  it('writes through the provided transaction client instead of the default connection', async () => {
    await service.log(
      currentUser,
      { action: 'CAMPUS_UPDATED', entity: 'Campus', entityId: 'campus-1' },
      txMock as never,
    );

    expect(txMock.auditLog.create).toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
