import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserDecorator } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser as CurrentUserPayload } from '../../common/interfaces/current-user.interface';
import { ClassResultSummaryQueryDto } from './dto/examinations.dto';
import { ExamResultsViewService } from './exam-results-view.service';

@ApiTags('Examinations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('examinations/exams')
export class ExamResultsViewController {
  constructor(private readonly viewService: ExamResultsViewService) {}

  @Get(':id/class-result-summary')
  @Version('1')
  @RequirePermission('exam_results', 'read')
  @ApiOperation({
    summary: "Get every student's result for an exam",
    description:
      'Totals, percentage, grade, pass or fail and class and section position for each student, computed from the marks at read time. Always the results of this exact exam, never substituted by a later retake.',
  })
  getClassSummary(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
    @Query() query: ClassResultSummaryQueryDto,
  ) {
    return this.viewService.getClassSummary(currentUser, id, query.sectionId);
  }

  // No permission decorator: students and guardians read their own result, so
  // ownership is checked in the service instead.
  @Get(':id/students/:studentId/result-summary')
  @Version('1')
  @ApiOperation({
    summary: "Get one student's result for an exam",
    description:
      'Per-subject marks and grades, totals, pass or fail and position. Staff need the results permission; a student or guardian can read only their own result, and only once the exam is published.',
  })
  getStudentSummary(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
    @Param('studentId') studentId: string,
  ) {
    return this.viewService.getStudentSummary(currentUser, id, studentId);
  }
}
