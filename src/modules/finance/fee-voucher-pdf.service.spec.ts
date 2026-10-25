import { PdfService } from '../../common/pdf/pdf.service';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { UserRole } from '../../prisma/client';
import { FeeVoucherPdfService } from './fee-voucher-pdf.service';
import { FeeVoucherPrintablesService } from './fee-voucher-printables.service';

const pageCount = (buffer: Buffer) =>
  (buffer.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;

describe('FeeVoucherPdfService', () => {
  const admin: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };

  const item = (name: string, logoUrl: string | null = null) => ({
    printMeta: {
      documentType: 'FEE_VOUCHER',
      generatedAt: '2026-10-25T00:00:00.000Z',
      institution: {
        id: 'i',
        name: 'Greenfield School',
        logoUrl,
        branding: {},
      },
      campus: { id: 'c', name: 'Main Campus' },
    },
    voucher: {
      id: `v-${name}`,
      voucherNumber: `FV-202610-${name}`,
      month: 10,
      year: 2026,
      issueDate: new Date('2026-10-01'),
      dueDate: new Date('2026-10-10'),
      status: 'PENDING',
      lines: [{ label: 'tuition', amount: '5000.00' }],
      customValues: [{ label: 'Reference', value: 'INV-9' }],
      totalFees: '5000.00',
      discountAmount: '500.00',
      fineAmount: '0.00',
      lateFeeFine: '0.00',
      finalAmountDue: '4500.00',
      totalPaid: '0.00',
      remainingBalance: '4500.00',
    },
    student: {
      id: name,
      name,
      regNo: `R-${name}`,
      className: 'Grade 1',
      sectionName: null,
    },
    bank: null,
    print: {
      currencyLabel: 'Rs.',
      voucherInstructions: ['Pay at the bank.'],
      voucherContact: 'info@school.test',
    },
  });

  const printablesMock = {
    getPrintable: jest.fn(),
    getPrintableForSelf: jest.fn(),
    getBatchPrintable: jest.fn(),
  };
  const pdf = new PdfService();
  const fetchImage = jest.spyOn(pdf, 'fetchImage');
  const service = new FeeVoucherPdfService(
    printablesMock as unknown as FeeVoucherPrintablesService,
    pdf,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    fetchImage.mockResolvedValue(null);
  });

  it('draws one voucher as one landscape page named after its number', async () => {
    printablesMock.getPrintable.mockResolvedValue({ data: item('Ayesha') });

    const file = await service.forVoucher(admin, 'v-Ayesha');

    expect(printablesMock.getPrintable).toHaveBeenCalledWith(admin, 'v-Ayesha');
    expect(file.filename).toBe('FV-202610-Ayesha.pdf');
    expect(file.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(file.buffer)).toBe(1);
    expect(file.buffer.toString('latin1')).toMatch(/\/MediaBox \[0 0 841\.89/);
  });

  it('draws an own voucher through the ownership-checked route', async () => {
    printablesMock.getPrintableForSelf.mockResolvedValue({
      data: item('Bilal'),
    });

    const file = await service.forOwnVoucher(admin, 'v-Bilal');

    expect(printablesMock.getPrintableForSelf).toHaveBeenCalledWith(
      admin,
      'v-Bilal',
    );
    expect(printablesMock.getPrintable).not.toHaveBeenCalled();
    expect(file.filename).toBe('FV-202610-Bilal.pdf');
  });

  it('draws a batch as one page per voucher, named after the month', async () => {
    printablesMock.getBatchPrintable.mockResolvedValue({
      data: [item('Ayesha'), item('Bilal'), item('Omar')],
    });

    const file = await service.forBatch(admin, {
      campusId: 'campus-1',
      month: 3,
      year: 2027,
    });

    expect(pageCount(file.buffer)).toBe(3);
    expect(file.filename).toBe('fee-vouchers-2027-03.pdf');
  });

  it('still gives a page, saying there is nothing, for an empty batch', async () => {
    printablesMock.getBatchPrintable.mockResolvedValue({ data: [] });

    const file = await service.forBatch(admin, {
      campusId: 'campus-1',
      month: 3,
      year: 2027,
    });

    expect(pageCount(file.buffer)).toBe(1);
  });

  it('fetches each institution logo once, however many vouchers share it', async () => {
    printablesMock.getBatchPrintable.mockResolvedValue({
      data: [
        item('Ayesha', 'https://x/logo.png'),
        item('Bilal', 'https://x/logo.png'),
      ],
    });

    await service.forBatch(admin, { campusId: 'c', month: 10, year: 2026 });

    expect(fetchImage).toHaveBeenCalledTimes(1);
  });

  it('still draws the voucher when the logo cannot be fetched', async () => {
    fetchImage.mockResolvedValue(null);
    printablesMock.getPrintable.mockResolvedValue({
      data: item('Ayesha', 'https://x/missing.png'),
    });

    const file = await service.forVoucher(admin, 'v-Ayesha');

    expect(pageCount(file.buffer)).toBe(1);
  });

  it('does not draw anything for a voucher the caller may not see', async () => {
    printablesMock.getPrintable.mockRejectedValue(new Error('forbidden'));

    await expect(service.forVoucher(admin, 'v-x')).rejects.toThrow('forbidden');
  });
});
