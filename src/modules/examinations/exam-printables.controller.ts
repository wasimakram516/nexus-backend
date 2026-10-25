import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
  Version,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserDecorator } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser as CurrentUserPayload } from '../../common/interfaces/current-user.interface';
import { ClassResultSummaryQueryDto } from './dto/examinations.dto';
import { sendPdf } from '../../common/pdf/send-pdf';
import { ExamPdfService } from './exam-pdf.service';
import { ExamPrintablesService } from './exam-printables.service';

@ApiTags('Examinations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('examinations/exams')
export class ExamPrintablesController {
  constructor(
    private readonly printablesService: ExamPrintablesService,
    private readonly pdfService: ExamPdfService,
  ) {}

  // The datesheet and a student's own admit card carry no permission
  // decorator: students and guardians read them too, so the service checks
  // that the caller is staff with read access or belongs to the exam's class.
  @Get(':id/datesheet/pdf')
  @Version('1')
  @ApiOperation({ summary: 'Download the datesheet of an exam as a PDF' })
  async downloadDatesheetPdf(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return sendPdf(response, await this.pdfService.datesheet(currentUser, id));
  }

  @Get(':id/students/:studentId/admit-card/pdf')
  @Version('1')
  @ApiOperation({ summary: "Download one student's admit card as a PDF" })
  async downloadAdmitCardPdf(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
    @Param('studentId') studentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return sendPdf(
      response,
      await this.pdfService.admitCard(currentUser, id, studentId),
    );
  }

  @Get(':id/admit-cards/pdf')
  @Version('1')
  @RequirePermission('exams', 'read')
  @ApiOperation({
    summary: 'Download admit cards for a class or section as a PDF',
  })
  async downloadAdmitCardsPdf(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
    @Query() query: ClassResultSummaryQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return sendPdf(
      response,
      await this.pdfService.admitCards(currentUser, id, query.sectionId),
    );
  }

  @Get(':id/datesheet')
  @Version('1')
  @ApiOperation({
    summary: 'Get the datesheet of an exam',
    description:
      'The exam papers in date order with times and rooms, plus the shared print header. Visible whether or not the exam is published.',
  })
  getDatesheet(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.printablesService.getDatesheet(currentUser, id);
  }

  @Get(':id/students/:studentId/admit-card')
  @Version('1')
  @ApiOperation({
    summary: "Get one student's admit card",
    description:
      'The student, their class and section, and the datesheet, plus the print header. Staff, or the student or their guardian.',
  })
  getAdmitCard(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
    @Param('studentId') studentId: string,
  ) {
    return this.printablesService.getAdmitCard(currentUser, id, studentId);
  }

  @Get(':id/admit-cards')
  @Version('1')
  @RequirePermission('exams', 'read')
  @ApiOperation({
    summary: 'Get admit cards for a class or section',
    description:
      'One card per enrolled student for printing, with a single shared print header.',
  })
  getAdmitCards(
    @CurrentUserDecorator() currentUser: CurrentUserPayload,
    @Param('id') id: string,
    @Query() query: ClassResultSummaryQueryDto,
  ) {
    return this.printablesService.getAdmitCards(
      currentUser,
      id,
      query.sectionId,
    );
  }
}
