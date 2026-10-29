import {
  Controller,
  Get,
  Query,
  Res,
  StreamableFile,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUserDecorator } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AttendanceReportsService } from './attendance-reports.service';
import { CampusComparisonService } from './campus-comparison.service';
import { ExamReportsService } from './exam-reports.service';
import {
  CampusComparisonQueryDto,
  CampusPeriodQueryDto,
  ChronicAbsenteesQueryDto,
  ExamReportQueryDto,
  FeeCollectionQueryDto,
  MonthlyRegisterQueryDto,
  PayrollRegisterQueryDto,
  ReportQueryDto,
} from './dto/reports.dto';
import { FinanceReportsService } from './finance-reports.service';
import { PayrollReportsService } from './payroll-reports.service';
import { ReportTable } from './report-table';
import { ReportsExportService, sendReportFile } from './reports-export.service';

/**
 * Reports for institution administrators. Every report returns the same table
 * shape as JSON, or as a CSV or PDF download when `format` asks for one, so
 * the screen, the spreadsheet and the printout always agree.
 */
@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly comparison: CampusComparisonService,
    private readonly attendance: AttendanceReportsService,
    private readonly finance: FinanceReportsService,
    private readonly exams: ExamReportsService,
    private readonly payroll: PayrollReportsService,
    private readonly exporter: ReportsExportService,
  ) {}

  @Get('campus-comparison')
  @Version('1')
  @ApiOperation({
    summary: 'Compare campuses side by side',
    description:
      "Enrollment, the day's attendance, this month's fees collected against billed, what is outstanding and how many students are in default, per campus with a total.",
  })
  async campusComparison(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: CampusComparisonQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond(
      await this.comparison.build(currentUser, query),
      query,
      response,
    );
  }

  @Get('attendance/monthly-register')
  @Version('1')
  @ApiOperation({ summary: "A section's attendance register for a month" })
  async monthlyRegister(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: MonthlyRegisterQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond(
      await this.attendance.monthlyRegister(currentUser, query),
      query,
      response,
    );
  }

  @Get('attendance/staff-summary')
  @Version('1')
  @ApiOperation({ summary: 'How staff attended over a period' })
  async staffSummary(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: CampusPeriodQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond(
      await this.attendance.staffSummary(currentUser, query),
      query,
      response,
    );
  }

  @Get('attendance/chronic-absentees')
  @Version('1')
  @ApiOperation({
    summary: 'Students absent on a large share of the days marked',
  })
  async chronicAbsentees(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: ChronicAbsenteesQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond(
      await this.attendance.chronicAbsentees(currentUser, query),
      query,
      response,
    );
  }

  @Get('finance/collection')
  @Version('1')
  @ApiOperation({
    summary: 'Fees received in a period, by day, month or campus',
  })
  async collection(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: FeeCollectionQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond(
      await this.finance.collection(currentUser, query),
      query,
      response,
    );
  }

  @Get('finance/outstanding-dues')
  @Version('1')
  @ApiOperation({ summary: 'Students with fees past their due date' })
  async outstandingDues(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: CampusPeriodQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond(
      await this.finance.outstandingDues(currentUser, query),
      query,
      response,
    );
  }

  @Get('finance/discounts-and-fines')
  @Version('1')
  @ApiOperation({
    summary: 'Discounts, attendance fines and late fees applied',
  })
  async adjustments(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: CampusPeriodQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond(
      await this.finance.adjustments(currentUser, query),
      query,
      response,
    );
  }

  @Get('exams/subject-results')
  @Version('1')
  @ApiOperation({ summary: 'How each paper of an exam went' })
  async examSubjectResults(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: ExamReportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond(
      await this.exams.subjectResults(currentUser, query),
      query,
      response,
    );
  }

  @Get('exams/grade-distribution')
  @Version('1')
  @ApiOperation({ summary: 'How many students earned each grade in an exam' })
  async examGradeDistribution(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: ExamReportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond(
      await this.exams.gradeDistribution(currentUser, query),
      query,
      response,
    );
  }

  @Get('exams/failed-students')
  @Version('1')
  @ApiOperation({ summary: 'Students who did not pass an exam' })
  async examFailedStudents(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: ExamReportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond(
      await this.exams.failedStudents(currentUser, query),
      query,
      response,
    );
  }

  @Get('payroll/register')
  @Version('1')
  @ApiOperation({
    summary:
      "A month's payroll: who was paid what, and who is still to be paid",
  })
  async payrollRegister(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: PayrollRegisterQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond(
      await this.payroll.register(currentUser, query),
      query,
      response,
    );
  }

  @Get('payroll/cost')
  @Version('1')
  @ApiOperation({ summary: 'What payroll cost each month, by campus' })
  async payrollCost(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: CampusPeriodQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond(
      await this.payroll.cost(currentUser, query),
      query,
      response,
    );
  }

  /** The table as the usual JSON envelope, or as the file the caller asked for. */
  private async respond(
    table: ReportTable,
    query: ReportQueryDto,
    response: Response,
  ): Promise<{ message: string; data: ReportTable } | StreamableFile> {
    if (query.format === 'csv' || query.format === 'pdf') {
      return sendReportFile(
        response,
        await this.exporter.toFile(table, query.format),
      );
    }
    return { message: 'Report retrieved successfully', data: table };
  }
}
