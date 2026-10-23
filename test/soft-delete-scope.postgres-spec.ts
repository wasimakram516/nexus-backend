import { randomUUID } from 'node:crypto';
import { RequestContextService } from '../src/common/services/request-context.service';
import { UserRole } from '../src/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Real-database proof that a plain `update({ deletedAt })` soft delete frees
 * the record's slot in its unique index, for models that never opted in
 * individually (AcademicYear, Role). Run via `npm run test:postgres`; see
 * test/POSTGRES-TESTS.md.
 */
describe('PostgreSQL soft delete frees unique names', () => {
  const context = new RequestContextService();
  let prisma: PrismaService;
  let institutionId: string;

  beforeAll(async () => {
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
    const institution = await prisma.institution.create({
      data: { name: 'Soft delete scope test', slug: randomUUID() },
    });
    institutionId = institution.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const yearData = () => ({
    institutionId,
    name: '2026-27',
    startDate: new Date('2026-08-01'),
    endDate: new Date('2027-06-30'),
  });

  it('lets an academic year name be reused after a soft delete', async () => {
    const first = await prisma.academicYear.create({ data: yearData() });

    await prisma.academicYear.update({
      where: { id: first.id },
      data: { deletedAt: new Date() },
    });

    const stored = await prisma.academicYear.findFirst({
      where: { id: first.id, deletedAt: { not: null } },
    });
    expect(stored?.activeScopeKey).toBe(`DELETED:${first.id}`);
    await expect(
      prisma.academicYear.create({ data: yearData() }),
    ).resolves.toBeDefined();
  });

  it('resets the key on restore and then blocks a clash with the active twin', async () => {
    const name = `Restorable ${randomUUID()}`;
    const first = await prisma.role.create({
      data: { institutionId, name, permissions: {} },
    });
    await prisma.role.update({
      where: { id: first.id },
      data: { deletedAt: new Date() },
    });
    await prisma.role.create({
      data: { institutionId, name, permissions: {} },
    });

    // The reset-to-ACTIVE stamp on restore only runs for an authenticated
    // actor, which every real restore has.
    const actor = {
      sub: randomUUID(),
      email: 'admin@nexus.test',
      role: UserRole.ADMIN,
    };
    await expect(
      context.runWith(
        { currentUser: actor },
        async () =>
          await prisma.role.update({
            where: { id: first.id, deletedAt: { not: null } },
            data: { deletedAt: null, deletedBy: null, deleteReason: null },
          }),
      ),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
