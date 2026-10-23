import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { CurrentUser } from '../src/common/interfaces/current-user.interface';
import { ModuleAccessService } from '../src/common/services/module-access.service';
import { RequestContextService } from '../src/common/services/request-context.service';
import { ExaminationsService } from '../src/modules/examinations/examinations.service';
import { UserRole } from '../src/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Real-database proof for the M4 setup entities: band replacement frees the
 * (scale, grade) unique slot, GradeBand writes audit under the parent
 * scale's institution, soft-deleting frees a name for reuse, and the
 * additive migration's unique constraints behave as designed. Run via
 * `npm run test:postgres`; see test/POSTGRES-TESTS.md.
 */
describe('PostgreSQL examinations setup', () => {
  const context = new RequestContextService();
  let prisma: PrismaService;
  let service: ExaminationsService;
  let institutionId: string;
  let academicYearId: string;

  // SUPERADMIN skips module gating and exercises the platform-mirror path.
  const superadmin: CurrentUser = {
    sub: randomUUID(),
    email: 'super@nexus.test',
    role: UserRole.SUPERADMIN,
    institutionId: null,
  };

  const bands = (...rows: Array<[string, number, number]>) =>
    rows.map(([grade, minPercentage, maxPercentage]) => ({
      grade,
      minPercentage,
      maxPercentage,
    }));

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
    service = new ExaminationsService(
      prisma,
      new ModuleAccessService(prisma),
      context,
    );

    const institution = await prisma.institution.create({
      data: { name: 'Exams setup test', slug: randomUUID() },
    });
    institutionId = institution.id;
    const year = await prisma.academicYear.create({
      data: {
        institutionId,
        name: '2026-27',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-06-30'),
      },
    });
    academicYearId = year.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a scale with ordered bands and reads it back with isCurrent', async () => {
    const created = await service.createGradingScale(
      institutionId,
      {
        name: 'Standard',
        bands: bands(['A', 80, 100], ['B', 60, 79.99], ['F', 0, 59.99]),
      },
      superadmin,
    );

    expect(created.data.bands.map((band) => band.grade)).toEqual([
      'A',
      'B',
      'F',
    ]);

    await service.setCurrentGradingScale(
      institutionId,
      created.data.id,
      superadmin,
    );
    const list = await service.listGradingScales(institutionId, superadmin);
    expect(
      list.data.find((scale) => scale.id === created.data.id)?.isCurrent,
    ).toBe(true);

    await expect(
      service.deleteGradingScale(institutionId, created.data.id, superadmin),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a duplicate active scale name but allows it after a soft delete', async () => {
    const first = await service.createGradingScale(
      institutionId,
      { name: 'Reusable', bands: bands(['P', 0, 100]) },
      superadmin,
    );
    await expect(
      service.createGradingScale(
        institutionId,
        { name: 'Reusable', bands: bands(['P', 0, 100]) },
        superadmin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    await service.deleteGradingScale(institutionId, first.data.id, superadmin);

    await expect(
      service.createGradingScale(
        institutionId,
        { name: 'Reusable', bands: bands(['P', 0, 100]) },
        superadmin,
      ),
    ).resolves.toBeDefined();
  });

  it('replaces bands, reusing a grade label, and keeps the superseded rows soft-deleted', async () => {
    const created = await service.createGradingScale(
      institutionId,
      { name: 'Replaceable', bands: bands(['A', 50, 100], ['F', 0, 49.99]) },
      superadmin,
    );

    const updated = await service.updateGradingScale(
      institutionId,
      created.data.id,
      { bands: bands(['A', 90, 100], ['B', 70, 89.99], ['F', 0, 69.99]) },
      superadmin,
    );

    expect(updated.data.bands.map((band) => band.grade)).toEqual([
      'A',
      'B',
      'F',
    ]);
    expect(Number(updated.data.bands[0].minPercentage)).toBe(90);

    const superseded = await prisma.gradeBand.findMany({
      where: { gradingScaleId: created.data.id, deletedAt: { not: null } },
    });
    expect(superseded).toHaveLength(2);
    expect(
      superseded.every((band) => band.activeScopeKey.startsWith('REPLACED-')),
    ).toBe(true);
  });

  it('audits GradeBand writes under the parent scale institution', async () => {
    const created = await service.createGradingScale(
      institutionId,
      { name: 'Audited', bands: bands(['Pass', 40, 100]) },
      superadmin,
    );
    const bandRow = created.data.bands[0];

    const audit = await prisma.auditLog.findMany({
      where: { entity: 'GradeBand', entityId: bandRow.id },
    });

    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((row) => row.institutionId === institutionId)).toBe(
      true,
    );
  });

  it('enforces exam term uniqueness per academic year and frees the name on delete', async () => {
    const term = await service.createExamTerm(
      institutionId,
      { academicYearId, name: 'First Term', weight: 1.5, sortOrder: 1 },
      superadmin,
    );
    expect(Number(term?.data.weight)).toBe(1.5);

    await expect(
      service.createExamTerm(
        institutionId,
        { academicYearId, name: 'First Term' },
        superadmin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    await service.deleteExamTerm(institutionId, term.data.id, superadmin);

    await expect(
      service.createExamTerm(
        institutionId,
        { academicYearId, name: 'First Term' },
        superadmin,
      ),
    ).resolves.toBeDefined();

    const terms = await service.listExamTerms(
      institutionId,
      superadmin,
      academicYearId,
    );
    expect(terms.data.filter((row) => row.name === 'First Term')).toHaveLength(
      1,
    );
  });
});
