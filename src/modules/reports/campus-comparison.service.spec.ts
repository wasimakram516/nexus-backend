/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest asymmetric matchers are typed any */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { TimezoneResolverService } from '../../common/services/timezone-resolver.service';
import {
  AttendanceStatus,
  EnrollmentStatus,
  Prisma,
  UserRole,
  VoucherStatus,
} from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CampusComparisonService } from './campus-comparison.service';
import { ReportsAccessService } from './reports-access.service';

describe('CampusComparisonService', () => {
  const admin: CurrentUser = {
    sub: 'admin-1',
    email: 'a@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };

  const dec = (value: string) => new Prisma.Decimal(value);

  const prismaMock = {
    institution: { findUnique: jest.fn() },
    studentEnrollment: { count: jest.fn() },
    student: { count: jest.fn() },
    attendance: { groupBy: jest.fn() },
    feeVoucher: { aggregate: jest.fn(), groupBy: jest.fn() },
    feePayment: { aggregate: jest.fn() },
  };
  const accessMock = { resolve: jest.fn() };
  const service = new CampusComparisonService(
    prismaMock as unknown as PrismaService,
    accessMock as unknown as ReportsAccessService,
    new TimezoneResolverService(prismaMock as unknown as PrismaService),
  );

  /** Figures per campus, keyed by the campus id the query asks about. */
  const byCampus =
    <T>(values: Record<string, T>) =>
    (args: {
      where: {
        campusId?: string;
        student?: { campusId: string };
        voucher?: { student: { campusId: string } };
      };
    }) =>
      Promise.resolve(
        values[
          args.where.campusId ??
            args.where.student?.campusId ??
            args.where.voucher?.student.campusId ??
            ''
        ],
      );

  beforeEach(() => {
    jest.resetAllMocks();
    accessMock.resolve.mockResolvedValue({
      institutionId: 'inst-1',
      campuses: [
        { id: 'c1', name: 'Main', timezone: 'Asia/Karachi' },
        { id: 'c2', name: 'North', timezone: 'Asia/Karachi' },
      ],
    });
    prismaMock.institution.findUnique.mockResolvedValue({
      currentAcademicYearId: 'year-1',
      settings: [{ value: { currencyLabel: 'PKR' } }],
    });
    prismaMock.studentEnrollment.count.mockImplementation(
      byCampus({ c1: 100, c2: 50 }),
    );
    prismaMock.attendance.groupBy.mockImplementation(
      byCampus({
        c1: [
          { status: AttendanceStatus.PRESENT, _count: { _all: 80 } },
          { status: AttendanceStatus.LATE, _count: { _all: 10 } },
          { status: AttendanceStatus.ABSENT, _count: { _all: 10 } },
          { status: AttendanceStatus.LEAVE, _count: { _all: 5 } },
        ],
        c2: [
          { status: AttendanceStatus.PRESENT, _count: { _all: 30 } },
          { status: AttendanceStatus.ABSENT, _count: { _all: 10 } },
        ],
      }),
    );
    // Two kinds of voucher sum: this month's billing, and everything unpaid.
    prismaMock.feeVoucher.aggregate.mockImplementation(
      (args: {
        where: { status?: unknown; student: { campusId: string } };
      }) => {
        const unpaid = Boolean(args.where.status);
        const sums: Record<string, [string, string]> = {
          c1: ['10000.00', '4000.00'],
          c2: ['5000.00', '1000.00'],
        };
        const [billed, owing] = sums[args.where.student.campusId];
        return Promise.resolve({
          _sum: { finalAmountDue: dec(unpaid ? owing : billed) },
        });
      },
    );
    prismaMock.feePayment.aggregate.mockImplementation(
      (args: {
        where: {
          paymentDate?: unknown;
          voucher: { student: { campusId: string } };
        };
      }) => {
        const thisMonth = Boolean(args.where.paymentDate);
        const sums: Record<string, [string, string]> = {
          c1: ['6000.00', '1500.00'],
          c2: ['2500.00', '0.00'],
        };
        const [collected, onUnpaid] = sums[args.where.voucher.student.campusId];
        return Promise.resolve({
          _sum: { paidAmount: dec(thisMonth ? collected : onUnpaid) },
        });
      },
    );
    prismaMock.feeVoucher.groupBy.mockImplementation(
      byCampus({ c1: [{ studentId: 's1' }, { studentId: 's2' }], c2: [] }),
    );
  });

  it('puts every campus side by side with a total, computing attendance and collection from the counts', async () => {
    const table = await service.build(admin, { date: '2026-10-25' });

    expect(table.key).toBe('campus-comparison');
    expect(table.subtitle).toBe('As of 25 Oct 2026');
    expect(table.rows[0]).toEqual({
      campus: 'Main',
      students: 100,
      present: 90,
      absent: 10,
      leave: 5,
      attendance: 90,
      billed: '10000.00',
      collected: '6000.00',
      collection: 60,
      outstanding: '2500.00',
      defaulters: 2,
    });
    expect(table.rows[1]).toMatchObject({
      campus: 'North',
      present: 30,
      attendance: 75,
      collection: 50,
      outstanding: '1000.00',
      defaulters: 0,
    });
    expect(table.totals).toEqual({
      campus: 'All campuses',
      students: 150,
      present: 120,
      absent: 20,
      leave: 5,
      attendance: 85.7,
      billed: '15000.00',
      collected: '8500.00',
      collection: 56.7,
      outstanding: '3500.00',
      defaulters: 2,
    });
    expect(table.notes).toContain('Amounts are in PKR');
  });

  it("asks for each campus's own figures, the enrolments of the current year and daily marking only", async () => {
    await service.build(admin, { date: '2026-10-25' });

    expect(prismaMock.studentEnrollment.count).toHaveBeenCalledWith({
      where: {
        campusId: 'c1',
        academicYearId: 'year-1',
        status: EnrollmentStatus.ACTIVE,
        deletedAt: null,
      },
    });
    expect(prismaMock.attendance.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          campusId: 'c1',
          role: UserRole.STUDENT,
          periodKey: 'DAILY',
          deletedAt: null,
        }),
      }),
    );
    expect(prismaMock.feeVoucher.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ month: 10, year: 2026 }),
      }),
    );
    expect(prismaMock.feeVoucher.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { not: VoucherStatus.PAID },
        }),
      }),
    );
  });

  it('has no total row for a single campus, and shows zeros instead of dividing by nothing', async () => {
    accessMock.resolve.mockResolvedValue({
      institutionId: 'inst-1',
      campuses: [{ id: 'c1', name: 'Main', timezone: 'Asia/Karachi' }],
    });
    prismaMock.attendance.groupBy.mockResolvedValue([]);
    prismaMock.feeVoucher.aggregate.mockResolvedValue({
      _sum: { finalAmountDue: null },
    });
    prismaMock.feePayment.aggregate.mockResolvedValue({
      _sum: { paidAmount: null },
    });
    prismaMock.feeVoucher.groupBy.mockResolvedValue([]);

    const table = await service.build(admin, { date: '2026-10-25' });

    expect(table.totals).toBeNull();
    expect(table.rows[0]).toMatchObject({
      attendance: 0,
      billed: '0.00',
      collected: '0.00',
      collection: 0,
      outstanding: '0.00',
    });
  });

  it('never shows a negative outstanding amount when payments exceed what is owed', async () => {
    prismaMock.feePayment.aggregate.mockResolvedValue({
      _sum: { paidAmount: dec('99999.00') },
    });

    const table = await service.build(admin, { date: '2026-10-25' });

    expect(table.rows[0].outstanding).toBe('0.00');
  });

  it('counts every registered student when no academic year is current, and says so', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      currentAcademicYearId: null,
      settings: [],
    });
    prismaMock.student.count.mockResolvedValue(120);

    const table = await service.build(admin, { date: '2026-10-25' });

    expect(prismaMock.studentEnrollment.count).not.toHaveBeenCalled();
    expect(table.rows[0].students).toBe(120);
    expect(table.notes.join(' ')).toContain('No current academic year is set');
    expect(table.notes).toContain('Amounts are in Rs.');
  });

  it("reports each campus on its own day when none is asked for, and passes a superadmin's institution on", async () => {
    const table = await service.build(
      { ...admin, role: UserRole.SUPERADMIN, institutionId: null },
      { institutionId: 'inst-9' },
    );

    expect(accessMock.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ role: UserRole.SUPERADMIN }),
      { institutionId: 'inst-9' },
    );
    expect(table.subtitle).toBe('As of today at each campus');
  });

  it('refuses a date that is not real, and anyone the access check refuses', async () => {
    await expect(
      service.build(admin, { date: '2026-02-30' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    accessMock.resolve.mockRejectedValue(new ForbiddenException('no'));
    await expect(service.build(admin, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
