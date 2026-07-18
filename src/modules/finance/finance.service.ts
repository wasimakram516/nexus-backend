import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdjustmentType as PrismaAdjustmentType,
  AttendanceStatus as PrismaAttendanceStatus,
  UserRole,
} from '../../prisma/client';
import { CustomFieldEntity } from '../../common/constants/custom-field-entities.constants';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ModuleKey } from '../../prisma/client';
import {
  CreateBankAccountDto,
  CreateDeductionRuleDto,
  CreateFeePaymentDto,
  CreateFeeStructureDto,
  CreateFeeVoucherDto,
  CreateSalaryDto,
  CreateStudentDiscountDto,
  CreateStudentFineDto,
  CreateStudentFineRuleDto,
  SalaryAdjustmentDto,
  SalaryPaymentDto,
  SalaryPayrollPreviewQueryDto,
  UpdateBankAccountDto,
  UpdateFeeStructureDto,
  UpdateFeeVoucherDto,
  UpdateSalaryDto,
} from './dto/finance.dto';

const DEFAULT_PAYROLL_PER_DAY_BASIS = 30;

export interface PayrollBreakdown {
  baseSalary: number;
  perDayBasis: number;
  dailyRate: number;
  bonuses: number;
  manualDeductions: number;
  absenceDeduction: number;
  lateDeduction: number;
  halfDayDeduction: number;
  leaveDeduction: number;
  totalDeductions: number;
  finalSalary: number;
  attendance: {
    absentCount: number;
    lateCount: number;
    halfDayCount: number;
    leaveCount: number;
  };
  rule: {
    allowedAbsences: number;
    allowedLates: number;
    allowedHalfDays: number;
    allowedLeaves: number;
  } | null;
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campusAccessService: CampusAccessService,
    private readonly entityCustomFieldsService: EntityCustomFieldsService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly requestContext: RequestContextService,
  ) {}

  async createSalary(currentUser: CurrentUser, dto: CreateSalaryDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    const { customFields, ...salaryData } = dto;
    const item = await this.prisma.staffSalary.create({
      data: {
        ...salaryData,
        joiningDate: new Date(dto.joiningDate),
        effectiveDate: new Date(dto.effectiveDate),
      },
    });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        dto.campusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.FINANCE,
      entityType: CustomFieldEntity.STAFF_SALARY,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.STAFF_SALARY,
    );
    return { message: 'Salary created successfully', data };
  }

  async listSalaries(currentUser: CurrentUser, campusId?: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const campusIds = await this.campusAccessService.getScopedCampusIds(
      currentUser,
      campusId,
    );
    const items = await this.prisma.staffSalary.findMany({
      where:
        currentUser.role === UserRole.SUPERADMIN && !campusId
          ? undefined
          : { campusId: { in: campusIds } },
      orderBy: { createdAt: 'desc' },
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.STAFF_SALARY,
    );
    return { message: 'Salaries retrieved successfully', data };
  }

  async getSalary(currentUser: CurrentUser, salaryId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const campusId = await this.resolveSalaryCampusId(salaryId);
    await this.campusAccessService.assertCampusAccess(currentUser, campusId);

    const item = await this.prisma.staffSalary.findUnique({
      where: { id: salaryId },
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.STAFF_SALARY,
    );

    if (!data) {
      throw new NotFoundException('Salary record not found.');
    }

    return { message: 'Salary retrieved successfully', data };
  }

  async updateSalary(
    currentUser: CurrentUser,
    salaryId: string,
    dto: UpdateSalaryDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );

    const existing = await this.prisma.staffSalary.findUnique({
      where: { id: salaryId },
    });

    if (!existing) {
      throw new NotFoundException('Salary record not found.');
    }

    const targetCampusId = dto.campusId ?? existing.campusId;
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      existing.campusId,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      targetCampusId,
    );

    const { customFields, joiningDate, effectiveDate, ...salaryData } = dto;
    const item = await this.prisma.staffSalary.update({
      where: { id: salaryId },
      data: {
        ...salaryData,
        ...(joiningDate ? { joiningDate: new Date(joiningDate) } : {}),
        ...(effectiveDate ? { effectiveDate: new Date(effectiveDate) } : {}),
      },
    });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        targetCampusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.FINANCE,
      entityType: CustomFieldEntity.STAFF_SALARY,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.STAFF_SALARY,
    );
    return { message: 'Salary updated successfully', data };
  }

  async deleteSalary(
    currentUser: CurrentUser,
    salaryId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const existing = await this.prisma.staffSalary.findUnique({
      where: { id: salaryId },
      select: {
        id: true,
        campusId: true,
        userId: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Salary record not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      existing.campusId,
    );
    await this.prisma.staffSalary.update({
      where: { id: salaryId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    return {
      message: 'Salary moved to recycle bin successfully',
      data: existing,
    };
  }

  async createDeductionRule(
    currentUser: CurrentUser,
    dto: CreateDeductionRuleDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    const existingRule = await this.prisma.salaryDeductionRule.findFirst({
      where: {
        campusId: dto.campusId,
        role: dto.role,
      },
    });

    if (existingRule) {
      throw new ConflictException(
        'A salary deduction rule already exists for this campus and role.',
      );
    }
    const { customFields, ...ruleData } = dto;
    const item = await this.prisma.salaryDeductionRule.create({
      data: ruleData,
    });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        dto.campusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.FINANCE,
      entityType: CustomFieldEntity.SALARY_DEDUCTION_RULE,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.SALARY_DEDUCTION_RULE,
    );
    return {
      message: 'Salary deduction rule created successfully',
      data,
    };
  }

  async listDeductionRules(currentUser: CurrentUser, campusId?: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const campusIds = await this.campusAccessService.getScopedCampusIds(
      currentUser,
      campusId,
    );
    const items = await this.prisma.salaryDeductionRule.findMany({
      where:
        currentUser.role === UserRole.SUPERADMIN && !campusId
          ? undefined
          : { campusId: { in: campusIds } },
      orderBy: { createdAt: 'desc' },
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.SALARY_DEDUCTION_RULE,
    );
    return {
      message: 'Salary deduction rules retrieved successfully',
      data,
    };
  }

  async getDeductionRule(currentUser: CurrentUser, ruleId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const item = await this.prisma.salaryDeductionRule.findUnique({
      where: { id: ruleId },
    });

    if (!item) {
      throw new NotFoundException('Salary deduction rule not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      item.campusId,
    );
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.SALARY_DEDUCTION_RULE,
    );
    return {
      message: 'Salary deduction rule retrieved successfully',
      data,
    };
  }

  async deleteDeductionRule(
    currentUser: CurrentUser,
    ruleId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const existing = await this.prisma.salaryDeductionRule.findUnique({
      where: { id: ruleId },
      select: {
        id: true,
        campusId: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Salary deduction rule not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      existing.campusId,
    );
    await this.prisma.salaryDeductionRule.update({
      where: { id: ruleId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    return {
      message: 'Salary deduction rule moved to recycle bin successfully',
      data: existing,
    };
  }

  async applyAdjustment(dto: SalaryAdjustmentDto, currentUser: CurrentUser) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    await this.assertSalaryAccess(dto.salaryId, dto.campusId, dto.userId);
    const { customFields, ...adjustmentData } = dto;
    const item = await this.prisma.salaryAdjustment.create({
      data: {
        ...adjustmentData,
        adjustedBy: currentUser.sub,
      },
    });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        dto.campusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.FINANCE,
      entityType: CustomFieldEntity.SALARY_ADJUSTMENT,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.SALARY_ADJUSTMENT,
    );
    return { message: 'Salary adjustment applied successfully', data };
  }

  async listSalaryAdjustments(
    currentUser: CurrentUser,
    campusId?: string,
    userId?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const campusIds = await this.campusAccessService.getScopedCampusIds(
      currentUser,
      campusId,
    );
    const items = await this.prisma.salaryAdjustment.findMany({
      where: {
        ...(currentUser.role === UserRole.SUPERADMIN && !campusId
          ? {}
          : { campusId: { in: campusIds } }),
        ...(userId ? { userId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.SALARY_ADJUSTMENT,
    );
    return { message: 'Salary adjustments retrieved successfully', data };
  }

  async getSalaryAdjustment(currentUser: CurrentUser, adjustmentId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const item = await this.prisma.salaryAdjustment.findUnique({
      where: { id: adjustmentId },
    });

    if (!item) {
      throw new NotFoundException('Salary adjustment not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      item.campusId,
    );
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.SALARY_ADJUSTMENT,
    );
    return { message: 'Salary adjustment retrieved successfully', data };
  }

  async deleteSalaryAdjustment(
    currentUser: CurrentUser,
    adjustmentId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const existing = await this.prisma.salaryAdjustment.findUnique({
      where: { id: adjustmentId },
      select: {
        id: true,
        salaryId: true,
        userId: true,
        campusId: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Salary adjustment not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      existing.campusId,
    );
    await this.prisma.salaryAdjustment.update({
      where: { id: adjustmentId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    return {
      message: 'Salary adjustment moved to recycle bin successfully',
      data: existing,
    };
  }

  async paySalary(dto: SalaryPaymentDto, currentUser: CurrentUser) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    const salary = await this.prisma.staffSalary.findUnique({
      where: { id: dto.salaryId },
    });
    if (!salary) throw new NotFoundException('Salary record not found.');
    if (salary.campusId !== dto.campusId || salary.userId !== dto.userId) {
      throw new ForbiddenException(
        'Salary payment must match the selected salary record and campus.',
      );
    }
    const existingPayment = await this.prisma.salaryPayment.findFirst({
      where: {
        userId: dto.userId,
        campusId: dto.campusId,
        month: dto.month,
        year: dto.year,
      },
    });

    if (existingPayment) {
      throw new ConflictException(
        'A salary payment already exists for this user and payroll period.',
      );
    }

    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        dto.campusId,
      );
    const breakdown = await this.buildPayrollBreakdown(
      dto.userId,
      dto.campusId,
      salary.role,
      dto.month,
      dto.year,
      Number(salary.baseSalary),
      institutionId,
    );

    const { customFields, ...paymentData } = dto;
    const item = await this.prisma.salaryPayment.create({
      data: {
        userId: paymentData.userId,
        salaryId: paymentData.salaryId,
        campusId: paymentData.campusId,
        month: paymentData.month,
        year: paymentData.year,
        baseSalaryAtPayment: salary.baseSalary,
        totalDeductions: breakdown.totalDeductions,
        totalBonuses: breakdown.bonuses,
        finalSalaryPaid: breakdown.finalSalary,
        paymentDate: new Date(),
        paidBy: currentUser.sub,
      },
    });

    await this.prisma.salaryDeductionSummary.create({
      data: {
        salaryPaymentId: item.id,
        userId: dto.userId,
        campusId: dto.campusId,
        month: dto.month,
        year: dto.year,
        absenceDeduction: breakdown.absenceDeduction,
        lateDeduction: breakdown.lateDeduction,
        halfDayDeduction: breakdown.halfDayDeduction,
        leaveDeduction: breakdown.leaveDeduction,
        manualDeductions: breakdown.manualDeductions,
        bonuses: breakdown.bonuses,
        totalDeductions: breakdown.totalDeductions,
        finalSalaryPaid: breakdown.finalSalary,
      },
    });

    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.FINANCE,
      entityType: CustomFieldEntity.SALARY_PAYMENT,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.SALARY_PAYMENT,
    );
    return { message: 'Salary paid successfully', data };
  }

  async previewSalary(
    query: SalaryPayrollPreviewQueryDto,
    currentUser: CurrentUser,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      query.campusId,
    );
    const salary = await this.prisma.staffSalary.findUnique({
      where: { id: query.salaryId },
    });
    if (!salary) throw new NotFoundException('Salary record not found.');
    if (salary.campusId !== query.campusId || salary.userId !== query.userId) {
      throw new ForbiddenException(
        'Salary preview must match the selected salary record and campus.',
      );
    }

    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        query.campusId,
      );
    const breakdown = await this.buildPayrollBreakdown(
      query.userId,
      query.campusId,
      salary.role,
      query.month,
      query.year,
      Number(salary.baseSalary),
      institutionId,
    );

    return {
      message: 'Salary payment preview computed successfully',
      data: breakdown,
    };
  }

  async listSalaryPayments(
    currentUser: CurrentUser,
    campusId?: string,
    userId?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const campusIds = await this.campusAccessService.getScopedCampusIds(
      currentUser,
      campusId,
    );
    const items = await this.prisma.salaryPayment.findMany({
      where: {
        ...(currentUser.role === UserRole.SUPERADMIN && !campusId
          ? {}
          : { campusId: { in: campusIds } }),
        ...(userId ? { userId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.SALARY_PAYMENT,
    );
    return { message: 'Salary payments retrieved successfully', data };
  }

  async getSalaryPayment(currentUser: CurrentUser, paymentId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const item = await this.prisma.salaryPayment.findUnique({
      where: { id: paymentId },
    });

    if (!item) {
      throw new NotFoundException('Salary payment not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      item.campusId,
    );
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.SALARY_PAYMENT,
    );
    return { message: 'Salary payment retrieved successfully', data };
  }

  async deleteSalaryPayment(
    currentUser: CurrentUser,
    paymentId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const existing = await this.prisma.salaryPayment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        salaryId: true,
        userId: true,
        campusId: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Salary payment not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      existing.campusId,
    );
    const softDeleteData = {
      deletedAt: new Date(),
      deletedBy: currentUser.sub,
      deleteReason: reason ?? null,
      updatedBy: currentUser.sub,
    };
    await this.prisma.salaryDeductionSummary.updateMany({
      where: { salaryPaymentId: paymentId },
      data: softDeleteData,
    });
    await this.prisma.salaryPayment.update({
      where: { id: paymentId },
      data: softDeleteData,
    });

    return {
      message: 'Salary payment moved to recycle bin successfully',
      data: existing,
    };
  }

  async createBankAccount(currentUser: CurrentUser, dto: CreateBankAccountDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    const { customFields, ...bankData } = dto;
    const item = await this.prisma.bankAccount.create({ data: bankData });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        dto.campusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.FINANCE,
      entityType: CustomFieldEntity.BANK_ACCOUNT,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.BANK_ACCOUNT,
    );
    return { message: 'Bank account created successfully', data };
  }

  async listBankAccounts(currentUser: CurrentUser, campusId?: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const campusIds = await this.campusAccessService.getScopedCampusIds(
      currentUser,
      campusId,
    );
    const items = await this.prisma.bankAccount.findMany({
      where:
        currentUser.role === UserRole.SUPERADMIN && !campusId
          ? undefined
          : { campusId: { in: campusIds } },
      orderBy: { createdAt: 'desc' },
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.BANK_ACCOUNT,
    );
    return { message: 'Bank accounts retrieved successfully', data };
  }

  async getBankAccount(currentUser: CurrentUser, bankAccountId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );

    const item = await this.prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
    });

    if (!item) {
      throw new NotFoundException('Bank account not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      item.campusId,
    );
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.BANK_ACCOUNT,
    );
    return { message: 'Bank account retrieved successfully', data };
  }

  async updateBankAccount(
    currentUser: CurrentUser,
    bankAccountId: string,
    dto: UpdateBankAccountDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );

    const existing = await this.prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
    });

    if (!existing) {
      throw new NotFoundException('Bank account not found.');
    }

    const targetCampusId = dto.campusId ?? existing.campusId;
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      existing.campusId,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      targetCampusId,
    );

    const { customFields, ...bankData } = dto;
    const item = await this.prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: bankData,
    });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        targetCampusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.FINANCE,
      entityType: CustomFieldEntity.BANK_ACCOUNT,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.BANK_ACCOUNT,
    );
    return { message: 'Bank account updated successfully', data };
  }

  async deleteBankAccount(
    currentUser: CurrentUser,
    bankAccountId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );

    const existing = await this.prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
      select: {
        id: true,
        campusId: true,
        accountTitle: true,
        bankName: true,
        accountNumber: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Bank account not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      existing.campusId,
    );
    await this.prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    return {
      message: 'Bank account moved to recycle bin successfully',
      data: existing,
    };
  }

  async createFeeStructure(
    currentUser: CurrentUser,
    dto: CreateFeeStructureDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    const classCampusId = await this.campusAccessService.assertClassAccess(
      currentUser,
      dto.classId,
    );
    this.assertSameCampus(dto.campusId, classCampusId, 'class');
    const existingStructure = await this.prisma.feeStructure.findFirst({
      where: {
        classId: dto.classId,
        campusId: dto.campusId,
      },
    });

    if (existingStructure) {
      throw new ConflictException(
        'A fee structure already exists for this class and campus.',
      );
    }
    const { customFields, ...structureData } = dto;
    const item = await this.prisma.feeStructure.create({
      data: {
        classId: structureData.classId,
        campusId: structureData.campusId,
        feeBreakdown: structureData.feeBreakdown,
      },
    });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        dto.campusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.FINANCE,
      entityType: CustomFieldEntity.FEE_STRUCTURE,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.FEE_STRUCTURE,
    );
    return { message: 'Fee structure created successfully', data };
  }

  async listFeeStructures(
    currentUser: CurrentUser,
    campusId?: string,
    classId?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    if (classId) {
      await this.campusAccessService.assertClassAccess(currentUser, classId);
    }
    const campusIds = await this.campusAccessService.getScopedCampusIds(
      currentUser,
      campusId,
    );
    const items = await this.prisma.feeStructure.findMany({
      where: {
        ...(currentUser.role === UserRole.SUPERADMIN && !campusId
          ? {}
          : { campusId: { in: campusIds } }),
        ...(classId ? { classId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.FEE_STRUCTURE,
    );
    return { message: 'Fee structures retrieved successfully', data };
  }

  async getFeeStructure(currentUser: CurrentUser, feeStructureId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );

    const item = await this.prisma.feeStructure.findUnique({
      where: { id: feeStructureId },
    });

    if (!item) {
      throw new NotFoundException('Fee structure not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      item.campusId,
    );
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.FEE_STRUCTURE,
    );
    return { message: 'Fee structure retrieved successfully', data };
  }

  async updateFeeStructure(
    currentUser: CurrentUser,
    feeStructureId: string,
    dto: UpdateFeeStructureDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );

    const existing = await this.prisma.feeStructure.findUnique({
      where: { id: feeStructureId },
    });

    if (!existing) {
      throw new NotFoundException('Fee structure not found.');
    }

    const targetCampusId = dto.campusId ?? existing.campusId;
    const targetClassId = dto.classId ?? existing.classId;
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      existing.campusId,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      targetCampusId,
    );
    const classCampusId = await this.campusAccessService.assertClassAccess(
      currentUser,
      targetClassId,
    );
    this.assertSameCampus(targetCampusId, classCampusId, 'class');

    const { customFields, ...structureData } = dto;
    const item = await this.prisma.feeStructure.update({
      where: { id: feeStructureId },
      data: structureData,
    });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        targetCampusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.FINANCE,
      entityType: CustomFieldEntity.FEE_STRUCTURE,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.FEE_STRUCTURE,
    );
    return { message: 'Fee structure updated successfully', data };
  }

  async deleteFeeStructure(
    currentUser: CurrentUser,
    feeStructureId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );

    const existing = await this.prisma.feeStructure.findUnique({
      where: { id: feeStructureId },
      select: {
        id: true,
        campusId: true,
        classId: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Fee structure not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      existing.campusId,
    );
    await this.prisma.feeStructure.update({
      where: { id: feeStructureId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    return {
      message: 'Fee structure moved to recycle bin successfully',
      data: existing,
    };
  }

  async createStudentDiscount(
    dto: CreateStudentDiscountDto,
    currentUser: CurrentUser,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    await this.campusAccessService.assertStudentAccess(
      currentUser,
      dto.studentId,
    );
    const { customFields, ...discountData } = dto;
    const item = await this.prisma.studentDiscount.create({
      data: {
        ...discountData,
        approvedBy: currentUser.sub,
      },
    });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByStudent(
        dto.studentId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.FINANCE,
      entityType: CustomFieldEntity.STUDENT_DISCOUNT,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.STUDENT_DISCOUNT,
    );
    return { message: 'Student discount created successfully', data };
  }

  async listStudentDiscounts(
    currentUser: CurrentUser,
    campusId?: string,
    studentId?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    if (studentId) {
      await this.campusAccessService.assertStudentAccess(
        currentUser,
        studentId,
      );
    }
    const campusIds = await this.campusAccessService.getScopedCampusIds(
      currentUser,
      campusId,
    );
    const items = await this.prisma.studentDiscount.findMany({
      where: {
        ...(studentId ? { studentId } : {}),
        ...(currentUser.role === UserRole.SUPERADMIN && !campusId
          ? {}
          : { student: { campusId: { in: campusIds } } }),
      },
      orderBy: { createdAt: 'desc' },
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.STUDENT_DISCOUNT,
    );
    return { message: 'Student discounts retrieved successfully', data };
  }

  async getStudentDiscount(currentUser: CurrentUser, discountId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const item = await this.prisma.studentDiscount.findUnique({
      where: { id: discountId },
    });

    if (!item) {
      throw new NotFoundException('Student discount not found.');
    }

    await this.campusAccessService.assertStudentAccess(
      currentUser,
      item.studentId,
    );
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.STUDENT_DISCOUNT,
    );
    return { message: 'Student discount retrieved successfully', data };
  }

  async deleteStudentDiscount(
    currentUser: CurrentUser,
    discountId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const existing = await this.prisma.studentDiscount.findUnique({
      where: { id: discountId },
      select: {
        id: true,
        studentId: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Student discount not found.');
    }

    await this.campusAccessService.assertStudentAccess(
      currentUser,
      existing.studentId,
    );
    await this.prisma.studentDiscount.update({
      where: { id: discountId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    return {
      message: 'Student discount moved to recycle bin successfully',
      data: existing,
    };
  }

  async createStudentFineRule(
    currentUser: CurrentUser,
    dto: CreateStudentFineRuleDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    if (dto.classId) {
      const classCampusId = await this.campusAccessService.assertClassAccess(
        currentUser,
        dto.classId,
      );
      this.assertSameCampus(dto.campusId, classCampusId, 'class');
    }
    const { customFields, ...fineRuleData } = dto;
    const item = await this.prisma.studentFineRule.create({
      data: fineRuleData,
    });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        dto.campusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.FINANCE,
      entityType: CustomFieldEntity.STUDENT_FINE_RULE,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.STUDENT_FINE_RULE,
    );
    return { message: 'Student fine rule created successfully', data };
  }

  async listStudentFineRules(
    currentUser: CurrentUser,
    campusId?: string,
    classId?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    if (classId) {
      await this.campusAccessService.assertClassAccess(currentUser, classId);
    }
    const campusIds = await this.campusAccessService.getScopedCampusIds(
      currentUser,
      campusId,
    );
    const items = await this.prisma.studentFineRule.findMany({
      where: {
        ...(currentUser.role === UserRole.SUPERADMIN && !campusId
          ? {}
          : { campusId: { in: campusIds } }),
        ...(classId ? { classId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.STUDENT_FINE_RULE,
    );
    return { message: 'Student fine rules retrieved successfully', data };
  }

  async getStudentFineRule(currentUser: CurrentUser, fineRuleId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const item = await this.prisma.studentFineRule.findUnique({
      where: { id: fineRuleId },
    });

    if (!item) {
      throw new NotFoundException('Student fine rule not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      item.campusId,
    );
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.STUDENT_FINE_RULE,
    );
    return { message: 'Student fine rule retrieved successfully', data };
  }

  async deleteStudentFineRule(
    currentUser: CurrentUser,
    fineRuleId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const existing = await this.prisma.studentFineRule.findUnique({
      where: { id: fineRuleId },
      select: {
        id: true,
        campusId: true,
        classId: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Student fine rule not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      existing.campusId,
    );
    await this.prisma.studentFineRule.update({
      where: { id: fineRuleId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    return {
      message: 'Student fine rule moved to recycle bin successfully',
      data: existing,
    };
  }

  async createStudentFine(currentUser: CurrentUser, dto: CreateStudentFineDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    const studentCampusId = await this.campusAccessService.assertStudentAccess(
      currentUser,
      dto.studentId,
    );
    this.assertSameCampus(dto.campusId, studentCampusId, 'student');
    const existingFine = await this.prisma.studentFine.findFirst({
      where: {
        studentId: dto.studentId,
        campusId: dto.campusId,
        month: dto.month,
        year: dto.year,
      },
    });

    if (existingFine) {
      throw new ConflictException(
        'A student fine already exists for this student and billing period.',
      );
    }
    const { customFields, ...fineData } = dto;
    const item = await this.prisma.studentFine.create({
      data: {
        ...fineData,
        fineStatus: 'PENDING',
      },
    });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        dto.campusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.FINANCE,
      entityType: CustomFieldEntity.STUDENT_FINE,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.STUDENT_FINE,
    );
    return { message: 'Student fine created successfully', data };
  }

  async listStudentFines(
    currentUser: CurrentUser,
    campusId?: string,
    studentId?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    if (studentId) {
      await this.campusAccessService.assertStudentAccess(
        currentUser,
        studentId,
      );
    }
    const campusIds = await this.campusAccessService.getScopedCampusIds(
      currentUser,
      campusId,
    );
    const items = await this.prisma.studentFine.findMany({
      where: {
        ...(currentUser.role === UserRole.SUPERADMIN && !campusId
          ? {}
          : { campusId: { in: campusIds } }),
        ...(studentId ? { studentId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.STUDENT_FINE,
    );
    return { message: 'Student fines retrieved successfully', data };
  }

  async getStudentFine(currentUser: CurrentUser, fineId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const item = await this.prisma.studentFine.findUnique({
      where: { id: fineId },
    });

    if (!item) {
      throw new NotFoundException('Student fine not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      item.campusId,
    );
    await this.campusAccessService.assertStudentAccess(
      currentUser,
      item.studentId,
    );
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.STUDENT_FINE,
    );
    return { message: 'Student fine retrieved successfully', data };
  }

  async deleteStudentFine(
    currentUser: CurrentUser,
    fineId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const existing = await this.prisma.studentFine.findUnique({
      where: { id: fineId },
      select: {
        id: true,
        studentId: true,
        campusId: true,
        month: true,
        year: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Student fine not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      existing.campusId,
    );
    await this.campusAccessService.assertStudentAccess(
      currentUser,
      existing.studentId,
    );
    await this.prisma.studentFine.update({
      where: { id: fineId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    return {
      message: 'Student fine moved to recycle bin successfully',
      data: existing,
    };
  }

  async createFeeVoucher(currentUser: CurrentUser, dto: CreateFeeVoucherDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const student = await this.prisma.student.findUnique({
      where: { id: dto.studentId },
    });
    if (!student) throw new NotFoundException('Student not found.');
    const structure = await this.prisma.feeStructure.findUnique({
      where: { id: dto.feeStructureId },
    });
    if (!structure) throw new NotFoundException('Fee structure not found.');
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      student.campusId,
    );
    await this.campusAccessService.assertStudentAccess(
      currentUser,
      dto.studentId,
    );
    const structureCampusId =
      await this.entityCustomFieldsService.resolveInstitutionIdByFeeStructure(
        dto.feeStructureId,
      );
    const studentInstitutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByStudent(
        dto.studentId,
      );
    if (studentInstitutionId !== structureCampusId) {
      throw new ForbiddenException(
        'Student and fee structure must belong to the same institution.',
      );
    }
    this.assertSameCampus(
      student.campusId,
      structure.campusId,
      'fee structure',
    );
    const existingVoucher = await this.prisma.feeVoucher.findFirst({
      where: {
        studentId: dto.studentId,
        month: dto.month,
        year: dto.year,
      },
    });

    if (existingVoucher) {
      throw new ConflictException(
        'A fee voucher already exists for this student and billing period.',
      );
    }

    const discount = await this.prisma.studentDiscount.findFirst({
      where: { studentId: dto.studentId },
      orderBy: { createdAt: 'desc' },
    });
    const fine = await this.prisma.studentFine.findFirst({
      where: { studentId: dto.studentId, month: dto.month, year: dto.year },
      orderBy: { createdAt: 'desc' },
    });
    const breakdown = structure.feeBreakdown as Record<string, number>;
    const total = Object.values(breakdown).reduce(
      (sum, value) => sum + Number(value),
      0,
    );
    const discountAmount = Number(discount?.discountAmount ?? 0);
    const fineAmount = Number(fine?.totalFineAmount ?? 0);
    const lateFeeFine = Number(dto.lateFeeFine ?? 0);
    const { customFields, ...voucherData } = dto;
    const item = await this.prisma.feeVoucher.create({
      data: {
        studentId: voucherData.studentId,
        feeStructureId: voucherData.feeStructureId,
        month: voucherData.month,
        year: voucherData.year,
        feeBreakdown: breakdown,
        discountAmount,
        fineAmount,
        lateFeeFine,
        finalAmountDue: total - discountAmount + fineAmount + lateFeeFine,
        bankId: voucherData.bankId,
        dueDate: new Date(voucherData.dueDate),
      },
    });
    const institutionId = studentInstitutionId;
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.FINANCE,
      entityType: CustomFieldEntity.FEE_VOUCHER,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.FEE_VOUCHER,
    );
    return { message: 'Fee voucher created successfully', data };
  }

  async listFeeVouchers(
    currentUser: CurrentUser,
    campusId?: string,
    studentId?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    if (studentId) {
      await this.campusAccessService.assertStudentAccess(
        currentUser,
        studentId,
      );
    }
    const campusIds = await this.campusAccessService.getScopedCampusIds(
      currentUser,
      campusId,
    );
    const items = await this.prisma.feeVoucher.findMany({
      where: {
        ...(studentId ? { studentId } : {}),
        ...(currentUser.role === UserRole.SUPERADMIN && !campusId
          ? {}
          : { student: { campusId: { in: campusIds } } }),
      },
      orderBy: { createdAt: 'desc' },
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.FEE_VOUCHER,
    );
    return { message: 'Fee vouchers retrieved successfully', data };
  }

  async getFeeVoucher(currentUser: CurrentUser, voucherId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );

    const item = await this.prisma.feeVoucher.findUnique({
      where: { id: voucherId },
      include: {
        student: {
          select: {
            campusId: true,
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('Fee voucher not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      item.student.campusId,
    );
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.FEE_VOUCHER,
    );
    return { message: 'Fee voucher retrieved successfully', data };
  }

  async updateFeeVoucher(
    currentUser: CurrentUser,
    voucherId: string,
    dto: UpdateFeeVoucherDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );

    const existing = await this.prisma.feeVoucher.findUnique({
      where: { id: voucherId },
      include: {
        student: true,
        feeStructure: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Fee voucher not found.');
    }

    const studentId = dto.studentId ?? existing.studentId;
    const feeStructureId = dto.feeStructureId ?? existing.feeStructureId;
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
    });
    if (!student) {
      throw new NotFoundException('Student not found.');
    }
    const structure = await this.prisma.feeStructure.findUnique({
      where: { id: feeStructureId },
    });
    if (!structure) {
      throw new NotFoundException('Fee structure not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      existing.student.campusId,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      student.campusId,
    );
    await this.campusAccessService.assertStudentAccess(currentUser, studentId);

    const structureInstitutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByFeeStructure(
        feeStructureId,
      );
    const studentInstitutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByStudent(
        studentId,
      );
    if (studentInstitutionId !== structureInstitutionId) {
      throw new ForbiddenException(
        'Student and fee structure must belong to the same institution.',
      );
    }
    this.assertSameCampus(
      student.campusId,
      structure.campusId,
      'fee structure',
    );

    const discount = await this.prisma.studentDiscount.findFirst({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
    });
    const targetMonth = dto.month ?? existing.month;
    const targetYear = dto.year ?? existing.year;
    const fine = await this.prisma.studentFine.findFirst({
      where: { studentId, month: targetMonth, year: targetYear },
      orderBy: { createdAt: 'desc' },
    });
    const breakdown = structure.feeBreakdown as Record<string, number>;
    const total = Object.values(breakdown).reduce(
      (sum, value) => sum + Number(value),
      0,
    );
    const discountAmount = Number(discount?.discountAmount ?? 0);
    const fineAmount = Number(fine?.totalFineAmount ?? 0);
    const lateFeeFine = Number(dto.lateFeeFine ?? existing.lateFeeFine ?? 0);

    const { customFields, dueDate, ...voucherData } = dto;
    const item = await this.prisma.feeVoucher.update({
      where: { id: voucherId },
      data: {
        ...voucherData,
        feeBreakdown: breakdown,
        discountAmount,
        fineAmount,
        lateFeeFine,
        finalAmountDue: total - discountAmount + fineAmount + lateFeeFine,
        ...(dueDate ? { dueDate: new Date(dueDate) } : {}),
      },
    });
    await this.entityCustomFieldsService.saveValues({
      institutionId: studentInstitutionId,
      moduleKey: ModuleKey.FINANCE,
      entityType: CustomFieldEntity.FEE_VOUCHER,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.FEE_VOUCHER,
    );
    return { message: 'Fee voucher updated successfully', data };
  }

  async deleteFeeVoucher(
    currentUser: CurrentUser,
    voucherId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );

    const existing = await this.prisma.feeVoucher.findUnique({
      where: { id: voucherId },
      select: {
        id: true,
        studentId: true,
        feeStructureId: true,
        month: true,
        year: true,
        student: {
          select: {
            campusId: true,
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Fee voucher not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      existing.student.campusId,
    );
    await this.campusAccessService.assertStudentAccess(
      currentUser,
      existing.studentId,
    );
    await this.prisma.feeVoucher.update({
      where: { id: voucherId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    return {
      message: 'Fee voucher moved to recycle bin successfully',
      data: {
        id: existing.id,
        studentId: existing.studentId,
        feeStructureId: existing.feeStructureId,
        month: existing.month,
        year: existing.year,
      },
    };
  }

  async createFeePayment(dto: CreateFeePaymentDto, currentUser: CurrentUser) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const voucher = await this.prisma.feeVoucher.findUnique({
      where: { id: dto.voucherId },
      select: {
        id: true,
        month: true,
        year: true,
        student: {
          select: {
            campusId: true,
            campus: {
              select: {
                institutionId: true,
              },
            },
          },
        },
      },
    });
    if (!voucher) {
      throw new NotFoundException('Fee voucher not found.');
    }
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      voucher.student.campusId,
    );
    if (dto.month !== voucher.month || dto.year !== voucher.year) {
      throw new ForbiddenException(
        'Fee payment month and year must match the selected voucher.',
      );
    }

    const { customFields, ...paymentData } = dto;
    const item = await this.prisma.feePayment.create({
      data: {
        voucherId: paymentData.voucherId,
        month: paymentData.month,
        year: paymentData.year,
        paidAmount: paymentData.paidAmount,
        paymentMethod: paymentData.paymentMethod,
        paymentDate: new Date(paymentData.paymentDate),
        receivedBy: currentUser.sub,
      },
    });
    await this.prisma.feeVoucher.update({
      where: { id: dto.voucherId },
      data: { status: 'PAID' },
    });
    const institutionId = voucher?.student.campus.institutionId;
    if (!institutionId) {
      throw new NotFoundException('Institution not found for fee payment.');
    }
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.FINANCE,
      entityType: CustomFieldEntity.FEE_PAYMENT,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.FEE_PAYMENT,
    );
    return { message: 'Fee payment created successfully', data };
  }

  async listFeePayments(
    currentUser: CurrentUser,
    campusId?: string,
    voucherId?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    if (voucherId) {
      const voucher = await this.prisma.feeVoucher.findUnique({
        where: { id: voucherId },
        select: {
          student: {
            select: {
              campusId: true,
            },
          },
        },
      });

      if (!voucher) {
        throw new NotFoundException('Fee voucher not found.');
      }

      await this.campusAccessService.assertCampusAccess(
        currentUser,
        voucher.student.campusId,
      );
    }
    const campusIds = await this.campusAccessService.getScopedCampusIds(
      currentUser,
      campusId,
    );
    const items = await this.prisma.feePayment.findMany({
      where: {
        ...(voucherId ? { voucherId } : {}),
        ...(currentUser.role === UserRole.SUPERADMIN && !campusId
          ? {}
          : { voucher: { student: { campusId: { in: campusIds } } } }),
      },
      orderBy: { createdAt: 'desc' },
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.FEE_PAYMENT,
    );
    return { message: 'Fee payments retrieved successfully', data };
  }

  async getFeePayment(currentUser: CurrentUser, paymentId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const item = await this.prisma.feePayment.findUnique({
      where: { id: paymentId },
      include: {
        voucher: {
          select: {
            student: {
              select: {
                campusId: true,
              },
            },
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('Fee payment not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      item.voucher.student.campusId,
    );
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.FEE_PAYMENT,
    );
    return { message: 'Fee payment retrieved successfully', data };
  }

  async deleteFeePayment(
    currentUser: CurrentUser,
    paymentId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    const existing = await this.prisma.feePayment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        voucherId: true,
        month: true,
        year: true,
        voucher: {
          select: {
            student: {
              select: {
                campusId: true,
              },
            },
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Fee payment not found.');
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      existing.voucher.student.campusId,
    );
    await this.prisma.feePayment.update({
      where: { id: paymentId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });
    const remainingPayment = await this.prisma.feePayment.findFirst({
      where: { voucherId: existing.voucherId },
    });
    if (!remainingPayment) {
      await this.prisma.feeVoucher.update({
        where: { id: existing.voucherId },
        data: { status: 'PENDING' },
      });
    }

    return {
      message: 'Fee payment moved to recycle bin successfully',
      data: {
        id: existing.id,
        voucherId: existing.voucherId,
        month: existing.month,
        year: existing.year,
      },
    };
  }

  private async assertSalaryAccess(
    salaryId: string,
    campusId: string,
    userId: string,
  ) {
    const salary = await this.prisma.staffSalary.findUnique({
      where: { id: salaryId },
      select: {
        campusId: true,
        userId: true,
      },
    });

    if (!salary) {
      throw new NotFoundException('Salary record not found.');
    }

    if (salary.campusId !== campusId || salary.userId !== userId) {
      throw new ForbiddenException(
        'Salary record does not belong to the selected user and campus.',
      );
    }
  }

  private async resolvePerDayBasis(institutionId: string) {
    const setting = await this.prisma.institutionSetting.findUnique({
      where: {
        institutionId_key_activeScopeKey: {
          institutionId,
          key: 'payroll',
          activeScopeKey: 'ACTIVE',
        },
      },
      select: { value: true },
    });

    const value = setting?.value;
    const perDayBasis =
      value &&
      typeof value === 'object' &&
      'perDayBasis' in value &&
      typeof (value as { perDayBasis: unknown }).perDayBasis === 'number'
        ? (value as { perDayBasis: number }).perDayBasis
        : undefined;

    return perDayBasis && perDayBasis > 0
      ? perDayBasis
      : DEFAULT_PAYROLL_PER_DAY_BASIS;
  }

  /**
   * Computes the full payroll breakdown for a user/salary/period: real
   * attendance-based deductions from the campus+role SalaryDeductionRule
   * (only the excess over each allowed threshold is deducted, mirroring the
   * attendance module's own status/half-day counting convention) plus the
   * month-scoped bonus/manual-deduction adjustments. Shared by paySalary()
   * (which persists the result) and previewSalary() (which does not), so the
   * two can never drift apart.
   */
  private async buildPayrollBreakdown(
    userId: string,
    campusId: string,
    role: UserRole,
    month: number,
    year: number,
    baseSalary: number,
    institutionId: string,
  ): Promise<PayrollBreakdown> {
    const adjustments = await this.prisma.salaryAdjustment.findMany({
      where: { userId, campusId, month, year },
    });
    const bonuses = adjustments
      .filter((item) => item.adjustmentType === PrismaAdjustmentType.BONUS)
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const manualDeductions = adjustments
      .filter((item) => item.adjustmentType === PrismaAdjustmentType.DEDUCTION)
      .reduce((sum, item) => sum + Number(item.amount), 0);

    const rule = await this.prisma.salaryDeductionRule.findFirst({
      where: { campusId, role, deletedAt: null },
    });

    const perDayBasis = await this.resolvePerDayBasis(institutionId);
    const dailyRate = baseSalary / perDayBasis;

    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const periodEnd = new Date(Date.UTC(year, month, 1));
    const attendanceRecords = await this.prisma.attendance.findMany({
      where: {
        userId,
        campusId,
        date: { gte: periodStart, lt: periodEnd },
      },
      select: { status: true, halfDay: true },
    });

    const counts = attendanceRecords.reduce(
      (accumulator, item) => {
        if (item.status === PrismaAttendanceStatus.ABSENT) {
          accumulator.absentCount += 1;
        } else if (item.status === PrismaAttendanceStatus.LATE) {
          accumulator.lateCount += 1;
        } else if (item.status === PrismaAttendanceStatus.LEAVE) {
          accumulator.leaveCount += 1;
        }
        accumulator.halfDayCount += item.halfDay ? 1 : 0;
        return accumulator;
      },
      { absentCount: 0, lateCount: 0, halfDayCount: 0, leaveCount: 0 },
    );

    // No configured rule for this campus/role means the institution hasn't
    // opted into attendance-based deductions yet — leave them at zero
    // rather than guessing at thresholds.
    const excessDeduction = (count: number, allowed: number, percent: number) =>
      Math.max(0, count - allowed) * dailyRate * (percent / 100);

    const absenceDeduction = rule
      ? excessDeduction(
          counts.absentCount,
          rule.allowedAbsences,
          Number(rule.absenceDeductionPercent),
        )
      : 0;
    const lateDeduction = rule
      ? excessDeduction(
          counts.lateCount,
          rule.allowedLates,
          Number(rule.lateDeductionPercent),
        )
      : 0;
    const halfDayDeduction = rule
      ? excessDeduction(
          counts.halfDayCount,
          rule.allowedHalfDays,
          Number(rule.halfDayDeductionPercent),
        )
      : 0;
    const leaveDeduction = rule
      ? excessDeduction(
          counts.leaveCount,
          rule.allowedLeaves,
          Number(rule.leaveDeductionPercent),
        )
      : 0;

    const attendanceDeductions =
      absenceDeduction + lateDeduction + halfDayDeduction + leaveDeduction;
    const totalDeductions = manualDeductions + attendanceDeductions;
    const finalSalary = baseSalary + bonuses - totalDeductions;

    return {
      baseSalary,
      perDayBasis,
      dailyRate,
      bonuses,
      manualDeductions,
      absenceDeduction,
      lateDeduction,
      halfDayDeduction,
      leaveDeduction,
      totalDeductions,
      finalSalary,
      attendance: counts,
      rule: rule
        ? {
            allowedAbsences: rule.allowedAbsences,
            allowedLates: rule.allowedLates,
            allowedHalfDays: rule.allowedHalfDays,
            allowedLeaves: rule.allowedLeaves,
          }
        : null,
    };
  }

  private async resolveSalaryCampusId(salaryId: string) {
    const salary = await this.prisma.staffSalary.findUnique({
      where: { id: salaryId },
      select: { campusId: true },
    });

    if (!salary) {
      throw new NotFoundException('Salary record not found.');
    }

    return salary.campusId;
  }

  private assertSameCampus(
    expectedCampusId: string,
    actualCampusId: string,
    entityLabel: string,
  ) {
    if (expectedCampusId !== actualCampusId) {
      throw new ForbiddenException(
        `${entityLabel} must belong to the same campus as the selected record.`,
      );
    }
  }
}
