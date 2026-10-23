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
import { ReportCardsQueryDto } from './dto/examinations.dto';
import { ExamReportCardsService } from './exam-report-cards.service';

@ApiTags('Examinations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('examinations')
export class ExamReportCardsController {
  constructor(private readonly reportCardsService: ExamReportCardsService) {}

  // No permission decorator: students and guardians read their own card, so
  // ownership is checked in the service.
  @Get('students/:studentId/academic-years/:academicYearId/report-card')
  @Version('1')
  @ApiOperation({
    summary: "Get a student's report card for an academic year",
    description:
      "Every published regular exam of the student's class that year, term by term, with the annual figures. A published retake supersedes the original for that subject and the original mark stays visible. Draft exams are left out.",
  })
  getReportCard(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('studentId') studentId: string,
    @Param('academicYearId') academicYearId: string,
  ) {
    return this.reportCardsService.getReportCard(
      currentUser,
      studentId,
      academicYearId,
    );
  }

  @Get('academic-years/:academicYearId/report-cards')
  @Version('1')
  @RequirePermission('exam_results', 'read')
  @ApiOperation({
    summary: 'Get report cards for a class or section',
    description:
      'One card per enrolled student for printing, computed once for the whole class, with a single shared print header.',
  })
  getReportCards(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('academicYearId') academicYearId: string,
    @Query() query: ReportCardsQueryDto,
  ) {
    return this.reportCardsService.getReportCards(
      currentUser,
      academicYearId,
      query.classId,
      query.sectionId,
    );
  }
}
