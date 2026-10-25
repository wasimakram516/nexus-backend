import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Sends a generated PDF as a download. The response is left to Nest's
 * pass-through so the file is returned as it is, never wrapped in the JSON
 * envelope.
 *
 * @param {Response} response - The response being answered.
 * @param {{buffer: Buffer, filename: string}} file - The PDF and the name to save it under.
 * @returns {StreamableFile} The file to return from the route.
 */
export function sendPdf(
  response: Response,
  file: { buffer: Buffer; filename: string },
): StreamableFile {
  response.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${file.filename}"`,
    'Cache-Control': 'no-store',
  });
  return new StreamableFile(file.buffer);
}
