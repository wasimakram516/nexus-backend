import { Injectable } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PdfService } from '../../common/pdf/pdf.service';
import {
  drawAdmitCards,
  drawDatesheet,
  drawReportCards,
} from './exam-documents.pdf';
import { ExamPrintablesService } from './exam-printables.service';
import { ExamReportCardsService } from './exam-report-cards.service';

export interface PdfFile {
  buffer: Buffer;
  filename: string;
}

const safe = (text: string) =>
  text
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'document';

/**
 * Exam documents as downloadable PDF files, drawn from exactly the data the
 * on-screen print layouts read, so the two always agree. Access is decided by
 * the same services that serve the on-screen documents.
 */
@Injectable()
export class ExamPdfService {
  constructor(
    private readonly printables: ExamPrintablesService,
    private readonly reportCards: ExamReportCardsService,
    private readonly pdf: PdfService,
  ) {}

  /**
   * An exam's datesheet.
   *
   * @param {CurrentUser} currentUser - Staff with exam read access, or a student or guardian of the exam's class.
   * @param {string} examId - The exam.
   * @returns {Promise<PdfFile>} The PDF and a file name.
   */
  async datesheet(currentUser: CurrentUser, examId: string): Promise<PdfFile> {
    const { data } = await this.printables.getDatesheet(currentUser, examId);
    const logo = await this.pdf.fetchImage(data.printMeta.institution.logoUrl);
    const buffer = await this.pdf.render(
      (doc) => drawDatesheet(doc, data, logo),
      { title: `Datesheet ${data.exam.name}` },
    );
    return { buffer, filename: `datesheet-${safe(data.exam.name)}.pdf` };
  }

  /**
   * One student's admit card.
   *
   * @param {CurrentUser} currentUser - Staff with exam read access, or the student or their guardian.
   * @param {string} examId - The exam.
   * @param {string} studentId - The student.
   * @returns {Promise<PdfFile>} The PDF and a file name.
   */
  async admitCard(
    currentUser: CurrentUser,
    examId: string,
    studentId: string,
  ): Promise<PdfFile> {
    const { data } = await this.printables.getAdmitCard(
      currentUser,
      examId,
      studentId,
    );
    const logo = await this.pdf.fetchImage(data.printMeta.institution.logoUrl);
    const buffer = await this.pdf.render(
      (doc) => drawAdmitCards(doc, [data], data.printMeta, logo),
      { title: `Admit card ${data.student.name}` },
    );
    return { buffer, filename: `admit-card-${safe(data.student.name)}.pdf` };
  }

  /**
   * The admit cards of a whole class or one section.
   *
   * @param {CurrentUser} currentUser - Staff with exam read access.
   * @param {string} examId - The exam.
   * @param {string} [sectionId] - Limit to one section.
   * @returns {Promise<PdfFile>} The PDF and a file name.
   */
  async admitCards(
    currentUser: CurrentUser,
    examId: string,
    sectionId?: string,
  ): Promise<PdfFile> {
    const { data } = await this.printables.getAdmitCards(
      currentUser,
      examId,
      sectionId,
    );
    const logo = await this.pdf.fetchImage(data.printMeta.institution.logoUrl);
    const buffer = await this.pdf.render(
      (doc) => {
        if (data.cards.length === 0) {
          doc
            .fontSize(12)
            .text('There are no students enrolled for this choice.');
          return;
        }
        drawAdmitCards(doc, data.cards, data.printMeta, logo);
      },
      { title: 'Admit cards' },
    );
    return { buffer, filename: 'admit-cards.pdf' };
  }

  /**
   * One student's report card for a year.
   *
   * @param {CurrentUser} currentUser - Staff with results access, or the student or their guardian.
   * @param {string} studentId - The student.
   * @param {string} academicYearId - The academic year.
   * @returns {Promise<PdfFile>} The PDF and a file name.
   */
  async reportCard(
    currentUser: CurrentUser,
    studentId: string,
    academicYearId: string,
  ): Promise<PdfFile> {
    const { data } = await this.reportCards.getReportCard(
      currentUser,
      studentId,
      academicYearId,
    );
    const logo = await this.pdf.fetchImage(data.printMeta.institution.logoUrl);
    const buffer = await this.pdf.render(
      (doc) => drawReportCards(doc, [data], data.printMeta, logo),
      { title: `Report card ${data.student.name}` },
    );
    return { buffer, filename: `report-card-${safe(data.student.name)}.pdf` };
  }

  /**
   * The report cards of a class or one section.
   *
   * @param {CurrentUser} currentUser - Staff with results access.
   * @param {string} academicYearId - The academic year.
   * @param {string} classId - The class.
   * @param {string} [sectionId] - Limit to one section.
   * @returns {Promise<PdfFile>} The PDF and a file name.
   */
  async classReportCards(
    currentUser: CurrentUser,
    academicYearId: string,
    classId: string,
    sectionId?: string,
  ): Promise<PdfFile> {
    const { data } = await this.reportCards.getReportCards(
      currentUser,
      academicYearId,
      classId,
      sectionId,
    );
    const logo = await this.pdf.fetchImage(data.printMeta.institution.logoUrl);
    const buffer = await this.pdf.render(
      (doc) => {
        if (data.cards.length === 0) {
          doc
            .fontSize(12)
            .text('There are no students enrolled for this choice.');
          return;
        }
        drawReportCards(doc, data.cards, data.printMeta, logo);
      },
      { title: 'Report cards' },
    );
    return { buffer, filename: 'report-cards.pdf' };
  }
}
