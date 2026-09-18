import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AdjustmentType,
  AttendanceStatus,
  EnrollmentStatus,
  ModuleKey,
  Prisma,
  UserRole,
} from '../../prisma/client';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceService } from './finance.service';
import { PaymentMethod } from '../../common/enums/domain.enums';

describe('FinanceService', () => {
  let service: FinanceService;

  const accountantUser: CurrentUser = {
    sub: 'accountant-1',
    email: 'accounts@nexus.test',
    role: UserRole.STAFF,
    institutionId: 'institution-1',
  };

  const prismaMock = {
    $transaction: jest.fn(),
    staffSalary: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
    },
    bankAccount: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
    },
    student: {
      findUnique: jest.fn(),
    },
    feeStructure: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    feeVoucher: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    feePayment: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
    studentDiscount: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    studentFine: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    studentFineRule: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    salaryDeductionRule: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    salaryAdjustment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    salaryPayment: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    salaryDeductionSummary: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    attendance: {
      findMany: jest.fn(),
    },
    institutionSetting: {
      findUnique: jest.fn(),
    },
    institution: {
      findUnique: jest.fn(),
    },
    studentEnrollment: {
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
    saveRecord: jest.fn(
      (
        _params: unknown,
        mutation: (transaction: Prisma.TransactionClient) => Promise<unknown>,
      ) => mutation(prismaMock as unknown as Prisma.TransactionClient),
    ),
    resolveInstitutionIdByCampus: jest.fn(),
    resolveInstitutionIdByFeeStructure: jest.fn(),
    resolveInstitutionIdByStudent: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.studentDiscount.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(
      (callback: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(prismaMock as unknown as Prisma.TransactionClient),
    );
    // M2 Phase 3: default the withdrawal guard's institution lookup to "no
    // current academic year set" so it's a no-op unless a test explicitly
    // configures it — otherwise every pre-existing createFeeVoucher test
    // below would need to know about StudentEnrollment.
    prismaMock.institution.findUnique.mockResolvedValue(null);

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

  describe('createFeeVoucher — M2 Phase 3 withdrawal guard (§ 7.4 item 5)', () => {
    beforeEach(() => {
      prismaMock.student.findUnique.mockResolvedValue({
        id: 'student-1',
        campusId: 'campus-1',
      });
      prismaMock.feeStructure.findUnique.mockResolvedValue({
        id: 'structure-1',
        campusId: 'campus-1',
        feeBreakdown: { tuition: 1000 },
      });
      prismaMock.feeVoucher.findFirst.mockResolvedValue(null);
      prismaMock.feeVoucher.findUnique.mockResolvedValue({
        finalAmountDue: new Prisma.Decimal(1000),
        dueDate: new Date('2026-05-30'),
      });
      prismaMock.feePayment.aggregate.mockResolvedValue({
        _sum: { paidAmount: null },
      });
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
      campusAccessServiceMock.assertStudentAccess.mockResolvedValue('campus-1');
      entityCustomFieldsServiceMock.resolveInstitutionIdByFeeStructure.mockResolvedValue(
        'institution-1',
      );
      entityCustomFieldsServiceMock.resolveInstitutionIdByStudent.mockResolvedValue(
        'institution-1',
      );
    });

    it('rejects voucher creation for a student whose current-year enrollment is LEFT', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: 'year-1',
      });
      prismaMock.studentEnrollment.findUnique.mockResolvedValue({
        status: EnrollmentStatus.LEFT,
      });

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

    it('allows voucher creation when the current-year enrollment is ACTIVE', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: 'year-1',
      });
      prismaMock.studentEnrollment.findUnique.mockResolvedValue({
        status: EnrollmentStatus.ACTIVE,
      });
      prismaMock.feeVoucher.create.mockResolvedValue({
        id: 'voucher-1',
        studentId: 'student-1',
        feeStructureId: 'structure-1',
      });
      entityCustomFieldsServiceMock.attachToItem.mockImplementation(
        (item: Record<string, unknown>) => ({ ...item, customFields: {} }),
      );

      await expect(
        service.createFeeVoucher(accountantUser, {
          studentId: 'student-1',
          feeStructureId: 'structure-1',
          month: 5,
          year: 2026,
          dueDate: '2026-05-30',
        }),
      ).resolves.toMatchObject({ message: 'Fee voucher created successfully' });
    });

    it('allows voucher creation when the institution has no current academic year set yet (guard is a no-op)', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: null,
      });
      prismaMock.feeVoucher.create.mockResolvedValue({
        id: 'voucher-1',
        studentId: 'student-1',
        feeStructureId: 'structure-1',
      });
      entityCustomFieldsServiceMock.attachToItem.mockImplementation(
        (item: Record<string, unknown>) => ({ ...item, customFields: {} }),
      );

      await expect(
        service.createFeeVoucher(accountantUser, {
          studentId: 'student-1',
          feeStructureId: 'structure-1',
          month: 5,
          year: 2026,
          dueDate: '2026-05-30',
        }),
      ).resolves.toMatchObject({ message: 'Fee voucher created successfully' });
      expect(prismaMock.studentEnrollment.findUnique).not.toHaveBeenCalled();
    });
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
    expect(
      entityCustomFieldsServiceMock.saveRecord.mock.calls.map(
        ([params]) => params,
      ),
    ).toMatchObject([
      {
        institutionId: 'institution-1',
        moduleKey: ModuleKey.FINANCE,
        entityType: 'staff_salary',
        create: false,
        values: { payrollCode: 'B2' },
      },
    ]);
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
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- expect.objectContaining()/expect.any() are intentionally typed `any` by @types/jest */
      data: expect.objectContaining({
        deletedAt: expect.any(Date),
        deletedBy: accountantUser.sub,
        deleteReason: 'archived duplicate',
      }),
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
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

  describe('fee payment settlement', () => {
    beforeEach(() => {
      prismaMock.feePayment.findFirst.mockResolvedValue(null);
      prismaMock.feeVoucher.findUnique.mockResolvedValue({
        id: 'voucher-1',
        month: 9,
        year: 2026,
        finalAmountDue: new Prisma.Decimal(100),
        dueDate: new Date('2040-10-01'),
        student: {
          campusId: 'campus-1',
          campus: { institutionId: 'institution-1' },
        },
      });
      prismaMock.feePayment.create.mockResolvedValue({ id: 'payment-1' });
      entityCustomFieldsServiceMock.attachToItem.mockImplementation(
        (item: unknown) => Promise.resolve(item),
      );
    });
    it.each([
      [25, 'PARTIAL'],
      [100, 'PAID'],
    ] as const)(
      'settles an active payment total of %s as %s',
      async (paidAmount, status) => {
        prismaMock.feePayment.aggregate.mockResolvedValue({
          _sum: { paidAmount: new Prisma.Decimal(paidAmount) },
        });
        await service.createFeePayment(
          {
            requestKey: '11111111-1111-4111-8111-111111111111',
            voucherId: 'voucher-1',
            month: 9,
            year: 2026,
            paidAmount,
            paymentMethod: PaymentMethod.CASH,
            paymentDate: '2026-09-15',
          },
          accountantUser,
        );
        expect(prismaMock.feeVoucher.update).toHaveBeenCalledWith({
          where: { id: 'voucher-1' },
          data: { status },
        });
        expect(prismaMock.feePayment.aggregate).toHaveBeenCalledWith({
          where: { voucherId: 'voucher-1', deletedAt: null },
          _sum: { paidAmount: true },
        });
      },
    );
    it('replays an identical request without inserting another receipt and rejects changed details', async () => {
      const request = {
        requestKey: '11111111-1111-4111-8111-111111111111',
        voucherId: 'voucher-1',
        month: 9,
        year: 2026,
        paidAmount: 25,
        paymentMethod: PaymentMethod.CASH,
        paymentDate: '2026-09-15',
      };
      prismaMock.feePayment.aggregate.mockResolvedValue({
        _sum: { paidAmount: new Prisma.Decimal(25) },
      });
      await service.createFeePayment(request, accountantUser);
      const calls = prismaMock.feePayment.create.mock.calls as unknown as Array<
        [{ data: { requestFingerprint: string } }]
      >;
      const created = calls[0][0];
      prismaMock.feePayment.findFirst.mockResolvedValue({
        id: 'payment-1',
        requestFingerprint: created.data.requestFingerprint,
        deletedAt: null,
      });
      await expect(
        service.createFeePayment(request, accountantUser),
      ).resolves.toMatchObject({ message: 'Fee payment already saved' });
      expect(prismaMock.feePayment.create).toHaveBeenCalledTimes(1);
      await expect(
        service.createFeePayment(
          { ...request, paidAmount: 30 },
          accountantUser,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.feePayment.create).toHaveBeenCalledTimes(1);
    });

    it('rejects overpayment inside the transaction', async () => {
      prismaMock.feePayment.aggregate.mockResolvedValue({
        _sum: { paidAmount: new Prisma.Decimal(101) },
      });
      await expect(
        service.createFeePayment(
          {
            requestKey: '11111111-1111-4111-8111-111111111111',
            voucherId: 'voucher-1',
            month: 9,
            year: 2026,
            paidAmount: 101,
            paymentMethod: PaymentMethod.CASH,
            paymentDate: '2026-09-15',
          },
          accountantUser,
        ),
      ).rejects.toThrow('exceeds');
      expect(prismaMock.feeVoucher.update).not.toHaveBeenCalled();
    });
    it('reconciles remaining payments and overdue state after deletion', async () => {
      prismaMock.feePayment.findUnique.mockResolvedValue({
        id: 'payment-1',
        voucherId: 'voucher-1',
        month: 9,
        year: 2026,
        voucher: { student: { campusId: 'campus-1' } },
      });
      prismaMock.feeVoucher.findUnique.mockResolvedValue({
        finalAmountDue: new Prisma.Decimal(100),
        dueDate: new Date('2000-01-01'),
      });
      prismaMock.feePayment.aggregate.mockResolvedValue({
        _sum: { paidAmount: new Prisma.Decimal(25) },
      });
      await service.deleteFeePayment(accountantUser, 'payment-1');
      expect(prismaMock.feeVoucher.update).toHaveBeenCalledWith({
        where: { id: 'voucher-1' },
        data: { status: 'OVERDUE' },
      });
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

    it('rejects a negative payroll payment before writing payment or deduction summary', async () => {
      prismaMock.salaryAdjustment.findMany.mockResolvedValue([
        { adjustmentType: AdjustmentType.DEDUCTION, amount: 31000 },
      ]);
      prismaMock.attendance.findMany.mockResolvedValue([]);
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
      ).rejects.toThrow('negative salary');
      expect(prismaMock.salaryPayment.create).not.toHaveBeenCalled();
      expect(prismaMock.salaryDeductionSummary.create).not.toHaveBeenCalled();
    });

    it('keeps preview, payment and summary equal after rounding each deduction category', async () => {
      prismaMock.staffSalary.findUnique.mockResolvedValue({
        ...salaryRecord,
        baseSalary: 100,
      });
      prismaMock.salaryAdjustment.findMany.mockResolvedValue([]);
      prismaMock.salaryDeductionRule.findFirst.mockResolvedValue({
        ...rule,
        allowedAbsences: 0,
        allowedLates: 0,
        lateDeductionPercent: 100,
      });
      prismaMock.attendance.findMany.mockResolvedValue([
        { status: AttendanceStatus.ABSENT, halfDay: false },
        { status: AttendanceStatus.LATE, halfDay: false },
      ]);
      const selection = {
        userId: 'teacher-1',
        salaryId: 'salary-1',
        campusId: 'campus-1',
        month: 3,
        year: 2026,
      };
      expect(
        await service.previewSalary(selection, accountantUser),
      ).toMatchObject({
        data: {
          absenceDeduction: 3.33,
          lateDeduction: 3.33,
          totalDeductions: 6.66,
          finalSalary: 93.34,
        },
      });
      expect(await service.paySalary(selection, accountantUser)).toMatchObject({
        data: { totalDeductions: 6.66, finalSalaryPaid: 93.34 },
      });
      const summaryCalls = prismaMock.salaryDeductionSummary.create.mock
        .calls as unknown as Array<[{ data: Record<string, unknown> }]>;
      expect(summaryCalls[0][0]).toMatchObject({
        data: {
          absenceDeduction: 3.33,
          lateDeduction: 3.33,
          totalDeductions: 6.66,
          finalSalaryPaid: 93.34,
        },
      });
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

  describe('getSalary', () => {
    it('throws 404 when the salary record is missing', async () => {
      prismaMock.staffSalary.findUnique.mockResolvedValue(null);
      entityCustomFieldsServiceMock.attachToItem.mockResolvedValue(null);

      await expect(
        service.getSalary(accountantUser, 'missing-salary'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('retrieves a salary with attached custom fields', async () => {
      prismaMock.staffSalary.findUnique.mockResolvedValue({
        id: 'salary-1',
        campusId: 'campus-1',
      });
      entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
        id: 'salary-1',
        customFields: {},
      });

      await expect(
        service.getSalary(accountantUser, 'salary-1'),
      ).resolves.toMatchObject({ message: 'Salary retrieved successfully' });
    });
  });

  describe('Deduction rules', () => {
    it('creates a deduction rule and rejects a duplicate campus/role rule', async () => {
      prismaMock.salaryDeductionRule.findFirst.mockResolvedValueOnce(null);
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      prismaMock.salaryDeductionRule.create.mockResolvedValue({
        id: 'rule-1',
      });
      entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
        id: 'rule-1',
      });

      await expect(
        service.createDeductionRule(accountantUser, {
          campusId: 'campus-1',
          role: UserRole.STAFF,
        } as never),
      ).resolves.toMatchObject({
        message: 'Salary deduction rule created successfully',
      });

      prismaMock.salaryDeductionRule.findFirst.mockResolvedValueOnce({
        id: 'existing-rule',
      });
      await expect(
        service.createDeductionRule(accountantUser, {
          campusId: 'campus-1',
          role: UserRole.STAFF,
        } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('lists deduction rules scoped to accessible campuses', async () => {
      campusAccessServiceMock.getScopedCampusIds.mockResolvedValue([
        'campus-1',
      ]);
      prismaMock.salaryDeductionRule.findMany.mockResolvedValue([]);
      entityCustomFieldsServiceMock.attachToItems.mockResolvedValue([]);

      await service.listDeductionRules(accountantUser);

      expect(prismaMock.salaryDeductionRule.findMany).toHaveBeenCalledWith({
        where: { campusId: { in: ['campus-1'] } },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('throws 404 getting a missing deduction rule, otherwise asserts campus access', async () => {
      prismaMock.salaryDeductionRule.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.getDeductionRule(accountantUser, 'missing-rule'),
      ).rejects.toBeInstanceOf(NotFoundException);

      prismaMock.salaryDeductionRule.findUnique.mockResolvedValueOnce({
        id: 'rule-1',
        campusId: 'campus-1',
      });
      entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
        id: 'rule-1',
      });

      await service.getDeductionRule(accountantUser, 'rule-1');

      expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
        accountantUser,
        'campus-1',
      );
    });

    it('soft-deletes a deduction rule, and 404s when missing', async () => {
      prismaMock.salaryDeductionRule.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.deleteDeductionRule(accountantUser, 'missing-rule'),
      ).rejects.toBeInstanceOf(NotFoundException);

      prismaMock.salaryDeductionRule.findUnique.mockResolvedValueOnce({
        id: 'rule-1',
        campusId: 'campus-1',
      });
      const result = await service.deleteDeductionRule(
        accountantUser,
        'rule-1',
        'No longer needed',
      );

      expect(prismaMock.salaryDeductionRule.update).toHaveBeenCalledWith({
        where: { id: 'rule-1' },
        data: expect.objectContaining({
          deleteReason: 'No longer needed',
        }) as never,
      });
      expect(result.message).toBe(
        'Salary deduction rule moved to recycle bin successfully',
      );
    });
  });

  describe('Salary adjustments', () => {
    it('applies an adjustment after validating salary access', async () => {
      prismaMock.staffSalary.findUnique.mockResolvedValue({
        id: 'salary-1',
        campusId: 'campus-1',
        userId: 'teacher-1',
      });
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      prismaMock.salaryAdjustment.create.mockResolvedValue({ id: 'adj-1' });
      entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
        id: 'adj-1',
      });

      await expect(
        service.applyAdjustment(
          {
            campusId: 'campus-1',
            salaryId: 'salary-1',
            userId: 'teacher-1',
            adjustmentType: AdjustmentType.BONUS,
            amount: 500,
          } as never,
          accountantUser,
        ),
      ).resolves.toMatchObject({
        message: 'Salary adjustment applied successfully',
      });
    });

    it('lists salary adjustments filtered by user', async () => {
      campusAccessServiceMock.getScopedCampusIds.mockResolvedValue([
        'campus-1',
      ]);
      prismaMock.salaryAdjustment.findMany.mockResolvedValue([]);
      entityCustomFieldsServiceMock.attachToItems.mockResolvedValue([]);

      await service.listSalaryAdjustments(
        accountantUser,
        'campus-1',
        'teacher-1',
      );

      expect(prismaMock.salaryAdjustment.findMany).toHaveBeenCalledWith({
        where: { campusId: { in: ['campus-1'] }, userId: 'teacher-1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('throws 404 getting a missing adjustment', async () => {
      prismaMock.salaryAdjustment.findUnique.mockResolvedValue(null);

      await expect(
        service.getSalaryAdjustment(accountantUser, 'missing-adj'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft-deletes an adjustment, and 404s when missing', async () => {
      prismaMock.salaryAdjustment.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.deleteSalaryAdjustment(accountantUser, 'missing-adj'),
      ).rejects.toBeInstanceOf(NotFoundException);

      prismaMock.salaryAdjustment.findUnique.mockResolvedValueOnce({
        id: 'adj-1',
        campusId: 'campus-1',
      });
      const result = await service.deleteSalaryAdjustment(
        accountantUser,
        'adj-1',
      );

      expect(result.message).toBe(
        'Salary adjustment moved to recycle bin successfully',
      );
    });
  });

  describe('Salary payments (list/get/delete)', () => {
    it('lists salary payments filtered by user', async () => {
      campusAccessServiceMock.getScopedCampusIds.mockResolvedValue([
        'campus-1',
      ]);
      prismaMock.salaryPayment.findMany.mockResolvedValue([]);
      entityCustomFieldsServiceMock.attachToItems.mockResolvedValue([]);

      await service.listSalaryPayments(accountantUser, 'campus-1', 'user-1');

      expect(prismaMock.salaryPayment.findMany).toHaveBeenCalledWith({
        where: { campusId: { in: ['campus-1'] }, userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('throws 404 getting a missing salary payment', async () => {
      prismaMock.salaryPayment.findUnique.mockResolvedValue(null);

      await expect(
        service.getSalaryPayment(accountantUser, 'missing-payment'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft-deletes a salary payment and its deduction summary, 404s when missing', async () => {
      prismaMock.salaryPayment.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.deleteSalaryPayment(accountantUser, 'missing-payment'),
      ).rejects.toBeInstanceOf(NotFoundException);

      prismaMock.salaryPayment.findUnique.mockResolvedValueOnce({
        id: 'payment-1',
        campusId: 'campus-1',
      });
      const result = await service.deleteSalaryPayment(
        accountantUser,
        'payment-1',
      );

      expect(prismaMock.salaryDeductionSummary.updateMany).toHaveBeenCalled();
      expect(result.message).toBe(
        'Salary payment moved to recycle bin successfully',
      );
    });
  });

  describe('Bank accounts', () => {
    it('creates a bank account for the target campus', async () => {
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      prismaMock.bankAccount.create.mockResolvedValue({ id: 'bank-1' });
      entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
        id: 'bank-1',
      });

      await expect(
        service.createBankAccount(accountantUser, {
          campusId: 'campus-1',
          accountTitle: 'Main',
          bankName: 'HBL',
          accountNumber: '12345',
        }),
      ).resolves.toMatchObject({
        message: 'Bank account created successfully',
      });
    });

    it('throws 404 getting a missing bank account', async () => {
      prismaMock.bankAccount.findUnique.mockResolvedValue(null);

      await expect(
        service.getBankAccount(accountantUser, 'missing-bank'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 updating a missing bank account', async () => {
      prismaMock.bankAccount.findUnique.mockResolvedValue(null);

      await expect(
        service.updateBankAccount(accountantUser, 'missing-bank', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates a bank account, re-asserting access when the campus changes', async () => {
      prismaMock.bankAccount.findUnique.mockResolvedValue({
        id: 'bank-1',
        campusId: 'campus-1',
      });
      prismaMock.bankAccount.update.mockResolvedValue({
        id: 'bank-1',
        campusId: 'campus-2',
      });
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
        id: 'bank-1',
      });

      const result = await service.updateBankAccount(accountantUser, 'bank-1', {
        campusId: 'campus-2',
      });

      expect(result).toMatchObject({
        message: 'Bank account updated successfully',
      });
    });

    it('soft-deletes a bank account, and 404s when missing', async () => {
      prismaMock.bankAccount.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.deleteBankAccount(accountantUser, 'missing-bank'),
      ).rejects.toBeInstanceOf(NotFoundException);

      prismaMock.bankAccount.findUnique.mockResolvedValueOnce({
        id: 'bank-1',
        campusId: 'campus-1',
      });
      const result = await service.deleteBankAccount(accountantUser, 'bank-1');

      expect(result.message).toBe(
        'Bank account moved to recycle bin successfully',
      );
    });
  });

  describe('Fee structures', () => {
    it('creates a fee structure and rejects a class/campus mismatch or duplicate', async () => {
      campusAccessServiceMock.assertClassAccess.mockResolvedValue('campus-1');
      prismaMock.feeStructure.findFirst.mockResolvedValueOnce(null);
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      prismaMock.feeStructure.create.mockResolvedValue({ id: 'fs-1' });
      entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
        id: 'fs-1',
      });

      await expect(
        service.createFeeStructure(accountantUser, {
          campusId: 'campus-1',
          classId: 'class-1',
        } as never),
      ).resolves.toMatchObject({
        message: 'Fee structure created successfully',
      });

      prismaMock.feeStructure.findFirst.mockResolvedValueOnce({
        id: 'existing',
      });
      await expect(
        service.createFeeStructure(accountantUser, {
          campusId: 'campus-1',
          classId: 'class-1',
        } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects fee structure creation when the class belongs to a different campus', async () => {
      campusAccessServiceMock.assertClassAccess.mockResolvedValue('campus-9');

      await expect(
        service.createFeeStructure(accountantUser, {
          campusId: 'campus-1',
          classId: 'class-1',
        } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lists fee structures filtered by class', async () => {
      campusAccessServiceMock.getScopedCampusIds.mockResolvedValue([
        'campus-1',
      ]);
      prismaMock.feeStructure.findMany.mockResolvedValue([]);
      entityCustomFieldsServiceMock.attachToItems.mockResolvedValue([]);

      await service.listFeeStructures(accountantUser, 'campus-1', 'class-1');

      expect(campusAccessServiceMock.assertClassAccess).toHaveBeenCalledWith(
        accountantUser,
        'class-1',
      );
    });

    it('throws 404 getting a missing fee structure', async () => {
      prismaMock.feeStructure.findUnique.mockResolvedValue(null);

      await expect(
        service.getFeeStructure(accountantUser, 'missing-fs'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 updating a missing fee structure', async () => {
      prismaMock.feeStructure.findUnique.mockResolvedValue(null);

      await expect(
        service.updateFeeStructure(accountantUser, 'missing-fs', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates a fee structure', async () => {
      prismaMock.feeStructure.findUnique.mockResolvedValue({
        id: 'fs-1',
        campusId: 'campus-1',
        classId: 'class-1',
      });
      campusAccessServiceMock.assertClassAccess.mockResolvedValue('campus-1');
      prismaMock.feeStructure.update.mockResolvedValue({ id: 'fs-1' });
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
        id: 'fs-1',
      });

      await expect(
        service.updateFeeStructure(accountantUser, 'fs-1', {
          feeBreakdown: undefined,
        }),
      ).resolves.toMatchObject({
        message: 'Fee structure updated successfully',
      });
    });

    it('soft-deletes a fee structure, and 404s when missing', async () => {
      prismaMock.feeStructure.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.deleteFeeStructure(accountantUser, 'missing-fs'),
      ).rejects.toBeInstanceOf(NotFoundException);

      prismaMock.feeStructure.findUnique.mockResolvedValueOnce({
        id: 'fs-1',
        campusId: 'campus-1',
      });
      const result = await service.deleteFeeStructure(accountantUser, 'fs-1');

      expect(result.message).toBe(
        'Fee structure moved to recycle bin successfully',
      );
    });
  });

  describe('Student discounts', () => {
    it('creates a student discount', async () => {
      entityCustomFieldsServiceMock.resolveInstitutionIdByStudent.mockResolvedValue(
        'institution-1',
      );
      prismaMock.studentDiscount.create.mockResolvedValue({ id: 'disc-1' });
      entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
        id: 'disc-1',
      });

      await expect(
        service.createStudentDiscount(
          { studentId: 'student-1', amount: 100 } as never,
          accountantUser,
        ),
      ).resolves.toMatchObject({
        message: 'Student discount created successfully',
      });
    });

    it('lists student discounts filtered by student', async () => {
      campusAccessServiceMock.getScopedCampusIds.mockResolvedValue([
        'campus-1',
      ]);
      prismaMock.studentDiscount.findMany.mockResolvedValue([]);
      entityCustomFieldsServiceMock.attachToItems.mockResolvedValue([]);

      await service.listStudentDiscounts(
        accountantUser,
        'campus-1',
        'student-1',
      );

      expect(campusAccessServiceMock.assertStudentAccess).toHaveBeenCalledWith(
        accountantUser,
        'student-1',
      );
    });

    it('throws 404 getting a missing student discount', async () => {
      prismaMock.studentDiscount.findUnique.mockResolvedValue(null);

      await expect(
        service.getStudentDiscount(accountantUser, 'missing-disc'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft-deletes a student discount, and 404s when missing', async () => {
      prismaMock.studentDiscount.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.deleteStudentDiscount(accountantUser, 'missing-disc'),
      ).rejects.toBeInstanceOf(NotFoundException);

      prismaMock.studentDiscount.findUnique.mockResolvedValueOnce({
        id: 'disc-1',
        studentId: 'student-1',
      });
      const result = await service.deleteStudentDiscount(
        accountantUser,
        'disc-1',
      );

      expect(result.message).toBe(
        'Student discount moved to recycle bin successfully',
      );
    });
  });

  describe('Student fine rules', () => {
    it('creates a student fine rule and rejects a class/campus mismatch', async () => {
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      prismaMock.studentFineRule.create.mockResolvedValue({ id: 'fr-1' });
      entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
        id: 'fr-1',
      });

      await expect(
        service.createStudentFineRule(accountantUser, {
          campusId: 'campus-1',
        } as never),
      ).resolves.toMatchObject({
        message: 'Student fine rule created successfully',
      });

      campusAccessServiceMock.assertClassAccess.mockResolvedValueOnce(
        'campus-9',
      );
      await expect(
        service.createStudentFineRule(accountantUser, {
          campusId: 'campus-1',
          classId: 'class-1',
        } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lists student fine rules filtered by class', async () => {
      campusAccessServiceMock.getScopedCampusIds.mockResolvedValue([
        'campus-1',
      ]);
      prismaMock.studentFineRule.findMany.mockResolvedValue([]);
      entityCustomFieldsServiceMock.attachToItems.mockResolvedValue([]);

      await service.listStudentFineRules(accountantUser, 'campus-1', 'class-1');

      expect(campusAccessServiceMock.assertClassAccess).toHaveBeenCalledWith(
        accountantUser,
        'class-1',
      );
    });

    it('throws 404 getting a missing student fine rule', async () => {
      prismaMock.studentFineRule.findUnique.mockResolvedValue(null);

      await expect(
        service.getStudentFineRule(accountantUser, 'missing-fr'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft-deletes a student fine rule, and 404s when missing', async () => {
      prismaMock.studentFineRule.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.deleteStudentFineRule(accountantUser, 'missing-fr'),
      ).rejects.toBeInstanceOf(NotFoundException);

      prismaMock.studentFineRule.findUnique.mockResolvedValueOnce({
        id: 'fr-1',
        campusId: 'campus-1',
      });
      const result = await service.deleteStudentFineRule(
        accountantUser,
        'fr-1',
      );

      expect(result.message).toBe(
        'Student fine rule moved to recycle bin successfully',
      );
    });
  });

  describe('Student fines', () => {
    it('creates a student fine and rejects a duplicate for the same period', async () => {
      campusAccessServiceMock.assertStudentAccess.mockResolvedValue('campus-1');
      prismaMock.studentFine.findFirst.mockResolvedValueOnce(null);
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      prismaMock.studentFine.create.mockResolvedValue({ id: 'fine-1' });
      entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
        id: 'fine-1',
      });

      await expect(
        service.createStudentFine(accountantUser, {
          campusId: 'campus-1',
          studentId: 'student-1',
          month: 3,
          year: 2026,
        } as never),
      ).resolves.toMatchObject({
        message: 'Student fine created successfully',
      });

      prismaMock.studentFine.findFirst.mockResolvedValueOnce({
        id: 'existing-fine',
      });
      await expect(
        service.createStudentFine(accountantUser, {
          campusId: 'campus-1',
          studentId: 'student-1',
          month: 3,
          year: 2026,
        } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects student fine creation when the student belongs to a different campus', async () => {
      campusAccessServiceMock.assertStudentAccess.mockResolvedValue('campus-9');

      await expect(
        service.createStudentFine(accountantUser, {
          campusId: 'campus-1',
          studentId: 'student-1',
          month: 3,
          year: 2026,
        } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lists student fines filtered by student', async () => {
      campusAccessServiceMock.getScopedCampusIds.mockResolvedValue([
        'campus-1',
      ]);
      prismaMock.studentFine.findMany.mockResolvedValue([]);
      entityCustomFieldsServiceMock.attachToItems.mockResolvedValue([]);

      await service.listStudentFines(accountantUser, 'campus-1', 'student-1');

      expect(campusAccessServiceMock.assertStudentAccess).toHaveBeenCalledWith(
        accountantUser,
        'student-1',
      );
    });

    it('throws 404 getting a missing student fine', async () => {
      prismaMock.studentFine.findUnique.mockResolvedValue(null);

      await expect(
        service.getStudentFine(accountantUser, 'missing-fine'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('gets a student fine, asserting both campus and student access', async () => {
      prismaMock.studentFine.findUnique.mockResolvedValue({
        id: 'fine-1',
        campusId: 'campus-1',
        studentId: 'student-1',
      });
      entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
        id: 'fine-1',
      });

      await service.getStudentFine(accountantUser, 'fine-1');

      expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
        accountantUser,
        'campus-1',
      );
      expect(campusAccessServiceMock.assertStudentAccess).toHaveBeenCalledWith(
        accountantUser,
        'student-1',
      );
    });

    it('soft-deletes a student fine, and 404s when missing', async () => {
      prismaMock.studentFine.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.deleteStudentFine(accountantUser, 'missing-fine'),
      ).rejects.toBeInstanceOf(NotFoundException);

      prismaMock.studentFine.findUnique.mockResolvedValueOnce({
        id: 'fine-1',
        campusId: 'campus-1',
        studentId: 'student-1',
        month: 3,
        year: 2026,
      });
      const result = await service.deleteStudentFine(accountantUser, 'fine-1');

      expect(result.message).toBe(
        'Student fine moved to recycle bin successfully',
      );
    });
  });

  describe('Fee vouchers (list/get/delete)', () => {
    it('lists fee vouchers filtered by student', async () => {
      campusAccessServiceMock.getScopedCampusIds.mockResolvedValue([
        'campus-1',
      ]);
      prismaMock.feeVoucher.findMany.mockResolvedValue([]);
      entityCustomFieldsServiceMock.attachToItems.mockImplementation((items) =>
        Promise.resolve(items),
      );

      await service.listFeeVouchers(accountantUser, 'campus-1', 'student-1');

      expect(campusAccessServiceMock.assertStudentAccess).toHaveBeenCalledWith(
        accountantUser,
        'student-1',
      );
    });

    it('throws 404 getting a missing fee voucher', async () => {
      prismaMock.feeVoucher.findUnique.mockResolvedValue(null);

      await expect(
        service.getFeeVoucher(accountantUser, 'missing-voucher'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft-deletes a fee voucher, and 404s when missing', async () => {
      prismaMock.feeVoucher.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.deleteFeeVoucher(accountantUser, 'missing-voucher'),
      ).rejects.toBeInstanceOf(NotFoundException);

      prismaMock.feeVoucher.findUnique.mockResolvedValueOnce({
        id: 'voucher-1',
        studentId: 'student-1',
        feeStructureId: 'fs-1',
        month: 3,
        year: 2026,
        student: { campusId: 'campus-1' },
      });
      const result = await service.deleteFeeVoucher(
        accountantUser,
        'voucher-1',
      );

      expect(result.message).toBe(
        'Fee voucher moved to recycle bin successfully',
      );
    });
  });

  describe('Fee payments (list/get)', () => {
    it('lists fee payments filtered by voucher, 404s on a missing voucher', async () => {
      prismaMock.feeVoucher.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.listFeePayments(accountantUser, undefined, 'missing-voucher'),
      ).rejects.toBeInstanceOf(NotFoundException);

      prismaMock.feeVoucher.findUnique.mockResolvedValueOnce({
        student: { campusId: 'campus-1' },
      });
      campusAccessServiceMock.getScopedCampusIds.mockResolvedValue([
        'campus-1',
      ]);
      prismaMock.feePayment.findMany.mockResolvedValue([]);
      entityCustomFieldsServiceMock.attachToItems.mockResolvedValue([]);

      await service.listFeePayments(accountantUser, 'campus-1', 'voucher-1');

      expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
        accountantUser,
        'campus-1',
      );
    });

    it('throws 404 getting a missing fee payment', async () => {
      prismaMock.feePayment.findUnique.mockResolvedValue(null);

      await expect(
        service.getFeePayment(accountantUser, 'missing-payment'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('gets a fee payment with campus access asserted through the voucher', async () => {
      prismaMock.feePayment.findUnique.mockResolvedValue({
        id: 'payment-1',
        voucher: { student: { campusId: 'campus-1' } },
      });
      entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
        id: 'payment-1',
      });

      await service.getFeePayment(accountantUser, 'payment-1');

      expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
        accountantUser,
        'campus-1',
      );
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
