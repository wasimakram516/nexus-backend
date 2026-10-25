import { drawRow, PDF_COLORS, PdfCell } from '../../common/pdf/pdf-draw';
import { PDF_FONTS, PdfDocument } from '../../common/pdf/pdf.service';
import {
  formatClockRange,
  formatClockTime,
  formatDate,
} from '../../common/utils/date-format.util';
import type { PrintableMeta } from '../../common/services/printable-meta.service';
import type { PrintableCustomValue } from '../../common/services/printable-custom-values.service';
import type { ExamReportCardsService } from './exam-report-cards.service';
import type { ExamPrintablesService } from './exam-printables.service';

type Datesheet = Awaited<
  ReturnType<ExamPrintablesService['getDatesheet']>
>['data'];
type AdmitCardsResult = Awaited<
  ReturnType<ExamPrintablesService['getAdmitCards']>
>['data'];
type AdmitCard = AdmitCardsResult['cards'][number];
type ReportCardsResult = Awaited<
  ReturnType<ExamReportCardsService['getReportCards']>
>['data'];
type ReportCard = ReportCardsResult['cards'][number];

export const MARGIN = 36;
const DEFAULT_ACCENT = '#1a237e';

const STATUS_LABELS: Record<string, string> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  ABSENT: 'Absent',
  INCOMPLETE: 'Incomplete',
};

/** `1st`, `2nd`, `3rd`, `4th`, `11th`. */
export function ordinal(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] ?? 'th';
  return `${value}${suffix}`;
}

/** A percentage to at most two decimals, or a dash when there is none. */
export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined
    ? '-'
    : `${Number(value.toFixed(2))}%`;
}

/** `2nd of 30`, or a dash when the student has no position. */
export function formatPosition(position: number | null, size: number): string {
  return position === null || size === 0
    ? '-'
    : `${ordinal(position)} of ${size}`;
}

function accentOf(meta: PrintableMeta): string {
  return meta.institution.branding.primaryColorLight ?? DEFAULT_ACCENT;
}

/** The institution's name and campus at the top of a document, with the document's own title at the right. */
function drawHeader(
  doc: PdfDocument,
  meta: PrintableMeta,
  title: string,
  logo: Buffer | null,
): number {
  const left = MARGIN;
  const width = doc.page.width - MARGIN * 2;
  const top = doc.y > MARGIN ? doc.y : MARGIN;
  let textLeft = left;
  if (logo) {
    try {
      doc.image(logo, left, top, { fit: [48, 48] });
      textLeft = left + 58;
    } catch {
      // An image PDFKit cannot read must never stop the document.
    }
  }
  doc
    .font(PDF_FONTS.bold)
    .fontSize(14)
    .fillColor(PDF_COLORS.text)
    .text(meta.institution.name, textLeft, top + 4, {
      width: width - (textLeft - left) - 130,
    });
  if (meta.campus) {
    doc
      .font(PDF_FONTS.regular)
      .fontSize(9)
      .fillColor(PDF_COLORS.muted)
      .text(meta.campus.name, textLeft, doc.y + 1);
  }
  doc
    .font(PDF_FONTS.bold)
    .fontSize(11)
    .fillColor(accentOf(meta))
    .text(title.toUpperCase(), left + width - 130, top + 8, {
      width: 130,
      align: 'right',
      characterSpacing: 0.8,
    });
  const ruleY = top + 54;
  doc
    .lineWidth(2)
    .strokeColor(accentOf(meta))
    .moveTo(left, ruleY)
    .lineTo(left + width, ruleY)
    .stroke();
  doc.y = ruleY + 10;
  doc.x = left;
  return doc.y;
}

/** Starts a new page when the next block would not fit. */
function ensureSpace(doc: PdfDocument, y: number, needed: number): number {
  if (y + needed <= doc.page.height - MARGIN) return y;
  doc.addPage();
  return MARGIN;
}

