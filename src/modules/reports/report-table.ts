/** One value in a report: text, a number (counts, percentages) or nothing. */
export type ReportCell = string | number | null;

export type ReportRow = Record<string, ReportCell>;

export interface ReportColumn {
  key: string;
  label: string;
  /** Numbers and money line up on the right. */
  align?: 'left' | 'right' | 'center';
  /** Relative width in a printed table; defaults to 1. */
  weight?: number;
}

/**
 * Every report is a table, so one viewer, one CSV writer and one PDF drawer
 * serve them all. A new report only has to produce this shape.
 */
export interface ReportTable {
  key: string;
  title: string;
  /** What the report covers, such as the period and campus. */
  subtitle: string | null;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** A closing row, labelled in the first column; null when totals make no sense. */
  totals: ReportRow | null;
  /** Caveats a reader should see, such as what the report leaves out. */
  notes: string[];
  institutionId: string;
  /** Set when the report covers one campus, so the print header can name it. */
  campusId: string | null;
}

/** Money as `1234.50`, so no precision is lost in a CSV opened in a spreadsheet. */
export const money = (value: { toFixed(places: number): string }): string =>
  value.toFixed(2);

/** A percentage with one decimal; zero when nothing was measured. */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}
