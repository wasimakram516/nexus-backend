import { drawRow, drawTextBlock, PDF_COLORS } from '../../common/pdf/pdf-draw';
import { PDF_FONTS, PdfDocument } from '../../common/pdf/pdf.service';
import { amountInWords } from '../../common/utils/amount-in-words.util';
import { formatDate } from '../../common/utils/date-format.util';
import type { PrintableFeeVoucher } from './fee-voucher-printables.service';

export const VOUCHER_COPIES = ['Student Copy', 'School Copy', 'Bank Copy'];

/** Shown when the school has not written its own instructions. */
export const DEFAULT_VOUCHER_NOTES = [
  'Please pay your fee on or before the due date.',
  'A fine will be charged on payments made after the due date.',
  'Keep the bank receipt as proof of payment.',
];

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const isPositive = (amount: string) => Number(amount) > 0;

/**
 * Draw one voucher as a landscape page with its student, school and bank
 * copies side by side, mirroring the on-screen print layout: the instructions
 * fill the space down to a footer fixed at the bottom of the page.
 *
 * @param {PdfDocument} doc - The document; a page is added for this voucher.
 * @param {PrintableFeeVoucher} item - The voucher's printable data.
 * @param {Buffer | null} logo - The institution's logo, when it could be fetched.
 */
