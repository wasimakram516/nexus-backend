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
  AssignTeacherSubjectDto,
  CreateContactDto,
  CreateGuardianDto,
  CreateStaffProfileDto,
  CreateStudentDto,
  LinkGuardianDto,
  StudentPromotionDto,
  UpdateGuardianDto,
  UpdateStaffProfileDto,
  UpdateStudentDto,
} from './dto/people.dto';
import { PeopleService } from './people.service';

@ApiTags('People')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('people')
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  @Post('students')
  @Version('1')
  @RequirePermission('students', 'create')
  @ApiOperation({
    summary: 'Create a student',
    description:
      'Creates a student record in the selected campus and prepares it for enrollment, attendance, and finance workflows.',
  })
  createStudent(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: CreateStudentDto,
  ) {
    return this.peopleService.createStudent(currentUser, dto);
  }

  @Get('students')
  @Version('1')
  @RequirePermission('students', 'read')
  @ApiOperation({
    summary: 'List students',
    description:
      'Returns students visible to the authenticated user, optionally filtered by campus for roster and selection screens.',
  })
  listStudents(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Query('campusId') campusId?: string,
  ) {
    return this.peopleService.listStudents(currentUser, campusId);
  }

  @Get('students/:studentId')
  @Version('1')
  @RequirePermission('students', 'read')
  @ApiOperation({
    summary: 'Get a student',
    description:
      'Returns one student record with scoped access checks for profile, edit, and linked-record detail screens.',
  })
  getStudent(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('studentId') studentId: string,
  ) {
    return this.peopleService.getStudent(currentUser, studentId);
  }

  @Patch('students/:studentId')
  @Version('1')
  @RequirePermission('students', 'update')
  @ApiOperation({
    summary: 'Update a student',
    description:
      'Updates a student record while preserving institution and campus scoping rules.',
  })
  updateStudent(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('studentId') studentId: string,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.peopleService.updateStudent(currentUser, studentId, dto);
  }

  @Delete('students/:studentId')
  @Version('1')
  @RequirePermission('students', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a student',
    description:
      'Moves a student record to the recycle bin instead of permanently removing it immediately.',
  })
  deleteStudent(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('studentId') studentId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.peopleService.deleteStudent(currentUser, studentId, dto.reason);
  }

  @Post('guardians')
  @Version('1')
  @RequirePermission('guardians', 'create')
  @ApiOperation({
    summary: 'Create a guardian',
    description:
      'Creates a guardian record that can later be linked to one or more students in the same scope.',
  })
  createGuardian(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: CreateGuardianDto,
  ) {
    return this.peopleService.createGuardian(currentUser, dto);
  }

  @Get('guardians')
  @Version('1')
  @RequirePermission('guardians', 'read')
  @ApiOperation({
    summary: 'List guardians',
    description:
      'Returns guardians visible to the authenticated user, optionally filtered by campus.',
  })
  listGuardians(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Query('campusId') campusId?: string,
  ) {
    return this.peopleService.listGuardians(currentUser, campusId);
  }

  @Get('guardians/:guardianId')
  @Version('1')
  @RequirePermission('guardians', 'read')
  @ApiOperation({
    summary: 'Get a guardian',
    description:
      'Returns one guardian record for detail and edit screens with scope validation.',
  })
  getGuardian(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('guardianId') guardianId: string,
  ) {
    return this.peopleService.getGuardian(currentUser, guardianId);
  }

  @Patch('guardians/:guardianId')
  @Version('1')
  @RequirePermission('guardians', 'update')
  @ApiOperation({
    summary: 'Update a guardian',
    description:
      'Updates guardian details inside the current institution and campus access scope.',
  })
  updateGuardian(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('guardianId') guardianId: string,
    @Body() dto: UpdateGuardianDto,
  ) {
    return this.peopleService.updateGuardian(currentUser, guardianId, dto);
  }

  @Delete('guardians/:guardianId')
  @Version('1')
  @RequirePermission('guardians', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a guardian',
    description:
      'Moves a guardian record to the recycle bin for reversible deletion flows.',
  })
  deleteGuardian(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('guardianId') guardianId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.peopleService.deleteGuardian(
      currentUser,
      guardianId,
      dto.reason,
    );
  }

  @Post('staff-profiles')
  @Version('1')
  @RequirePermission('staff_profiles', 'create')
  @ApiOperation({
    summary: 'Create a staff profile',
    description:
      'Creates a staff profile (teaching or non-teaching) that can be used across academics, attendance, and payroll flows.',
  })
  createStaffProfile(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: CreateStaffProfileDto,
  ) {
    return this.peopleService.createStaffProfile(currentUser, dto);
  }

  @Get('staff-profiles')
  @Version('1')
  @RequirePermission('staff_profiles', 'read')
  @ApiOperation({
    summary: 'List staff profiles',
    description:
      'Returns staff profiles visible to the authenticated user, optionally filtered by campus.',
  })
  listStaffProfiles(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Query('campusId') campusId?: string,
  ) {
    return this.peopleService.listStaffProfiles(currentUser, campusId);
  }

  @Get('staff-profiles/:staffProfileId')
  @Version('1')
  @RequirePermission('staff_profiles', 'read')
  @ApiOperation({
    summary: 'Get a staff profile',
    description:
      'Returns one staff profile with scoped access checks for frontend detail screens.',
  })
  getStaffProfile(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('staffProfileId') staffProfileId: string,
  ) {
    return this.peopleService.getStaffProfile(currentUser, staffProfileId);
  }

  @Patch('staff-profiles/:staffProfileId')
  @Version('1')
  @RequirePermission('staff_profiles', 'update')
  @ApiOperation({
    summary: 'Update a staff profile',
    description:
      'Updates staff profile and employment details within the current access scope.',
  })
  updateStaffProfile(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('staffProfileId') staffProfileId: string,
    @Body() dto: UpdateStaffProfileDto,
  ) {
    return this.peopleService.updateStaffProfile(
      currentUser,
      staffProfileId,
      dto,
    );
  }

  @Delete('staff-profiles/:staffProfileId')
  @Version('1')
  @RequirePermission('staff_profiles', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a staff profile',
    description:
      'Moves a staff profile to the recycle bin instead of permanently deleting it immediately.',
  })
  deleteStaffProfile(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('staffProfileId') staffProfileId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.peopleService.deleteStaffProfile(
      currentUser,
      staffProfileId,
      dto.reason,
    );
  }

  @Post('student-guardians')
  @Version('1')
  @RequirePermission('student_guardians', 'create')
  @ApiOperation({
    summary: 'Link a guardian to a student',
    description:
      'Creates a student-guardian relationship for contact, portal, and family-management screens.',
  })
  linkGuardian(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: LinkGuardianDto,
  ) {
    return this.peopleService.linkGuardian(currentUser, dto);
  }

  @Post('student-history')
  @Version('1')
  @RequirePermission('student_history', 'create')
  @ApiOperation({
    summary: 'Record student promotion history',
    description:
      'Creates a student history record for promotions, transfers, or similar academic progression events.',
  })
  recordPromotion(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: StudentPromotionDto,
  ) {
    return this.peopleService.recordPromotion(currentUser, dto);
  }

  @Post('teacher-subjects')
  @Version('1')
  @RequirePermission('teacher_subjects', 'create')
  @ApiOperation({
    summary: 'Assign a teacher to a subject',
    description:
      'Creates a section-level teacher-subject assignment used by class planning and timetable-related screens.',
  })
  assignTeacherSubject(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: AssignTeacherSubjectDto,
  ) {
    return this.peopleService.assignTeacherSubject(currentUser, dto);
  }

  @Get('teacher-subjects')
  @Version('1')
  @RequirePermission('teacher_subjects', 'read')
  @ApiOperation({
    summary: 'List teacher subject assignments',
    description:
      'Returns campus-scoped teaching allocations for the academics assignment screen.',
  })
  listTeacherSubjects(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Query('campusId') campusId?: string,
  ) {
    return this.peopleService.listTeacherSubjects(currentUser, campusId);
  }

  @Delete('teacher-subjects/:assignmentId')
  @Version('1')
  @RequirePermission('teacher_subjects', 'delete')
  @ApiOperation({
    summary: 'Remove a teacher subject assignment',
    description:
      'Unassigns a teacher from a subject section. The allocation row is removed permanently and audit-logged.',
  })
  removeTeacherSubject(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.peopleService.removeTeacherSubject(currentUser, assignmentId);
  }

  @Delete('student-guardians/:linkId')
  @Version('1')
  @RequirePermission('student_guardians', 'delete')
  @ApiOperation({
    summary: 'Unlink a guardian from a student',
    description:
      'Removes a student-guardian relationship. The link is removed permanently and audit-logged.',
  })
  unlinkGuardian(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('linkId') linkId: string,
  ) {
    return this.peopleService.unlinkGuardian(currentUser, linkId);
  }

  @Post('contacts')
  @Version('1')
  @RequirePermission('contacts', 'create')
  @ApiOperation({
    summary: 'Create a contact record',
    description:
      'Creates a contact entry associated with a supported person record such as a student, guardian, or teacher.',
  })
  createContact(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: CreateContactDto,
  ) {
    return this.peopleService.createContact(currentUser, dto);
  }
}
