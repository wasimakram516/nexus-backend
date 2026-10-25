import { drawRow, PDF_COLORS, PdfCell } from '../../common/pdf/pdf-draw';
import { PDF_FONTS, PdfDocument } from '../../common/pdf/pdf.service';
import {
  formatClockRange,
  formatDate,
  formatDateTime,
} from '../../common/utils/date-format.util';
import type { PrintableMeta } from '../../common/services/printable-meta.service';
import { DayOfWeek } from '../../prisma/client';
import { buildGrid, cellLines } from './timetable-grid.util';
import type { TimetableGroup, TimetableWeek } from './timetable-views.service';

const MARGIN = 28;
const DEFAULT_ACCENT = '#1a237e';

const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
  FRIDAY: 'Friday',
  SATURDAY: 'Saturday',
  SUNDAY: 'Sunday',
};

/**
 * Draw one or more timetables, a landscape page each: the school header, whose
 * timetable it is and the week, then a table with a column per day and a row
 * per time slot. A covered period names the teacher who is really taking it.
 *
 * @param {PdfDocument} doc - The document; a page is added for every group after the first.
 * @param {TimetableGroup[]} groups - The timetables to draw.
 * @param {TimetableWeek} week - The week shown.
 * @param {PrintableMeta} meta - The shared print header.
 * @param {Buffer | null} logo - The institution's logo, when available.
 */
export function drawTimetables(
  doc: PdfDocument,
  groups: TimetableGroup[],
  week: TimetableWeek,
  meta: PrintableMeta,
  logo: Buffer | null,
): void {
  const accent = meta.institution.branding.primaryColorLight ?? DEFAULT_ACCENT;
  const width = doc.page.width - MARGIN * 2;

  groups.forEach((group, index) => {
    if (index > 0) doc.addPage();
    const top = MARGIN;
    let textLeft = MARGIN;
    if (logo) {
      try {
        doc.image(logo, MARGIN, top, { fit: [44, 44] });
        textLeft = MARGIN + 54;
      } catch {
        // An image PDFKit cannot read must never stop the timetable.
      }
    }
    doc
      .font(PDF_FONTS.bold)
      .fontSize(14)
      .fillColor(PDF_COLORS.text)
      .text(meta.institution.name, textLeft, top + 2, { width: width - 200 });
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
      .text('TIMETABLE', MARGIN + width - 150, top + 6, {
        width: 150,
        align: 'right',
        characterSpacing: 0.8,
      });
    doc
      .lineWidth(2)
      .strokeColor(accent)
      .moveTo(MARGIN, top + 50)
      .lineTo(MARGIN + width, top + 50)
      .stroke();

    doc
      .font(PDF_FONTS.bold)
      .fontSize(13)
      .fillColor(PDF_COLORS.text)
      .text(group.title, MARGIN, top + 58);
    doc
      .font(PDF_FONTS.regular)
      .fontSize(9)
      .fillColor(PDF_COLORS.muted)
      .text(
        [
          group.subtitle,
          `Week of ${formatDate(week.from)} to ${formatDate(week.to)}`,
        ]
          .filter(Boolean)
          .join(' · '),
        MARGIN,
        doc.y + 1,
      );

    let y = doc.y + 10;
    const forTeacher = group.kind === 'TEACHER';
    const grid = buildGrid(group.entries);
    const dayWidth = 0.88 / grid.days.length;

    const header: PdfCell[] = [
      { text: 'Period', width: 0.12, bold: true },
      ...grid.days.map((day) => ({
        text: grid.dates.has(day)
          ? `${DAY_LABELS[day]}\n${formatDate(grid.dates.get(day) as string)}`
          : DAY_LABELS[day],
        width: dayWidth,
        bold: true,
        align: 'center' as const,
      })),
    ];
    y += drawRow(doc, MARGIN, y, width, header, {
      fontSize: 9,
      fill: PDF_COLORS.headFill,
    });

    if (grid.rows.length === 0) {
      doc
        .font(PDF_FONTS.regular)
        .fontSize(10)
        .fillColor(PDF_COLORS.muted)
        .text('There are no periods in this timetable yet.', MARGIN, y + 10);
      return;
    }

    for (const row of grid.rows) {
      const cells: PdfCell[] = [
        {
          text: `${row.label}\n${formatClockRange(row.startTime, row.endTime)}`,
          width: 0.12,
          bold: true,
        },
        ...grid.days.map((day) => ({
          text: (row.cells.get(day) ?? [])
            .map((entry) => cellLines(entry, forTeacher).join('\n'))
            .join('\n\n'),
          width: dayWidth,
          align: 'center' as const,
        })),
      ];
      if (y + 50 > doc.page.height - MARGIN) {
        doc.addPage();
        y = MARGIN;
      }
      y += drawRow(doc, MARGIN, y, width, cells, {
        fontSize: 8.5,
        minHeight: 34,
      });
    }

    doc
      .font(PDF_FONTS.regular)
      .fontSize(7)
      .fillColor(PDF_COLORS.muted)
      .text(
        `Printed ${formatDateTime(new Date(), meta.timezone)}. A period marked cover is taken by a substitute on that date only.`,
        MARGIN,
        Math.min(y + 8, doc.page.height - MARGIN - 8),
        { width },
      );
  });
}
