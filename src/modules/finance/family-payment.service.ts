import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { OwnedStudentsService } from '../../common/services/owned-students.service';
import { deriveItemKey } from '../../common/utils/derived-key.util';
import { ModuleKey, Prisma } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FamilyPaymentDto } from './dto/finance.dto';
import { FinanceService } from './finance.service';

export type FamilyPaymentStatus = 'RECORDED' | 'ALREADY_RECORDED' | 'FAILED';

export interface FamilyPaymentResult {
  voucherId: string;
  voucherNumber: string | null;
  studentName: string | null;
  amount: string;
  status: FamilyPaymentStatus;
  message: string | null;
}

const ALREADY_SAVED_MESSAGE = 'Fee payment already saved';

/**
 * Records one sitting's payment across several vouchers of a family, such as a
 * parent paying for three children at the front desk. Each voucher gets its
 * own ordinary payment (so every receipt, balance and audit entry is exactly
 * what a single payment would produce), and each one is independent: if one
 * is refused, the others are still recorded and the refusal is reported. The
 * per-voucher keys are derived from the batch key, so retrying the same batch
 * after a timeout never pays twice.
 */
@Injectable()
export class FamilyPaymentService {
  private readonly logger = new Logger(FamilyPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly campusAccessService: CampusAccessService,
    private readonly ownedStudents: OwnedStudentsService,
    private readonly auditLogService: AuditLogService,
    private readonly financeService: FinanceService,
  ) {}

  /**
   * Record the payments.
   *
   * @param {CurrentUser} currentUser - Authenticated front-desk caller.
   * @param {FamilyPaymentDto} dto - The batch key, the guardian, how and when it was paid, and the amount per voucher.
   * @returns {Promise<{message: string, data: object}>} A result for each voucher and the total recorded.
   * @throws {BadRequestException} If a voucher is listed twice.
   * @throws {ForbiddenException} If the caller cannot act at the guardian's campus.
   */
  async record(currentUser: CurrentUser, dto: FamilyPaymentDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    await this.campusAccessService.assertGuardianAccess(
      currentUser,
      dto.guardianId,
    );
    const voucherIds = dto.payments.map((line) => line.voucherId);
    if (new Set(voucherIds).size !== voucherIds.length) {
      throw new BadRequestException(
        'A voucher can appear only once in a payment.',
      );
    }

    const childIds = new Set(
      await this.ownedStudents.studentIdsOfGuardian(dto.guardianId),
    );
    const vouchers = await this.prisma.feeVoucher.findMany({
      where: { id: { in: voucherIds } },
      select: {
        id: true,
        studentId: true,
        month: true,
        year: true,
        student: {
          select: { regNo: true, user: { select: { name: true } } },
        },
      },
    });
    const byId = new Map(vouchers.map((voucher) => [voucher.id, voucher]));

    const results: FamilyPaymentResult[] = [];
    for (const line of dto.payments) {
      const voucher = byId.get(line.voucherId);
      const base = {
        voucherId: line.voucherId,
        voucherNumber: voucher
          ? `FV-${voucher.year}${String(voucher.month).padStart(2, '0')}-${voucher.student.regNo}`
          : null,
        studentName: voucher?.student.user.name ?? null,
        amount: new Prisma.Decimal(line.paidAmount).toFixed(2),
      };
      if (!voucher) {
        results.push({
          ...base,
          status: 'FAILED',
          message: 'Fee voucher not found.',
        });
        continue;
      }
      if (!childIds.has(voucher.studentId)) {
        results.push({
          ...base,
          status: 'FAILED',
          message: "This voucher is not one of this guardian's children's.",
        });
        continue;
      }
      try {
        const saved = await this.financeService.createFeePayment(
          {
            requestKey: deriveItemKey(dto.requestKey, line.voucherId),
            voucherId: line.voucherId,
            month: voucher.month,
            year: voucher.year,
            paidAmount: line.paidAmount,
            paymentMethod: dto.paymentMethod,
            paymentDate: dto.paymentDate,
          },
          currentUser,
        );
        results.push({
          ...base,
          status:
            saved.message === ALREADY_SAVED_MESSAGE
              ? 'ALREADY_RECORDED'
              : 'RECORDED',
          message: null,
        });
      } catch (error) {
        results.push({
          ...base,
          status: 'FAILED',
          message:
            error instanceof HttpException
              ? error.message
              : 'This payment could not be recorded.',
        });
      }
    }

    const recorded = results.filter((row) => row.status !== 'FAILED');
    const totalRecorded = recorded
      .reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0))
      .toFixed(2);
    await this.auditSummary(currentUser, dto, results, totalRecorded);

    return {
      message: results.some((row) => row.status === 'FAILED')
        ? 'Some payments could not be recorded'
        : 'Family payment recorded successfully',
      data: {
        results,
        totals: {
          recorded: recorded.length,
          failed: results.length - recorded.length,
          totalRecorded,
        },
      },
    };
  }

  /**
   * One summary entry for the sitting. The payments are already saved and
   * audited one by one, so a failure here must not hide what was recorded.
   */
  private async auditSummary(
    currentUser: CurrentUser,
    dto: FamilyPaymentDto,
    results: FamilyPaymentResult[],
    totalRecorded: string,
  ) {
    try {
      const guardian = await this.prisma.guardian.findUnique({
        where: { id: dto.guardianId },
        select: { campus: { select: { institutionId: true } } },
      });
      await this.auditLogService.log(currentUser, {
        action: 'FAMILY_PAYMENT_RECORDED',
        entity: 'FeePayment',
        institutionId: guardian?.campus.institutionId ?? undefined,
        metadata: {
          guardianId: dto.guardianId,
          paymentMethod: dto.paymentMethod,
          vouchers: results.length,
          failed: results.filter((row) => row.status === 'FAILED').length,
          totalRecorded,
        },
      });
    } catch (error) {
      this.logger.error(
        'Could not record the family payment summary',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
