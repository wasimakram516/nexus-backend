import { Injectable, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { PdfService } from '../../common/pdf/pdf.service';
import { PrintableMetaService } from '../../common/services/printable-meta.service';
import { reportToCsv } from './report-csv.util';
import { ReportTable } from './report-table';
import { drawReportTable } from './report-table.pdf';

export type ReportFormat = 'json' | 'csv' | 'pdf';

export interface ReportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const slug = (text: string) =>
  text
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'report';

/**
 * Turns any report into a file people can keep: a CSV for spreadsheets or a
 * PDF on the school's letterhead. Reports never write files themselves.
 */
@Injectable()
export class ReportsExportService {
  constructor(
    private readonly pdf: PdfService,
    private readonly printableMeta: PrintableMetaService,
  ) {}

  /**
   * @param {ReportTable} table - The report.
   * @param {'csv' | 'pdf'} format - The file kind.
   * @returns {Promise<ReportFile>} The bytes, a file name and the content type.
   */
  async toFile(table: ReportTable, format: 'csv' | 'pdf'): Promise<ReportFile> {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const base = `${slug(table.key)}-${stamp}`;
    if (format === 'csv') {
      return {
        buffer: reportToCsv(table),
        filename: `${base}.csv`,
        contentType: 'text/csv; charset=utf-8',
      };
    }
    const meta = await this.printableMeta.build(
      'REPORT',
      table.institutionId,
      table.campusId ?? undefined,
    );
    const logo = await this.pdf.fetchImage(meta.institution.logoUrl);
    const buffer = await this.pdf.render(
      (doc) => drawReportTable(doc, table, meta, logo),
      { layout: 'landscape', title: table.title },
    );
    return { buffer, filename: `${base}.pdf`, contentType: 'application/pdf' };
  }
}

/**
 * Sends a report file as a download, outside the JSON envelope.
 *
 * @param {Response} response - The response being answered.
 * @param {ReportFile} file - The file.
 * @returns {StreamableFile} The file to return from the route.
 */
export function sendReportFile(
  response: Response,
  file: ReportFile,
): StreamableFile {
  response.set({
    'Content-Type': file.contentType,
    'Content-Disposition': `attachment; filename="${file.filename}"`,
    'Cache-Control': 'no-store',
  });
  return new StreamableFile(file.buffer);
}
