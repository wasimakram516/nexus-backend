import { Injectable, NotFoundException } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { attachFeeVoucherBalances } from '../../common/utils/fee-settlement.util';
import { ModuleKey, Prisma } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DefaultersQueryDto } from './dto/finance.dto';
import { voucherNumber } from './fee-voucher-printables.service';
import { loadStudentPlacements, studentIdsInScope } from './student-scope.util';

const money = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toFixed(2);

/**
 * Fee statements for staff: one student's ledger with every voucher and
 * payment, and the list of students who owe past a due date.
 */
@Injectable()
export class FeeReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly campusAccessService: CampusAccessService,
  ) {}

  /**
   * A student's fee statement, oldest voucher first, with a running balance.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} studentId - Student whose statement is wanted.
   * @returns {Promise<{message: string, data: object}>} Student, entries with their payments, and totals.
   * @throws {NotFoundException} If the student does not exist.
   * @throws {ForbiddenException} If the caller cannot act at the student's campus.
   */
  async getStudentLedger(currentUser: CurrentUser, studentId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    await this.campusAccessService.assertStudentAccess(currentUser, studentId);
    return {
      message: 'Fee ledger retrieved successfully',
      data: await this.buildLedger(studentId),
    };
  }

  /**
   * The ledger itself, without any caller checks, so a self-service route
   * that has already proven ownership can reuse it.
   *
   * @param {string} studentId - Student whose statement is wanted.
   * @returns {Promise<object>} Student, entries and totals.
   * @throws {NotFoundException} If the student does not exist.
   */
  async buildLedger(studentId: string) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        regNo: true,
        user: { select: { name: true } },
      },
    });
    if (!student) throw new NotFoundException('Student not found.');

    const vouchers = await this.prisma.feeVoucher.findMany({
      where: { studentId },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
      include: {
        payments: {
          where: { deletedAt: null },
          orderBy: { paymentDate: 'asc' },
          select: {
            id: true,
            paidAmount: true,
            paymentMethod: true,
            paymentDate: true,
          },
        },
      },
    });
    const withBalances = await attachFeeVoucherBalances(this.prisma, vouchers);
    const placement = (
      await loadStudentPlacements(this.prisma, [studentId])
    ).get(studentId);

    let running = new Prisma.Decimal(0);
    let charged = new Prisma.Decimal(0);
    let paid = new Prisma.Decimal(0);
    let overdue = new Prisma.Decimal(0);
    const entries = withBalances.map((voucher) => {
      const remaining = new Prisma.Decimal(voucher.remainingBalance);
      charged = charged.plus(voucher.finalAmountDue);
      paid = paid.plus(voucher.totalPaid);
      running = running.plus(remaining);
      if (voucher.status === 'OVERDUE') overdue = overdue.plus(remaining);
      return {
        voucherId: voucher.id,
        voucherNumber: voucherNumber({ ...voucher, student }),
        month: voucher.month,
        year: voucher.year,
        dueDate: voucher.dueDate,
        status: voucher.status,
        charged: money(voucher.finalAmountDue),
        discount: money(voucher.discountAmount),
        fine: money(
          new Prisma.Decimal(voucher.fineAmount).plus(voucher.lateFeeFine),
        ),
        paid: money(voucher.totalPaid),
        remaining: money(remaining),
        runningBalance: money(running),
        payments: voucher.payments.map((payment) => ({
          id: payment.id,
          amount: money(payment.paidAmount),
          method: payment.paymentMethod,
          date: payment.paymentDate,
        })),
      };
    });

    return {
      student: {
        id: student.id,
        name: student.user.name,
        regNo: student.regNo,
        className: placement?.className ?? null,
        sectionName: placement?.sectionName ?? null,
      },
      entries,
      totals: {
        charged: money(charged),
        paid: money(paid),
        outstanding: money(running),
        overdue: money(overdue),
      },
    };
  }

  /**
   * Students with an unpaid balance on a voucher whose due date has passed,
   * largest debt first.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {DefaultersQueryDto} query - Campus, optional class or section, and minimum months overdue.
   * @returns {Promise<{message: string, data: object}>} Defaulters with their overdue months, and totals.
   * @throws {ForbiddenException} If the caller cannot act at the campus.
   */
  async getDefaulters(currentUser: CurrentUser, query: DefaultersQueryDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      query.campusId,
    );
    const minMonths = query.minMonths ?? 1;
    const now = new Date();
    const startOfToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    const studentIds = await studentIdsInScope(this.prisma, query);
    const vouchers = await this.prisma.feeVoucher.findMany({
      where: {
        studentId: { in: studentIds },
        dueDate: { lt: startOfToday },
        status: { not: 'PAID' },
      },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
      include: {
        student: {
          select: { regNo: true, user: { select: { name: true } } },
        },
      },
    });
    const owing = (
      await attachFeeVoucherBalances(this.prisma, vouchers)
    ).filter((voucher) => new Prisma.Decimal(voucher.remainingBalance).gt(0));

    const byStudent = new Map<string, typeof owing>();
    for (const voucher of owing) {
      byStudent.set(voucher.studentId, [
        ...(byStudent.get(voucher.studentId) ?? []),
        voucher,
      ]);
    }
    const placements = await loadStudentPlacements(this.prisma, [
      ...byStudent.keys(),
    ]);

    const defaulters = [...byStudent.entries()]
      .filter(([, rows]) => rows.length >= minMonths)
      .map(([studentId, rows]) => {
        const outstanding = rows.reduce(
          (sum, row) => sum.plus(row.remainingBalance),
          new Prisma.Decimal(0),
        );
        return {
          studentId,
          name: rows[0].student.user.name,
          regNo: rows[0].student.regNo,
          className: placements.get(studentId)?.className ?? null,
          sectionName: placements.get(studentId)?.sectionName ?? null,
          monthsOutstanding: rows.length,
          totalOutstanding: money(outstanding),
          oldestDueDate: rows[0].dueDate,
          vouchers: rows.map((row) => ({
            voucherId: row.id,
            month: row.month,
            year: row.year,
            dueDate: row.dueDate,
            remaining: money(row.remainingBalance),
          })),
        };
      })
      .sort(
        (a, b) =>
          Number(b.totalOutstanding) - Number(a.totalOutstanding) ||
          a.name.localeCompare(b.name),
      );

    return {
      message: 'Defaulters retrieved successfully',
      data: {
        defaulters,
        totals: {
          students: defaulters.length,
          outstanding: money(
            defaulters.reduce(
              (sum, row) => sum.plus(row.totalOutstanding),
              new Prisma.Decimal(0),
            ),
          ),
        },
      },
    };
  }
}
