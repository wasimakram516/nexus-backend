import { reportToCsv } from './report-csv.util';
import { ReportTable } from './report-table';

const table = (overrides: Partial<ReportTable> = {}): ReportTable => ({
  key: 'test',
  title: 'Test',
  subtitle: null,
  columns: [
    { key: 'name', label: 'Name' },
    { key: 'amount', label: 'Amount', align: 'right' },
  ],
  rows: [{ name: 'Ayesha', amount: '1200.00' }],
  totals: null,
  notes: [],
  institutionId: 'inst-1',
  campusId: null,
  ...overrides,
});

const text = (buffer: Buffer) => buffer.toString('utf8');

describe('reportToCsv', () => {
  it('starts with a byte order mark and writes a header and rows with Windows line endings', () => {
    const csv = text(reportToCsv(table()));

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('Name,Amount\r\nAyesha,1200.00\r\n');
  });

  it('quotes fields with commas, quotes and line breaks', () => {
    const csv = text(
      reportToCsv(
        table({
          rows: [{ name: 'Khan, "Ali"\nJr', amount: '5.00' }],
        }),
      ),
    );

    expect(csv).toContain('"Khan, ""Ali""\nJr",5.00');
  });

  it('keeps a spreadsheet from running a name as a formula, but leaves negative numbers alone', () => {
    const csv = text(
      reportToCsv(
        table({
          rows: [
            { name: '=HYPERLINK("x")', amount: '-50.00' },
            { name: '+cmd', amount: 3 },
            { name: '@sum', amount: null },
          ],
        }),
      ),
    );

    expect(csv).toContain(`"'=HYPERLINK(""x"")",-50.00`);
    expect(csv).toContain("'+cmd,3");
    expect(csv).toContain("'@sum,");
  });

  it('writes numbers and blanks, and the totals row last', () => {
    const csv = text(
      reportToCsv(
        table({
          rows: [
            { name: 'A', amount: 2 },
            { name: 'B', amount: null },
          ],
          totals: { name: 'Total', amount: 2 },
        }),
      ),
    );

    expect(csv.slice(1)).toBe('Name,Amount\r\nA,2\r\nB,\r\nTotal,2\r\n');
  });

  it('writes only the header when there are no rows', () => {
    expect(text(reportToCsv(table({ rows: [] }))).slice(1)).toBe(
      'Name,Amount\r\n',
    );
  });

  it('keeps non-Latin names intact', () => {
    const csv = text(
      reportToCsv(table({ rows: [{ name: 'عائشہ', amount: '1.00' }] })),
    );

    expect(csv).toContain('عائشہ,1.00');
  });
});
