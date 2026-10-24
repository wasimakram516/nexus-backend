import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { reconcileFeeVoucher } from '../../common/utils/fee-settlement.util';
import { readVoucherAmounts } from '../../common/utils/voucher-calculation.util';
import { ModuleKey, Prisma, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BulkGenerateVouchersDto } from './dto/finance.dto';
import {
  FeeVoucherGenerationService,
  MAX_BULK_VOUCHER_STUDENTS,
} from './fee-voucher-generation.service';

jest.mock('../../common/utils/voucher-calculation.util', () => ({
  readVoucherAmounts: jest.fn(),
}));
jest.mock('../../common/utils/fee-settlement.util', () => ({
  reconcileFeeVoucher: jest.fn(),
}));

describe('FeeVoucherGenerationService', () => {
  let service: FeeVoucherGenerationService;

  const admin: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };

  const tx = { feeVoucher: { create: jest.fn() } };
  const prismaMock = {
    $transaction: jest.fn(),
    campus: { findUnique: jest.fn() },
    bankAccount: { findUnique: jest.fn() },
    customFieldDefinition: { count: jest.fn() },
    institution: { findUnique: jest.fn() },
    institutionSetting: { findUnique: jest.fn() },
    studentEnrollment: { findMany: jest.fn() },
    feeStructure: { findMany: jest.fn() },
    feeVoucher: { findMany: jest.fn() },
  };
  const moduleAccessMock = {
    assertModuleEnabledForUser: jest.fn().mockResolvedValue(undefined),
  };
  const campusAccessMock = {
    assertCampusAccess: jest.fn().mockResolvedValue(undefined),
  };
  const auditMock = { log: jest.fn().mockResolvedValue(undefined) };

  const readAmounts = readVoucherAmounts as jest.Mock;
  const reconcile = reconcileFeeVoucher as jest.Mock;

  const dto = (
    overrides: Partial<BulkGenerateVouchersDto> = {},
  ): BulkGenerateVouchersDto => ({
    campusId: 'campus-1',
    month: 9,
    year: 2026,
    ...overrides,
  });

  const enrollment = (id: string, name: string, classId = 'class-1') => ({
    classId,
    student: { id, regNo: `R-${id}`, user: { name } },
  });

  const amounts = (due: string) => ({
    finalAmountDue: new Prisma.Decimal(due),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (callback: (client: typeof tx) => unknown) => callback(tx),
    );
    prismaMock.campus.findUnique.mockResolvedValue({ institutionId: 'inst-1' });
    prismaMock.bankAccount.findUnique.mockResolvedValue({
      campusId: 'campus-1',
    });
    prismaMock.customFieldDefinition.count.mockResolvedValue(0);
    prismaMock.institution.findUnique.mockResolvedValue({
      currentAcademicYearId: 'year-1',
    });
    prismaMock.institutionSetting.findUnique.mockResolvedValue(null);
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      enrollment('s-bilal', 'Bilal'),
      enrollment('s-ayesha', 'Ayesha'),
    ]);
    prismaMock.feeStructure.findMany.mockResolvedValue([
      { id: 'fs-1', classId: 'class-1' },
    ]);
    prismaMock.feeVoucher.findMany.mockResolvedValue([]);
    readAmounts.mockResolvedValue(amounts('1250.50'));
    reconcile.mockResolvedValue(undefined);
    let counter = 0;
    tx.feeVoucher.create.mockImplementation(() => {
      counter += 1;
      return Promise.resolve({ id: `voucher-${counter}` });
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        FeeVoucherGenerationService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ModuleAccessService, useValue: moduleAccessMock },
        { provide: CampusAccessService, useValue: campusAccessMock },
        { provide: AuditLogService, useValue: auditMock },
        RequestContextService,
      ],
    }).compile();
    service = moduleRef.get(FeeVoucherGenerationService);
  });

  it('creates a voucher per enrolled student, ordered by name, and totals the amounts', async () => {
    const { data } = await service.generate(admin, dto());

    expect(moduleAccessMock.assertModuleEnabledForUser).toHaveBeenCalledWith(
      admin,
      ModuleKey.FINANCE,
    );
    expect(campusAccessMock.assertCampusAccess).toHaveBeenCalledWith(
      admin,
      'campus-1',
    );
    expect(data.generated.map((row) => row.name)).toEqual(['Ayesha', 'Bilal']);
    expect(data.generated[0]).toMatchObject({
      voucherId: 'voucher-1',
      amount: '1250.50',
    });
    expect(data.totals).toEqual({
      generated: 2,
      skipped: 0,
      failed: 0,
      totalAmount: '2501.00',
    });
    expect(tx.feeVoucher.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studentId: 's-ayesha',
        feeStructureId: 'fs-1',
        month: 9,
        year: 2026,
        createdBy: 'admin-1',
      }) as never,
    });
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it("selects the current year's students who have not withdrawn, narrowed by class and section", async () => {
    await service.generate(
      admin,
      dto({ classId: 'class-1', sectionId: 'sec-a' }),
    );

    expect(prismaMock.studentEnrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          academicYearId: 'year-1',
          campusId: 'campus-1',
          status: { not: 'LEFT' },
          deletedAt: null,
          student: { deletedAt: null },
          classId: 'class-1',
          sectionId: 'sec-a',
        },
      }),
    );
  });

  it('skips students who already have a voucher for the month, so a second run creates nothing new', async () => {
    prismaMock.feeVoucher.findMany.mockResolvedValue([
      { studentId: 's-ayesha' },
      { studentId: 's-bilal' },
    ]);

    const { data } = await service.generate(admin, dto());

    expect(data.totals).toMatchObject({ generated: 0, skipped: 2, failed: 0 });
    expect(data.skipped[0].reason).toMatch(/already exists/);
    expect(tx.feeVoucher.create).not.toHaveBeenCalled();
  });

  it('reports a class with no fee structure as failed without stopping the others', async () => {
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      enrollment('s-ayesha', 'Ayesha'),
      enrollment('s-omar', 'Omar', 'class-9'),
    ]);

    const { data } = await service.generate(admin, dto());

    expect(data.generated.map((row) => row.name)).toEqual(['Ayesha']);
    expect(data.failed).toEqual([
      expect.objectContaining({
        name: 'Omar',
        reason: "No fee structure is set for this student's class.",
      }),
    ]);
  });

  it("isolates a failing student: the rest are still created and the reason is the student's own", async () => {
    readAmounts
      .mockResolvedValueOnce(amounts('100'))
      .mockRejectedValueOnce(
        new ConflictException(
          'The student or fee structure changed. Reload before saving.',
        ),
      )
      .mockResolvedValue(amounts('100'));
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      enrollment('s-a', 'Ana'),
      enrollment('s-b', 'Bea'),
      enrollment('s-c', 'Cara'),
    ]);

    const { data } = await service.generate(admin, dto());

    expect(data.totals).toMatchObject({ generated: 2, failed: 1 });
    expect(data.failed[0]).toMatchObject({
      name: 'Bea',
      reason: 'The student or fee structure changed. Reload before saving.',
    });
  });

  it('gives a generic reason for an unexpected error rather than leaking it', async () => {
    readAmounts.mockRejectedValueOnce(
      new Error('connection to db-prod-7 lost'),
    );
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      enrollment('s-a', 'Ana'),
    ]);

    const { data } = await service.generate(admin, dto());

    expect(data.failed[0].reason).toBe('This voucher could not be created.');
  });

  it('treats losing a race with another run as skipped, not failed', async () => {
    tx.feeVoucher.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      enrollment('s-a', 'Ana'),
    ]);

    const { data } = await service.generate(admin, dto());

    expect(data.totals).toMatchObject({ generated: 0, skipped: 1, failed: 0 });
  });

  it('adds the one-time charges and the bank to every voucher calculation', async () => {
    await service.generate(
      admin,
      dto({
        bankId: 'bank-1',
        oneTimeCharges: [{ label: 'Admission fee', amount: 2000 }],
      }),
    );

    expect(readAmounts).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        bankId: 'bank-1',
        oneTimeCharges: [{ label: 'Admission fee', amount: 2000 }],
        lateFeeFine: 0,
      }),
    );
  });

  describe('preview', () => {
    it('reports what would be created and writes nothing, not even an audit entry', async () => {
      const { data } = await service.generate(admin, dto({ preview: true }));

      expect(data.preview).toBe(true);
      expect(data.generated).toHaveLength(2);
      expect(data.generated[0]).toMatchObject({
        voucherId: null,
        amount: '1250.50',
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(tx.feeVoucher.create).not.toHaveBeenCalled();
      expect(auditMock.log).not.toHaveBeenCalled();
    });

    it('still reports skipped and failed students', async () => {
      prismaMock.feeVoucher.findMany.mockResolvedValue([
        { studentId: 's-ayesha' },
      ]);

      const { data } = await service.generate(admin, dto({ preview: true }));

      expect(data.totals).toMatchObject({ generated: 1, skipped: 1 });
    });
  });

  describe('due date', () => {
    it('uses the date given', async () => {
      const { data } = await service.generate(
        admin,
        dto({ dueDate: '2026-09-20T00:00:00.000Z' }),
      );

      expect(data.dueDate).toEqual(new Date('2026-09-20T00:00:00.000Z'));
      expect(prismaMock.institutionSetting.findUnique).not.toHaveBeenCalled();
    });

    it('defaults to the 10th, or to the institution due day from settings', async () => {
      expect((await service.generate(admin, dto())).data.dueDate).toEqual(
        new Date(Date.UTC(2026, 8, 10)),
      );

      prismaMock.institutionSetting.findUnique.mockResolvedValue({
        value: { dueDayOfMonth: 5 },
      });
      expect((await service.generate(admin, dto())).data.dueDate).toEqual(
        new Date(Date.UTC(2026, 8, 5)),
      );
    });

    it('ignores an invalid due day in settings', async () => {
      for (const bad of [0, 31, 4.5, '7', null]) {
        prismaMock.institutionSetting.findUnique.mockResolvedValue({
          value: { dueDayOfMonth: bad },
        });
        expect((await service.generate(admin, dto())).data.dueDate).toEqual(
          new Date(Date.UTC(2026, 8, 10)),
        );
      }
    });
  });

  describe('audit', () => {
    it('still returns the report when the summary entry cannot be written', async () => {
      auditMock.log.mockRejectedValueOnce(new Error('audit table unavailable'));
      const logger = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      const { data } = await service.generate(admin, dto());

      expect(data.totals.generated).toBe(2);
      expect(logger).toHaveBeenCalled();
      logger.mockRestore();
    });

    it('records one summary entry with the counts and the total', async () => {
      await service.generate(admin, dto({ classId: 'class-1' }));

      expect(auditMock.log).toHaveBeenCalledWith(
        admin,
        expect.objectContaining({
          action: 'FEE_VOUCHERS_BULK_GENERATED',
          institutionId: 'inst-1',
          metadata: expect.objectContaining({
            campusId: 'campus-1',
            classId: 'class-1',
            generated: 2,
            totalAmount: '2501.00',
          }) as never,
        }),
      );
    });
  });

  describe('refusals', () => {
    it('refuses without campus access, before reading anything', async () => {
      campusAccessMock.assertCampusAccess.mockRejectedValueOnce(
        new ForbiddenException(),
      );

      await expect(service.generate(admin, dto())).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaMock.studentEnrollment.findMany).not.toHaveBeenCalled();
    });

    it('refuses a bank account from another campus', async () => {
      prismaMock.bankAccount.findUnique.mockResolvedValue({
        campusId: 'campus-9',
      });

      await expect(
        service.generate(admin, dto({ bankId: 'bank-1' })),
      ).rejects.toThrow(/belong to this campus/);
    });

    it('refuses while vouchers require custom values it cannot fill in', async () => {
      prismaMock.customFieldDefinition.count.mockResolvedValue(1);

      await expect(service.generate(admin, dto())).rejects.toThrow(
        /required custom fields/,
      );
      expect(tx.feeVoucher.create).not.toHaveBeenCalled();
    });

    it('refuses without a current academic year', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: null,
      });

      await expect(service.generate(admin, dto())).rejects.toThrow(
        /current academic year/,
      );
    });

    it('refuses a run that would cover too many students', async () => {
      prismaMock.studentEnrollment.findMany.mockResolvedValue(
        Array.from({ length: MAX_BULK_VOUCHER_STUDENTS + 1 }, (_, i) =>
          enrollment(`s-${i}`, `Student ${i}`),
        ),
      );

      await expect(service.generate(admin, dto())).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.feeVoucher.create).not.toHaveBeenCalled();
    });

    it('refuses an unknown campus', async () => {
      prismaMock.campus.findUnique.mockResolvedValue(null);

      await expect(service.generate(admin, dto())).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
