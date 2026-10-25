import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { join } from 'node:path';

export type PdfDocument = InstanceType<typeof PDFDocument>;

export interface PdfOptions {
  layout?: 'portrait' | 'landscape';
  /** Page margin in points. */
  margin?: number;
  title?: string;
}

const FONT_REGULAR = 'Body';
const FONT_BOLD = 'BodyBold';

/** The names the drawing helpers use for the two embedded fonts. */
export const PDF_FONTS = { regular: FONT_REGULAR, bold: FONT_BOLD } as const;

/** Where the embedded font files live; resolved from the installed package so it works from `dist` too. */
function fontPath(file: string): string {
  const packageJson = require.resolve('dejavu-fonts-ttf/package.json');
  return join(packageJson, '..', 'ttf', file);
}

/**
 * Turns a drawing function into a PDF file. Every printable document (fee
 * vouchers, exam documents, timetables) is drawn from the same data the
 * on-screen print layout reads, so the numbers can never differ between the
 * two. An embedded font keeps accented and non-Latin letters from turning
 * into empty boxes.
 */
@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  /**
   * Draw a document and return it as a PDF file.
   *
   * @param {(doc: PdfDocument) => void | Promise<void>} draw - Draws every page; may add pages itself.
   * @param {PdfOptions} [options] - Page orientation, margin and title.
   * @returns {Promise<Buffer>} The finished PDF.
   */
  async render(
    draw: (doc: PdfDocument) => void | Promise<void>,
    options: PdfOptions = {},
  ): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'A4',
      layout: options.layout ?? 'portrait',
      margin: options.margin ?? 28,
      autoFirstPage: true,
      info: { Title: options.title ?? 'Nexus document', Producer: 'Nexus' },
    });
    doc.registerFont(FONT_REGULAR, fontPath('DejaVuSans.ttf'));
    doc.registerFont(FONT_BOLD, fontPath('DejaVuSans-Bold.ttf'));
    doc.font(FONT_REGULAR);

    const chunks: Buffer[] = [];
    const finished = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    try {
      await draw(doc);
    } catch (error) {
      this.logger.error(
        'Drawing a PDF failed',
        error instanceof Error ? error.stack : String(error),
      );
      doc.end();
      await finished.catch(() => undefined);
      throw error;
    }
    doc.end();
    return finished;
  }

  /**
   * Fetch an image (a logo) for a document. A missing or slow image must
   * never stop a document from being produced, so any problem gives nothing.
   *
   * @param {string | null | undefined} url - The image address.
   * @returns {Promise<Buffer | null>} The image bytes, or null.
   */
  async fetchImage(url: string | null | undefined): Promise<Buffer | null> {
    if (!url || !/^https?:\/\//i.test(url)) return null;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) return null;
      const type = response.headers.get('content-type') ?? '';
      // PDFKit embeds PNG and JPEG only.
      if (!/image\/(png|jpe?g)/i.test(type)) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      return bytes.length > 0 && bytes.length < 2_000_000 ? bytes : null;
    } catch {
      return null;
    }
  }
}
