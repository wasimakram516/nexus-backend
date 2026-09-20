import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { ContactInquiryStatus } from '../src/prisma/client';
import { CurrentUser } from '../src/common/interfaces/current-user.interface';
import { RequestContextService } from '../src/common/services/request-context.service';
import { ContactInquiriesService } from '../src/modules/contact-inquiries/contact-inquiries.service';
import { RealtimeGateway } from '../src/modules/realtime/realtime.gateway';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Real-database proof for the contact inbox: an unauthenticated (no actor)
 * create audits without crashing, and the
 * status / soft-delete / list-filter lifecycle works. Run via
 * `npm run test:postgres`; see test/POSTGRES-TESTS.md.
 */
describe('PostgreSQL contact inquiries', () => {
  const context = new RequestContextService();
  let prisma: PrismaService;
  let service: ContactInquiriesService;
  const marker = randomUUID();

  beforeAll(() => {
    const connection = process.env.TEST_DATABASE_URL;
    if (!connection) throw new Error('TEST_DATABASE_URL is required');
    const url = new URL(connection);
    if (
      url.hostname !== '127.0.0.1' ||
      !/^\/nexus_audit_test(?:_[a-z0-9]+)?$/.test(url.pathname)
    )
      throw new Error('Use an isolated loopback nexus_audit_test database');
    process.env.DATABASE_URL = connection;
    prisma = new PrismaService(context);
    // Realtime delivery is covered by unit tests; here it is a no-op stub.
    const realtime = {
      emitDomainEvent: jest.fn(),
    } as unknown as RealtimeGateway;
    service = new ContactInquiriesService(prisma, realtime);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const submit = (extra: Record<string, unknown> = {}) =>
    service.create(
      {
        name: 'Ada',
        email: `${marker}@example.com`,
        inquiryType: 'Request a Demo',
        message: 'Hello',
        ...extra,
      },
      { ipAddress: '203.0.113.9', userAgent: 'jest' },
    );

  it('creates with no actor and audits it', async () => {
    await submit();

    const rows = await prisma.contactInquiry.findMany({
      where: { email: `${marker}@example.com` },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: ContactInquiryStatus.NEW,
      ipAddress: '203.0.113.9',
      createdBy: null,
    });

    const audit = await prisma.auditLog.findMany({
      where: { entity: 'ContactInquiry', entityId: rows[0].id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].userId).toBeNull();
  });

  it('filters by status, changes status and soft-deletes', async () => {
    const row = await prisma.contactInquiry.findFirstOrThrow({
      where: { email: `${marker}@example.com` },
    });
    const admin = { sub: randomUUID() } as CurrentUser;

    const read = await service.updateStatus(row.id, ContactInquiryStatus.READ);
    expect(read.data.readAt).toBeInstanceOf(Date);

    const newOnes = await service.list({
      status: ContactInquiryStatus.NEW,
      limit: 100,
    });
    expect(newOnes.data.items.some((i) => i.id === row.id)).toBe(false);
    const readOnes = await service.list({
      status: ContactInquiryStatus.READ,
      limit: 100,
    });
    expect(readOnes.data.items.some((i) => i.id === row.id)).toBe(true);

    await service.remove(row.id, admin, 'spam');
    const after = await service.list({ limit: 100 });
    expect(after.data.items.some((i) => i.id === row.id)).toBe(false);
    await expect(
      service.updateStatus(row.id, ContactInquiryStatus.ARCHIVED),
    ).rejects.toBeInstanceOf(NotFoundException);

    const stored = await prisma.contactInquiry.findFirst({
      where: { id: row.id, deletedAt: { not: null } },
    });
    expect(stored?.deleteReason).toBe('spam');
  });
});
