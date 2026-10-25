"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const pdf_service_1 = require("./src/common/pdf/pdf.service");
const fee_voucher_pdf_1 = require("./src/modules/finance/fee-voucher.pdf");
const item = {
    printMeta: {
        documentType: 'FEE_VOUCHER',
        generatedAt: new Date().toISOString(),
        institution: {
            id: 'i',
            name: 'Taleem School System',
            logoUrl: null,
            branding: {},
        },
        campus: { id: 'c', name: 'Main Campus' },
    },
    voucher: {
        id: 'v1',
        voucherNumber: 'FV-202610-MAI-26-0001',
        month: 10,
        year: 2026,
        issueDate: new Date('2026-10-24'),
        dueDate: new Date('2026-10-26'),
        status: 'PENDING',
        lines: [
            { label: 'tuition', amount: '5000.00' },
            { label: 'Books Fee', amount: '1000.00' },
            { label: 'transport', amount: '1500.00' },
        ],
        customValues: [{ label: 'Reference', value: 'INV-9' }],
        totalFees: '7500.00',
        discountAmount: '0.00',
        fineAmount: '0.00',
        lateFeeFine: '50.00',
        finalAmountDue: '7550.00',
        totalPaid: '2000.00',
        remainingBalance: '5550.00',
    },
    student: {
        id: 's',
        name: 'Wasim Akram',
        regNo: 'MAI-26-0001',
        className: 'PG',
        sectionName: 'Iqbal',
    },
    bank: {
        bankName: 'Bank Alfalah Limited',
        accountTitle: 'Taleem School',
        accountNumber: '1234-5678-90',
        iban: 'PK00ALFH0000000000000',
        branchCode: null,
    },
    print: {
        currencyLabel: 'Rs.',
        voucherInstructions: [],
        voucherContact: 'info@taleem.test | 042-111-00-00-78',
    },
};
async function main() {
    const buffer = await new pdf_service_1.PdfService().render((doc) => (0, fee_voucher_pdf_1.drawVoucherPage)(doc, item, null), { layout: 'landscape', margin: 20 });
    (0, node_fs_1.writeFileSync)(process.argv[2], buffer);
    console.log('bytes', buffer.length);
}
void main();
//# sourceMappingURL=_render_sample.js.map