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
  CreateStudentEnrollmentDto,
  LinkGuardianDto,
  ListStudentEnrollmentsQueryDto,
  PromotionWizardDto,
  StudentPromotionDto,
  UpdateGuardianDto,
  UpdateStaffProfileDto,
  UpdateStudentDto,
  UpdateStudentEnrollmentDto,
  WithdrawStudentDto,
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

  // Must be declared before 'students/:studentId' below, or Nest matches
  // "next-reg-no" as the :studentId param (same gotcha as the academic
  // years module's 'current' route ordering).
  @Get('students/next-reg-no')
  @Version('1')
  @RequirePermission('students', 'create')
  @ApiOperation({
    summary: 'Preview the next registration number',
    description:
      'Advisory, read-only preview of the regNo the next admission at this campus would receive, based on the institution’s regNo pattern setting. The actual create still validates uniqueness independently.',
  })
  getNextRegNo(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Query('campusId') campusId: string,
  ) {
    return this.peopleService.resolveNextRegNo(currentUser, campusId);
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

  // -----------------------------------------------------------------------
  // M2 Phase 3 — StudentEnrollment, promotion wizard, withdrawal (§ 6.2).
  // Every route here is gated on the single `student_enrollments` catalog
  // key (no separate keys for the wizard/withdrawal — they're specialized
  // writes against this same resource, per § 5).
  // -----------------------------------------------------------------------

  @Post('student-enrollments')
  @Version('1')
  @RequirePermission('student_enrollments', 'create')
  @ApiOperation({
    summary: 'Create a student enrollment',
    description:
      'Manual enrollment creation for edge cases such as a mid-year transfer-in student enrolling directly into a specific academic year.',
  })
  createStudentEnrollment(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: CreateStudentEnrollmentDto,
  ) {
    return this.peopleService.createStudentEnrollment(currentUser, dto);
  }

  @Get('student-enrollments')
  @Version('1')
  @RequirePermission('student_enrollments', 'read')
  @ApiOperation({
    summary: 'List student enrollments',
    description:
      'Returns campus-scoped enrollment rows, optionally filtered by student, academic year, class, section, or status.',
  })
  listStudentEnrollments(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Query() query: ListStudentEnrollmentsQueryDto,
  ) {
    return this.peopleService.listStudentEnrollments(currentUser, query);
  }

  @Post('promotions/preview')
  @Version('1')
  @RequirePermission('student_enrollments', 'read')
  @ApiOperation({
    summary: 'Preview a bulk promotion run',
    description:
      'Dry run of the bulk promotion wizard for one campus/source year against a set of class mappings and per-student overrides. No writes.',
  })
  previewPromotion(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: PromotionWizardDto,
  ) {
    return this.peopleService.previewPromotion(currentUser, dto);
  }

  @Post('promotions/commit')
  @Version('1')
  @RequirePermission('student_enrollments', 'create')
  @ApiOperation({
    summary: 'Commit a bulk promotion run',
    description:
      'Executes the bulk promotion wizard in one transaction: promotes/repeats/leaves every resolvable student. Idempotent on re-run.',
  })
  commitPromotion(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: PromotionWizardDto,
  ) {
    return this.peopleService.commitPromotion(currentUser, dto);
  }

  @Get('student-enrollments/:enrollmentId')
  @Version('1')
  @RequirePermission('student_enrollments', 'read')
  @ApiOperation({
    summary: 'Get a student enrollment',
    description: 'Returns one enrollment row with scoped access checks.',
  })
  getStudentEnrollment(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    return this.peopleService.getStudentEnrollment(currentUser, enrollmentId);
  }

  @Patch('student-enrollments/:enrollmentId')
  @Version('1')
  @RequirePermission('student_enrollments', 'update')
  @ApiOperation({
    summary: 'Update a student enrollment',
    description:
      'Manual class/section correction or mid-year transfer. Writes a paired StudentHistory row in the same transaction.',
  })
  updateStudentEnrollment(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('enrollmentId') enrollmentId: string,
    @Body() dto: UpdateStudentEnrollmentDto,
  ) {
    return this.peopleService.updateStudentEnrollment(
      currentUser,
      enrollmentId,
      dto,
    );
  }

  @Post('student-enrollments/:enrollmentId/withdraw')
  @Version('1')
  @RequirePermission('student_enrollments', 'update')
  @ApiOperation({
    summary: 'Withdraw a student',
    description:
      'Formally closes out an enrollment as LEFT. A soft gate on outstanding dues — resubmit with acknowledgeOutstandingDues: true to proceed past the 409.',
  })
  withdrawStudent(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('enrollmentId') enrollmentId: string,
    @Body() dto: WithdrawStudentDto,
  ) {
    return this.peopleService.withdrawStudent(currentUser, enrollmentId, dto);
  }

  @Delete('student-enrollments/:enrollmentId')
  @Version('1')
  @RequirePermission('student_enrollments', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a student enrollment',
    description:
      'Moves an enrollment row to the recycle bin, for correcting a mistaken entry.',
  })
  deleteStudentEnrollment(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('enrollmentId') enrollmentId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.peopleService.deleteStudentEnrollment(
      currentUser,
      enrollmentId,
      dto.reason,
    );
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