function drawTable(
  doc: PdfDocument,
  y: number,
  header: PdfCell[],
  rows: PdfCell[][],
): number {
  const width = doc.page.width - MARGIN * 2;
  let cursor = ensureSpace(doc, y, 40);
  cursor += drawRow(doc, MARGIN, cursor, width, header, {
    fontSize: 9,
    fill: PDF_COLORS.headFill,
  });
  for (const cells of rows) {
    cursor = ensureSpace(doc, cursor, 24);
    cursor += drawRow(doc, MARGIN, cursor, width, cells, { fontSize: 9 });
  }
  return cursor;
}

function drawCustomValues(
  doc: PdfDocument,
  y: number,
  values: PrintableCustomValue[],
): number {
  const width = doc.page.width - MARGIN * 2;
  let cursor = y;
  for (const field of values) {
    cursor += drawRow(
      doc,
      MARGIN,
      cursor,
      width,
      [
        { text: field.label, width: 0.3, bold: true },
        { text: field.value, width: 0.7 },
      ],
      { fontSize: 9 },
    );
  }
  return cursor;
}

function timeRange(start: string | null, end: string | null): string {
  if (start && end) return formatClockRange(start, end);
  return start ? formatClockTime(start) : '-';
}

function paperRows(papers: Datesheet['papers']): PdfCell[][] {
  return papers.map((paper) => [
    {
      text: paper.examDate ? formatDate(paper.examDate) : 'To be announced',
      width: 0.22,
    },
    { text: paper.subjectName, width: 0.32, bold: true },
    { text: timeRange(paper.startTime, paper.endTime), width: 0.2 },
    { text: paper.room ?? '-', width: 0.14 },
    { text: String(paper.maxMarks), width: 0.12, align: 'right' as const },
  ]);
}

const PAPER_HEADER: PdfCell[] = [
  { text: 'Date', width: 0.22, bold: true },
  { text: 'Subject', width: 0.32, bold: true },
  { text: 'Time', width: 0.2, bold: true },
  { text: 'Room', width: 0.14, bold: true },
  { text: 'Max marks', width: 0.12, bold: true, align: 'right' },
];

function examLine(exam: Datesheet['exam']): string {
  return `${exam.className} · ${exam.termName} · ${exam.academicYearName}`;
}

/**
 * The datesheet of one exam on a single portrait page.
 *
 * @param {PdfDocument} doc - The document.
 * @param {Datesheet} datesheet - The exam, its papers and the print header.
 * @param {Buffer | null} logo - The institution's logo, when available.
 */
export function drawDatesheet(
  doc: PdfDocument,
  datesheet: Datesheet,
  logo: Buffer | null,
): void {
  let y = drawHeader(doc, datesheet.printMeta, 'Datesheet', logo);
  doc
    .font(PDF_FONTS.bold)
    .fontSize(13)
    .fillColor(PDF_COLORS.text)
    .text(datesheet.exam.name, MARGIN, y);
  doc
    .font(PDF_FONTS.regular)
    .fontSize(9)
    .fillColor(PDF_COLORS.muted)
    .text(examLine(datesheet.exam), MARGIN, doc.y + 1);
  y = doc.y + 10;
  y = drawCustomValues(doc, y, datesheet.exam.customValues);
  y += datesheet.exam.customValues.length > 0 ? 10 : 0;
  drawTable(doc, y, PAPER_HEADER, paperRows(datesheet.papers));
}

/**
 * One admit card per page: who the student is, the exam, and its papers, with
 * lines for the signatures.
 *
 * @param {PdfDocument} doc - The document; a page is added for every card after the first.
 * @param {AdmitCard[]} cards - The cards to draw.
 * @param {PrintableMeta} meta - The shared print header.
 * @param {Buffer | null} logo - The institution's logo, when available.
 */
