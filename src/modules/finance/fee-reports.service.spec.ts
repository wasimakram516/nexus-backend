/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest asymmetric matchers are typed any */
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { attachFeeVoucherBalances } from '../../common/utils/fee-settlement.util';
import { ModuleKey, Prisma, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FeeReportsService } from './fee-reports.service';

jest.mock('../../common/utils/fee-settlement.util', () => ({
  attachFeeVoucherBalances: jest.fn(),
}));

describe('FeeReportsService', () => {
  let service: FeeReportsService;

  const admin: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };

  const prismaMock = {
    student: { findUnique: jest.fn(), findMany: jest.fn() },
    studentEnrollment: { findMany: jest.fn() },
    feeVoucher: { findMany: jest.fn() },
  };
  const moduleAccessMock = { assertModuleEnabledForUser: jest.fn() };
  const campusAccessMock = {
    assertCampusAccess: jest.fn(),
    assertStudentAccess: jest.fn(),
  };
  const balances = attachFeeVoucherBalances as jest.Mock;

  const voucher = (
    id: string,
    studentId: string,
    month: number,
    due: string,
    remaining: string,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    studentId,
    month,
    year: 2026,
    dueDate: new Date(due),
    finalAmountDue: new Prisma.Decimal(5000),
    discountAmount: new Prisma.Decimal(0),
    fineAmount: new Prisma.Decimal(0),
    lateFeeFine: new Prisma.Decimal(0),
    totalPaid: String(5000 - Number(remaining)),
    remainingBalance: remaining,
    status: Number(remaining) === 0 ? 'PAID' : 'OVERDUE',
    payments: [],
    student: { regNo: `R-${studentId}`, user: { name: `Name ${studentId}` } },
    ...extra,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    moduleAccessMock.assertModuleEnabledForUser.mockResolvedValue(undefined);
    campusAccessMock.assertCampusAccess.mockResolvedValue(undefined);
    campusAccessMock.assertStudentAccess.mockResolvedValue(undefined);
    balances.mockImplementation((_client: unknown, rows: unknown[]) =>
      Promise.resolve(rows),
    );
    prismaMock.studentEnrollment.findMany.mockResolvedValue([]);

    const module = await Test.createTestingModule({
      providers: [
        FeeReportsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ModuleAccessService, useValue: moduleAccessMock },
        { provide: CampusAccessService, useValue: campusAccessMock },
      ],
    }).compile();
    service = module.get(FeeReportsService);
  });

  describe('getStudentLedger', () => {
    beforeEach(() => {
      prismaMock.student.findUnique.mockResolvedValue({
        id: 's1',
        regNo: 'R-1',
        user: { name: 'Ayesha' },
      });
    });

    it('checks the finance module and the student before reading', async () => {
      prismaMock.feeVoucher.findMany.mockResolvedValue([]);

      await service.getStudentLedger(admin, 's1');

      expect(moduleAccessMock.assertModuleEnabledForUser).toHaveBeenCalledWith(
        admin,
        ModuleKey.FINANCE,
      );
      expect(campusAccessMock.assertStudentAccess).toHaveBeenCalledWith(
        admin,
        's1',
      );
    });

    it('lists each voucher with a running balance, its payments and the totals', async () => {
      prismaMock.studentEnrollment.findMany.mockResolvedValue([
        { studentId: 's1', class: { name: 'Grade 1' }, section: null },
      ]);
      prismaMock.feeVoucher.findMany.mockResolvedValue([
        voucher('v1', 's1', 8, '2026-08-10', '0.00', {
          payments: [
            {
              id: 'p1',
              paidAmount: new Prisma.Decimal(5000),
              paymentMethod: 'CASH',
              paymentDate: new Date('2026-08-05'),
            },
          ],
        }),
        voucher('v2', 's1', 9, '2026-09-10', '3000.00', {
          fineAmount: new Prisma.Decimal(100),
          lateFeeFine: new Prisma.Decimal(50),
        }),
        voucher('v3', 's1', 10, '2026-10-10', '5000.00', { status: 'PENDING' }),
      ]);

      const { data } = await service.getStudentLedger(admin, 's1');

      expect(data.student).toMatchObject({
        name: 'Ayesha',
        className: 'Grade 1',
        sectionName: null,
      });
      expect(data.entries.map((entry) => entry.runningBalance)).toEqual([
        '0.00',
        '3000.00',
        '8000.00',
      ]);
      expect(data.entries[0].payments).toEqual([
        {
          id: 'p1',
          amount: '5000.00',
          method: 'CASH',
          date: new Date('2026-08-05'),
        },
      ]);
      expect(data.entries[0].voucherNumber).toBe('FV-202608-R-1');
      expect(data.entries[1].fine).toBe('150.00');
      // 15000 charged, 7000 paid (5000 + 2000 + 0), 8000 owed of which only the overdue 3000 is late.
      expect(data.totals).toEqual({
        charged: '15000.00',
        paid: '7000.00',
        outstanding: '8000.00',
        overdue: '3000.00',
      });
    });

    it('gives an empty ledger for a student with no vouchers', async () => {
      prismaMock.feeVoucher.findMany.mockResolvedValue([]);

      const { data } = await service.getStudentLedger(admin, 's1');

      expect(data.entries).toEqual([]);
      expect(data.totals.outstanding).toBe('0.00');
    });

    it('is not found for an unknown student', async () => {
      prismaMock.student.findUnique.mockResolvedValue(null);

      await expect(service.buildLedger('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getDefaulters', () => {
    const query = { campusId: 'campus-1' };

    beforeEach(() => {
      prismaMock.student.findMany.mockResolvedValue([
        { id: 's1' },
        { id: 's2' },
        { id: 's3' },
      ]);
      prismaMock.feeVoucher.findMany.mockResolvedValue([
        voucher('a1', 's1', 8, '2026-08-10', '5000.00'),
        voucher('a2', 's1', 9, '2026-09-10', '5000.00'),
        voucher('b1', 's2', 9, '2026-09-10', '9000.00'),
        voucher('c1', 's3', 9, '2026-09-10', '0.00'),
      ]);
    });

    it('checks the module and campus first', async () => {
      await service.getDefaulters(admin, query);

      expect(moduleAccessMock.assertModuleEnabledForUser).toHaveBeenCalledWith(
        admin,
        ModuleKey.FINANCE,
      );
      expect(campusAccessMock.assertCampusAccess).toHaveBeenCalledWith(
        admin,
        'campus-1',
      );
    });

    it('groups overdue balances by student, largest debt first, and skips the fully paid', async () => {
      const { data } = await service.getDefaulters(admin, query);

      expect(data.defaulters.map((row) => row.studentId)).toEqual(['s1', 's2']);
      expect(data.defaulters[0]).toMatchObject({
        monthsOutstanding: 2,
        totalOutstanding: '10000.00',
        vouchers: [
          expect.objectContaining({ month: 8, remaining: '5000.00' }),
          expect.objectContaining({ month: 9, remaining: '5000.00' }),
        ],
      });
      expect(data.totals).toEqual({ students: 2, outstanding: '19000.00' });
    });

    it('only asks the database for unpaid vouchers already past their due date', async () => {
      await service.getDefaulters(admin, query);

      expect(prismaMock.feeVoucher.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            studentId: { in: ['s1', 's2', 's3'] },
            dueDate: { lt: expect.any(Date) },
            status: { not: 'PAID' },
          },
        }),
      );
    });

    it('keeps only students behind by the minimum number of months', async () => {
      const { data } = await service.getDefaulters(admin, {
        ...query,
        minMonths: 2,
      });

      expect(data.defaulters.map((row) => row.studentId)).toEqual(['s1']);
    });

    it('narrows to a class and section through current enrollments', async () => {
      prismaMock.studentEnrollment.findMany.mockResolvedValueOnce([
        { studentId: 's2' },
      ]);

      await service.getDefaulters(admin, {
        ...query,
        classId: 'class-1',
        sectionId: 'sec-1',
      });

      expect(prismaMock.feeVoucher.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ studentId: { in: ['s2'] } }),
        }),
      );
    });

    it('returns an empty list when nobody owes anything', async () => {
      prismaMock.feeVoucher.findMany.mockResolvedValue([]);

      const { data } = await service.getDefaulters(admin, query);

      expect(data.defaulters).toEqual([]);
      expect(data.totals).toEqual({ students: 0, outstanding: '0.00' });
    });
  });
});
