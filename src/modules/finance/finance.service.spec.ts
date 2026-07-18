import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AdjustmentType,
  AttendanceStatus,
  ModuleKey,
  UserRole,
} from '../../prisma/client';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceService } from './finance.service';

describe('FinanceService', () => {
  let service: FinanceService;

  const accountantUser: CurrentUser = {
    sub: 'accountant-1',
    email: 'accounts@nexus.test',
    role: UserRole.STAFF,
    institutionId: 'institution-1',
  };

  const prismaMock = {
    staffSalary: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    bankAccount: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    student: {
      findUnique: jest.fn(),
    },
    feeStructure: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    feeVoucher: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    feePayment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    studentDiscount: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    studentFine: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    salaryDeductionRule: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    salaryAdjustment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    salaryPayment: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    salaryDeductionSummary: {
      create: jest.fn(),
    },
    attendance: {
      findMany: jest.fn(),
    },
    institutionSetting: {
      findUnique: jest.fn(),
    },
    studentFineRule: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const campusAccessServiceMock = {
    getScopedCampusIds: jest.fn(),
    assertCampusAccess: jest.fn(),
    assertStudentAccess: jest.fn(),
    assertClassAccess: jest.fn(),
  };

  const entityCustomFieldsServiceMock = {
    attachToItems: jest.fn(),
    attachToItem: jest.fn(),
    saveValues: jest.fn(),
    resolveInstitutionIdByCampus: jest.fn(),
    resolveInstitutionIdByFeeStructure: jest.fn(),
    resolveInstitutionIdByStudent: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        FinanceService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: CampusAccessService,
          useValue: campusAccessServiceMock,
        },
        {
          provide: EntityCustomFieldsService,
          useValue: entityCustomFieldsServiceMock,
        },
        {
          provide: ModuleAccessService,
          useValue: {
            assertModuleEnabledForUser: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: RequestContextService,
          useValue: {
            runWith: jest
              .fn()
              .mockImplementation(
                (
                  _state: Record<string, unknown>,
                  callback: () => Promise<unknown>,
                ) => callback(),
              ),
          },
        },
      ],
    }).compile();

    service = moduleRef.get<FinanceService>(FinanceService);
  });

  it('scopes salary listing to accessible campuses for non-superadmins', async () => {
    campusAccessServiceMock.getScopedCampusIds.mockResolvedValue(['campus-1']);
    prismaMock.staffSalary.findMany.mockResolvedValue([
      { id: 'salary-1', campusId: 'campus-1', userId: 'teacher-1' },
    ]);
    entityCustomFieldsServiceMock.attachToItems.mockResolvedValue([
      {
        id: 'salary-1',
        campusId: 'campus-1',
        userId: 'teacher-1',
        customFields: {},
      },
    ]);

    const result = await service.listSalaries(accountantUser);

    expect(prismaMock.staffSalary.findMany).toHaveBeenCalledWith({
      where: { campusId: { in: ['campus-1'] } },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toMatchObject({
      message: 'Salaries retrieved successfully',
      data: [{ id: 'salary-1', campusId: 'campus-1' }],
    });
  });

  it('rejects fee voucher creation when student and structure are in different campuses', async () => {
    prismaMock.student.findUnique.mockResolvedValue({
      id: 'student-1',
      campusId: 'campus-1',
    });
    prismaMock.feeStructure.findUnique.mockResolvedValue({
      id: 'structure-1',
      campusId: 'campus-2',
      feeBreakdown: { tuition: 1000 },
    });
    campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
    campusAccessServiceMock.assertStudentAccess.mockResolvedValue('campus-1');
    entityCustomFieldsServiceMock.resolveInstitutionIdByFeeStructure.mockResolvedValue(
      'institution-1',
    );
    entityCustomFieldsServiceMock.resolveInstitutionIdByStudent.mockResolvedValue(
      'institution-1',
    );

    await expect(
      service.createFeeVoucher(accountantUser, {
        studentId: 'student-1',
        feeStructureId: 'structure-1',
        month: 5,
        year: 2026,
        dueDate: '2026-05-30',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks duplicate fee voucher creation for the same student and period', async () => {
    prismaMock.student.findUnique.mockResolvedValue({
      id: 'student-1',
      campusId: 'campus-1',
    });
    prismaMock.feeStructure.findUnique.mockResolvedValue({
      id: 'structure-1',
      campusId: 'campus-1',
      feeBreakdown: { tuition: 1000 },
    });
    prismaMock.feeVoucher.findFirst.mockResolvedValue({
      id: 'voucher-1',
    });
    campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
    campusAccessServiceMock.assertStudentAccess.mockResolvedValue('campus-1');
    entityCustomFieldsServiceMock.resolveInstitutionIdByFeeStructure.mockResolvedValue(
      'institution-1',
    );
    entityCustomFieldsServiceMock.resolveInstitutionIdByStudent.mockResolvedValue(
      'institution-1',
    );

    await expect(
      service.createFeeVoucher(accountantUser, {
        studentId: 'student-1',
        feeStructureId: 'structure-1',
        month: 5,
        year: 2026,
        dueDate: '2026-05-30',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('retrieves a salary with attached custom fields', async () => {
    prismaMock.staffSalary.findUnique
      .mockResolvedValueOnce({ campusId: 'campus-1' })
      .mockResolvedValueOnce({
        id: 'salary-1',
        campusId: 'campus-1',
        userId: 'teacher-1',
      });
    campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
    entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
      id: 'salary-1',
      campusId: 'campus-1',
      customFields: { payrollCode: 'A1' },
    });

    const result = await service.getSalary(accountantUser, 'salary-1');

    expect(result).toMatchObject({
      message: 'Salary retrieved successfully',
      data: {
        id: 'salary-1',
        customFields: { payrollCode: 'A1' },
      },
    });
  });

  it('updates a salary and persists custom fields for the target campus institution', async () => {
    prismaMock.staffSalary.findUnique.mockResolvedValue({
      id: 'salary-1',
      userId: 'teacher-1',
      campusId: 'campus-1',
    });
    prismaMock.staffSalary.update.mockResolvedValue({
      id: 'salary-1',
      userId: 'teacher-1',
      campusId: 'campus-1',
      baseSalary: 25000,
    });
    campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
    entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
      'institution-1',
    );
    entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
      id: 'salary-1',
      baseSalary: 25000,
      customFields: { payrollCode: 'B2' },
    });

    const result = await service.updateSalary(accountantUser, 'salary-1', {
      baseSalary: 25000,
      customFields: { payrollCode: 'B2' },
    });

    expect(prismaMock.staffSalary.update).toHaveBeenCalledWith({
      where: { id: 'salary-1' },
      data: {
        baseSalary: 25000,
      },
    });
    expect(entityCustomFieldsServiceMock.saveValues).toHaveBeenCalledWith({
      institutionId: 'institution-1',
      moduleKey: ModuleKey.FINANCE,
      entityType: 'staff_salary',
      entityId: 'salary-1',
      values: { payrollCode: 'B2' },
    });
    expect(result).toMatchObject({
      message: 'Salary updated successfully',
      data: {
        id: 'salary-1',
        customFields: { payrollCode: 'B2' },
      },
    });
  });

  it('soft deletes a salary record through the request context', async () => {
    prismaMock.staffSalary.findUnique.mockResolvedValue({
      id: 'salary-1',
      campusId: 'campus-1',
      userId: 'teacher-1',
    });
    prismaMock.staffSalary.update.mockResolvedValue({
      id: 'salary-1',
    });
    campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');

    const result = await service.deleteSalary(
      accountantUser,
      'salary-1',
      'archived duplicate',
    );

    expect(prismaMock.staffSalary.update).toHaveBeenCalledWith({
      where: { id: 'salary-1' },
      data: expect.objectContaining({
        deletedAt: expect.any(Date),
        deletedBy: accountantUser.sub,
        deleteReason: 'archived duplicate',
      }),
    });
    expect(result).toMatchObject({
      message: 'Salary moved to recycle bin successfully',
      data: {
        id: 'salary-1',
        campusId: 'campus-1',
        userId: 'teacher-1',
      },
    });
  });

  it('lists bank accounts scoped to accessible campuses', async () => {
    campusAccessServiceMock.getScopedCampusIds.mockResolvedValue(['campus-1']);
    prismaMock.bankAccount.findMany.mockResolvedValue([
      { id: 'bank-1', campusId: 'campus-1', bankName: 'Nexus Bank' },
    ]);
    entityCustomFieldsServiceMock.attachToItems.mockResolvedValue([
      {
        id: 'bank-1',
        campusId: 'campus-1',
        bankName: 'Nexus Bank',
        customFields: {},
      },
    ]);

    const result = await service.listBankAccounts(accountantUser);

    expect(prismaMock.bankAccount.findMany).toHaveBeenCalledWith({
      where: { campusId: { in: ['campus-1'] } },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toMatchObject({
      message: 'Bank accounts retrieved successfully',
      data: [{ id: 'bank-1', campusId: 'campus-1' }],
    });
  });

  it('retrieves a fee payment with custom fields after campus access check', async () => {
    prismaMock.feePayment.findUnique.mockResolvedValue({
      id: 'payment-1',
      voucherId: 'voucher-1',
      voucher: {
        student: {
          campusId: 'campus-1',
        },
      },
    });
    campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
    entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
      id: 'payment-1',
      voucherId: 'voucher-1',
      customFields: { receiptNumber: 'R-1001' },
    });

    const result = await service.getFeePayment(accountantUser, 'payment-1');

    expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
      accountantUser,
      'campus-1',
    );
    expect(result).toMatchObject({
      message: 'Fee payment retrieved successfully',
      data: {
        id: 'payment-1',
        customFields: { receiptNumber: 'R-1001' },
      },
    });
  });

  describe('paySalary — payroll correctness', () => {
    const salaryRecord = {
      id: 'salary-1',
      userId: 'teacher-1',
      campusId: 'campus-1',
      role: UserRole.STAFF,
      baseSalary: 30000,
    };
    const rule = {
      allowedAbsences: 2,
      absenceDeductionPercent: 100,
      allowedLates: 3,
      lateDeductionPercent: 10,
      allowedHalfDays: 2,
      halfDayDeductionPercent: 50,
      allowedLeaves: 5,
      leaveDeductionPercent: 0,
    };

    beforeEach(() => {
      prismaMock.staffSalary.findUnique.mockResolvedValue(salaryRecord);
      prismaMock.salaryPayment.findFirst.mockResolvedValue(null);
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      entityCustomFieldsServiceMock.attachToItem.mockImplementation(
        (item: unknown) => Promise.resolve(item),
      );
      prismaMock.institutionSetting.findUnique.mockResolvedValue(null);
      prismaMock.salaryDeductionRule.findFirst.mockResolvedValue(rule);
      prismaMock.salaryPayment.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'payment-1', ...data }),
      );
      prismaMock.salaryDeductionSummary.create.mockResolvedValue({});
    });

    it('only sums adjustments from the payroll month being paid (Bug #1)', async () => {
      prismaMock.salaryAdjustment.findMany.mockResolvedValue([
        { adjustmentType: AdjustmentType.BONUS, amount: 500 },
        { adjustmentType: AdjustmentType.DEDUCTION, amount: 100 },
      ]);
      prismaMock.attendance.findMany.mockResolvedValue([]);

      await service.paySalary(
        {
          userId: 'teacher-1',
          salaryId: 'salary-1',
          campusId: 'campus-1',
          month: 3,
          year: 2026,
        },
        accountantUser,
      );

      expect(prismaMock.salaryAdjustment.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'teacher-1',
          campusId: 'campus-1',
          month: 3,
          year: 2026,
        },
      });
    });

    it('deducts exactly the excess absences over the allowed threshold, using only March data (acceptance criterion)', async () => {
      prismaMock.salaryAdjustment.findMany.mockResolvedValue([
        { adjustmentType: AdjustmentType.BONUS, amount: 500 },
        { adjustmentType: AdjustmentType.DEDUCTION, amount: 100 },
      ]);
      prismaMock.attendance.findMany.mockResolvedValue(
        makeAttendance(AttendanceStatus.ABSENT, 4),
      );

      const result = await service.paySalary(
        {
          userId: 'teacher-1',
          salaryId: 'salary-1',
          campusId: 'campus-1',
          month: 3,
          year: 2026,
        },
        accountantUser,
      );

      // 4 absences - 2 allowed = 2 excess * (30000/30 daily rate) * 100% = 2000
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- untyped Prisma mock */
      expect(prismaMock.salaryDeductionSummary.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          absenceDeduction: 2000,
          lateDeduction: 0,
          halfDayDeduction: 0,
          leaveDeduction: 0,
          manualDeductions: 100,
          bonuses: 500,
          totalDeductions: 2100,
          finalSalaryPaid: 28400,
        }),
      });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(result).toMatchObject({ message: 'Salary paid successfully' });
    });

    it('deducts nothing when attendance is exactly at the allowed threshold', async () => {
      prismaMock.salaryAdjustment.findMany.mockResolvedValue([]);
      prismaMock.attendance.findMany.mockResolvedValue(
        makeAttendance(AttendanceStatus.ABSENT, 2),
      );

      await service.paySalary(
        {
          userId: 'teacher-1',
          salaryId: 'salary-1',
          campusId: 'campus-1',
          month: 3,
          year: 2026,
        },
        accountantUser,
      );

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- untyped Prisma mock */
      expect(prismaMock.salaryDeductionSummary.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          absenceDeduction: 0,
          totalDeductions: 0,
          finalSalaryPaid: 30000,
        }),
      });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('deducts nothing when there is zero attendance data for the period', async () => {
      prismaMock.salaryAdjustment.findMany.mockResolvedValue([]);
      prismaMock.attendance.findMany.mockResolvedValue([]);

      await service.paySalary(
        {
          userId: 'teacher-1',
          salaryId: 'salary-1',
          campusId: 'campus-1',
          month: 3,
          year: 2026,
        },
        accountantUser,
      );

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- untyped Prisma mock */
      expect(prismaMock.salaryDeductionSummary.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          absenceDeduction: 0,
          lateDeduction: 0,
          halfDayDeduction: 0,
          leaveDeduction: 0,
          finalSalaryPaid: 30000,
        }),
      });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('counts half-days independently of status, e.g. a PRESENT day with an early checkout', async () => {
      prismaMock.salaryAdjustment.findMany.mockResolvedValue([]);
      prismaMock.attendance.findMany.mockResolvedValue([
        ...makeAttendance(AttendanceStatus.PRESENT, 3, true),
        ...makeAttendance(AttendanceStatus.PRESENT, 5, false),
      ]);

      await service.paySalary(
        {
          userId: 'teacher-1',
          salaryId: 'salary-1',
          campusId: 'campus-1',
          month: 3,
          year: 2026,
        },
        accountantUser,
      );

      // 3 half-days - 2 allowed = 1 excess * 1000 daily rate * 50% = 500
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- untyped Prisma mock */
      expect(prismaMock.salaryDeductionSummary.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          absenceDeduction: 0,
          halfDayDeduction: 500,
          finalSalaryPaid: 29500,
        }),
      });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('applies zero attendance-based deductions when no SalaryDeductionRule is configured for the campus/role', async () => {
      prismaMock.salaryDeductionRule.findFirst.mockResolvedValue(null);
      prismaMock.salaryAdjustment.findMany.mockResolvedValue([]);
      prismaMock.attendance.findMany.mockResolvedValue(
        makeAttendance(AttendanceStatus.ABSENT, 10),
      );

      await service.paySalary(
        {
          userId: 'teacher-1',
          salaryId: 'salary-1',
          campusId: 'campus-1',
          month: 3,
          year: 2026,
        },
        accountantUser,
      );

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- untyped Prisma mock */
      expect(prismaMock.salaryDeductionSummary.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          absenceDeduction: 0,
          finalSalaryPaid: 30000,
        }),
      });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('rejects a duplicate payment for the same user and payroll period', async () => {
      prismaMock.salaryPayment.findFirst.mockResolvedValue({
        id: 'existing-payment',
      });

      await expect(
        service.paySalary(
          {
            userId: 'teacher-1',
            salaryId: 'salary-1',
            campusId: 'campus-1',
            month: 3,
            year: 2026,
          },
          accountantUser,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.salaryPayment.create).not.toHaveBeenCalled();
    });
  });

  describe('previewSalary', () => {
    it('returns the same breakdown paySalary would produce, without persisting anything', async () => {
      prismaMock.staffSalary.findUnique.mockResolvedValue({
        id: 'salary-1',
        userId: 'teacher-1',
        campusId: 'campus-1',
        role: UserRole.STAFF,
        baseSalary: 30000,
      });
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      prismaMock.institutionSetting.findUnique.mockResolvedValue(null);
      prismaMock.salaryDeductionRule.findFirst.mockResolvedValue({
        allowedAbsences: 2,
        absenceDeductionPercent: 100,
        allowedLates: 3,
        lateDeductionPercent: 10,
        allowedHalfDays: 2,
        halfDayDeductionPercent: 50,
        allowedLeaves: 5,
        leaveDeductionPercent: 0,
      });
      prismaMock.salaryAdjustment.findMany.mockResolvedValue([
        { adjustmentType: AdjustmentType.BONUS, amount: 500 },
      ]);
      prismaMock.attendance.findMany.mockResolvedValue(
        makeAttendance(AttendanceStatus.ABSENT, 4),
      );

      const result = await service.previewSalary(
        {
          userId: 'teacher-1',
          salaryId: 'salary-1',
          campusId: 'campus-1',
          month: 3,
          year: 2026,
        },
        accountantUser,
      );

      expect(result).toMatchObject({
        message: 'Salary payment preview computed successfully',
        data: {
          absenceDeduction: 2000,
          bonuses: 500,
          finalSalary: 28500,
        },
      });
      expect(prismaMock.salaryPayment.create).not.toHaveBeenCalled();
      expect(prismaMock.salaryDeductionSummary.create).not.toHaveBeenCalled();
    });
  });
});

function makeAttendance(
  status: AttendanceStatus,
  count: number,
  halfDay = false,
) {
  return Array.from({ length: count }, () => ({ status, halfDay }));
}
