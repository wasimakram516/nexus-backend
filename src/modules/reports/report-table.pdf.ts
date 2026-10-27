import { drawRow, PDF_COLORS, PdfCell } from '../../common/pdf/pdf-draw';
import { PDF_FONTS, PdfDocument } from '../../common/pdf/pdf.service';
import type { PrintableMeta } from '../../common/services/printable-meta.service';
import { formatDateTime } from '../../common/utils/date-format.util';
import {
  ReportCell,
  ReportColumn,
  ReportRow,
  ReportTable,
} from './report-table';

const MARGIN = 28;
const DEFAULT_ACCENT = '#1a237e';
/** A row can wrap onto a few lines, so a new page starts before the bottom edge. */
const ROW_ROOM = 44;

const text = (value: ReportCell | undefined) =>
  value === null || value === undefined ? '' : String(value);

/** The columns' relative widths as fractions of the row. */
function widthsOf(columns: ReportColumn[]): number[] {
  const total = columns.reduce((sum, column) => sum + (column.weight ?? 1), 0);
  return columns.map((column) => (column.weight ?? 1) / total);
}

const cellsOf = (
  columns: ReportColumn[],
  widths: number[],
  row: ReportRow,
  bold = false,
): PdfCell[] =>
  columns.map((column, index) => ({
    text: text(row[column.key]),
    width: widths[index],
    align: column.align ?? 'left',
    bold,
  }));

/**
 * Draw a report as a table on landscape pages: the school header, the report
 * name and what it covers, then the rows with the column headings repeated on
 * every page and any totals row last.
 *
 * @param {PdfDocument} doc - The document.
 * @param {ReportTable} table - The report.
 * @param {PrintableMeta} meta - The shared print header, with the school's timezone.
 * @param {Buffer | null} logo - The institution's logo, when available.
 */
export function drawReportTable(
  doc: PdfDocument,
  table: ReportTable,
  meta: PrintableMeta,
  logo: Buffer | null,
): void {
  const accent = meta.institution.branding.primaryColorLight ?? DEFAULT_ACCENT;
  const width = doc.page.width - MARGIN * 2;
  const bottom = doc.page.height - MARGIN;

  let textLeft = MARGIN;
  if (logo) {
    try {
      doc.image(logo, MARGIN, MARGIN, { fit: [44, 44] });
      textLeft = MARGIN + 54;
    } catch {
      // An image PDFKit cannot read must never stop the report.
    }
  }
  doc
    .font(PDF_FONTS.bold)
    .fontSize(14)
    .fillColor(PDF_COLORS.text)
    .text(meta.institution.name, textLeft, MARGIN + 2, { width: width - 200 });
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
    .fillColor(accent)
    .text('REPORT', MARGIN + width - 150, MARGIN + 6, {
      width: 150,
      align: 'right',
      characterSpacing: 0.8,
    });
  doc
    .lineWidth(2)
    .strokeColor(accent)
    .moveTo(MARGIN, MARGIN + 50)
    .lineTo(MARGIN + width, MARGIN + 50)
    .stroke();

  doc
    .font(PDF_FONTS.bold)
    .fontSize(13)
    .fillColor(PDF_COLORS.text)
    .text(table.title, MARGIN, MARGIN + 58);
  if (table.subtitle) {
    doc
      .font(PDF_FONTS.regular)
      .fontSize(9)
      .fillColor(PDF_COLORS.muted)
      .text(table.subtitle, MARGIN, doc.y + 1);
  }
  for (const note of table.notes) {
    doc
      .font(PDF_FONTS.regular)
      .fontSize(8)
      .fillColor(PDF_COLORS.muted)
      .text(note, MARGIN, doc.y + 1, { width });
  }

  const widths = widthsOf(table.columns);
  const head: PdfCell[] = table.columns.map((column, index) => ({
    text: column.label,
    width: widths[index],
    bold: true,
    align: column.align === 'right' ? 'right' : 'center',
  }));
  const drawHead = (y: number) =>
    drawRow(doc, MARGIN, y, width, head, {
      fontSize: 8,
      fill: PDF_COLORS.headFill,
    });

  let y = doc.y + 10;
  y += drawHead(y);

  if (table.rows.length === 0) {
    doc
      .font(PDF_FONTS.regular)
      .fontSize(10)
      .fillColor(PDF_COLORS.muted)
      .text('There is nothing to report for this selection.', MARGIN, y + 10);
    y += 30;
  }

  const drawBodyRow = (row: ReportRow, bold = false, fill?: string) => {
    if (y + ROW_ROOM > bottom) {
      doc.addPage();
      y = MARGIN;
      y += drawHead(y);
    }
    y += drawRow(
      doc,
      MARGIN,
      y,
      width,
      cellsOf(table.columns, widths, row, bold),
      {
        fontSize: 8,
        fill,
      },
    );
  };
  for (const row of table.rows) drawBodyRow(row);
  if (table.totals) drawBodyRow(table.totals, true, PDF_COLORS.grey);

  doc
    .font(PDF_FONTS.regular)
    .fontSize(7)
    .fillColor(PDF_COLORS.muted)
    .text(
      `Printed ${formatDateTime(new Date(), meta.timezone)}.`,
      MARGIN,
      Math.min(y + 8, bottom - 8),
      { width },
    );
}
