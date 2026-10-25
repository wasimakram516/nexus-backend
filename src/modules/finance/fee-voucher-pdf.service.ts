import { Injectable } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PdfService } from '../../common/pdf/pdf.service';
import { PrintFeeVouchersQueryDto } from './dto/finance.dto';
import { drawVoucherPage } from './fee-voucher.pdf';
import {
  FeeVoucherPrintablesService,
  PrintableFeeVoucher,
} from './fee-voucher-printables.service';

export interface PdfFile {
  buffer: Buffer;
  filename: string;
}

/**
 * Fee vouchers as downloadable PDF files, drawn from exactly the data the
 * on-screen print layout reads, so the two always agree.
 */
@Injectable()
export class FeeVoucherPdfService {
  constructor(
    private readonly printables: FeeVoucherPrintablesService,
    private readonly pdf: PdfService,
  ) {}

  /**
   * One voucher, for staff.
   *
   * @param {CurrentUser} currentUser - Authenticated staff caller.
   * @param {string} voucherId - The voucher.
   * @returns {Promise<PdfFile>} The PDF and a file name.
   */
  async forVoucher(currentUser: CurrentUser, voucherId: string) {
    const { data } = await this.printables.getPrintable(currentUser, voucherId);
    return this.build([data], data.voucher.voucherNumber);
  }

  /**
   * One of the caller's own vouchers (or a ward's).
   *
   * @param {CurrentUser} currentUser - A student or guardian.
   * @param {string} voucherId - The voucher.
   * @returns {Promise<PdfFile>} The PDF and a file name.
   */
  async forOwnVoucher(currentUser: CurrentUser, voucherId: string) {
    const { data } = await this.printables.getPrintableForSelf(
      currentUser,
      voucherId,
    );
    return this.build([data], data.voucher.voucherNumber);
  }

  /**
   * Every voucher of a month for a campus, class or section, one page each.
   *
   * @param {CurrentUser} currentUser - Authenticated staff caller.
   * @param {PrintFeeVouchersQueryDto} query - Campus, optional class or section, and period.
   * @returns {Promise<PdfFile>} The PDF and a file name.
   */
  async forBatch(currentUser: CurrentUser, query: PrintFeeVouchersQueryDto) {
    const { data } = await this.printables.getBatchPrintable(
      currentUser,
      query,
    );
    return this.build(
      data,
      `fee-vouchers-${query.year}-${String(query.month).padStart(2, '0')}`,
    );
  }

  private async build(
    items: PrintableFeeVoucher[],
    name: string,
  ): Promise<PdfFile> {
    // One logo fetch per institution, however many vouchers use it.
    const logos = new Map<string, Buffer | null>();
    for (const item of items) {
      const url = item.printMeta.institution.logoUrl;
      if (url && !logos.has(url))
        logos.set(url, await this.pdf.fetchImage(url));
    }
    const buffer = await this.pdf.render(
      (doc) => {
        items.forEach((item, index) => {
          if (index > 0) doc.addPage();
          drawVoucherPage(
            doc,
            item,
            logos.get(item.printMeta.institution.logoUrl ?? '') ?? null,
          );
        });
        if (items.length === 0) {
          doc.fontSize(12).text('There are no vouchers for this choice.');
        }
      },
      { layout: 'landscape', margin: 20, title: 'Fee vouchers' },
    );
    return { buffer, filename: `${name}.pdf` };
  }
}
