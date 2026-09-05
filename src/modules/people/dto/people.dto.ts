import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import {
  ContactPersonType,
  EmploymentType,
  EnrollmentStatus,
  Gender,
  GuardianRelation,
  Religion,
} from '../../../common/enums/domain.enums';
import { CustomFieldPayloadDto } from '../../../common/dto/custom-field-payload.dto';

export class CreateStudentDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiPropertyOptional({
    description:
      'Optional — omit to auto-generate from the institution’s regNo pattern (see GET /people/students/next-reg-no). If provided, it is still validated for per-institution uniqueness.',
  })
  @IsOptional()
  @IsString()
  regNo?: string;
  @ApiProperty() @IsDateString() dob!: string;
  @ApiProperty({ enum: Gender }) @IsEnum(Gender) gender!: Gender;
  @ApiPropertyOptional() @IsOptional() @IsString() cnic?: string;
  @ApiPropertyOptional({
    description:
      'Class for the student’s first StudentEnrollment row, created against the institution’s current academic year.',
  })
  @IsOptional()
  @IsUUID()
  classId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sectionId?: string;
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() picture?: string;
  @ApiPropertyOptional({ enum: Religion })
  @IsOptional()
  @IsEnum(Religion)
  religion?: Religion;
  @ApiProperty() @IsDateString() admissionDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() prevSchool?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
}

// M2 Phase 3 (§ 7.5, § 10 item 5): class/section changes now go exclusively
// through the StudentEnrollment endpoints below — a generic student update
// is no longer a valid way to move a student between classes, since that
// write path skipped writing a paired StudentHistory row.
export class UpdateStudentDto extends PartialType(
  OmitType(CreateStudentDto, ['classId', 'sectionId'] as const),
) {}

export class CreateGuardianDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() picture?: string;
  @ApiProperty({ enum: GuardianRelation })
  @IsEnum(GuardianRelation)
  relation!: GuardianRelation;
  @ApiProperty() @IsUUID() campusId!: string;
}

export class UpdateGuardianDto extends PartialType(CreateGuardianDto) {}

export class CreateStaffProfileDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty({ enum: EmploymentType })
  @IsEnum(EmploymentType)
  employmentType!: EmploymentType;
  @ApiProperty({
    description:
      'Free text — institutions define their own designations. Per-designation profile fields come from Custom Fields.',
  })
  @IsString()
  designation!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cnic?: string;
  @ApiProperty({ enum: Gender }) @IsEnum(Gender) gender!: Gender;
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() picture?: string;
  @ApiProperty() @IsDateString() joiningDate!: string;
}

export class UpdateStaffProfileDto extends PartialType(CreateStaffProfileDto) {}

export class LinkGuardianDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() studentId!: string;
  @ApiProperty() @IsUUID() guardianId!: string;
}

export class StudentPromotionDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() studentId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() previousClassId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() previousSectionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() newClassId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() newSectionId?: string;
  @ApiPropertyOptional({
    description:
      'Academic year this manual transfer belongs to. Defaults to the institution’s current academic year when omitted.',
  })
  @IsOptional()
  @IsUUID()
  academicYearId?: string;
  @ApiProperty() @IsDateString() promotionDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() promotionReason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

// M2 Phase 3 (§ 4.3, § 6.2) — StudentEnrollment CRUD DTOs. Deliberately do
// NOT extend CustomFieldPayloadDto: custom fields on StudentEnrollment are
// an explicit fast-follow, not part of this phase (§ 8) — no
// CustomFieldEntity.STUDENT_ENROLLMENT registry entry exists yet.
export class CreateStudentEnrollmentDto {
  @ApiProperty() @IsUUID() studentId!: string;
  @ApiProperty() @IsUUID() academicYearId!: string;
  @ApiProperty() @IsUUID() classId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sectionId?: string;
}