export function drawVoucherPage(
  doc: PdfDocument,
  item: PrintableFeeVoucher,
  logo: Buffer | null,
): void {
  const margin = 20;
  const gap = 10;
  const top = margin;
  const bottom = doc.page.height - margin;
  const columnWidth = (doc.page.width - margin * 2 - gap * 2) / 3;
  const { voucher, student, bank, print, printMeta } = item;
  const currency = print.currencyLabel;

  VOUCHER_COPIES.forEach((copy, index) => {
    const x = margin + index * (columnWidth + gap);
    let y = top;

    // Logo and the name of this copy.
    const headerHeight = 40;
    doc.lineWidth(0.5).strokeColor(PDF_COLORS.line);
    doc.rect(x, y, columnWidth, headerHeight).stroke();
    doc.rect(x + 74, y, columnWidth - 74, headerHeight).fill(PDF_COLORS.grey);
    if (logo) {
      try {
        doc.image(logo, x + 4, y + 4, { fit: [66, headerHeight - 8] });
      } catch {
        // An image PDFKit cannot read must never stop the voucher.
      }
    }
    doc
      .font(PDF_FONTS.bold)
      .fontSize(11)
      .fillColor(PDF_COLORS.text)
      .text(copy, x + 74, y + 14, { width: columnWidth - 74, align: 'center' });
    y += headerHeight;

    // Invoice details.
    const details: Array<[string, string]> = [
      ['Invoice #', voucher.voucherNumber],
      ['Invoice Date', formatDate(voucher.issueDate, printMeta.timezone)],
      ['Due Date', formatDate(voucher.dueDate, printMeta.timezone)],
    ];
    const detailsHeight = details.length * 14 + 6;
    doc.rect(x, y, columnWidth, detailsHeight).stroke();
    details.forEach(([label, value], line) => {
      const lineY = y + 4 + line * 14;
      doc
        .font(PDF_FONTS.bold)
        .fontSize(9)
        .text(label, x + 3, lineY, {
          width: columnWidth * 0.42,
          align: 'right',
        });
      doc
        .font(line === 0 ? PDF_FONTS.bold : PDF_FONTS.regular)
        .text(value, x + columnWidth * 0.42 + 8, lineY, {
          width: columnWidth * 0.58 - 10,
        });
    });
    y += detailsHeight;

    // Student.
    const info: Array<[string, string]> = [
      ['Student ID', student.regNo],
      ['Student Name', student.name],
      ['Class', student.className ?? '-'],
      ['Section', student.sectionName ?? '-'],
      ['Period', `${MONTH_NAMES[voucher.month - 1]} ${voucher.year}`],
    ];
    for (const [label, value] of info) {
      y += drawRow(doc, x, y, columnWidth, [
        { text: label, width: 0.42, bold: true },
        { text: value, width: 0.58 },
      ]);
    }

    // Particulars.
    y += drawRow(
      doc,
      x,
      y,
      columnWidth,
      [
        { text: 'Particulars', width: 0.68, bold: true },
        {
          text: `Amount (${currency})`,
          width: 0.32,
          bold: true,
          align: 'right',
        },
      ],
      { fill: PDF_COLORS.headFill },
    );
    const lines: Array<[string, string, boolean?]> = [
      ...voucher.lines.map((line): [string, string] => [
        line.label,
        line.amount,
      ]),
    ];
    if (isPositive(voucher.discountAmount)) {
      lines.push(['Discounts', `-${voucher.discountAmount}`]);
    }
    if (isPositive(voucher.fineAmount)) {
      lines.push(['Attendance fine', voucher.fineAmount]);
    }
    if (isPositive(voucher.lateFeeFine)) {
      lines.push(['Fine for late payment', voucher.lateFeeFine]);
    }
    lines.push(['Payable within due date', voucher.finalAmountDue, true]);
    if (isPositive(voucher.totalPaid)) {
      lines.push(['Already paid', voucher.totalPaid]);
      lines.push(['Remaining balance', voucher.remainingBalance, true]);
    }
    for (const [label, value, bold] of lines) {
      y += drawRow(doc, x, y, columnWidth, [
        { text: label, width: 0.68, bold },
        { text: value, width: 0.32, bold, align: 'right' },
      ]);
    }

    // Printed custom values the school chose to show.
    for (const field of voucher.customValues) {
      y += drawRow(doc, x, y, columnWidth, [
        { text: field.label, width: 0.42, bold: true },
        { text: field.value, width: 0.58 },
      ]);
    }

    // In words.
    const words = amountInWords(voucher.finalAmountDue);
    if (words) {
      y += drawRow(
        doc,
        x,
        y,
        columnWidth,
        [{ text: 'In Words', width: 1, bold: true }],
        { fill: PDF_COLORS.headFill },
      );
      y += drawRow(doc, x, y, columnWidth, [
        { text: `${currency} ${words}.`, width: 1 },
      ]);
    }

    // Payment information.
    if (bank) {
      y += drawRow(
        doc,
        x,
        y,
        columnWidth,
        [{ text: 'Payment Information', width: 1, bold: true }],
        { fill: PDF_COLORS.headFill },
      );
      const bankLines = [
        `Bank: ${bank.bankName}`,
        `Account Title: ${bank.accountTitle}`,
        `Account No: ${bank.accountNumber}`,
        ...(bank.iban ? [`IBAN: ${bank.iban}`] : []),
        ...(bank.branchCode ? [`Branch: ${bank.branchCode}`] : []),
      ];
      y += drawRow(doc, x, y, columnWidth, [
        { text: bankLines.join('\n'), width: 1 },
      ]);
    }

    // Footer: fixed to the bottom of the page.
    const footerHeight = 12 + 18;
    const footerTop = bottom - footerHeight;

    // The instructions fill whatever space is left down to the footer.
    const instructions =
      print.voucherInstructions.length > 0
        ? print.voucherInstructions
        : DEFAULT_VOUCHER_NOTES;
    const noteHeight = Math.max(footerTop - y, 0);
    if (noteHeight > 12) {
      drawTextBlock(
        doc,
        x,
        y,
        columnWidth,
        noteHeight,
        instructions.map((line) => `* ${line}`),
        7.5,
      );
    }

    doc.rect(x, footerTop, columnWidth, 12).fill(PDF_COLORS.black);
    doc
      .font(PDF_FONTS.regular)
      .fontSize(8)
      .fillColor(PDF_COLORS.white)
      .text(printMeta.institution.name, x, footerTop + 2, {
        width: columnWidth,
        align: 'center',
        lineBreak: false,
      });
    doc.rect(x, footerTop + 12, columnWidth, 18).fill(PDF_COLORS.grey);
    doc
      .fillColor(PDF_COLORS.text)
      .fontSize(7)
      .text(
        print.voucherContact || printMeta.campus?.name || '',
        x + 3,
        footerTop + 15,
        { width: columnWidth - 6, align: 'center', height: 14, ellipsis: true },
      );
    doc.lineWidth(0.5).strokeColor(PDF_COLORS.line);
    doc.rect(x, footerTop, columnWidth, footerHeight).stroke();
  });
}
