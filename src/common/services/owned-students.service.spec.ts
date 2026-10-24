import { Test } from '@nestjs/testing';
import { CurrentUser } from '../interfaces/current-user.interface';
import { UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnedStudentsService } from './owned-students.service';

describe('OwnedStudentsService', () => {
  let service: OwnedStudentsService;
  const prismaMock = {
    student: { findFirst: jest.fn() },
    guardian: { findFirst: jest.fn() },
    studentGuardian: { findMany: jest.fn() },
  };

  const user = (role: UserRole): CurrentUser => ({
    sub: 'user-1',
    email: 'u@nexus.test',
    role,
    institutionId: 'inst-1',
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        OwnedStudentsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get(OwnedStudentsService);
  });

  it('gives a student only their own record', async () => {
    prismaMock.student.findFirst.mockResolvedValue({ id: 's1' });

    expect(
      await service.resolveOwnedStudentIds(user(UserRole.STUDENT)),
    ).toEqual(['s1']);
    expect(prismaMock.student.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', deletedAt: null },
      select: { id: true },
    });
  });

  it('gives a student with no record nothing', async () => {
    prismaMock.student.findFirst.mockResolvedValue(null);

    expect(
      await service.resolveOwnedStudentIds(user(UserRole.STUDENT)),
    ).toEqual([]);
  });

  it('gives a guardian every linked, active child', async () => {
    prismaMock.guardian.findFirst.mockResolvedValue({ id: 'g1' });
    prismaMock.studentGuardian.findMany.mockResolvedValue([
      { studentId: 's1' },
      { studentId: 's2' },
    ]);

    expect(
      await service.resolveOwnedStudentIds(user(UserRole.GUARDIAN)),
    ).toEqual(['s1', 's2']);
    expect(prismaMock.studentGuardian.findMany).toHaveBeenCalledWith({
      where: {
        guardianId: 'g1',
        deletedAt: null,
        student: { deletedAt: null },
      },
      select: { studentId: true },
    });
  });

  it('gives a guardian with no record nothing', async () => {
    prismaMock.guardian.findFirst.mockResolvedValue(null);

    expect(
      await service.resolveOwnedStudentIds(user(UserRole.GUARDIAN)),
    ).toEqual([]);
    expect(prismaMock.studentGuardian.findMany).not.toHaveBeenCalled();
  });

  it.each([UserRole.ADMIN, UserRole.STAFF, UserRole.SUPERADMIN])(
    'gives %s nothing, since staff are not self-service callers',
    async (role) => {
      expect(await service.resolveOwnedStudentIds(user(role))).toEqual([]);
      expect(prismaMock.student.findFirst).not.toHaveBeenCalled();
    },
  );

  it('lists the children of a given guardian for staff screens', async () => {
    prismaMock.studentGuardian.findMany.mockResolvedValue([
      { studentId: 's9' },
    ]);

    expect(await service.studentIdsOfGuardian('g7')).toEqual(['s9']);
  });
});
