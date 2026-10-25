import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { OwnedStudentsService } from '../../common/services/owned-students.service';
import {
  PrintableCustomValue,
  PrintableCustomValuesService,
} from '../../common/services/printable-custom-values.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import {
  PrintableMeta,
  PrintableMetaService,
} from '../../common/services/printable-meta.service';
import {
  FinanceSettings,
  readFinanceSettings,
} from '../../common/utils/finance-settings.util';
import { attachFeeVoucherBalances } from '../../common/utils/fee-settlement.util';
import { ModuleKey, Prisma } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrintFeeVouchersQueryDto } from './dto/finance.dto';
import { loadStudentPlacements, studentIdsInScope } from './student-scope.util';

/** A batch print covers at most this many vouchers; larger runs narrow by class or section. */
export const MAX_PRINT_VOUCHERS = 500;

const voucherInclude = {
  student: {
    select: {
      id: true,
      regNo: true,
      campusId: true,
      user: { select: { name: true } },
    },
  },
  bank: {
    select: {
      bankName: true,
      accountTitle: true,
      accountNumber: true,
      iban: true,
      branchCode: true,
    },
  },
} satisfies Prisma.FeeVoucherInclude;

type VoucherRow = Prisma.FeeVoucherGetPayload<{
  include: typeof voucherInclude;
}>;

export interface PrintableFeeVoucher {
  printMeta: PrintableMeta;
  voucher: {
    id: string;
    voucherNumber: string;
    month: number;
    year: number;
    issueDate: Date;
    dueDate: Date;
    status: string;
    lines: Array<{ label: string; amount: string }>;
    /** Custom field values the institution chose to show on the printed voucher. */
    customValues: PrintableCustomValue[];
    totalFees: string;
    discountAmount: string;
    fineAmount: string;
    lateFeeFine: string;
    finalAmountDue: string;
    totalPaid: string;
    remainingBalance: string;
  };
  student: {
    id: string;
    name: string;
    regNo: string;
    className: string | null;
    sectionName: string | null;
  };
  bank: VoucherRow['bank'];
  /** The institution's wording for the printed voucher. */
  print: Pick<
    FinanceSettings,
    'currencyLabel' | 'voucherInstructions' | 'voucherContact'
  >;
}

/**
 * Print-ready fee vouchers for staff, one or a whole class at a time. The
 * response carries the school header, the fee lines, discounts and fines, the
 * paid and remaining amounts and the bank details; the layout (bank, school
 * and parent copies) is the frontend's job.
 */