// Deliberately NOT PartialType(CreateStudentEnrollmentDto): studentId and
// academicYearId are the row's identity and must not change through a PATCH
// — this endpoint is for manual class/section correction or a mid-year
// transfer, which writes a paired StudentHistory row (§ 7.5); moving a
// student to a different year/student entirely is a new enrollment, not an
// update of this one.
export class UpdateStudentEnrollmentDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() classId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sectionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

export class WithdrawStudentDto {
  @ApiProperty() @IsDateString() leftDate!: string;
  @ApiProperty() @IsString() leftReason!: string;
  @ApiPropertyOptional({
    description:
      'Set to true to withdraw despite outstanding dues (the family has left and the debt itself is not erased — see M2-PEOPLE-ACADEMIC-DESIGN.md § 7.4). Omit/false on the first attempt so the caller sees the outstanding amount and can decide.',
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeOutstandingDues?: boolean;
}

/** The three outcomes the bulk promotion wizard can resolve a student to. */
export enum PromotionOverrideAction {
  PROMOTE = 'PROMOTE',
  REPEAT = 'REPEAT',
  LEAVE = 'LEAVE',
}

export class PromotionSectionMappingDto {
  @ApiProperty() @IsUUID() fromSectionId!: string;
  @ApiProperty() @IsUUID() toSectionId!: string;
}

export class PromotionClassMappingDto {
  @ApiProperty() @IsUUID() fromClassId!: string;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Target class for every ACTIVE student currently in fromClassId. null means this class graduates/leaves (e.g. the highest grade) — every student in it is marked LEFT unless overridden.',
  })
  @IsOptional()
  @IsUUID()
  toClassId?: string | null;
  @ApiPropertyOptional({ type: [PromotionSectionMappingDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionSectionMappingDto)
  sectionMapping?: PromotionSectionMappingDto[];
}

export class PromotionStudentOverrideDto {
  @ApiProperty() @IsUUID() studentId!: string;
  @ApiProperty({ enum: PromotionOverrideAction })
  @IsEnum(PromotionOverrideAction)
  action!: PromotionOverrideAction;
  @ApiPropertyOptional() @IsOptional() @IsUUID() toClassId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() toSectionId?: string;
}

// Shared shape for both the preview (dry run) and commit endpoints, per
// § 7.3 — one campusId per invocation, matching how every other academics
// screen in this codebase is already campus-scoped.
export class PromotionWizardDto {
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiProperty() @IsUUID() sourceAcademicYearId!: string;
  @ApiProperty() @IsUUID() targetAcademicYearId!: string;
  @ApiProperty({ type: [PromotionClassMappingDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionClassMappingDto)
  classMappings!: PromotionClassMappingDto[];
  @ApiPropertyOptional({ type: [PromotionStudentOverrideDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionStudentOverrideDto)
  studentOverrides?: PromotionStudentOverrideDto[];
}

// Query filters for GET /people/student-enrollments — unpaginated, matching
// students/guardians/teachers today (§ 6.2 flags this as a forward-looking
// concern once enrollment volume grows, not blocking for M2).
export class ListStudentEnrollmentsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() studentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() academicYearId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() campusId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() classId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sectionId?: string;
  @ApiPropertyOptional({ enum: EnrollmentStatus })
  @IsOptional()
  @IsEnum(EnrollmentStatus)
  status?: EnrollmentStatus;
}

export class AssignTeacherSubjectDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() staffProfileId!: string;
  @ApiProperty() @IsUUID() classId!: string;
  @ApiProperty() @IsUUID() subjectId!: string;
  @ApiProperty({
    description:
      'Teaching allocation is section-level: the section of the class this teacher takes for the subject.',
  })
  @IsUUID()
  sectionId!: string;
  @ApiProperty() @IsUUID() campusId!: string;
}

export class CreateContactDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() personId!: string;
  @ApiProperty({ enum: ContactPersonType })
  @IsString()
  personType!: string;
  @ApiProperty() @IsString() phone1!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone2?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() whatsapp?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
}
