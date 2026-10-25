/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest asymmetric matchers are typed any */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { ModuleKey, Prisma, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerateStudentFinesDto } from './dto/finance.dto';
import {
  MAX_FINE_RUN_STUDENTS,
  StudentFineGenerationService,
} from './student-fine-generation.service';

describe('StudentFineGenerationService', () => {
  let service: StudentFineGenerationService;

  const admin: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };

  const prismaMock = {
    campus: { findUnique: jest.fn() },
    institution: { findUnique: jest.fn() },
    studentEnrollment: { findMany: jest.fn() },
    studentFineRule: { findMany: jest.fn() },
    studentFine: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    feeVoucher: { findMany: jest.fn() },
    attendance: { findMany: jest.fn() },
  };
  const moduleAccessMock = {
    assertModuleEnabledForUser: jest.fn().mockResolvedValue(undefined),
  };
  const campusAccessMock = {
    assertCampusAccess: jest.fn().mockResolvedValue(undefined),
  };
  const auditMock = { log: jest.fn().mockResolvedValue(undefined) };

  const dto = (
    overrides: Partial<GenerateStudentFinesDto> = {},
  ): GenerateStudentFinesDto => ({
    campusId: 'campus-1',
    month: 9,
    year: 2026,
    ...overrides,
  });

  const enrollment = (id: string, name: string, classId = 'class-1') => ({
    classId,
    student: { id, userId: `user-${id}`, regNo: `R-${id}`, user: { name } },
  });

  const rule = (overrides: Record<string, unknown> = {}) => ({
    campusId: 'campus-1',
    classId: null,
    allowedAbsences: 1,
    absenceFineAmount: new Prisma.Decimal(100),
    allowedLates: 0,
    lateFineAmount: new Prisma.Decimal(0),
    allowedHalfDays: 0,
    halfDayFineAmount: new Prisma.Decimal(0),
    allowedLeaves: 0,
    leaveFineAmount: new Prisma.Decimal(0),
    ...overrides,
  });

  const absences = (userId: string, count: number) =>
    Array.from({ length: count }, () => ({
      userId,
      status: 'ABSENT',
      halfDay: false,
    }));

  beforeEach(async () => {
    jest.resetAllMocks();
    moduleAccessMock.assertModuleEnabledForUser.mockResolvedValue(undefined);
    campusAccessMock.assertCampusAccess.mockResolvedValue(undefined);
    auditMock.log.mockResolvedValue(undefined);
    prismaMock.campus.findUnique.mockResolvedValue({ institutionId: 'inst-1' });
    prismaMock.institution.findUnique.mockResolvedValue({
      currentAcademicYearId: 'year-1',
    });
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      enrollment('s1', 'Ayesha'),
    ]);
    prismaMock.studentFineRule.findMany.mockResolvedValue([rule()]);
    prismaMock.studentFine.findMany.mockResolvedValue([]);
    prismaMock.feeVoucher.findMany.mockResolvedValue([]);
    prismaMock.attendance.findMany.mockResolvedValue(absences('user-s1', 3));
    prismaMock.studentFine.create.mockResolvedValue({ id: 'fine-1' });
    prismaMock.studentFine.update.mockResolvedValue({ id: 'fine-1' });

    const module = await Test.createTestingModule({
      providers: [
        StudentFineGenerationService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ModuleAccessService, useValue: moduleAccessMock },
        { provide: CampusAccessService, useValue: campusAccessMock },
        { provide: AuditLogService, useValue: auditMock },
      ],
    }).compile();
    service = module.get(StudentFineGenerationService);
  });

  it('checks the finance module and campus access first', async () => {
    await service.generate(admin, dto());

    expect(moduleAccessMock.assertModuleEnabledForUser).toHaveBeenCalledWith(
      admin,
      ModuleKey.FINANCE,
    );
    expect(campusAccessMock.assertCampusAccess).toHaveBeenCalledWith(
      admin,
      'campus-1',
    );
  });

  it('creates a pending fine for the marks beyond the allowance', async () => {
    const { data } = await service.generate(admin, dto());

    expect(data.totals).toEqual({
      fined: 1,
      unchanged: 0,
      totalAmount: '200.00',
    });
    expect(data.fined[0]).toMatchObject({
      action: 'created',
      amount: '200.00',
      counts: { absent: 3, late: 0, halfDay: 0, leave: 0 },
    });
    expect(prismaMock.studentFine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studentId: 's1',
        fineStatus: 'PENDING',
        absentCount: 3,
        fineReason: expect.stringMatching(/^Attendance fine:/),
        createdBy: 'admin-1',
      }),
    });
    expect(auditMock.log).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ action: 'STUDENT_FINES_GENERATED' }),
    );
  });

  it('counts a half day separately from the status', async () => {
    prismaMock.studentFineRule.findMany.mockResolvedValue([
      rule({
        allowedAbsences: 99,
        allowedHalfDays: 0,
        halfDayFineAmount: new Prisma.Decimal(40),
      }),
    ]);
    prismaMock.attendance.findMany.mockResolvedValue([
      { userId: 'user-s1', status: 'PRESENT', halfDay: true },
      { userId: 'user-s1', status: 'LATE', halfDay: true },
    ]);

    const { data } = await service.generate(admin, dto());

    expect(data.fined[0].counts).toEqual({
      absent: 0,
      late: 1,
      halfDay: 2,
      leave: 0,
    });
    expect(data.fined[0].amount).toBe('80.00');
  });

  it('writes nothing in preview, and records no summary', async () => {
    const { data } = await service.generate(admin, dto({ preview: true }));

    expect(data.preview).toBe(true);
    expect(data.fined[0].fineId).toBeNull();
    expect(prismaMock.studentFine.create).not.toHaveBeenCalled();
    expect(auditMock.log).not.toHaveBeenCalled();
  });

  it('uses a class rule over the campus-wide rule', async () => {
    prismaMock.studentFineRule.findMany.mockResolvedValue([
      rule(),
      rule({ classId: 'class-1', absenceFineAmount: new Prisma.Decimal(500) }),
    ]);

    const { data } = await service.generate(admin, dto());

    expect(data.fined[0].amount).toBe('1000.00');
  });

  it('reports a student with no applicable rule', async () => {
    prismaMock.studentFineRule.findMany.mockResolvedValue([
      rule({ classId: 'class-9' }),
    ]);

    const { data } = await service.generate(admin, dto());

    expect(data.unchanged[0].reason).toBe(
      'No fine rule applies to this student.',
    );
    expect(prismaMock.studentFine.create).not.toHaveBeenCalled();
  });

  it('creates nothing when no fine is due', async () => {
    prismaMock.attendance.findMany.mockResolvedValue(absences('user-s1', 1));

    const { data } = await service.generate(admin, dto());

    expect(data.unchanged[0].reason).toBe('No fine is due.');
    expect(prismaMock.studentFine.create).not.toHaveBeenCalled();
  });

  it('refreshes a fine it calculated earlier, even down to zero', async () => {
    prismaMock.studentFine.findMany.mockResolvedValue([
      {
        id: 'fine-1',
        studentId: 's1',
        fineStatus: 'PENDING',
        fineReason: 'Attendance fine: 9 absent, 0 late, 0 half day, 0 leave.',
      },
    ]);
    prismaMock.attendance.findMany.mockResolvedValue(absences('user-s1', 1));

    const { data } = await service.generate(admin, dto());

    expect(data.fined[0]).toMatchObject({ action: 'updated', amount: '0.00' });
    expect(prismaMock.studentFine.update).toHaveBeenCalledWith({
      where: { id: 'fine-1' },
      data: expect.objectContaining({ absentCount: 1, updatedBy: 'admin-1' }),
    });
    expect(prismaMock.studentFine.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a fine entered by hand',
      { fineStatus: 'PENDING', fineReason: 'Broke a window' },
      [],
      'A fine entered by hand already exists for this month.',
    ],
    [
      'a fine entered by hand with no reason',
      { fineStatus: 'PENDING', fineReason: null },
      [],
      'A fine entered by hand already exists for this month.',
    ],
    [
      'a paid automatic fine',
      { fineStatus: 'PAID', fineReason: 'Attendance fine: 3 absent' },
      [],
      'This fine is already paid.',
    ],
    [
      'an issued voucher',
      { fineStatus: 'PENDING', fineReason: 'Attendance fine: 3 absent' },
      [{ studentId: 's1' }],
      'The voucher for this month was already issued.',
    ],
  ])('leaves %s alone', async (_name, fine, vouchers, reason) => {
    prismaMock.studentFine.findMany.mockResolvedValue([
      { id: 'fine-1', studentId: 's1', ...fine },
    ]);
    prismaMock.feeVoucher.findMany.mockResolvedValue(vouchers);

    const { data } = await service.generate(admin, dto());

    expect(data.unchanged[0].reason).toBe(reason);
    expect(prismaMock.studentFine.update).not.toHaveBeenCalled();
    expect(prismaMock.studentFine.create).not.toHaveBeenCalled();
  });

  it('reports a simultaneous creation as unchanged instead of failing the run', async () => {
    prismaMock.studentFine.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );

    const { data } = await service.generate(admin, dto());

    expect(data.unchanged[0].reason).toMatch(/same moment/);
  });

  it('reports an unexpected save failure without stopping the run', async () => {
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      enrollment('s1', 'Ayesha'),
      enrollment('s2', 'Bilal'),
    ]);
    prismaMock.attendance.findMany.mockResolvedValue([
      ...absences('user-s1', 3),
      ...absences('user-s2', 3),
    ]);
    prismaMock.studentFine.create
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ id: 'fine-2' });

    const { data } = await service.generate(admin, dto());

    expect(data.unchanged[0].reason).toBe('This fine could not be saved.');
    expect(data.fined).toHaveLength(1);
  });

  it('still returns the report if the summary audit cannot be written', async () => {
    auditMock.log.mockRejectedValue(new Error('audit down'));

    const { data } = await service.generate(admin, dto());

    expect(data.totals.fined).toBe(1);
  });

  it('requires a current academic year', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      currentAcademicYearId: null,
    });

    await expect(service.generate(admin, dto())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('runs without a signed-in person for the scheduled run: no access checks, nothing recorded against a user, never a preview', async () => {
    const { data } = await service.generateAutomatically({
      ...dto(),
      preview: true,
    });

    expect(data.preview).toBe(false);
    expect(moduleAccessMock.assertModuleEnabledForUser).not.toHaveBeenCalled();
    expect(campusAccessMock.assertCampusAccess).not.toHaveBeenCalled();
    expect(prismaMock.studentFine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ createdBy: null }),
    });
    expect(auditMock.log).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        action: 'STUDENT_FINES_GENERATED',
        metadata: expect.objectContaining({ automatic: true }),
      }),
    );
  });

  it('refreshes its own fine in a scheduled run without naming a user either', async () => {
    prismaMock.studentFine.findMany.mockResolvedValue([
      {
        id: 'fine-1',
        studentId: 's1',
        fineStatus: 'PENDING',
        fineReason: 'Attendance fine: 9 absent, 0 late, 0 half day, 0 leave.',
      },
    ]);

    await service.generateAutomatically(dto());

    expect(prismaMock.studentFine.update).toHaveBeenCalledWith({
      where: { id: 'fine-1' },
      data: expect.objectContaining({ updatedBy: null }),
    });
  });

  it('refuses a scheduled run for a campus with no institution', async () => {
    prismaMock.campus.findUnique.mockResolvedValue({ institutionId: null });

    await expect(service.generateAutomatically(dto())).rejects.toThrow(
      'You do not have access to this campus.',
    );
  });

  it('refuses a run that covers too many students', async () => {
    prismaMock.studentEnrollment.findMany.mockResolvedValue(
      Array.from({ length: MAX_FINE_RUN_STUDENTS + 1 }, (_, index) =>
        enrollment(`s${index}`, `Student ${index}`),
      ),
    );

    await expect(service.generate(admin, dto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('narrows to the chosen class and section', async () => {
    await service.generate(admin, dto({ classId: 'c', sectionId: 'sec' }));

    expect(prismaMock.studentEnrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ classId: 'c', sectionId: 'sec' }),
      }),
    );
  });
});
