import { ReportCell, ReportTable } from './report-table';

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
const NUMERIC = /^-?\d+(\.\d+)?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV field. A text value that a spreadsheet would run as a formula
 * (`=`, `+`, `-`, `@` at the start) gets a leading apostrophe so a student's
 * name can never execute anything when the file is opened; plain numbers are
 * written as they are.
 */
function field(value: ReportCell): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (
    typeof value === 'string' &&
    FORMULA_START.test(text) &&
    !NUMERIC.test(text)
  ) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A report as a CSV file Excel opens correctly: a UTF-8 byte order mark so
 * names in any script show properly, and Windows line endings.
 *
 * @param {ReportTable} table - The report.
 * @returns {Buffer} The file's bytes.
 */
export function reportToCsv(table: ReportTable): Buffer {
  const lines = [table.columns.map((column) => field(column.label)).join(',')];
  for (const row of table.rows) {
    lines.push(
      table.columns.map((column) => field(row[column.key] ?? null)).join(','),
    );
  }
  if (table.totals) {
    lines.push(
      table.columns
        .map((column) => field(table.totals?.[column.key] ?? null))
        .join(','),
    );
  }
  return Buffer.from(`${BYTE_ORDER_MARK}${lines.join('\r\n')}\r\n`, 'utf8');
}
