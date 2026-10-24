/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest asymmetric matchers are typed any */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { OwnedStudentsService } from '../../common/services/owned-students.service';
import { deriveItemKey } from '../../common/utils/derived-key.util';
import { ModuleKey, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FamilyPaymentDto } from './dto/finance.dto';
import { FamilyPaymentService } from './family-payment.service';
import { FinanceService } from './finance.service';

describe('FamilyPaymentService', () => {
  let service: FamilyPaymentService;

  const admin: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };

  const prismaMock = {
    feeVoucher: { findMany: jest.fn() },
    guardian: { findUnique: jest.fn() },
  };
  const moduleAccessMock = { assertModuleEnabledForUser: jest.fn() };
  const campusAccessMock = { assertGuardianAccess: jest.fn() };
  const ownedMock = { studentIdsOfGuardian: jest.fn() };
  const auditMock = { log: jest.fn() };
  const financeMock = { createFeePayment: jest.fn() };

  const voucher = (id: string, studentId: string, month = 9) => ({
    id,
    studentId,
    month,
    year: 2026,
    student: { regNo: `R-${studentId}`, user: { name: `Name ${studentId}` } },
  });

  const dto = (
    payments: FamilyPaymentDto['payments'],
    overrides: Partial<FamilyPaymentDto> = {},
  ): FamilyPaymentDto => ({
    requestKey: '11111111-1111-4111-8111-111111111111',
    guardianId: 'guardian-1',
    paymentMethod: 'CASH' as FamilyPaymentDto['paymentMethod'],
    paymentDate: '2026-10-25',
    payments,
    ...overrides,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    moduleAccessMock.assertModuleEnabledForUser.mockResolvedValue(undefined);
    campusAccessMock.assertGuardianAccess.mockResolvedValue(undefined);
    ownedMock.studentIdsOfGuardian.mockResolvedValue(['s1', 's2']);
    prismaMock.feeVoucher.findMany.mockResolvedValue([
      voucher('v1', 's1'),
      voucher('v2', 's2'),
    ]);
    prismaMock.guardian.findUnique.mockResolvedValue({
      campus: { institutionId: 'inst-1' },
    });
    auditMock.log.mockResolvedValue(undefined);
    financeMock.createFeePayment.mockResolvedValue({
      message: 'Fee payment created successfully',
    });

    const module = await Test.createTestingModule({
      providers: [
        FamilyPaymentService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ModuleAccessService, useValue: moduleAccessMock },
        { provide: CampusAccessService, useValue: campusAccessMock },
        { provide: OwnedStudentsService, useValue: ownedMock },
        { provide: AuditLogService, useValue: auditMock },
        { provide: FinanceService, useValue: financeMock },
      ],
    }).compile();
    service = module.get(FamilyPaymentService);
  });

  it('checks the finance module and access to the guardian first', async () => {
    await service.record(admin, dto([{ voucherId: 'v1', paidAmount: 1000 }]));

    expect(moduleAccessMock.assertModuleEnabledForUser).toHaveBeenCalledWith(
      admin,
      ModuleKey.FINANCE,
    );
    expect(campusAccessMock.assertGuardianAccess).toHaveBeenCalledWith(
      admin,
      'guardian-1',
    );
  });

  it('records an ordinary payment for each voucher, each with its own key derived from the sitting', async () => {
    const { data } = await service.record(
      admin,
      dto([
        { voucherId: 'v1', paidAmount: 1000 },
        { voucherId: 'v2', paidAmount: 250.5 },
      ]),
    );

    expect(financeMock.createFeePayment).toHaveBeenCalledTimes(2);
    expect(financeMock.createFeePayment).toHaveBeenNthCalledWith(
      1,
      {
        requestKey: deriveItemKey('11111111-1111-4111-8111-111111111111', 'v1'),
        voucherId: 'v1',
        month: 9,
        year: 2026,
        paidAmount: 1000,
        paymentMethod: 'CASH',
        paymentDate: '2026-10-25',
      },
      admin,
    );
    expect(data.totals).toEqual({
      recorded: 2,
      failed: 0,
      totalRecorded: '1250.50',
    });
    expect(data.results[1]).toMatchObject({
      voucherId: 'v2',
      voucherNumber: 'FV-202609-R-s2',
      studentName: 'Name s2',
      amount: '250.50',
      status: 'RECORDED',
    });
  });

  it('reports a retried payment as already recorded instead of paying again', async () => {
    financeMock.createFeePayment.mockResolvedValue({
      message: 'Fee payment already saved',
    });

    const { data } = await service.record(
      admin,
      dto([{ voucherId: 'v1', paidAmount: 1000 }]),
    );

    expect(data.results[0].status).toBe('ALREADY_RECORDED');
    expect(data.totals.totalRecorded).toBe('1000.00');
  });

  it('keeps recording the other vouchers when one is refused, and says why', async () => {
    financeMock.createFeePayment
      .mockRejectedValueOnce(
        new ConflictException(
          'Payment exceeds the outstanding voucher balance.',
        ),
      )
      .mockResolvedValueOnce({ message: 'Fee payment created successfully' });

    const { message, data } = await service.record(
      admin,
      dto([
        { voucherId: 'v1', paidAmount: 99999 },
        { voucherId: 'v2', paidAmount: 500 },
      ]),
    );

    expect(message).toBe('Some payments could not be recorded');
    expect(data.results[0]).toMatchObject({
      status: 'FAILED',
      message: 'Payment exceeds the outstanding voucher balance.',
    });
    expect(data.results[1].status).toBe('RECORDED');
    expect(data.totals).toEqual({
      recorded: 1,
      failed: 1,
      totalRecorded: '500.00',
    });
  });

  it('does not leak an unexpected error message', async () => {
    financeMock.createFeePayment.mockRejectedValue(
      new Error('column "secret" does not exist'),
    );

    const { data } = await service.record(
      admin,
      dto([{ voucherId: 'v1', paidAmount: 100 }]),
    );

    expect(data.results[0].message).toBe('This payment could not be recorded.');
  });

  it("refuses a voucher that is not one of the guardian's children's, without paying it", async () => {
    prismaMock.feeVoucher.findMany.mockResolvedValue([
      voucher('v1', 's1'),
      voucher('v9', 's-stranger'),
    ]);

    const { data } = await service.record(
      admin,
      dto([
        { voucherId: 'v1', paidAmount: 100 },
        { voucherId: 'v9', paidAmount: 100 },
      ]),
    );

    expect(data.results[1]).toMatchObject({
      status: 'FAILED',
      message: "This voucher is not one of this guardian's children's.",
    });
    expect(financeMock.createFeePayment).toHaveBeenCalledTimes(1);
  });

  it('reports an unknown voucher', async () => {
    prismaMock.feeVoucher.findMany.mockResolvedValue([]);

    const { data } = await service.record(
      admin,
      dto([{ voucherId: 'ghost', paidAmount: 100 }]),
    );

    expect(data.results[0]).toMatchObject({
      status: 'FAILED',
      message: 'Fee voucher not found.',
      voucherNumber: null,
    });
    expect(financeMock.createFeePayment).not.toHaveBeenCalled();
  });

  it('refuses a voucher listed twice before paying anything', async () => {
    await expect(
      service.record(
        admin,
        dto([
          { voucherId: 'v1', paidAmount: 100 },
          { voucherId: 'v1', paidAmount: 200 },
        ]),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(financeMock.createFeePayment).not.toHaveBeenCalled();
  });

  it('refuses a caller who cannot act at the guardian, before reading anything', async () => {
    campusAccessMock.assertGuardianAccess.mockRejectedValue(
      new Error('forbidden'),
    );

    await expect(
      service.record(admin, dto([{ voucherId: 'v1', paidAmount: 100 }])),
    ).rejects.toThrow('forbidden');
    expect(prismaMock.feeVoucher.findMany).not.toHaveBeenCalled();
  });

  it('records one summary audit entry, and still returns the result if it cannot be written', async () => {
    await service.record(admin, dto([{ voucherId: 'v1', paidAmount: 100 }]));
    expect(auditMock.log).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        action: 'FAMILY_PAYMENT_RECORDED',
        institutionId: 'inst-1',
        metadata: expect.objectContaining({ totalRecorded: '100.00' }),
      }),
    );

    auditMock.log.mockRejectedValue(new Error('audit down'));
    const { data } = await service.record(
      admin,
      dto([{ voucherId: 'v2', paidAmount: 50 }]),
    );
    expect(data.totals.recorded).toBe(1);
  });
});
