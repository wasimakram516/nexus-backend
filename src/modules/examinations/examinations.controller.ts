import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
  CreateExamTermDto,
  CreateGradingScaleDto,
  UpdateExamTermDto,
  UpdateGradingScaleDto,
} from './dto/examinations.dto';
import { ExaminationsService } from './examinations.service';

@ApiTags('Examinations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('examinations')
export class ExaminationsController {
  constructor(private readonly examinationsService: ExaminationsService) {}

  @Post('grading-scales')
  @Version('1')
  @RequirePermission('grading_scales', 'create')
  @ApiOperation({
    summary: 'Create a grading scale',
    description:
      'Creates a named grading scale with non-overlapping percentage bands.',
  })
  createGradingScale(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: CreateGradingScaleDto,
  ) {
    return this.examinationsService.createGradingScale(
      this.requireInstitutionId(currentUser),
      dto,
      currentUser,
    );
  }

  @Get('grading-scales')
  @Version('1')
  @RequirePermission('grading_scales', 'read')
  @ApiOperation({
    summary: 'List grading scales',
    description:
      "Returns every grading scale of the caller's institution with its bands, flagging the current one.",
  })
  listGradingScales(@CurrentUserDecorator() currentUser: CurrentUserPayload) {
    return this.examinationsService.listGradingScales(
      this.requireInstitutionId(currentUser),
      currentUser,
    );
  }

  @Get('grading-scales/:id')
  @Version('1')
  @RequirePermission('grading_scales', 'read')
  @ApiOperation({
    summary: 'Get a grading scale',
    description: 'Returns one grading scale with its ordered bands.',
  })
  getGradingScale(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.examinationsService.getGradingScale(
      this.requireInstitutionId(currentUser),
      id,
      currentUser,
    );
  }

  @Patch('grading-scales/:id')
  @Version('1')
  @RequirePermission('grading_scales', 'update')
  @ApiOperation({
    summary: 'Update a grading scale',
    description:
      'Updates name/description and, when bands is provided, replaces the whole band set.',
  })
  updateGradingScale(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateGradingScaleDto,
  ) {
    return this.examinationsService.updateGradingScale(
      this.requireInstitutionId(currentUser),
      id,
      dto,
      currentUser,
    );
  }

  @Patch('grading-scales/:id/set-current')
  @Version('1')
  @RequirePermission('grading_scales', 'update')
  @ApiOperation({
    summary: 'Set the current grading scale',
    description:
      "Flips the institution's current grading scale pointer to the given scale.",
  })
  setCurrentGradingScale(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.examinationsService.setCurrentGradingScale(
      this.requireInstitutionId(currentUser),
      id,
      currentUser,
    );
  }

  @Delete('grading-scales/:id')
  @Version('1')
  @RequirePermission('grading_scales', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a grading scale',
    description:
      "Moves a grading scale to the recycle bin. Blocked with a 409 while it is the institution's current scale.",
  })
  deleteGradingScale(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.examinationsService.deleteGradingScale(
      this.requireInstitutionId(currentUser),
      id,
      currentUser,
      dto.reason,
    );
  }

  @Post('exam-terms')
  @Version('1')
  @RequirePermission('exam_terms', 'create')
  @ApiOperation({
    summary: 'Create an exam term',
    description:
      'Creates an exam term (e.g. First Term, Annual) inside one academic year.',
  })
  createExamTerm(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Body() dto: CreateExamTermDto,
  ) {
    return this.examinationsService.createExamTerm(
      this.requireInstitutionId(currentUser),
      dto,
      currentUser,
    );
  }

  @Get('exam-terms')
  @Version('1')
  @RequirePermission('exam_terms', 'read')
  @ApiOperation({
    summary: 'List exam terms',
    description:
      "Returns the caller's institution exam terms, optionally for one academic year.",
  })
  listExamTerms(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.examinationsService.listExamTerms(
      this.requireInstitutionId(currentUser),
      currentUser,
      academicYearId,
    );
  }

  @Get('exam-terms/:id')
  @Version('1')
  @RequirePermission('exam_terms', 'read')
  @ApiOperation({
    summary: 'Get an exam term',
    description: 'Returns one exam term.',
  })
  getExamTerm(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.examinationsService.getExamTerm(
      this.requireInstitutionId(currentUser),
      id,
      currentUser,
    );
  }

  @Patch('exam-terms/:id')
  @Version('1')
  @RequirePermission('exam_terms', 'update')
  @ApiOperation({
    summary: 'Update an exam term',
    description: 'Updates name, weight, order or dates of an exam term.',
  })
  updateExamTerm(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateExamTermDto,
  ) {
    return this.examinationsService.updateExamTerm(
      this.requireInstitutionId(currentUser),
      id,
      dto,
      currentUser,
    );
  }

  @Delete('exam-terms/:id')
  @Version('1')
  @RequirePermission('exam_terms', 'delete')
  @ApiOperation({
    summary: 'Soft-delete an exam term',
    description: 'Moves an exam term to the recycle bin.',
  })
  deleteExamTerm(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.examinationsService.deleteExamTerm(
      this.requireInstitutionId(currentUser),
      id,
      currentUser,
      dto.reason,
    );
  }

  /**
   * Resolve the caller's own institution id for the institution-scoped
   * routes. The superadmin platform mirror takes its institution id from the
   * path param instead.
   *
   * @param {CurrentUserPayload} currentUser - Authenticated caller.
   * @returns {string} The caller's institution id.
   * @throws {ForbiddenException} If the caller's account is not scoped to an institution.
   */
  private requireInstitutionId(currentUser: CurrentUserPayload): string {
    if (!currentUser.institutionId) {
      throw new ForbiddenException(
        'Your account is not scoped to an institution.',
      );
    }
    return currentUser.institutionId;
  }
}
