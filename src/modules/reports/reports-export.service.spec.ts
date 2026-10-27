import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { PdfService } from '../../common/pdf/pdf.service';
import { PrintableMetaService } from '../../common/services/printable-meta.service';
import { ReportsExportService, sendReportFile } from './reports-export.service';
import { ReportTable } from './report-table';

const pageCount = (buffer: Buffer) =>
  (buffer.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;

describe('ReportsExportService', () => {
  const metaMock = { build: jest.fn() };
  const pdf = new PdfService();
  const fetchImage = jest.spyOn(pdf, 'fetchImage');
  const service = new ReportsExportService(
    pdf,
    metaMock as unknown as PrintableMetaService,
  );

  const table = (
    rows = 3,
    overrides: Partial<ReportTable> = {},
  ): ReportTable => ({
    key: 'campus-comparison',
    title: 'Campus comparison',
    subtitle: 'As of 25 Oct 2026',
    columns: [
      { key: 'name', label: 'Campus', weight: 3 },
      { key: 'students', label: 'Students', align: 'right' },
    ],
    rows: Array.from({ length: rows }, (_, index) => ({
      name: `Campus ${index + 1}`,
      students: index * 10,
    })),
    totals: { name: 'Total', students: 100 },
    notes: ['Period-mode attendance is not included.'],
    institutionId: 'inst-1',
    campusId: 'campus-1',
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    fetchImage.mockResolvedValue(null);
    metaMock.build.mockResolvedValue({
      documentType: 'REPORT',
      generatedAt: '2026-10-25T00:00:00.000Z',
      timezone: 'Asia/Karachi',
      institution: {
        id: 'inst-1',
        name: 'Greenfield School',
        logoUrl: null,
        branding: { primaryColorLight: null },
      },
      campus: { id: 'campus-1', name: 'Main Campus' },
    });
  });

  it('writes a CSV named after the report and the day', async () => {
    const file = await service.toFile(table(), 'csv');

    expect(file.filename).toMatch(/^campus-comparison-\d{8}\.csv$/);
    expect(file.contentType).toBe('text/csv; charset=utf-8');
    expect(file.buffer.toString('utf8')).toContain('Campus,Students');
    expect(metaMock.build).not.toHaveBeenCalled();
  });

  it('draws a PDF on one landscape page under the school header', async () => {
    const file = await service.toFile(table(), 'pdf');

    expect(metaMock.build).toHaveBeenCalledWith('REPORT', 'inst-1', 'campus-1');
    expect(file.filename).toMatch(/^campus-comparison-\d{8}\.pdf$/);
    expect(file.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(file.buffer)).toBe(1);
    expect(file.buffer.toString('latin1')).toMatch(/\/MediaBox \[0 0 841\.89/);
  });

  it('starts a new page when the rows do not fit, and still ends with the totals', async () => {
    const file = await service.toFile(table(120), 'pdf');

    expect(pageCount(file.buffer)).toBeGreaterThan(1);
  });

  it('draws an empty report with a note instead of failing, and without a campus', async () => {
    const file = await service.toFile(
      table(0, { campusId: null, totals: null, notes: [] }),
      'pdf',
    );

    expect(metaMock.build).toHaveBeenCalledWith('REPORT', 'inst-1', undefined);
    expect(pageCount(file.buffer)).toBe(1);
  });

  it('survives a logo that cannot be read', async () => {
    fetchImage.mockResolvedValue(Buffer.from('not an image'));

    const file = await service.toFile(table(), 'pdf');

    expect(file.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('sends a report as a download that is never cached', () => {
    const set = jest.fn();
    const sent = sendReportFile({ set } as unknown as Response, {
      buffer: Buffer.from('x'),
      filename: 'r.csv',
      contentType: 'text/csv; charset=utf-8',
    });

    expect(sent).toBeInstanceOf(StreamableFile);
    expect(set).toHaveBeenCalledWith({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="r.csv"',
      'Cache-Control': 'no-store',
    });
  });
});