export function drawAdmitCards(
  doc: PdfDocument,
  cards: AdmitCard[],
  meta: PrintableMeta,
  logo: Buffer | null,
): void {
  cards.forEach((card, index) => {
    if (index > 0) doc.addPage();
    let y = drawHeader(doc, meta, 'Admit card', logo);
    doc
      .font(PDF_FONTS.bold)
      .fontSize(13)
      .fillColor(PDF_COLORS.text)
      .text(card.student.name, MARGIN, y);
    doc
      .font(PDF_FONTS.regular)
      .fontSize(9)
      .fillColor(PDF_COLORS.muted)
      .text(
        `Reg. no. ${card.student.regNo} · ${card.student.className}${card.student.sectionName ? `, Section ${card.student.sectionName}` : ''}`,
        MARGIN,
        doc.y + 1,
      );
    doc
      .font(PDF_FONTS.bold)
      .fontSize(11)
      .fillColor(PDF_COLORS.text)
      .text(card.exam.name, MARGIN, doc.y + 8);
    doc
      .font(PDF_FONTS.regular)
      .fontSize(9)
      .fillColor(PDF_COLORS.muted)
      .text(examLine(card.exam), MARGIN, doc.y + 1);
    y = doc.y + 10;
    y = drawCustomValues(doc, y, card.exam.customValues);
    y += card.exam.customValues.length > 0 ? 10 : 0;
    y = drawTable(doc, y, PAPER_HEADER, paperRows(card.papers));

    // Signature lines.
    y = ensureSpace(doc, y + 60, 40);
    const half = (doc.page.width - MARGIN * 2) / 2;
    doc.lineWidth(0.5).strokeColor(PDF_COLORS.line);
    [
      ['Student signature', MARGIN],
      ['Controller of Examinations', MARGIN + half],
    ].forEach(([label, x]) => {
      doc
        .moveTo(x as number, y)
        .lineTo((x as number) + half - 30, y)
        .stroke();
      doc
        .font(PDF_FONTS.regular)
        .fontSize(8)
        .fillColor(PDF_COLORS.muted)
        .text(label as string, x as number, y + 3);
    });
  });
}

/** The marks cell of a subject: the mark, or why there is none. */
function describeMarks(
  subject: ReportCard['terms'][number]['outcome']['subjects'][number],
): string {
  if (subject.state === 'ABSENT') return 'Absent';
  if (subject.state === 'UNMARKED') return 'Pending';
  return `${subject.marksObtained}`;
}

/** The note under a subject whose mark was replaced by a retake. */
function describeRetake(
  subject: ReportCard['terms'][number]['outcome']['subjects'][number],
): string {
  if (!subject.isRetake) return '';
  const kind = subject.retakeExamType
    ? subject.retakeExamType.toLowerCase()
    : 'retake';
  const original =
    subject.originalMarksObtained === null ||
    subject.originalMarksObtained === undefined
      ? 'no original mark'
      : `original ${subject.originalMarksObtained}${subject.originalGrade ? ` (${subject.originalGrade})` : ''}`;
  return `Counted from the ${kind}; ${original}`;
}

/**
 * One report card per student: each published term's subjects, marks, grades
 * and positions, then the annual result.
 *
 * @param {PdfDocument} doc - The document; a page is added for every card after the first.
 * @param {ReportCard[]} cards - The cards to draw.
 * @param {PrintableMeta} meta - The shared print header.
 * @param {Buffer | null} logo - The institution's logo, when available.
 */