@Injectable()
export class FeeVoucherPrintablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly campusAccessService: CampusAccessService,
    private readonly printableMetaService: PrintableMetaService,
    private readonly ownedStudents: OwnedStudentsService,
    private readonly customValues: PrintableCustomValuesService,
  ) {}

  /**
   * One voucher, ready to print.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} voucherId - Voucher to print.
   * @returns {Promise<{message: string, data: PrintableFeeVoucher}>} The printable voucher.
   * @throws {NotFoundException} If the voucher does not exist.
   * @throws {ForbiddenException} If the caller cannot act at the student's campus.
   */
  async getPrintable(currentUser: CurrentUser, voucherId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const voucher = await this.prisma.feeVoucher.findUnique({
      where: { id: voucherId },
      include: voucherInclude,
    });
    if (!voucher) throw new NotFoundException('Fee voucher not found.');
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      voucher.student.campusId,
    );
    const [printable] = await this.build([voucher]);
    return { message: 'Fee voucher ready to print', data: printable };
  }

  /**
   * One of the caller's own vouchers (or a ward's, for a guardian), ready to
   * print at home.
   *
   * @param {CurrentUser} currentUser - A student or guardian.
   * @param {string} voucherId - Voucher to print.
   * @returns {Promise<{message: string, data: PrintableFeeVoucher}>} The printable voucher.
   * @throws {NotFoundException} If the voucher does not exist.
   * @throws {ForbiddenException} If the voucher belongs to someone else's child.
   */
  async getPrintableForSelf(currentUser: CurrentUser, voucherId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const voucher = await this.prisma.feeVoucher.findUnique({
      where: { id: voucherId },
      include: voucherInclude,
    });
    if (!voucher) throw new NotFoundException('Fee voucher not found.');
    const owned = await this.ownedStudents.resolveOwnedStudentIds(currentUser);
    if (!owned.includes(voucher.studentId)) {
      throw new ForbiddenException('You can only print your own vouchers.');
    }
    const [printable] = await this.build([voucher]);
    return { message: 'Fee voucher ready to print', data: printable };
  }

  /**
   * Every voucher of a month for a campus, class or section.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {PrintFeeVouchersQueryDto} query - Campus, optional class or section, and period.
   * @returns {Promise<{message: string, data: PrintableFeeVoucher[]}>} Printable vouchers by student name.
   * @throws {ForbiddenException} If the caller cannot act at the campus.
   * @throws {BadRequestException} If the batch would be too large to print at once.
   */
  async getBatchPrintable(
    currentUser: CurrentUser,
    query: PrintFeeVouchersQueryDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      query.campusId,
    );
    const studentIds = await studentIdsInScope(this.prisma, query);
    const vouchers = await this.prisma.feeVoucher.findMany({
      where: {
        studentId: { in: studentIds },
        month: query.month,
        year: query.year,
      },
      include: voucherInclude,
      take: MAX_PRINT_VOUCHERS + 1,
    });
    if (vouchers.length > MAX_PRINT_VOUCHERS) {
      throw new BadRequestException(
        `This would print more than ${MAX_PRINT_VOUCHERS} vouchers. Choose a class or section.`,
      );
    }
    const printables = await this.build(vouchers);
    printables.sort((a, b) => a.student.name.localeCompare(b.student.name));
    return { message: 'Fee vouchers ready to print', data: printables };
  }

  /** Attach balances, class and section names and the school header. */
  private async build(vouchers: VoucherRow[]): Promise<PrintableFeeVoucher[]> {
    if (vouchers.length === 0) return [];
    const withBalances = await attachFeeVoucherBalances(this.prisma, vouchers);
    const campusIds = [
      ...new Set(vouchers.map((voucher) => voucher.student.campusId)),
    ];
    const campuses = await this.prisma.campus.findMany({
      where: { id: { in: campusIds } },
      select: { id: true, institutionId: true },
    });
    const institutionByCampus = new Map(
      campuses.map((row) => [row.id, row.institutionId]),
    );
    const metaByCampus = new Map<string, PrintableMeta>();
    for (const campusId of campusIds) {
      const institutionId = institutionByCampus.get(campusId);
      if (!institutionId) {
        throw new NotFoundException('Institution not found.');
      }
      metaByCampus.set(
        campusId,
        await this.printableMetaService.build(
          'FEE_VOUCHER',
          institutionId,
          campusId,
        ),
      );
    }

    const settingRows = await this.prisma.institutionSetting.findMany({
      where: {
        institutionId: {
          in: [
            ...new Set(
              [...institutionByCampus.values()].filter((id): id is string =>
                Boolean(id),
              ),
            ),
          ],
        },
        key: 'finance',
      },
      select: { institutionId: true, value: true },
    });
    const settingsByInstitution = new Map(
      settingRows.map((row) => [
        row.institutionId,
        readFinanceSettings(row.value),
      ]),
    );

    const customByVoucher = new Map<string, PrintableCustomValue[]>();
    for (const institutionId of new Set(
      [...institutionByCampus.values()].filter((id): id is string =>
        Boolean(id),
      ),
    )) {
      const inInstitution = vouchers.filter(
        (voucher) =>
          institutionByCampus.get(voucher.student.campusId) === institutionId,
      );
      const found = await this.customValues.forRecords(
        institutionId,
        'fee_voucher',
        inInstitution.map((voucher) => voucher.id),
      );
      found.forEach((lines, voucherId) =>
        customByVoucher.set(voucherId, lines),
      );
    }

    const placements = await loadStudentPlacements(
      this.prisma,
      vouchers.map((voucher) => voucher.studentId),
    );

    return withBalances.map((voucher) => {
      const placement = placements.get(voucher.studentId);
      const settings =
        settingsByInstitution.get(
          institutionByCampus.get(voucher.student.campusId) ?? '',
        ) ?? readFinanceSettings(null);
      const lines = Object.entries(
        (voucher.feeBreakdown ?? {}) as Record<string, number | string>,
      ).map(([label, amount]) => ({
        label,
        amount: new Prisma.Decimal(amount).toFixed(2),
      }));
      const totalFees = lines
        .reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0))
        .toFixed(2);
      return {
        printMeta: metaByCampus.get(voucher.student.campusId) as PrintableMeta,
        voucher: {
          id: voucher.id,
          voucherNumber: voucherNumber(voucher),
          month: voucher.month,
          year: voucher.year,
          issueDate: voucher.createdAt,
          dueDate: voucher.dueDate,
          status: voucher.status,
          lines,
          customValues: customByVoucher.get(voucher.id) ?? [],
          totalFees,
          discountAmount: voucher.discountAmount.toFixed(2),
          fineAmount: voucher.fineAmount.toFixed(2),
          lateFeeFine: voucher.lateFeeFine.toFixed(2),
          finalAmountDue: voucher.finalAmountDue.toFixed(2),
          totalPaid: new Prisma.Decimal(voucher.totalPaid).toFixed(2),
          remainingBalance: new Prisma.Decimal(
            voucher.remainingBalance,
          ).toFixed(2),
        },
        student: {
          id: voucher.student.id,
          name: voucher.student.user.name,
          regNo: voucher.student.regNo,
          className: placement?.className ?? null,
          sectionName: placement?.sectionName ?? null,
        },
        bank: voucher.bank,
        print: {
          currencyLabel: settings.currencyLabel,
          voucherInstructions: settings.voucherInstructions,
          voucherContact: settings.voucherContact,
        },
      };
    });
  }
}

/**
 * A readable number for the voucher, built from its period and the student's
 * registration number so no counter or extra column is needed.
 */
export function voucherNumber(voucher: {
  month: number;
  year: number;
  student: { regNo: string };
}): string {
  return `FV-${voucher.year}${String(voucher.month).padStart(2, '0')}-${voucher.student.regNo}`;
}
