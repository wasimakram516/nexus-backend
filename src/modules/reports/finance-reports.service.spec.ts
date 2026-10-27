/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest asymmetric matchers are typed any */
import { BadRequestException } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { TimezoneResolverService } from '../../common/services/timezone-resolver.service';
import { PaymentMethod, Prisma, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceReportsService } from './finance-reports.service';
import { ReportsAccessService } from './reports-access.service';

describe('FinanceReportsService', () => {
  const admin: CurrentUser = {
    sub: 'admin-1',
    email: 'a@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };
  const dec = (value: string) => new Prisma.Decimal(value);

  const prismaMock = {
    feePayment: { findMany: jest.fn(), groupBy: jest.fn() },
    feeVoucher: { findMany: jest.fn() },
    institutionSetting: { findFirst: jest.fn() },
    studentEnrollment: { findMany: jest.fn() },
  };
  const accessMock = { resolve: jest.fn() };
  const service = new FinanceReportsService(
    prismaMock as unknown as PrismaService,
    accessMock as unknown as ReportsAccessService,
    new TimezoneResolverService(prismaMock as unknown as PrismaService),
  );

  const scopeOf = (...campuses: [string, string][]) => ({
    institutionId: 'inst-1',
    campuses: campuses.map(([id, name]) => ({
      id,
      name,
      timezone: 'Asia/Karachi',
    })),
  });

  beforeEach(() => {
    jest.resetAllMocks();
    accessMock.resolve.mockResolvedValue(scopeOf(['c1', 'Main']));
    prismaMock.institutionSetting.findFirst.mockResolvedValue({
      value: { currencyLabel: 'PKR' },
    });
  });

  describe('collection', () => {
    const payment = (iso: string, amount: string, method: PaymentMethod) => ({
      paidAmount: dec(amount),
      paymentMethod: method,
      paymentDate: new Date(iso),
    });

    beforeEach(() => {
      prismaMock.feePayment.findMany.mockResolvedValue([
        // 20:00 UTC on the 24th is already the 25th at a Karachi campus.
        payment('2026-10-24T20:00:00.000Z', '1000.00', PaymentMethod.CASH),
        payment(
          '2026-10-25T06:00:00.000Z',
          '2500.50',
          PaymentMethod.BANK_TRANSFER,
        ),
        payment('2026-10-26T06:00:00.000Z', '500.00', PaymentMethod.CASH),
        payment('2026-11-03T06:00:00.000Z', '700.00', PaymentMethod.CASH),
      ]);
    });

    it('groups by the day received at the campus, splitting cash and bank and totalling', async () => {
      const table = await service.collection(admin, {
        from: '2026-10-01',
        to: '2026-11-30',
      });

      expect(table.columns[0].label).toBe('Date');
      expect(table.rows).toEqual([
        {
          group: '25 Oct 2026',
          payments: 2,
          cash: '1000.00',
          bank: '2500.50',
          total: '3500.50',
        },
        {
          group: '26 Oct 2026',
          payments: 1,
          cash: '500.00',
          bank: '0.00',
          total: '500.00',
        },
        {
          group: '3 Nov 2026',
          payments: 1,
          cash: '700.00',
          bank: '0.00',
          total: '700.00',
        },
      ]);
      expect(table.totals).toEqual({
        group: 'Total',
        payments: 4,
        cash: '2200.00',
        bank: '2500.50',
        total: '4700.50',
      });
      expect(table.subtitle).toBe('1 Oct 2026 to 30 Nov 2026, Main, by day');
      expect(table.notes[0]).toContain('Amounts are in PKR');
    });

    it('groups by month', async () => {
      const table = await service.collection(admin, {
        from: '2026-10-01',
        to: '2026-11-30',
        groupBy: 'MONTH',
      });

      expect(table.columns[0].label).toBe('Month');
      expect(table.rows.map((row) => [row.group, row.total])).toEqual([
        ['Oct 2026', '4000.50'],
        ['Nov 2026', '700.00'],
      ]);
    });

    it('groups by campus across every campus the report covers', async () => {
      accessMock.resolve.mockResolvedValue(
        scopeOf(['c1', 'Main'], ['c2', 'North']),
      );
      prismaMock.feePayment.findMany
        .mockResolvedValueOnce([
          payment('2026-10-25T06:00:00.000Z', '100.00', PaymentMethod.CASH),
        ])
        .mockResolvedValueOnce([
          payment(
            '2026-10-25T06:00:00.000Z',
            '40.00',
            PaymentMethod.BANK_TRANSFER,
          ),
        ]);

      const table = await service.collection(admin, {
        from: '2026-10-01',
        to: '2026-10-31',
        groupBy: 'CAMPUS',
      });

      expect(table.columns[0].label).toBe('Campus');
      expect(table.rows.map((row) => [row.group, row.total])).toEqual([
        ['Main', '100.00'],
        ['North', '40.00'],
      ]);
      expect(table.totals?.total).toBe('140.00');
      expect(table.campusId).toBeNull();
    });

    it("asks for each campus's payments between the local start of the first day and the end of the last", async () => {
      await service.collection(admin, { from: '2026-10-01', to: '2026-10-31' });

      expect(prismaMock.feePayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
            voucher: { deletedAt: null, student: { campusId: 'c1' } },
            paymentDate: {
              gte: new Date('2026-09-30T19:00:00.000Z'),
              lt: new Date('2026-10-31T19:00:00.000Z'),
            },
          }),
        }),
      );
    });

    it('is empty with a zero total when nothing was received, and refuses a bad period', async () => {
      prismaMock.feePayment.findMany.mockResolvedValue([]);
      const table = await service.collection(admin, {
        from: '2026-10-01',
        to: '2026-10-31',
      });
      expect(table.rows).toEqual([]);
      expect(table.totals).toMatchObject({ payments: 0, total: '0.00' });

      await expect(
        service.collection(admin, { from: '2026-10-31', to: '2026-10-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('outstandingDues', () => {
    const voucher = (
      id: string,
      studentId: string,
      name: string,
      month: number,
      due: string,
    ) => ({
      id,
      studentId,
      month,
      year: 2026,
      finalAmountDue: dec('1000.00'),
      dueDate: new Date(due),
      student: { campusId: 'c1', regNo: `R-${studentId}`, user: { name } },
    });

    beforeEach(() => {
      prismaMock.feeVoucher.findMany.mockResolvedValue([
        voucher('v1', 's1', 'Ayesha', 8, '2026-08-10T00:00:00.000Z'),
        voucher('v2', 's1', 'Ayesha', 9, '2026-09-10T00:00:00.000Z'),
        voucher('v3', 's2', 'Bilal', 9, '2026-09-10T00:00:00.000Z'),
        voucher('v4', 's3', 'Cyrus', 9, '2026-09-10T00:00:00.000Z'),
      ]);
      // Cyrus has paid his voucher in full since its status was last set.
      prismaMock.feePayment.groupBy.mockResolvedValue([
        { voucherId: 'v1', _sum: { paidAmount: dec('400.00') } },
        { voucherId: 'v4', _sum: { paidAmount: dec('1000.00') } },
      ]);
      prismaMock.studentEnrollment.findMany.mockResolvedValue([
        { studentId: 's1', class: { name: 'Grade 5' }, section: { name: 'A' } },
      ]);
    });

    it('totals what each student owes after payments, largest first, and leaves out those who have paid up', async () => {
      const table = await service.outstandingDues(admin, {});

      expect(table.rows).toEqual([
        {
          name: 'Ayesha',
          regNo: 'R-s1',
          className: 'Grade 5',
          sectionName: 'A',
          campus: 'Main',
          months: 2,
          oldestDue: '10 Aug 2026',
          outstanding: '1600.00',
        },
        {
          name: 'Bilal',
          regNo: 'R-s2',
          className: '',
          sectionName: '',
          campus: 'Main',
          months: 1,
          oldestDue: '10 Sep 2026',
          outstanding: '1000.00',
        },
      ]);
      expect(table.totals).toEqual({
        name: 'Total, 2 students',
        outstanding: '2600.00',
      });
    });

    it('only asks for unpaid fees past their due date at the campuses it covers', async () => {
      await service.outstandingDues(admin, {});

      expect(prismaMock.feeVoucher.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
            status: { not: 'PAID' },
            student: { deletedAt: null, campusId: { in: ['c1'] } },
          }),
        }),
      );
    });

    it('has just a zero total when nobody owes', async () => {
      prismaMock.feeVoucher.findMany.mockResolvedValue([]);
      prismaMock.feePayment.groupBy.mockResolvedValue([]);

      const table = await service.outstandingDues(admin, {});

      expect(table.rows).toEqual([]);
      expect(table.totals).toEqual({
        name: 'Total, 0 students',
        outstanding: '0.00',
      });
    });
  });

  describe('adjustments', () => {
    const voucher = (
      campusId: string,
      year: number,
      month: number,
      figures: [string, string, string, string],
    ) => ({
      month,
      year,
      finalAmountDue: dec(figures[0]),
      discountAmount: dec(figures[1]),
      fineAmount: dec(figures[2]),
      lateFeeFine: dec(figures[3]),
      student: { campusId },
    });

    it('adds up discounts, attendance fines and late fees per month and campus, inside the months asked for', async () => {
      accessMock.resolve.mockResolvedValue(
        scopeOf(['c1', 'Main'], ['c2', 'North']),
      );
      prismaMock.feeVoucher.findMany.mockResolvedValue([
        voucher('c1', 2026, 9, ['900.00', '100.00', '0.00', '0.00']),
        voucher('c1', 2026, 9, ['1050.00', '0.00', '30.00', '20.00']),
        voucher('c2', 2026, 9, ['500.00', '50.00', '0.00', '0.00']),
        voucher('c1', 2026, 10, ['1000.00', '0.00', '0.00', '0.00']),
        voucher('c1', 2026, 3, ['999.00', '999.00', '0.00', '0.00']),
      ]);

      const table = await service.adjustments(admin, {
        from: '2026-09-01',
        to: '2026-10-31',
      });

      expect(table.rows).toEqual([
        {
          month: 'Sep 2026',
          campus: 'Main',
          vouchers: 2,
          billed: '1950.00',
          discounts: '100.00',
          fines: '30.00',
          lateFees: '20.00',
        },
        {
          month: 'Sep 2026',
          campus: 'North',
          vouchers: 1,
          billed: '500.00',
          discounts: '50.00',
          fines: '0.00',
          lateFees: '0.00',
        },
        {
          month: 'Oct 2026',
          campus: 'Main',
          vouchers: 1,
          billed: '1000.00',
          discounts: '0.00',
          fines: '0.00',
          lateFees: '0.00',
        },
      ]);
      expect(table.totals).toEqual({
        month: 'Total',
        vouchers: 4,
        billed: '3450.00',
        discounts: '150.00',
        fines: '30.00',
        lateFees: '20.00',
      });
      expect(table.subtitle).toBe('Sep 2026 to Oct 2026, All campuses');
    });

    it('is empty with zero totals when no vouchers fall in the months', async () => {
      prismaMock.feeVoucher.findMany.mockResolvedValue([]);

      const table = await service.adjustments(admin, {
        from: '2026-09-01',
        to: '2026-09-30',
      });

      expect(table.rows).toEqual([]);
      expect(table.totals).toMatchObject({ vouchers: 0, billed: '0.00' });
    });
  });
});
