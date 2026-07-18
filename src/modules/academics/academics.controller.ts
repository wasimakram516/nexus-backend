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
import { CurrentUser as CurrentUserPayload } from '../../common/interfaces/current-user.interface';
import {
  CreateClassDto,
  CreateLevelDto,
  CreateSectionDto,
  CreateSubjectDto,
  UpdateClassDto,
  UpdateLevelDto,
  UpdateSectionDto,
  UpdateSubjectDto,
} from './dto/academics.dto';
import { AcademicsService } from './academics.service';

@ApiTags('Academics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('academics')
export class AcademicsController {
  constructor(private readonly academicsService: AcademicsService) {}

  @Post('levels')
  @Version('1')
  @RequirePermission('levels', 'create')
  @ApiOperation({
    summary: 'Create a level',
    description:
      'Creates an academic level within a campus for downstream class, section, and student placement workflows.',
  })
  createLevel(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: CreateLevelDto,
  ) {
    return this.academicsService.createLevel(currentUser, dto);
  }

  @Get('levels')
  @Version('1')
  @RequirePermission('levels', 'read')
  @ApiOperation({
    summary: 'List levels',
    description:
      'Returns academic levels visible to the authenticated user, optionally filtered by campus.',
  })
  listLevels(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Query('campusId') campusId?: string,
  ) {
    return this.academicsService.listLevels(currentUser, campusId);
  }

  @Get('levels/:levelId')
  @Version('1')
  @RequirePermission('levels', 'read')
  @ApiOperation({
    summary: 'Get a level',
    description:
      'Returns one academic level for detail and edit screens with access checks applied.',
  })
  getLevel(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('levelId') levelId: string,
  ) {
    return this.academicsService.getLevel(currentUser, levelId);
  }

  @Patch('levels/:levelId')
  @Version('1')
  @RequirePermission('levels', 'update')
  @ApiOperation({
    summary: 'Update a level',
    description:
      'Updates an academic level while preserving institution and campus access boundaries.',
  })
  updateLevel(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('levelId') levelId: string,
    @Body() dto: UpdateLevelDto,
  ) {
    return this.academicsService.updateLevel(currentUser, levelId, dto);
  }

  @Delete('levels/:levelId')
  @Version('1')
  @RequirePermission('levels', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a level',
    description:
      'Moves an academic level to the recycle bin so it can be restored later if needed.',
  })
  deleteLevel(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('levelId') levelId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.academicsService.deleteLevel(currentUser, levelId, dto.reason);
  }

  @Post('classes')
  @Version('1')
  @RequirePermission('classes', 'create')
  @ApiOperation({
    summary: 'Create a class',
    description:
      'Creates a class under a level for section, subject, and fee-structure flows.',
  })
  createClass(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: CreateClassDto,
  ) {
    return this.academicsService.createClass(currentUser, dto);
  }

  @Get('classes')
  @Version('1')
  @RequirePermission('classes', 'read')
  @ApiOperation({
    summary: 'List classes',
    description:
      'Returns classes visible to the authenticated user, optionally filtered by level.',
  })
  listClasses(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Query('levelId') levelId?: string,
  ) {
    return this.academicsService.listClasses(currentUser, levelId);
  }

  @Get('classes/:classId')
  @Version('1')
  @RequirePermission('classes', 'read')
  @ApiOperation({
    summary: 'Get a class',
    description:
      'Returns one academic class with scoped access checks for frontend detail views.',
  })
  getClass(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('classId') classId: string,
  ) {
    return this.academicsService.getClass(currentUser, classId);
  }

  @Patch('classes/:classId')
  @Version('1')
  @RequirePermission('classes', 'update')
  @ApiOperation({
    summary: 'Update a class',
    description:
      'Updates an academic class record within the authenticated user scope.',
  })
  updateClass(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('classId') classId: string,
    @Body() dto: UpdateClassDto,
  ) {
    return this.academicsService.updateClass(currentUser, classId, dto);
  }

  @Delete('classes/:classId')
  @Version('1')
  @RequirePermission('classes', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a class',
    description:
      'Moves a class to the recycle bin instead of removing it permanently.',
  })
  deleteClass(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('classId') classId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.academicsService.deleteClass(currentUser, classId, dto.reason);
  }

  @Post('sections')
  @Version('1')
  @RequirePermission('sections', 'create')
  @ApiOperation({
    summary: 'Create a section',
    description:
      'Creates a section under a class for timetables, rosters, and attendance flows.',
  })
  createSection(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: CreateSectionDto,
  ) {
    return this.academicsService.createSection(currentUser, dto);
  }

  @Get('sections')
  @Version('1')
  @RequirePermission('sections', 'read')
  @ApiOperation({
    summary: 'List sections',
    description:
      'Returns sections visible to the authenticated user, optionally filtered by class.',
  })
  listSections(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Query('classId') classId?: string,
  ) {
    return this.academicsService.listSections(currentUser, classId);
  }

  @Get('sections/:sectionId')
  @Version('1')
  @RequirePermission('sections', 'read')
  @ApiOperation({
    summary: 'Get a section',
    description:
      'Returns one section record for frontend detail and edit screens.',
  })
  getSection(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('sectionId') sectionId: string,
  ) {
    return this.academicsService.getSection(currentUser, sectionId);
  }

  @Patch('sections/:sectionId')
  @Version('1')
  @RequirePermission('sections', 'update')
  @ApiOperation({
    summary: 'Update a section',
    description:
      'Updates an existing section while preserving current access rules.',
  })
  updateSection(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('sectionId') sectionId: string,
    @Body() dto: UpdateSectionDto,
  ) {
    return this.academicsService.updateSection(currentUser, sectionId, dto);
  }

  @Delete('sections/:sectionId')
  @Version('1')
  @RequirePermission('sections', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a section',
    description:
      'Moves a section to the recycle bin for reversible deletion flows.',
  })
  deleteSection(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('sectionId') sectionId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.academicsService.deleteSection(
      currentUser,
      sectionId,
      dto.reason,
    );
  }

  @Post('subjects')
  @Version('1')
  @RequirePermission('subjects', 'create')
  @ApiOperation({
    summary: 'Create a subject',
    description:
      'Creates a subject under a class for assignment, timetable, and assessment-related flows.',
  })
  createSubject(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: CreateSubjectDto,
  ) {
    return this.academicsService.createSubject(currentUser, dto);
  }

  @Get('subjects')
  @Version('1')
  @RequirePermission('subjects', 'read')
  @ApiOperation({
    summary: 'List subjects',
    description:
      'Returns subjects visible to the authenticated user, optionally filtered by class.',
  })
  listSubjects(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Query('classId') classId?: string,
  ) {
    return this.academicsService.listSubjects(currentUser, classId);
  }

  @Get('subjects/:subjectId')
  @Version('1')
  @RequirePermission('subjects', 'read')
  @ApiOperation({
    summary: 'Get a subject',
    description:
      'Returns one subject record with scoped access checks applied.',
  })
  getSubject(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('subjectId') subjectId: string,
  ) {
    return this.academicsService.getSubject(currentUser, subjectId);
  }

  @Patch('subjects/:subjectId')
  @Version('1')
  @RequirePermission('subjects', 'update')
  @ApiOperation({
    summary: 'Update a subject',
    description:
      'Updates a subject record inside the current institution and campus scope.',
  })
  updateSubject(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('subjectId') subjectId: string,
    @Body() dto: UpdateSubjectDto,
  ) {
    return this.academicsService.updateSubject(currentUser, subjectId, dto);
  }

  @Delete('subjects/:subjectId')
  @Version('1')
  @RequirePermission('subjects', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a subject',
    description:
      'Moves a subject to the recycle bin so it can be restored later if required.',
  })
  deleteSubject(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('subjectId') subjectId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.academicsService.deleteSubject(
      currentUser,
      subjectId,
      dto.reason,
    );
  }
}
