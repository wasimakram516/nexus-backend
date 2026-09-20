import { NotFoundException } from '@nestjs/common';
import { ContactInquiryStatus } from '../../prisma/client';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ContactInquiriesService } from './contact-inquiries.service';
import { CreateContactInquiryDto } from './dto/contact-inquiry.dto';

/** Typed wrapper around expect.objectContaining (which returns any). */
const containing = (value: Record<string, unknown>): unknown =>
  expect.objectContaining(value) as unknown;

describe('ContactInquiriesService', () => {
  const updateMock = jest.fn();
  const prismaMock = {
    contactInquiry: {
      create: jest.fn(),
      findMany: jest.fn().mockReturnValue('findMany'),
      count: jest.fn().mockReturnValue('count'),
      findFirst: jest.fn(),
      update: updateMock,
    },
    $transaction: jest.fn(),
  };
  const emitMock = jest.fn();
  let service: ContactInquiriesService;
  const dto: CreateContactInquiryDto = {
    name: 'Ada',
    email: 'ada@example.com',
    inquiryType: 'Other',
    message: 'Hello',
  };
  const admin = { sub: 'admin-1' } as CurrentUser;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ContactInquiriesService(
      prismaMock as unknown as PrismaService,
      { emitDomainEvent: emitMock } as unknown as RealtimeGateway,
    );
    prismaMock.contactInquiry.create.mockResolvedValue({
      id: 'i-1',
      name: 'Ada',
      email: 'ada@example.com',
      inquiryType: 'Other',
      message: 'Hello',
      ipAddress: '1.2.3.4',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
  });

  it('emits once to the superadmin room with a minimal payload', async () => {
    await service.create(dto, { ipAddress: '1.2.3.4' });
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith(
      'platform:superadmin',
      'inquiry.created',
      {
        id: 'i-1',
        name: 'Ada',
        inquiryType: 'Other',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    );
  });

  it('still succeeds when the emit throws', async () => {
    emitMock.mockImplementationOnce(() => {
      throw new Error('socket down');
    });
    await expect(service.create(dto, {})).resolves.toEqual({
      message: 'Message received. Thank you.',
      data: null,
    });
  });

  it('stores a valid inquiry with request metadata', async () => {
    const res = await service.create(dto, {
      ipAddress: '1.2.3.4',
      userAgent: 'jest',
    });
    expect(prismaMock.contactInquiry.create).toHaveBeenCalledWith({
      data: containing({
        email: 'ada@example.com',
        organisation: null,
        ipAddress: '1.2.3.4',
        userAgent: 'jest',
      }),
    });
    expect(res.data).toBeNull();
  });

  it('stores every submission as NEW (no status override) and returns the standard success payload', async () => {
    const res = await service.create(dto, {});
    expect(prismaMock.contactInquiry.create).toHaveBeenCalledTimes(1);
    const data = (
      prismaMock.contactInquiry.create.mock.calls[0] as [{ data: object }]
    )[0].data;
    expect(data).toMatchObject({ name: dto.name });
    expect(data).not.toHaveProperty('status');
    expect(res).toEqual({
      message: 'Message received. Thank you.',
      data: null,
    });
  });

  it('lists with pagination and status filter', async () => {
    prismaMock.$transaction.mockResolvedValue([[{ id: 'a' }], 1]);
    const res = await service.list({
      page: 2,
      limit: 5,
      status: ContactInquiryStatus.NEW,
    });
    expect(prismaMock.contactInquiry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, status: 'NEW' },
        skip: 5,
        take: 5,
      }),
    );
    expect(res.data).toEqual({
      items: [{ id: 'a' }],
      total: 1,
      page: 2,
      limit: 5,
    });
  });

  it('lists with defaults and no status filter', async () => {
    prismaMock.$transaction.mockResolvedValue([[], 0]);
    await service.list({});
    expect(prismaMock.contactInquiry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null },
        skip: 0,
        take: 10,
      }),
    );
  });

  it('sets readAt when marking READ and clears it for NEW', async () => {
    prismaMock.contactInquiry.findFirst.mockResolvedValue({ id: 'a' });
    prismaMock.contactInquiry.update.mockResolvedValue({ id: 'a' });
    await service.updateStatus('a', ContactInquiryStatus.READ);
    expect(
      (updateMock.mock.calls[0] as [{ data: { readAt: unknown } }])[0].data
        .readAt,
    ).toBeInstanceOf(Date);
    await service.updateStatus('a', ContactInquiryStatus.NEW);
    expect(
      (updateMock.mock.calls[1] as [{ data: { readAt: unknown } }])[0].data
        .readAt,
    ).toBeNull();
  });

  it('throws NotFound for a missing inquiry', async () => {
    prismaMock.contactInquiry.findFirst.mockResolvedValue(null);
    await expect(
      service.updateStatus('x', ContactInquiryStatus.READ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('x', admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('soft-deletes with actor and reason', async () => {
    prismaMock.contactInquiry.findFirst.mockResolvedValue({ id: 'a' });
    await service.remove('a', admin, 'spam');
    expect(prismaMock.contactInquiry.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: containing({
        deletedBy: 'admin-1',
        deleteReason: 'spam',
      }),
    });
  });
});