export function drawReportCards(
  doc: PdfDocument,
  cards: ReportCard[],
  meta: PrintableMeta,
  logo: Buffer | null,
): void {
  const width = doc.page.width - MARGIN * 2;
  cards.forEach((card, index) => {
    if (index > 0) doc.addPage();
    let y = drawHeader(doc, meta, 'Report card', logo);
    doc
      .font(PDF_FONTS.bold)
      .fontSize(13)
      .fillColor(PDF_COLORS.text)
      .text(card.student.name, MARGIN, y);
    doc
      .font(PDF_FONTS.regular)
      .fontSize(9)
      .fillColor(PDF_COLORS.muted)
      .text(
        `Reg. no. ${card.student.regNo} · ${card.student.className}${card.student.sectionName ? `, Section ${card.student.sectionName}` : ''} · ${card.academicYear.name}`,
        MARGIN,
        doc.y + 1,
      );
    y = doc.y + 12;

    if (card.terms.length === 0) {
      doc
        .fontSize(10)
        .fillColor(PDF_COLORS.text)
        .text('No results have been published for this year yet.', MARGIN, y);
      return;
    }

    for (const term of card.terms) {
      y = ensureSpace(doc, y, 90);
      doc
        .font(PDF_FONTS.bold)
        .fontSize(10.5)
        .fillColor(PDF_COLORS.text)
        .text(`${term.term.name} · ${term.exam.name}`, MARGIN, y);
      y = doc.y + 3;
      y = drawCustomValues(doc, y, term.exam.customValues);
      y += term.exam.customValues.length > 0 ? 4 : 0;

      const rows: PdfCell[][] = term.outcome.subjects.map((subject) => {
        const note = describeRetake(subject);
        return [
          {
            text: note
              ? `${subject.subjectName}\n${note}`
              : subject.subjectName,
            width: 0.4,
          },
          {
            text: String(subject.maxMarks),
            width: 0.14,
            align: 'right' as const,
          },
          {
            text: describeMarks(subject),
            width: 0.16,
            align: 'right' as const,
          },
          {
            text: formatPercent(subject.percentage),
            width: 0.16,
            align: 'right' as const,
          },
          { text: subject.grade ?? '-', width: 0.14 },
        ];
      });
      rows.push([
        { text: 'Total', width: 0.4, bold: true },
        {
          text: String(term.outcome.totalMaxMarks),
          width: 0.14,
          bold: true,
          align: 'right',
        },
        {
          text: String(term.outcome.totalMarks),
          width: 0.16,
          bold: true,
          align: 'right',
        },
        {
          text: formatPercent(term.outcome.percentage),
          width: 0.16,
          bold: true,
          align: 'right',
        },
        { text: term.outcome.grade ?? '-', width: 0.14, bold: true },
      ]);
      y = drawTable(
        doc,
        y,
        [
          { text: 'Subject', width: 0.4, bold: true },
          { text: 'Out of', width: 0.14, bold: true, align: 'right' },
          { text: 'Marks', width: 0.16, bold: true, align: 'right' },
          { text: '%', width: 0.16, bold: true, align: 'right' },
          { text: 'Grade', width: 0.14, bold: true },
        ],
        rows,
      );
      doc
        .font(PDF_FONTS.regular)
        .fontSize(9)
        .fillColor(PDF_COLORS.text)
        .text(
          `Result: ${STATUS_LABELS[term.outcome.status] ?? term.outcome.status} · Class position: ${formatPosition(term.positionInClass, term.classSize)} · Section position: ${formatPosition(term.positionInSection, term.sectionSize)}`,
          MARGIN,
          y + 4,
          { width },
        );
      y = doc.y + 14;
    }

    if (card.annual) {
      y = ensureSpace(doc, y, 60);
      const text = `Overall ${formatPercent(card.annual.percentage)}${card.annual.grade ? ` · Grade ${card.annual.grade}` : ''} · ${STATUS_LABELS[card.annual.status] ?? card.annual.status}`;
      const detail = card.annual.subjects
        .map((s) => `${s.subjectName} ${formatPercent(s.percentage)}`)
        .join(' · ');
      doc.font(PDF_FONTS.regular).fontSize(9);
      const boxHeight =
        18 +
        doc.heightOfString(text, { width: width - 16 }) +
        doc.heightOfString(detail, { width: width - 16 }) +
        10;
      doc
        .lineWidth(1.5)
        .strokeColor(PDF_COLORS.text)
        .rect(MARGIN, y, width, boxHeight)
        .stroke();
      doc
        .font(PDF_FONTS.bold)
        .fontSize(10)
        .fillColor(PDF_COLORS.text)
        .text('Annual result', MARGIN + 8, y + 6);
      doc
        .font(PDF_FONTS.regular)
        .fontSize(9)
        .text(text, MARGIN + 8, doc.y + 2, { width: width - 16 });
      doc
        .fillColor(PDF_COLORS.muted)
        .text(detail, MARGIN + 8, doc.y + 2, { width: width - 16 });
    }
  });
}
