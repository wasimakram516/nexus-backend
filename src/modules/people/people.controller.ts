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
import { Roles } from '../../common/decorators/roles.decorator';
import { DeleteRecordDto } from '../../common/dto/delete-record.dto';
import { UserRole } from '../../common/enums/domain.enums';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser as CurrentUserPayload } from '../../common/interfaces/current-user.interface';
import {
  AssignTeacherSubjectDto,
  CreateContactDto,
  CreateGuardianDto,
  CreateStudentDto,
  CreateTeacherDto,
  LinkGuardianDto,
  StudentPromotionDto,
  UpdateGuardianDto,
  UpdateStudentDto,
  UpdateTeacherDto,
} from './dto/people.dto';
import { PeopleService } from './people.service';

@ApiTags('People')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('people')
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  @Post('students')
  @Version('1')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
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
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
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
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
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
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
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
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
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
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
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

  @Post('teachers')
  @Version('1')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Create a teacher',
    description:
      'Creates a teacher record that can be used across academics, attendance, and payroll flows.',
  })
  createTeacher(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: CreateTeacherDto,
  ) {
    return this.peopleService.createTeacher(currentUser, dto);
  }

  @Get('teachers')
  @Version('1')
  @ApiOperation({
    summary: 'List teachers',
    description:
      'Returns teachers visible to the authenticated user, optionally filtered by campus.',
  })
  listTeachers(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Query('campusId') campusId?: string,
  ) {
    return this.peopleService.listTeachers(currentUser, campusId);
  }

  @Get('teachers/:teacherId')
  @Version('1')
  @ApiOperation({
    summary: 'Get a teacher',
    description:
      'Returns one teacher record with scoped access checks for frontend detail screens.',
  })
  getTeacher(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('teacherId') teacherId: string,
  ) {
    return this.peopleService.getTeacher(currentUser, teacherId);
  }

  @Patch('teachers/:teacherId')
  @Version('1')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update a teacher',
    description:
      'Updates teacher profile and staffing details within the current access scope.',
  })
  updateTeacher(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('teacherId') teacherId: string,
    @Body() dto: UpdateTeacherDto,
  ) {
    return this.peopleService.updateTeacher(currentUser, teacherId, dto);
  }

  @Delete('teachers/:teacherId')
  @Version('1')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Soft-delete a teacher',
    description:
      'Moves a teacher record to the recycle bin instead of permanently deleting it immediately.',
  })
  deleteTeacher(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('teacherId') teacherId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.peopleService.deleteTeacher(currentUser, teacherId, dto.reason);
  }

  @Post('student-guardians')
  @Version('1')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
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
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
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
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Assign a teacher to a subject',
    description:
      'Creates a teacher-subject assignment used by class planning and timetable-related screens.',
  })
  assignTeacherSubject(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: AssignTeacherSubjectDto,
  ) {
    return this.peopleService.assignTeacherSubject(currentUser, dto);
  }

  @Post('contacts')
  @Version('1')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
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
