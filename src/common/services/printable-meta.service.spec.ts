import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PrintableMetaService } from './printable-meta.service';

describe('PrintableMetaService', () => {
  let service: PrintableMetaService;

  const prismaMock = {
    institution: { findUnique: jest.fn() },
    campus: { findUnique: jest.fn() },
  };

  const branding = {
    displayName: 'Greenfield School',
    logoUrl: 'https://cdn.test/logo.png',
    primaryColorLight: '#111111',
    secondaryColorLight: '#222222',
    accentColorLight: '#333333',
    backgroundColorLight: '#ffffff',
    primaryColorDark: '#eeeeee',
    secondaryColorDark: '#dddddd',
    accentColorDark: '#cccccc',
    backgroundColorDark: '#000000',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrintableMetaService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(PrintableMetaService);
  });

  it('builds the shared header with institution identity, branding and campus', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'inst-1',
      name: 'Greenfield Education Trust',
      branding,
    });
    prismaMock.campus.findUnique.mockResolvedValue({
      id: 'campus-1',
      name: 'North',
      institutionId: 'inst-1',
    });

    const meta = await service.build('REPORT_CARD', 'inst-1', 'campus-1');

    expect(meta.documentType).toBe('REPORT_CARD');
    expect(new Date(meta.generatedAt).toString()).not.toBe('Invalid Date');
    expect(meta.institution).toEqual({
      id: 'inst-1',
      name: 'Greenfield School',
      logoUrl: 'https://cdn.test/logo.png',
      branding: {
        primaryColorLight: '#111111',
        secondaryColorLight: '#222222',
        accentColorLight: '#333333',
        backgroundColorLight: '#ffffff',
        primaryColorDark: '#eeeeee',
        secondaryColorDark: '#dddddd',
        accentColorDark: '#cccccc',
        backgroundColorDark: '#000000',
      },
    });
    expect(meta.campus).toEqual({ id: 'campus-1', name: 'North' });
  });

  it('falls back to the institution name and null branding when none is configured', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'inst-1',
      name: 'Greenfield Education Trust',
      branding: null,
    });

    const meta = await service.build('DATESHEET', 'inst-1');

    expect(meta.institution.name).toBe('Greenfield Education Trust');
    expect(meta.institution.logoUrl).toBeNull();
    expect(
      Object.values(meta.institution.branding).every((v) => v === null),
    ).toBe(true);
    expect(meta.campus).toBeNull();
    expect(prismaMock.campus.findUnique).not.toHaveBeenCalled();
  });

  it('uses the institution name when the display name is blank', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'inst-1',
      name: 'Greenfield Education Trust',
      branding: { ...branding, displayName: '' },
    });

    const meta = await service.build('ADMIT_CARD', 'inst-1');

    expect(meta.institution.name).toBe('Greenfield Education Trust');
  });

  it('404s for an unknown institution', async () => {
    prismaMock.institution.findUnique.mockResolvedValue(null);

    await expect(service.build('DATESHEET', 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('refuses a campus that belongs to a different institution', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'inst-1',
      name: 'Greenfield',
      branding: null,
    });
    prismaMock.campus.findUnique.mockResolvedValue({
      id: 'campus-9',
      name: 'Other',
      institutionId: 'inst-2',
    });

    await expect(
      service.build('DATESHEET', 'inst-1', 'campus-9'),
    ).rejects.toThrow(NotFoundException);
  });
});
