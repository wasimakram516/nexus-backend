import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { TimezoneResolverService } from '../../common/services/timezone-resolver.service';
import { Prisma, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollReportsService } from './payroll-reports.service';
import { ReportsAccessService } from './reports-access.service';

describe('PayrollReportsService', () => {
  const admin: CurrentUser = {
    sub: 'admin-1',
    email: 'a@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };
  const dec = (value: string) => new Prisma.Decimal(value);

  const prismaMock = {
    salaryPayment: { findMany: jest.fn() },
    staffSalary: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
    institutionSetting: { findFirst: jest.fn() },
  };
  const accessMock = { resolve: jest.fn() };
  const service = new PayrollReportsService(
    prismaMock as unknown as PrismaService,
    accessMock as unknown as ReportsAccessService,
    new TimezoneResolverService(prismaMock as unknown as PrismaService),
  );

  const campus = (id: string, name: string) => ({
    id,
    name,
    timezone: 'Asia/Karachi',
  });

  beforeEach(() => {
    jest.resetAllMocks();
    accessMock.resolve.mockResolvedValue({
      institutionId: 'inst-1',
      campuses: [campus('c1', 'Main')],
    });
    prismaMock.institutionSetting.findFirst.mockResolvedValue({
      value: { currencyLabel: 'PKR' },
    });
  });

  describe('register', () => {
    beforeEach(() => {
      prismaMock.salaryPayment.findMany.mockResolvedValue([
        {
          userId: 'u2',
          campusId: 'c1',
          baseSalaryAtPayment: dec('40000'),
          totalBonuses: dec('0'),
          totalDeductions: dec('0'),
          finalSalaryPaid: dec('40000'),
          paymentDate: new Date('2026-10-30T10:00:00.000Z'),
          summaries: [
            {
              absenceDeduction: dec('0'),
              lateDeduction: dec('0'),
              halfDayDeduction: dec('0'),
              leaveDeduction: dec('0'),
              manualDeductions: dec('0'),
            },
          ],
        },
        {
          userId: 'u1',
          campusId: 'c1',
          baseSalaryAtPayment: dec('50000'),
          totalBonuses: dec('2000'),
          totalDeductions: dec('3500'),
          finalSalaryPaid: dec('48500'),
          // 20:00 UTC is already the next day in Karachi.
          paymentDate: new Date('2026-10-30T20:00:00.000Z'),
          summaries: [
            {
              absenceDeduction: dec('2000'),
              lateDeduction: dec('500'),
              halfDayDeduction: dec('0'),
              leaveDeduction: dec('0'),
              manualDeductions: dec('1000'),
            },
          ],
        },
      ]);
      prismaMock.staffSalary.findMany.mockResolvedValue([
        { userId: 'u1', campusId: 'c1', baseSalary: dec('50000') },
        { userId: 'u3', campusId: 'c1', baseSalary: dec('30000') },
      ]);
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'u1', name: 'Ali' },
        { id: 'u2', name: 'Sara' },
        { id: 'u3', name: 'Omar' },
      ]);
    });

    it('lists what each person was paid as recorded, then who is still to be paid', async () => {
      const table = await service.register(admin, { month: '2026-10' });

      expect(table.subtitle).toBe('Oct 2026, Main');
      expect(table.rows).toEqual([
        {
          staff: 'Ali',
          campus: 'Main',
          status: 'Paid',
          base: '50000.00',
          bonuses: '2000.00',
          attendanceDeductions: '2500.00',
          manualDeductions: '1000.00',
          net: '48500.00',
          paidOn: '31 Oct 2026',
        },
        {
          staff: 'Sara',
          campus: 'Main',
          status: 'Paid',
          base: '40000.00',
          bonuses: '0.00',
          attendanceDeductions: '0.00',
          manualDeductions: '0.00',
          net: '40000.00',
          paidOn: '30 Oct 2026',
        },
        {
          staff: 'Omar',
          campus: 'Main',
          status: 'Not paid',
          base: '30000.00',
          bonuses: null,
          attendanceDeductions: null,
          manualDeductions: null,
          net: null,
          paidOn: '',
        },
      ]);
    });

    it('totals only what was paid and says what is still owed before deductions', async () => {
      const table = await service.register(admin, { month: '2026-10' });

      expect(table.totals).toEqual({
        staff: 'Total, 2 paid, 1 not yet paid',
        base: '90000.00',
        bonuses: '2000.00',
        attendanceDeductions: '2500.00',
        manualDeductions: '1000.00',
        net: '88500.00',
      });
      expect(table.notes[0]).toContain('30000.00');
      expect(table.notes[0]).toContain('Amounts are in PKR');
    });

    it('does not list someone as unpaid when they were paid for the month', async () => {
      const table = await service.register(admin, { month: '2026-10' });

      expect(table.rows.filter((row) => row.staff === 'Ali')).toHaveLength(1);
    });

    it('asks only for payments and salaries of the chosen month and campuses', async () => {
      await service.register(admin, { month: '2026-10' });

      expect(prismaMock.salaryPayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            campusId: { in: ['c1'] },
            month: 10,
            year: 2026,
            deletedAt: null,
          },
        }),
      );
    });
  });

  describe('cost', () => {
    const payment = (
      campusId: string,
      year: number,
      month: number,
      base: string,
      bonuses: string,
      deductions: string,
      net: string,
    ) => ({
      campusId,
      year,
      month,
      baseSalaryAtPayment: dec(base),
      totalBonuses: dec(bonuses),
      totalDeductions: dec(deductions),
      finalSalaryPaid: dec(net),
    });

    it('adds up each month and campus, leaves out months outside the period and totals', async () => {
      accessMock.resolve.mockResolvedValue({
        institutionId: 'inst-1',
        campuses: [campus('c1', 'Main'), campus('c2', 'North')],
      });
      prismaMock.salaryPayment.findMany.mockResolvedValue([
        payment('c1', 2026, 10, '50000', '2000', '3500', '48500'),
        payment('c1', 2026, 10, '40000', '0', '0', '40000'),
        payment('c2', 2026, 10, '30000', '0', '1000', '29000'),
        payment('c1', 2026, 9, '50000', '0', '0', '50000'),
        payment('c1', 2026, 8, '99999', '0', '0', '99999'),
      ]);

      const table = await service.cost(admin, {
        from: '2026-09-01',
        to: '2026-10-31',
      });

      expect(table.subtitle).toBe('Sep 2026 to Oct 2026, All campuses');
      expect(table.rows).toEqual([
        {
          month: 'Sep 2026',
          campus: 'Main',
          staff: 1,
          base: '50000.00',
          bonuses: '0.00',
          deductions: '0.00',
          net: '50000.00',
        },
        {
          month: 'Oct 2026',
          campus: 'Main',
          staff: 2,
          base: '90000.00',
          bonuses: '2000.00',
          deductions: '3500.00',
          net: '88500.00',
        },
        {
          month: 'Oct 2026',
          campus: 'North',
          staff: 1,
          base: '30000.00',
          bonuses: '0.00',
          deductions: '1000.00',
          net: '29000.00',
        },
      ]);
      expect(table.totals).toEqual({
        month: 'Total',
        staff: 4,
        base: '170000.00',
        bonuses: '2000.00',
        deductions: '4500.00',
        net: '167500.00',
      });
      expect(table.campusId).toBeNull();
    });
  });
});
