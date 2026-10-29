import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AttendanceReportsService } from './attendance-reports.service';
import { CampusComparisonService } from './campus-comparison.service';
import { ExamReportsService } from './exam-reports.service';
import { FinanceReportsService } from './finance-reports.service';
import { PayrollReportsService } from './payroll-reports.service';
import { ReportTable } from './report-table';
import { ReportsController } from './reports.controller';
import { ReportsExportService } from './reports-export.service';

describe('ReportsController', () => {
  const admin: CurrentUser = {
    sub: 'admin-1',
    email: 'a@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };
  const table: ReportTable = {
    key: 'campus-comparison',
    title: 'Campus comparison',
    subtitle: null,
    columns: [{ key: 'campus', label: 'Campus' }],
    rows: [{ campus: 'Main' }],
    totals: null,
    notes: [],
    institutionId: 'inst-1',
    campusId: null,
  };

  const comparison = { build: jest.fn() };
  const attendance = {
    monthlyRegister: jest.fn(),
    staffSummary: jest.fn(),
    chronicAbsentees: jest.fn(),
  };
  const finance = {
    collection: jest.fn(),
    outstandingDues: jest.fn(),
    adjustments: jest.fn(),
  };
  const exams = {
    subjectResults: jest.fn(),
    gradeDistribution: jest.fn(),
    failedStudents: jest.fn(),
  };
  const payroll = { register: jest.fn(), cost: jest.fn() };
  const exporter = { toFile: jest.fn() };
  const set = jest.fn();
  const response = { set } as unknown as Response;
  const controller = new ReportsController(
    comparison as unknown as CampusComparisonService,
    attendance as unknown as AttendanceReportsService,
    finance as unknown as FinanceReportsService,
    exams as unknown as ExamReportsService,
    payroll as unknown as PayrollReportsService,
    exporter as unknown as ReportsExportService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    comparison.build.mockResolvedValue(table);
    attendance.monthlyRegister.mockResolvedValue(table);
    attendance.staffSummary.mockResolvedValue(table);
    attendance.chronicAbsentees.mockResolvedValue(table);
    finance.collection.mockResolvedValue(table);
    finance.outstandingDues.mockResolvedValue(table);
    finance.adjustments.mockResolvedValue(table);
    exams.subjectResults.mockResolvedValue(table);
    exams.gradeDistribution.mockResolvedValue(table);
    exams.failedStudents.mockResolvedValue(table);
    payroll.register.mockResolvedValue(table);
    payroll.cost.mockResolvedValue(table);
    exporter.toFile.mockResolvedValue({
      buffer: Buffer.from('x'),
      filename: 'r.csv',
      contentType: 'text/csv; charset=utf-8',
    });
  });

  it('is only for administrators and the superadmin', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      ReportsController,
    ) as UserRole[];

    expect(roles).toEqual([UserRole.SUPERADMIN, UserRole.ADMIN]);
  });

  it('returns the report as the usual JSON envelope by default', async () => {
    const result = await controller.campusComparison(admin, {}, response);

    expect(result).toEqual({
      message: 'Report retrieved successfully',
      data: table,
    });
    expect(exporter.toFile).not.toHaveBeenCalled();
  });

  it.each(['csv', 'pdf'] as const)(
    'returns a %s download when asked, with no JSON wrapper',
    async (format) => {
      const result = await controller.campusComparison(
        admin,
        { format },
        response,
      );

      expect(result).toBeInstanceOf(StreamableFile);
      expect(exporter.toFile).toHaveBeenCalledWith(table, format);
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Disposition': 'attachment; filename="r.csv"',
        }),
      );
    },
  );

  it('hands each report its own query and the caller', async () => {
    await controller.monthlyRegister(
      admin,
      { sectionId: 's1', month: '2026-10' },
      response,
    );
    await controller.staffSummary(admin, { campusId: 'c1' }, response);
    await controller.chronicAbsentees(
      admin,
      { thresholdPercent: 30 },
      response,
    );
    await controller.collection(admin, { groupBy: 'MONTH' }, response);
    await controller.outstandingDues(admin, {}, response);
    await controller.adjustments(admin, { from: '2026-10-01' }, response);

    expect(attendance.monthlyRegister).toHaveBeenCalledWith(admin, {
      sectionId: 's1',
      month: '2026-10',
    });
    expect(attendance.staffSummary).toHaveBeenCalledWith(admin, {
      campusId: 'c1',
    });
    expect(attendance.chronicAbsentees).toHaveBeenCalledWith(admin, {
      thresholdPercent: 30,
    });
    expect(finance.collection).toHaveBeenCalledWith(admin, {
      groupBy: 'MONTH',
    });
    expect(finance.outstandingDues).toHaveBeenCalledWith(admin, {});
    expect(finance.adjustments).toHaveBeenCalledWith(admin, {
      from: '2026-10-01',
    });
  });

  it('hands the exam and payroll reports their own query and the caller', async () => {
    await controller.examSubjectResults(admin, { examId: 'e1' }, response);
    await controller.examGradeDistribution(admin, { examId: 'e1' }, response);
    await controller.examFailedStudents(admin, { examId: 'e1' }, response);
    await controller.payrollRegister(
      admin,
      { campusId: 'c1', month: '2026-10' },
      response,
    );
    await controller.payrollCost(admin, { from: '2026-08-01' }, response);

    expect(exams.subjectResults).toHaveBeenCalledWith(admin, { examId: 'e1' });
    expect(exams.gradeDistribution).toHaveBeenCalledWith(admin, {
      examId: 'e1',
    });
    expect(exams.failedStudents).toHaveBeenCalledWith(admin, { examId: 'e1' });
    expect(payroll.register).toHaveBeenCalledWith(admin, {
      campusId: 'c1',
      month: '2026-10',
    });
    expect(payroll.cost).toHaveBeenCalledWith(admin, { from: '2026-08-01' });
  });

  it('does not swallow a refusal from a report', async () => {
    comparison.build.mockRejectedValue(new Error('forbidden'));

    await expect(
      controller.campusComparison(admin, {}, response),
    ).rejects.toThrow('forbidden');
  });
});
