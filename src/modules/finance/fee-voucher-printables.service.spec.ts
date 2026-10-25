/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest asymmetric matchers are typed any */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { OwnedStudentsService } from '../../common/services/owned-students.service';
import { PrintableCustomValuesService } from '../../common/services/printable-custom-values.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { PrintableMetaService } from '../../common/services/printable-meta.service';
import { attachFeeVoucherBalances } from '../../common/utils/fee-settlement.util';
import { ModuleKey, Prisma, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FeeVoucherPrintablesService,
  MAX_PRINT_VOUCHERS,
  voucherNumber,
} from './fee-voucher-printables.service';

jest.mock('../../common/utils/fee-settlement.util', () => ({
  attachFeeVoucherBalances: jest.fn(),
}));

describe('FeeVoucherPrintablesService', () => {
  let service: FeeVoucherPrintablesService;

  const admin: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };

  const prismaMock = {
    feeVoucher: { findUnique: jest.fn(), findMany: jest.fn() },
    student: { findMany: jest.fn() },
    studentEnrollment: { findMany: jest.fn() },
    campus: { findMany: jest.fn() },
    institutionSetting: { findMany: jest.fn() },
  };
  const moduleAccessMock = {
    assertModuleEnabledForUser: jest.fn(),
  };
  const campusAccessMock = { assertCampusAccess: jest.fn() };
  const metaMock = { build: jest.fn() };
  const ownedMock = { resolveOwnedStudentIds: jest.fn() };
  const customValuesMock = { forRecords: jest.fn() };
  const balances = attachFeeVoucherBalances as jest.Mock;

  const row = (id: string, name: string, regNo: string) => ({
    id,
    studentId: `student-${id}`,
    month: 9,
    year: 2026,
    createdAt: new Date('2026-09-01'),
    dueDate: new Date('2026-09-10'),
    status: 'PENDING',
    feeBreakdown: { tuition: 5000, transport: '1000.5' },
    discountAmount: new Prisma.Decimal(800),
    fineAmount: new Prisma.Decimal(150),
    lateFeeFine: new Prisma.Decimal(0),
    finalAmountDue: new Prisma.Decimal('5350.5'),
    student: {
      id: `student-${id}`,
      regNo,
      campusId: 'campus-1',
      user: { name },
    },
    bank: {
      bankName: 'HBL',
      accountTitle: 'School',
      accountNumber: '123',
      iban: null,
      branchCode: null,
    },
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    moduleAccessMock.assertModuleEnabledForUser.mockResolvedValue(undefined);
    campusAccessMock.assertCampusAccess.mockResolvedValue(undefined);
    metaMock.build.mockResolvedValue({ documentType: 'FEE_VOUCHER' });
    customValuesMock.forRecords.mockImplementation(
      (_institutionId: string, _type: string, ids: string[]) =>
        Promise.resolve(new Map(ids.map((id) => [id, []]))),
    );
    balances.mockImplementation((_client: unknown, rows: unknown[]) =>
      Promise.resolve(
        rows.map((voucher) => ({
          ...(voucher as object),
          totalPaid: '1000.00',
          remainingBalance: '4350.50',
        })),
      ),
    );
    prismaMock.campus.findMany.mockResolvedValue([
      { id: 'campus-1', institutionId: 'inst-1' },
    ]);
    prismaMock.institutionSetting.findMany.mockResolvedValue([]);
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      {
        studentId: 'student-v1',
        class: { name: 'Grade 1' },
        section: { name: 'A' },
      },
    ]);

    const module = await Test.createTestingModule({
      providers: [
        FeeVoucherPrintablesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ModuleAccessService, useValue: moduleAccessMock },
        { provide: CampusAccessService, useValue: campusAccessMock },
        { provide: PrintableMetaService, useValue: metaMock },
        { provide: OwnedStudentsService, useValue: ownedMock },
        { provide: PrintableCustomValuesService, useValue: customValuesMock },
      ],
    }).compile();
    service = module.get(FeeVoucherPrintablesService);
  });

  describe('getPrintable', () => {
    it('returns the voucher with lines, totals, balances, student placement and bank', async () => {
      prismaMock.feeVoucher.findUnique.mockResolvedValue(
        row('v1', 'Ayesha', 'R-1'),
      );

      const { data } = await service.getPrintable(admin, 'v1');

      expect(moduleAccessMock.assertModuleEnabledForUser).toHaveBeenCalledWith(
        admin,
        ModuleKey.FINANCE,
      );
      expect(campusAccessMock.assertCampusAccess).toHaveBeenCalledWith(
        admin,
        'campus-1',
      );
      expect(metaMock.build).toHaveBeenCalledWith(
        'FEE_VOUCHER',
        'inst-1',
        'campus-1',
      );
      expect(data.voucher).toMatchObject({
        voucherNumber: 'FV-202609-R-1',
        lines: [
          { label: 'tuition', amount: '5000.00' },
          { label: 'transport', amount: '1000.50' },
        ],
        totalFees: '6000.50',
        discountAmount: '800.00',
        fineAmount: '150.00',
        finalAmountDue: '5350.50',
        totalPaid: '1000.00',
        remainingBalance: '4350.50',
      });
      expect(data.student).toMatchObject({
        name: 'Ayesha',
        className: 'Grade 1',
        sectionName: 'A',
      });
      expect(data.bank?.bankName).toBe('HBL');
    });

    it('prints the institution wording from its finance setting, with defaults when none is set', async () => {
      prismaMock.feeVoucher.findUnique.mockResolvedValue(
        row('v1', 'Ayesha', 'R-1'),
      );
      const defaults = await service.getPrintable(admin, 'v1');
      expect(defaults.data.print).toEqual({
        currencyLabel: 'Rs.',
        voucherInstructions: [],
        voucherContact: '',
      });
      expect(defaults.data.voucher.issueDate).toEqual(new Date('2026-09-01'));

      prismaMock.institutionSetting.findMany.mockResolvedValue([
        {
          institutionId: 'inst-1',
          value: {
            currencyLabel: 'SAR',
            voucherInstructions: 'Pay at the bank.\nKeep the receipt.',
            voucherContact: 'info@school.test',
          },
        },
      ]);
      const configured = await service.getPrintable(admin, 'v1');

      expect(configured.data.print).toEqual({
        currencyLabel: 'SAR',
        voucherInstructions: ['Pay at the bank.', 'Keep the receipt.'],
        voucherContact: 'info@school.test',
      });
    });

    it('prints the custom values the institution chose to show, per voucher', async () => {
      prismaMock.feeVoucher.findUnique.mockResolvedValue(
        row('v1', 'Ayesha', 'R-1'),
      );
      customValuesMock.forRecords.mockResolvedValue(
        new Map([['v1', [{ label: 'Reference', value: 'INV-9' }]]]),
      );

      const { data } = await service.getPrintable(admin, 'v1');

      expect(customValuesMock.forRecords).toHaveBeenCalledWith(
        'inst-1',
        'fee_voucher',
        ['v1'],
      );
      expect(data.voucher.customValues).toEqual([
        { label: 'Reference', value: 'INV-9' },
      ]);
    });

    it('prints a voucher with no bank and a student with no placement', async () => {
      prismaMock.feeVoucher.findUnique.mockResolvedValue({
        ...row('v2', 'Bilal', 'R-2'),
        bank: null,
      });
      prismaMock.studentEnrollment.findMany.mockResolvedValue([]);

      const { data } = await service.getPrintable(admin, 'v2');

      expect(data.bank).toBeNull();
      expect(data.student.className).toBeNull();
    });

    it('is not found for an unknown voucher', async () => {
      prismaMock.feeVoucher.findUnique.mockResolvedValue(null);

      await expect(service.getPrintable(admin, 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuses a voucher at a campus the caller cannot act at', async () => {
      prismaMock.feeVoucher.findUnique.mockResolvedValue(
        row('v1', 'Ayesha', 'R-1'),
      );
      campusAccessMock.assertCampusAccess.mockRejectedValue(
        new Error('forbidden'),
      );

      await expect(service.getPrintable(admin, 'v1')).rejects.toThrow(
        'forbidden',
      );
      expect(metaMock.build).not.toHaveBeenCalled();
    });
  });

  describe('getPrintableForSelf', () => {
    const parent = { ...admin, role: UserRole.GUARDIAN };

    it("prints a voucher that belongs to one of the caller's children, without checking campus staff access", async () => {
      prismaMock.feeVoucher.findUnique.mockResolvedValue(
        row('v1', 'Ayesha', 'R-1'),
      );
      ownedMock.resolveOwnedStudentIds.mockResolvedValue(['student-v1']);

      const { data } = await service.getPrintableForSelf(parent, 'v1');

      expect(data.voucher.voucherNumber).toBe('FV-202609-R-1');
      expect(campusAccessMock.assertCampusAccess).not.toHaveBeenCalled();
    });

    it("refuses someone else's child", async () => {
      prismaMock.feeVoucher.findUnique.mockResolvedValue(
        row('v1', 'Ayesha', 'R-1'),
      );
      ownedMock.resolveOwnedStudentIds.mockResolvedValue(['student-other']);

      await expect(
        service.getPrintableForSelf(parent, 'v1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(metaMock.build).not.toHaveBeenCalled();
    });

    it('is not found for an unknown voucher, and refuses a caller who owns no students', async () => {
      prismaMock.feeVoucher.findUnique.mockResolvedValue(null);
      await expect(
        service.getPrintableForSelf(parent, 'nope'),
      ).rejects.toBeInstanceOf(NotFoundException);

      prismaMock.feeVoucher.findUnique.mockResolvedValue(
        row('v1', 'Ayesha', 'R-1'),
      );
      ownedMock.resolveOwnedStudentIds.mockResolvedValue([]);
      await expect(
        service.getPrintableForSelf(parent, 'v1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getBatchPrintable', () => {
    const query = { campusId: 'campus-1', month: 9, year: 2026 };

    it('uses the whole campus when no class or section is given, ordered by name', async () => {
      prismaMock.student.findMany.mockResolvedValue([
        { id: 'student-v1' },
        { id: 'student-v2' },
      ]);
      prismaMock.feeVoucher.findMany.mockResolvedValue([
        row('v2', 'Zara', 'R-2'),
        row('v1', 'Ayesha', 'R-1'),
      ]);

      const { data } = await service.getBatchPrintable(admin, query);

      expect(data.map((item) => item.student.name)).toEqual(['Ayesha', 'Zara']);
      expect(prismaMock.feeVoucher.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            studentId: { in: ['student-v1', 'student-v2'] },
            month: 9,
            year: 2026,
          },
        }),
      );
      // One header lookup per campus, not per voucher.
      expect(metaMock.build).toHaveBeenCalledTimes(1);
    });

    it('narrows to the enrolled students of a class and section', async () => {
      prismaMock.studentEnrollment.findMany.mockResolvedValueOnce([
        { studentId: 'student-v1' },
        { studentId: 'student-v1' },
      ]);
      prismaMock.feeVoucher.findMany.mockResolvedValue([]);

      const { data } = await service.getBatchPrintable(admin, {
        ...query,
        classId: 'class-1',
        sectionId: 'sec-1',
      });

      expect(data).toEqual([]);
      expect(prismaMock.studentEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            classId: 'class-1',
            sectionId: 'sec-1',
          }),
        }),
      );
      expect(prismaMock.feeVoucher.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            studentId: { in: ['student-v1'] },
          }),
        }),
      );
    });

    it('refuses a batch larger than the print limit', async () => {
      prismaMock.student.findMany.mockResolvedValue([{ id: 'student-v1' }]);
      prismaMock.feeVoucher.findMany.mockResolvedValue(
        Array.from({ length: MAX_PRINT_VOUCHERS + 1 }, (_, index) =>
          row(`v${index}`, `S${index}`, `R-${index}`),
        ),
      );

      await expect(
        service.getBatchPrintable(admin, query),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('checks access to the campus before reading anything', async () => {
      campusAccessMock.assertCampusAccess.mockRejectedValue(
        new Error('forbidden'),
      );

      await expect(service.getBatchPrintable(admin, query)).rejects.toThrow(
        'forbidden',
      );
      expect(prismaMock.student.findMany).not.toHaveBeenCalled();
    });
  });

  describe('voucherNumber', () => {
    it('pads the month and appends the registration number', () => {
      expect(
        voucherNumber({ month: 3, year: 2027, student: { regNo: 'A-9' } }),
      ).toBe('FV-202703-A-9');
    });
  });
});
