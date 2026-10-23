import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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
import {
  BulkExamResultsDto,
  ExamResultsQueryDto,
} from './dto/examinations.dto';
import { ExamResultsService } from './exam-results.service';

@ApiTags('Examinations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('examinations/exam-subjects')
export class ExamResultsController {
  constructor(private readonly examResultsService: ExamResultsService) {}

  @Get(':id/results')
  @Version('1')
  @RequirePermission('exam_results', 'read')
  @ApiOperation({
    summary: 'Get the marks-entry grid for a paper',
    description:
      "Returns a section's enrolled students with the marks already entered for this paper, and whether the exam is locked.",
  })
  getResults(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
    @Query() query: ExamResultsQueryDto,
  ) {
    return this.examResultsService.getResults(currentUser, id, query.sectionId);
  }

  @Post(':id/results/bulk')
  @Version('1')
  @RequirePermission('exam_results', 'update')
  @ApiOperation({
    summary: 'Save marks for a section',
    description:
      'Saves marks, absences and remarks for up to 200 students. Blocked while the exam is published and locked. Staff can only save for subjects they are assigned to teach in the section.',
  })
  saveResults(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: BulkExamResultsDto,
  ) {
    return this.examResultsService.bulkSave(currentUser, id, dto);
  }

  @Get(':id/failing-students')
  @Version('1')
  @RequirePermission('exam_results', 'read')
  @ApiOperation({
    summary: 'List students who failed or were absent for a paper',
    description:
      'Returns the students confirmed to need a retake for this paper. Students who were never marked are not included.',
  })
  getFailingStudents(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
    @Query() query: ExamResultsQueryDto,
  ) {
    return this.examResultsService.getFailingStudents(
      currentUser,
      id,
      query.sectionId,
    );
  }
}
