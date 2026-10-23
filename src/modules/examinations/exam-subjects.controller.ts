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
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { DeleteRecordDto } from '../../common/dto/delete-record.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser as CurrentUserPayload } from '../../common/interfaces/current-user.interface';
import {
  CreateExamSubjectDto,
  ListExamSubjectsQueryDto,
  UpdateExamSubjectDto,
} from './dto/examinations.dto';
import { ExamSubjectsService } from './exam-subjects.service';

@ApiTags('Examinations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('examinations/exam-subjects')
export class ExamSubjectsController {
  constructor(private readonly examSubjectsService: ExamSubjectsService) {}

  @Post()
  @Version('1')
  @RequirePermission('exam_subjects', 'create')
  @ApiOperation({
    summary: 'Add a paper to an exam',
    description:
      'Adds a subject to a draft exam with its maximum and passing marks and an optional schedule. A retake exam can only include subjects from the original exam.',
  })
  createExamSubject(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: CreateExamSubjectDto,
  ) {
    return this.examSubjectsService.createExamSubject(currentUser, dto);
  }

  @Get()
  @Version('1')
  @RequirePermission('exam_subjects', 'read')
  @ApiOperation({
    summary: 'List exam papers',
    description:
      'Returns the papers in the campuses the caller can access, optionally for one exam, in date order.',
  })
  listExamSubjects(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Query() query: ListExamSubjectsQueryDto,
  ) {
    return this.examSubjectsService.listExamSubjects(currentUser, query);
  }

  @Get(':id')
  @Version('1')
  @RequirePermission('exam_subjects', 'read')
  @ApiOperation({
    summary: 'Get an exam paper',
    description: 'Returns one paper with its subject name.',
  })
  getExamSubject(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.examSubjectsService.getExamSubject(currentUser, id);
  }

  @Patch(':id')
  @Version('1')
  @RequirePermission('exam_subjects', 'update')
  @ApiOperation({
    summary: 'Update an exam paper',
    description:
      'Date, times and room can change at any time. Maximum and passing marks can change only while the exam is a draft or unlocked.',
  })
  updateExamSubject(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateExamSubjectDto,
  ) {
    return this.examSubjectsService.updateExamSubject(currentUser, id, dto);
  }

  @Delete(':id')
  @Version('1')
  @RequirePermission('exam_subjects', 'delete')
  @ApiOperation({
    summary: 'Remove an exam paper',
    description:
      'Moves a paper to the recycle bin. Only allowed while the exam is a draft.',
  })
  deleteExamSubject(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.examSubjectsService.deleteExamSubject(
      currentUser,
      id,
      dto.reason,
    );
  }
}
