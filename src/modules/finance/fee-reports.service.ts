import { Injectable, NotFoundException } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { OwnedStudentsService } from '../../common/services/owned-students.service';
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
    private readonly ownedStudents: OwnedStudentsService,
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
   * The fees of the caller's own children, or of the caller for a student:
   * a statement for each plus the combined totals and every voucher still
   * unpaid, so a family sees what it owes in one place.
   *
   * @param {CurrentUser} currentUser - A student or guardian; anyone else gets an empty family.
   * @returns {Promise<{message: string, data: object}>} The family's statements, totals and open vouchers.
   */
  async getMyFees(currentUser: CurrentUser) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const studentIds =
      await this.ownedStudents.resolveOwnedStudentIds(currentUser);
    return {
      message: 'Fees retrieved successfully',
      data: await this.buildFamily(studentIds),
    };
  }

  /**
   * A guardian's family for the front desk: every linked child's statement,
   * the combined totals and the vouchers still unpaid.
   *
   * @param {CurrentUser} currentUser - Authenticated staff caller.
   * @param {string} guardianId - The guardian whose family is wanted.
   * @returns {Promise<{message: string, data: object}>} The guardian, their children's statements and totals.
   * @throws {ForbiddenException} If the caller cannot act at the guardian's campus.
   * @throws {NotFoundException} If the guardian does not exist.
   */
  async getFamilyBilling(currentUser: CurrentUser, guardianId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    await this.campusAccessService.assertGuardianAccess(
      currentUser,
      guardianId,
    );
    const guardian = await this.prisma.guardian.findUnique({
      where: { id: guardianId },
      select: { id: true, user: { select: { name: true } } },
    });
    if (!guardian) throw new NotFoundException('Guardian not found.');
    const studentIds =
      await this.ownedStudents.studentIdsOfGuardian(guardianId);
    return {
      message: 'Family fees retrieved successfully',
      data: {
        guardian: { id: guardian.id, name: guardian.user.name },
        ...(await this.buildFamily(studentIds)),
      },
    };
  }

  /** Statements for several children with their combined totals and unpaid vouchers. */
  private async buildFamily(studentIds: string[]) {
    const ledgers = (
      await Promise.all(studentIds.map((id) => this.buildLedger(id)))
    ).sort((a, b) => a.student.name.localeCompare(b.student.name));

    const sum = (pick: (ledger: (typeof ledgers)[number]) => string) =>
      money(
        ledgers.reduce(
          (total, ledger) => total.plus(pick(ledger)),
          new Prisma.Decimal(0),
        ),
      );
    return {
      students: ledgers,
      totals: {
        charged: sum((ledger) => ledger.totals.charged),
        paid: sum((ledger) => ledger.totals.paid),
        outstanding: sum((ledger) => ledger.totals.outstanding),
        overdue: sum((ledger) => ledger.totals.overdue),
      },
      openVouchers: ledgers.flatMap((ledger) =>
        ledger.entries
          .filter((entry) => new Prisma.Decimal(entry.remaining).gt(0))
          .map((entry) => ({
            studentId: ledger.student.id,
            studentName: ledger.student.name,
            voucherId: entry.voucherId,
            voucherNumber: entry.voucherNumber,
            month: entry.month,
            year: entry.year,
            dueDate: entry.dueDate,
            status: entry.status,
            remaining: entry.remaining,
          })),
      ),
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
