import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserDecorator } from '../../common/decorators/current-user.decorator';
import { DeleteRecordDto } from '../../common/dto/delete-record.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
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
import { FinanceService } from './finance.service';

@ApiTags('Finance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Post('salaries')
  @Version('1')
  @RequirePermission('salaries', 'create')
  @ApiOperation({
    summary: 'Create a salary record',
    description:
      'Creates a staff salary record for a campus-scoped user so payroll workflows can track base compensation.',
  })
  createSalary(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: CreateSalaryDto,
  ) {
    return this.financeService.createSalary(currentUser, dto);
  }

  @Get('salaries')
  @Version('1')
  @RequirePermission('salaries', 'read')
  @ApiOperation({
    summary: 'List salary records',
    description:
      'Returns salary records visible to the authenticated user, optionally filtered by campus.',
  })
  listSalaries(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query('campusId') campusId?: string,
  ) {
    return this.financeService.listSalaries(currentUser, campusId);
  }

  @Get('salaries/:salaryId')
  @Version('1')
  @RequirePermission('salaries', 'read')
  @ApiOperation({
    summary: 'Get a salary record',
    description:
      'Returns one salary record for payroll detail, edit, and audit-related screens.',
  })
  getSalary(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('salaryId') salaryId: string,
  ) {
    return this.financeService.getSalary(currentUser, salaryId);
  }

  @Patch('salaries/:salaryId')
  @Version('1')
  @RequirePermission('salaries', 'update')
  @ApiOperation({
    summary: 'Update a salary record',
    description:
      'Updates an existing staff salary record within the current institution and campus scope.',
  })
  updateSalary(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('salaryId') salaryId: string,
    @Body() dto: UpdateSalaryDto,
  ) {
    return this.financeService.updateSalary(currentUser, salaryId, dto);
  }

  @Delete('salaries/:salaryId')
  @Version('1')
  @RequirePermission('salaries', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a salary record',
    description:
      'Moves a salary record to the recycle bin instead of permanently deleting it immediately.',
  })
  deleteSalary(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('salaryId') salaryId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.financeService.deleteSalary(currentUser, salaryId, dto.reason);
  }

  @Post('salary-deduction-rules')
  @Version('1')
  @RequirePermission('salary_deduction_rules', 'create')
  @ApiOperation({
    summary: 'Create a salary deduction rule',
    description:
      'Creates a reusable payroll deduction rule for items such as tax, lateness, or penalties.',
  })
  createDeductionRule(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: CreateDeductionRuleDto,
  ) {
    return this.financeService.createDeductionRule(currentUser, dto);
  }

  @Get('salary-deduction-rules')
  @Version('1')
  @RequirePermission('salary_deduction_rules', 'read')
  @ApiOperation({
    summary: 'List salary deduction rules',
    description:
      'Returns salary deduction rules visible to the authenticated user, optionally filtered by campus.',
  })
  listDeductionRules(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query('campusId') campusId?: string,
  ) {
    return this.financeService.listDeductionRules(currentUser, campusId);
  }

  @Get('salary-deduction-rules/:ruleId')
  @Version('1')
  @RequirePermission('salary_deduction_rules', 'read')
  @ApiOperation({
    summary: 'Get a salary deduction rule',
    description:
      'Returns one salary deduction rule for payroll configuration and detail screens.',
  })
  getDeductionRule(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('ruleId') ruleId: string,
  ) {
    return this.financeService.getDeductionRule(currentUser, ruleId);
  }

  @Delete('salary-deduction-rules/:ruleId')
  @Version('1')
  @RequirePermission('salary_deduction_rules', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a salary deduction rule',
    description:
      'Moves a salary deduction rule to the recycle bin for reversible deletion.',
  })
  deleteDeductionRule(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('ruleId') ruleId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.financeService.deleteDeductionRule(
      currentUser,
      ruleId,
      dto.reason,
    );
  }

  @Post('salary-adjustments')
  @Version('1')
  @RequirePermission('salary_adjustments', 'create')
  @ApiOperation({
    summary: 'Create a salary adjustment',
    description:
      'Creates a one-time payroll adjustment such as a bonus, allowance, or deduction for a user.',
  })
  applyAdjustment(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: SalaryAdjustmentDto,
  ) {
    return this.financeService.applyAdjustment(dto, currentUser);
  }

  @Get('salary-adjustments')
  @Version('1')
  @RequirePermission('salary_adjustments', 'read')
  @ApiOperation({
    summary: 'List salary adjustments',
    description:
      'Returns salary adjustments visible to the authenticated user, optionally filtered by campus or user.',
  })
  listSalaryAdjustments(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query('campusId') campusId?: string,
    @Query('userId') userId?: string,
  ) {
    return this.financeService.listSalaryAdjustments(
      currentUser,
      campusId,
      userId,
    );
  }

  @Get('salary-adjustments/:adjustmentId')
  @Version('1')
  @RequirePermission('salary_adjustments', 'read')
  @ApiOperation({
    summary: 'Get a salary adjustment',
    description:
      'Returns one salary adjustment for payroll detail and audit review screens.',
  })
  getSalaryAdjustment(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('adjustmentId') adjustmentId: string,
  ) {
    return this.financeService.getSalaryAdjustment(currentUser, adjustmentId);
  }

  @Delete('salary-adjustments/:adjustmentId')
  @Version('1')
  @RequirePermission('salary_adjustments', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a salary adjustment',
    description:
      'Moves a salary adjustment to the recycle bin instead of permanently removing it immediately.',
  })
  deleteSalaryAdjustment(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('adjustmentId') adjustmentId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.financeService.deleteSalaryAdjustment(
      currentUser,
      adjustmentId,
      dto.reason,
    );
  }

  @Post('salary-payments')
  @Version('1')
  @RequirePermission('salary_payments', 'create')
  @ApiOperation({
    summary: 'Create a salary payment',
    description:
      'Records a salary payment transaction for a user, including the campus-scoped payroll context.',
  })
  paySalary(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: SalaryPaymentDto,
  ) {
    return this.financeService.paySalary(dto, currentUser);
  }

  @Get('salary-payments')
  @Version('1')
  @RequirePermission('salary_payments', 'read')
  @ApiOperation({
    summary: 'List salary payments',
    description:
      'Returns salary payments visible to the authenticated user, optionally filtered by campus or user.',
  })
  listSalaryPayments(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query('campusId') campusId?: string,
    @Query('userId') userId?: string,
  ) {
    return this.financeService.listSalaryPayments(
      currentUser,
      campusId,
      userId,
    );
  }

  @Get('salary-payments/preview')
  @Version('1')
  @RequirePermission('salary_payments', 'read')
  @ApiOperation({
    summary: 'Preview a salary payment before committing it',
    description:
      'Computes the same base salary, bonus, manual-deduction, and attendance-based deduction breakdown that paying this payroll period would produce, without creating a payment record.',
  })
  previewSalary(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: SalaryPayrollPreviewQueryDto,
  ) {
    return this.financeService.previewSalary(query, currentUser);
  }

  @Get('salary-payments/:paymentId')
  @Version('1')
  @RequirePermission('salary_payments', 'read')
  @ApiOperation({
    summary: 'Get a salary payment',
    description:
      'Returns one salary payment record for payroll history, reconciliation, and detail screens.',
  })
  getSalaryPayment(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('paymentId') paymentId: string,
  ) {
    return this.financeService.getSalaryPayment(currentUser, paymentId);
  }

  @Delete('salary-payments/:paymentId')
  @Version('1')
  @RequirePermission('salary_payments', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a salary payment',
    description:
      'Moves a salary payment to the recycle bin for reversible cleanup and audit retention.',
  })
  deleteSalaryPayment(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('paymentId') paymentId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.financeService.deleteSalaryPayment(
      currentUser,
      paymentId,
      dto.reason,
    );
  }

  @Post('bank-accounts')
  @Version('1')
  @RequirePermission('bank_accounts', 'create')
  @ApiOperation({
    summary: 'Create a bank account',
    description:
      'Creates a campus-scoped bank account record that can be used in finance and payout workflows.',
  })
  createBankAccount(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: CreateBankAccountDto,
  ) {
    return this.financeService.createBankAccount(currentUser, dto);
  }

  @Get('bank-accounts')
  @Version('1')
  @RequirePermission('bank_accounts', 'read')
  @ApiOperation({
    summary: 'List bank accounts',
    description:
      'Returns bank accounts visible to the authenticated user, optionally filtered by campus.',
  })
  listBankAccounts(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query('campusId') campusId?: string,
  ) {
    return this.financeService.listBankAccounts(currentUser, campusId);
  }

  @Get('bank-accounts/:bankAccountId')
  @Version('1')
  @RequirePermission('bank_accounts', 'read')
  @ApiOperation({
    summary: 'Get a bank account',
    description:
      'Returns one bank account record for finance detail and configuration screens.',
  })
  getBankAccount(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('bankAccountId') bankAccountId: string,
  ) {
    return this.financeService.getBankAccount(currentUser, bankAccountId);
  }

  @Patch('bank-accounts/:bankAccountId')
  @Version('1')
  @RequirePermission('bank_accounts', 'update')
  @ApiOperation({
    summary: 'Update a bank account',
    description:
      'Updates a campus-scoped bank account used by fee and payroll related flows.',
  })
  updateBankAccount(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('bankAccountId') bankAccountId: string,
    @Body() dto: UpdateBankAccountDto,
  ) {
    return this.financeService.updateBankAccount(
      currentUser,
      bankAccountId,
      dto,
    );
  }

  @Delete('bank-accounts/:bankAccountId')
  @Version('1')
  @RequirePermission('bank_accounts', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a bank account',
    description:
      'Moves a bank account to the recycle bin instead of permanently deleting it immediately.',
  })
  deleteBankAccount(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('bankAccountId') bankAccountId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.financeService.deleteBankAccount(
      currentUser,
      bankAccountId,
      dto.reason,
    );
  }

  @Post('fee-structures')
  @Version('1')
  @RequirePermission('fee_structures', 'create')
  @ApiOperation({
    summary: 'Create a fee structure',
    description:
      'Creates a fee structure for a campus or class so frontend fee setup screens can manage billing definitions.',
  })
  createFeeStructure(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: CreateFeeStructureDto,
  ) {
    return this.financeService.createFeeStructure(currentUser, dto);
  }

  @Get('fee-structures')
  @Version('1')
  @RequirePermission('fee_structures', 'read')
  @ApiOperation({
    summary: 'List fee structures',
    description:
      'Returns fee structures visible to the authenticated user, optionally filtered by campus or class.',
  })
  listFeeStructures(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query('campusId') campusId?: string,
    @Query('classId') classId?: string,
  ) {
    return this.financeService.listFeeStructures(
      currentUser,
      campusId,
      classId,
    );
  }

  @Get('fee-structures/:feeStructureId')
  @Version('1')
  @RequirePermission('fee_structures', 'read')
  @ApiOperation({
    summary: 'Get a fee structure',
    description:
      'Returns one fee structure for fee configuration and detail screens.',
  })
  getFeeStructure(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('feeStructureId') feeStructureId: string,
  ) {
    return this.financeService.getFeeStructure(currentUser, feeStructureId);
  }

  @Patch('fee-structures/:feeStructureId')
  @Version('1')
  @RequirePermission('fee_structures', 'update')
  @ApiOperation({
    summary: 'Update a fee structure',
    description:
      'Updates an existing fee structure within the authenticated user scope.',
  })
  updateFeeStructure(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('feeStructureId') feeStructureId: string,
    @Body() dto: UpdateFeeStructureDto,
  ) {
    return this.financeService.updateFeeStructure(
      currentUser,
      feeStructureId,
      dto,
    );
  }

  @Delete('fee-structures/:feeStructureId')
  @Version('1')
  @RequirePermission('fee_structures', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a fee structure',
    description:
      'Moves a fee structure to the recycle bin for reversible deletion.',
  })
  deleteFeeStructure(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('feeStructureId') feeStructureId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.financeService.deleteFeeStructure(
      currentUser,
      feeStructureId,
      dto.reason,
    );
  }

  @Post('student-discounts')
  @Version('1')
  @RequirePermission('student_discounts', 'create')
  @ApiOperation({
    summary: 'Create a student discount',
    description:
      'Creates a student-specific discount that can be applied during voucher and fee calculation flows.',
  })
  createStudentDiscount(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: CreateStudentDiscountDto,
  ) {
    return this.financeService.createStudentDiscount(dto, currentUser);
  }

  @Get('student-discounts')
  @Version('1')
  @RequirePermission('student_discounts', 'read')
  @ApiOperation({
    summary: 'List student discounts',
    description:
      'Returns student discounts visible to the authenticated user, optionally filtered by campus or student.',
  })
  listStudentDiscounts(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query('campusId') campusId?: string,
    @Query('studentId') studentId?: string,
  ) {
    return this.financeService.listStudentDiscounts(
      currentUser,
      campusId,
      studentId,
    );
  }

  @Get('student-discounts/:discountId')
  @Version('1')
  @RequirePermission('student_discounts', 'read')
  @ApiOperation({
    summary: 'Get a student discount',
    description:
      'Returns one student discount for detail, edit, or fee preview screens.',
  })
  getStudentDiscount(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('discountId') discountId: string,
  ) {
    return this.financeService.getStudentDiscount(currentUser, discountId);
  }

  @Delete('student-discounts/:discountId')
  @Version('1')
  @RequirePermission('student_discounts', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a student discount',
    description:
      'Moves a student discount to the recycle bin so it can be restored later if needed.',
  })
  deleteStudentDiscount(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('discountId') discountId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.financeService.deleteStudentDiscount(
      currentUser,
      discountId,
      dto.reason,
    );
  }

  @Post('student-fine-rules')
  @Version('1')
  @RequirePermission('student_fine_rules', 'create')
  @ApiOperation({
    summary: 'Create a student fine rule',
    description:
      'Creates a reusable fine rule for finance and discipline-related billing flows.',
  })
  createStudentFineRule(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: CreateStudentFineRuleDto,
  ) {
    return this.financeService.createStudentFineRule(currentUser, dto);
  }

  @Get('student-fine-rules')
  @Version('1')
  @RequirePermission('student_fine_rules', 'read')
  @ApiOperation({
    summary: 'List student fine rules',
    description:
      'Returns student fine rules visible to the authenticated user, optionally filtered by campus or class.',
  })
  listStudentFineRules(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query('campusId') campusId?: string,
    @Query('classId') classId?: string,
  ) {
    return this.financeService.listStudentFineRules(
      currentUser,
      campusId,
      classId,
    );
  }

  @Get('student-fine-rules/:fineRuleId')
  @Version('1')
  @RequirePermission('student_fine_rules', 'read')
  @ApiOperation({
    summary: 'Get a student fine rule',
    description:
      'Returns one student fine rule for finance configuration and detail screens.',
  })
  getStudentFineRule(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('fineRuleId') fineRuleId: string,
  ) {
    return this.financeService.getStudentFineRule(currentUser, fineRuleId);
  }

  @Delete('student-fine-rules/:fineRuleId')
  @Version('1')
  @RequirePermission('student_fine_rules', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a student fine rule',
    description:
      'Moves a student fine rule to the recycle bin instead of permanently deleting it immediately.',
  })
  deleteStudentFineRule(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('fineRuleId') fineRuleId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.financeService.deleteStudentFineRule(
      currentUser,
      fineRuleId,
      dto.reason,
    );
  }

  @Post('student-fines')
  @Version('1')
  @RequirePermission('student_fines', 'create')
  @ApiOperation({
    summary: 'Create a student fine',
    description:
      'Creates a student fine entry that can later appear in voucher, billing, and payment flows.',
  })
  createStudentFine(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: CreateStudentFineDto,
  ) {
    return this.financeService.createStudentFine(currentUser, dto);
  }

  @Get('student-fines')
  @Version('1')
  @RequirePermission('student_fines', 'read')
  @ApiOperation({
    summary: 'List student fines',
    description:
      'Returns student fines visible to the authenticated user, optionally filtered by campus or student.',
  })
  listStudentFines(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query('campusId') campusId?: string,
    @Query('studentId') studentId?: string,
  ) {
    return this.financeService.listStudentFines(
      currentUser,
      campusId,
      studentId,
    );
  }

  @Get('student-fines/:fineId')
  @Version('1')
  @RequirePermission('student_fines', 'read')
  @ApiOperation({
    summary: 'Get a student fine',
    description:
      'Returns one student fine record for billing detail and reconciliation screens.',
  })
  getStudentFine(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('fineId') fineId: string,
  ) {
    return this.financeService.getStudentFine(currentUser, fineId);
  }

  @Delete('student-fines/:fineId')
  @Version('1')
  @RequirePermission('student_fines', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a student fine',
    description:
      'Moves a student fine to the recycle bin for reversible deletion.',
  })
  deleteStudentFine(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('fineId') fineId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.financeService.deleteStudentFine(
      currentUser,
      fineId,
      dto.reason,
    );
  }

  @Post('fee-vouchers')
  @Version('1')
  @RequirePermission('fee_vouchers', 'create')
  @ApiOperation({
    summary: 'Create a fee voucher',
    description:
      'Creates a fee voucher for a student so the frontend can present a bill before payment collection.',
  })
  createFeeVoucher(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: CreateFeeVoucherDto,
  ) {
    return this.financeService.createFeeVoucher(currentUser, dto);
  }

  @Get('fee-vouchers')
  @Version('1')
  @RequirePermission('fee_vouchers', 'read')
  @ApiOperation({
    summary: 'List fee vouchers',
    description:
      'Returns fee vouchers visible to the authenticated user, optionally filtered by campus or student.',
  })
  listFeeVouchers(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query('campusId') campusId?: string,
    @Query('studentId') studentId?: string,
  ) {
    return this.financeService.listFeeVouchers(
      currentUser,
      campusId,
      studentId,
    );
  }

  @Get('fee-vouchers/:voucherId')
  @Version('1')
  @RequirePermission('fee_vouchers', 'read')
  @ApiOperation({
    summary: 'Get a fee voucher',
    description:
      'Returns one fee voucher for billing detail, payment, and reconciliation screens.',
  })
  getFeeVoucher(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('voucherId') voucherId: string,
  ) {
    return this.financeService.getFeeVoucher(currentUser, voucherId);
  }

  @Patch('fee-vouchers/:voucherId')
  @Version('1')
  @RequirePermission('fee_vouchers', 'update')
  @ApiOperation({
    summary: 'Update a fee voucher',
    description:
      'Updates a fee voucher before or during collection workflows within the current scope.',
  })
  updateFeeVoucher(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('voucherId') voucherId: string,
    @Body() dto: UpdateFeeVoucherDto,
  ) {
    return this.financeService.updateFeeVoucher(currentUser, voucherId, dto);
  }

  @Delete('fee-vouchers/:voucherId')
  @Version('1')
  @RequirePermission('fee_vouchers', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a fee voucher',
    description:
      'Moves a fee voucher to the recycle bin instead of permanently deleting it immediately.',
  })
  deleteFeeVoucher(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('voucherId') voucherId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.financeService.deleteFeeVoucher(
      currentUser,
      voucherId,
      dto.reason,
    );
  }

  @Post('fee-payments')
  @Version('1')
  @RequirePermission('fee_payments', 'create')
  @ApiOperation({
    summary: 'Create a fee payment',
    description:
      'Records a fee payment against a voucher so collection and reconciliation screens can reflect paid amounts.',
  })
  createFeePayment(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: CreateFeePaymentDto,
  ) {
    return this.financeService.createFeePayment(dto, currentUser);
  }

  @Get('fee-payments')
  @Version('1')
  @RequirePermission('fee_payments', 'read')
  @ApiOperation({
    summary: 'List fee payments',
    description:
      'Returns fee payments visible to the authenticated user, optionally filtered by campus or voucher.',
  })
  listFeePayments(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query('campusId') campusId?: string,
    @Query('voucherId') voucherId?: string,
  ) {
    return this.financeService.listFeePayments(
      currentUser,
      campusId,
      voucherId,
    );
  }

  @Get('fee-payments/:paymentId')
  @Version('1')
  @RequirePermission('fee_payments', 'read')
  @ApiOperation({
    summary: 'Get a fee payment',
    description:
      'Returns one fee payment record for payment detail and reconciliation screens.',
  })
  getFeePayment(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('paymentId') paymentId: string,
  ) {
    return this.financeService.getFeePayment(currentUser, paymentId);
  }

  @Delete('fee-payments/:paymentId')
  @Version('1')
  @RequirePermission('fee_payments', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a fee payment',
    description:
      'Moves a fee payment to the recycle bin for reversible cleanup while preserving auditability.',
  })
  deleteFeePayment(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('paymentId') paymentId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.financeService.deleteFeePayment(
      currentUser,
      paymentId,
      dto.reason,
    );
  }
}
