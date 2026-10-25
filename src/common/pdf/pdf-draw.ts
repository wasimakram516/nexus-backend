import { PDF_FONTS, PdfDocument } from './pdf.service';

export const PDF_COLORS = {
  line: '#777777',
  headFill: '#f1f1f1',
  grey: '#d9d9d9',
  black: '#000000',
  white: '#ffffff',
  text: '#111111',
  muted: '#555555',
} as const;

export interface PdfCell {
  text: string;
  /** Share of the row's width, as a fraction. */
  width: number;
  bold?: boolean;
  align?: 'left' | 'right' | 'center';
}

/** A month and year as `Sep 2026`-style text without depending on the server's locale. */
export function formatPdfDate(value: Date | string): string {
  const date = new Date(value);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${String(date.getUTCDate()).padStart(2, '0')}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

/**
 * One bordered row of cells at a fixed width, as tall as its tallest cell.
 *
 * @param {PdfDocument} doc - The document.
 * @param {number} x - Left edge.
 * @param {number} y - Top edge.
 * @param {number} width - Row width.
 * @param {PdfCell[]} cells - The cells, whose widths add up to 1.
 * @param {{fontSize?: number, fill?: string, minHeight?: number}} [options] - Text size, background and minimum height.
 * @returns {number} The height used.
 */
export function drawRow(
  doc: PdfDocument,
  x: number,
  y: number,
  width: number,
  cells: PdfCell[],
  options: { fontSize?: number; fill?: string; minHeight?: number } = {},
): number {
  const fontSize = options.fontSize ?? 8;
  const padding = 3;
  doc.fontSize(fontSize);
  let height = options.minHeight ?? 14;
  for (const cell of cells) {
    doc.font(cell.bold ? PDF_FONTS.bold : PDF_FONTS.regular);
    height = Math.max(
      height,
      doc.heightOfString(cell.text, {
        width: cell.width * width - padding * 2,
      }) +
        padding * 2,
    );
  }
  if (options.fill) {
    doc.rect(x, y, width, height).fill(options.fill);
  }
  doc.lineWidth(0.5).strokeColor(PDF_COLORS.line);
  doc.rect(x, y, width, height).stroke();
  let cursor = x;
  cells.forEach((cell, index) => {
    const cellWidth = cell.width * width;
    if (index > 0) {
      doc
        .moveTo(cursor, y)
        .lineTo(cursor, y + height)
        .stroke();
    }
    doc
      .font(cell.bold ? PDF_FONTS.bold : PDF_FONTS.regular)
      .fillColor(PDF_COLORS.text)
      .text(cell.text, cursor + padding, y + padding, {
        width: cellWidth - padding * 2,
        align: cell.align ?? 'left',
      });
    cursor += cellWidth;
  });
  return height;
}

/**
 * A block of text inside a box, clipped to the space it is given so a long
 * instruction can never run over the footer below it.
 *
 * @param {PdfDocument} doc - The document.
 * @param {number} x - Left edge.
 * @param {number} y - Top edge.
 * @param {number} width - Box width.
 * @param {number} height - Box height.
 * @param {string[]} lines - One paragraph each.
 * @param {number} fontSize - Text size.
 */
export function drawTextBlock(
  doc: PdfDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  lines: string[],
  fontSize: number,
): void {
  doc
    .lineWidth(0.5)
    .strokeColor(PDF_COLORS.line)
    .rect(x, y, width, height)
    .stroke();
  doc.font(PDF_FONTS.bold).fontSize(fontSize).fillColor(PDF_COLORS.text);
  doc.text(lines.join('\n'), x + 3, y + 3, {
    width: width - 6,
    height: height - 6,
    ellipsis: true,
    paragraphGap: 2,
  });
}
