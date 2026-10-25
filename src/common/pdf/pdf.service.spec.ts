import { PdfService } from './pdf.service';

/** How many pages a PDF file has. */
export function pageCount(buffer: Buffer): number {
  return (buffer.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;
}

describe('PdfService', () => {
  const service = new PdfService();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('draws a real PDF file', async () => {
    const buffer = await service.render((doc) => {
      doc.text('Hello');
    });

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.subarray(-6).toString()).toContain('%%EOF');
    expect(pageCount(buffer)).toBe(1);
  });

  it('keeps every page the drawing function adds, in the orientation asked for', async () => {
    const buffer = await service.render(
      (doc) => {
        doc.text('One');
        doc.addPage();
        doc.text('Two');
      },
      { layout: 'landscape' },
    );

    expect(pageCount(buffer)).toBe(2);
    // Landscape A4 is wider than tall.
    expect(buffer.toString('latin1')).toMatch(/\/MediaBox \[0 0 841\.89/);
  });

  it('draws accented and non-Latin letters with an embedded font', async () => {
    const buffer = await service.render((doc) => {
      doc.text('Zoë Ñandú Ωmega Привет');
    });

    expect(buffer.toString('latin1')).toContain('DejaVuSans');
  });

  it('fails clearly, and does not hang, when drawing throws', async () => {
    await expect(
      service.render(() => {
        throw new Error('bad layout');
      }),
    ).rejects.toThrow('bad layout');
  });

  it('accepts a document title', async () => {
    const buffer = await service.render(() => undefined, {
      title: 'Fee vouchers',
    });

    expect(buffer.toString('latin1')).toContain('Fee vouchers');
  });

  describe('fetchImage', () => {
    const respond = (body: Buffer, type: string, ok = true) =>
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok,
        headers: { get: () => type },
        arrayBuffer: () =>
          Promise.resolve(
            body.buffer.slice(
              body.byteOffset,
              body.byteOffset + body.byteLength,
            ),
          ),
      } as unknown as Response);

    it.each([null, undefined, '', 'ftp://x/y.png', 'not a url'])(
      'gives nothing for %p without asking the network',
      async (url) => {
        const spy = jest.spyOn(global, 'fetch');

        expect(await service.fetchImage(url)).toBeNull();
        expect(spy).not.toHaveBeenCalled();
      },
    );

    it('returns a PNG or JPEG', async () => {
      respond(Buffer.from([1, 2, 3]), 'image/png');

      expect(await service.fetchImage('https://x/logo.png')).toEqual(
        Buffer.from([1, 2, 3]),
      );
    });

    it.each([
      ['an image PDFKit cannot embed', Buffer.from([1]), 'image/svg+xml', true],
      ['a failed response', Buffer.from([1]), 'image/png', false],
      ['an empty body', Buffer.alloc(0), 'image/png', true],
    ])('gives nothing for %s', async (_name, body, type, ok) => {
      respond(body, type, ok);

      expect(await service.fetchImage('https://x/logo')).toBeNull();
    });

    it('gives nothing when the request fails or times out', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('timeout'));

      expect(await service.fetchImage('https://x/logo.png')).toBeNull();
    });
  });
});
