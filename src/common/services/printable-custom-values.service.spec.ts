/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest asymmetric matchers are typed any */
import { Test } from '@nestjs/testing';
import { CustomFieldInputType } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrintableCustomValuesService } from './printable-custom-values.service';

describe('PrintableCustomValuesService', () => {
  let service: PrintableCustomValuesService;
  const prismaMock = {
    customFieldDefinition: { findMany: jest.fn() },
    customFieldValue: { findMany: jest.fn() },
  };

  const definition = (
    id: string,
    label: string,
    inputType: CustomFieldInputType,
    options: unknown = null,
  ) => ({ id, label, inputType, options });

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        PrintableCustomValuesService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get(PrintableCustomValuesService);
  });

  it('reads nothing when there are no records', async () => {
    const result = await service.forRecords('inst-1', 'fee_voucher', []);

    expect(result.size).toBe(0);
    expect(prismaMock.customFieldDefinition.findMany).not.toHaveBeenCalled();
  });

  it('asks only for flagged, active fields of that institution and kind, in the institution order', async () => {
    prismaMock.customFieldDefinition.findMany.mockResolvedValue([]);

    const result = await service.forRecords('inst-1', 'fee_voucher', ['v1']);

    expect(prismaMock.customFieldDefinition.findMany).toHaveBeenCalledWith({
      where: {
        institutionId: 'inst-1',
        entityType: 'fee_voucher',
        showOnPrint: true,
        isActive: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    expect(result.get('v1')).toEqual([]);
    expect(prismaMock.customFieldValue.findMany).not.toHaveBeenCalled();
  });

  it('writes each kind of value the way a reader expects', async () => {
    prismaMock.customFieldDefinition.findMany.mockResolvedValue([
      definition('d1', 'Reference', CustomFieldInputType.TEXT),
      definition('d2', 'Scholarship', CustomFieldInputType.BOOLEAN),
      definition('d3', 'Paid on', CustomFieldInputType.DATE),
      definition('d4', 'Category', CustomFieldInputType.SELECT, [
        { label: 'Staff child', value: 'STAFF' },
      ]),
      definition('d5', 'Transport', CustomFieldInputType.MULTI_SELECT, [
        { label: 'Bus', value: 'BUS' },
        { label: 'Van', value: 'VAN' },
      ]),
      definition('d6', 'Seen at', CustomFieldInputType.DATETIME),
      definition('d7', 'Hours', CustomFieldInputType.NUMBER),
    ]);
    prismaMock.customFieldValue.findMany.mockResolvedValue([
      { definitionId: 'd1', entityId: 'v1', value: 'INV-9' },
      { definitionId: 'd2', entityId: 'v1', value: true },
      { definitionId: 'd3', entityId: 'v1', value: '2026-10-25T00:00:00.000Z' },
      { definitionId: 'd4', entityId: 'v1', value: 'STAFF' },
      { definitionId: 'd5', entityId: 'v1', value: ['BUS', 'VAN'] },
      { definitionId: 'd6', entityId: 'v1', value: '2026-10-25T09:30:00.000Z' },
      { definitionId: 'd7', entityId: 'v1', value: 12 },
    ]);

    const lines = (
      await service.forRecords('inst-1', 'fee_voucher', ['v1'])
    ).get('v1');

    expect(lines).toEqual([
      { label: 'Reference', value: 'INV-9' },
      { label: 'Scholarship', value: 'Yes' },
      { label: 'Paid on', value: '2026-10-25' },
      { label: 'Category', value: 'Staff child' },
      { label: 'Transport', value: 'Bus, Van' },
      { label: 'Seen at', value: '2026-10-25 09:30' },
      { label: 'Hours', value: '12' },
    ]);
  });

  it('leaves out files, images, empty values and unknown records', async () => {
    prismaMock.customFieldDefinition.findMany.mockResolvedValue([
      definition('d1', 'Scan', CustomFieldInputType.FILE),
      definition('d2', 'Photo', CustomFieldInputType.IMAGE),
      definition('d3', 'Note', CustomFieldInputType.TEXT),
      definition('d4', 'Code', CustomFieldInputType.TEXT),
    ]);
    prismaMock.customFieldValue.findMany.mockResolvedValue([
      { definitionId: 'd3', entityId: 'v1', value: '' },
      { definitionId: 'd4', entityId: 'v1', value: 'X1' },
      { definitionId: 'd4', entityId: 'v2', value: null },
    ]);

    const result = await service.forRecords('inst-1', 'fee_voucher', [
      'v1',
      'v2',
      'v3',
    ]);

    expect(result.get('v1')).toEqual([{ label: 'Code', value: 'X1' }]);
    expect(result.get('v2')).toEqual([]);
    expect(result.get('v3')).toEqual([]);
    // A file field is never even asked for.
    expect(prismaMock.customFieldValue.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ definitionId: { in: ['d3', 'd4'] } }),
      select: { definitionId: true, entityId: true, value: true },
    });
  });

  it('shows the raw value for a choice whose option was since removed', async () => {
    prismaMock.customFieldDefinition.findMany.mockResolvedValue([
      definition('d1', 'Category', CustomFieldInputType.SELECT, []),
    ]);
    prismaMock.customFieldValue.findMany.mockResolvedValue([
      { definitionId: 'd1', entityId: 'v1', value: 'OLD' },
    ]);

    const result = await service.forRecords('inst-1', 'fee_voucher', ['v1']);

    expect(result.get('v1')).toEqual([{ label: 'Category', value: 'OLD' }]);
  });
});
