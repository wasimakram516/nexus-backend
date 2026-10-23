import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { CurrentUser } from '../src/common/interfaces/current-user.interface';
import { AuditLogService } from '../src/common/services/audit-log.service';
import { CampusAccessService } from '../src/common/services/campus-access.service';
import { EntityCustomFieldsService } from '../src/common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../src/common/services/module-access.service';
import { RequestContextService } from '../src/common/services/request-context.service';
import { RetakeExamType } from '../src/modules/examinations/dto/examinations.dto';
import { ExamResultsService } from '../src/modules/examinations/exam-results.service';
import { ExamSubjectsService } from '../src/modules/examinations/exam-subjects.service';
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
/** The service returns `data` as possibly null after the retry wrapper; fail loudly if it is. */
function dataOf<T>(result: { data: T } | undefined): NonNullable<T> {
  if (!result?.data) throw new Error('Expected the service to return data');
  return result.data;
}

describe('PostgreSQL examinations setup', () => {
  const context = new RequestContextService();
  let prisma: PrismaService;
  let service: ExaminationsService;
  let papers: ExamSubjectsService;
  let results: ExamResultsService;
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
      new CampusAccessService(prisma),
      new EntityCustomFieldsService(prisma, context),
      new AuditLogService(prisma),
    );
    papers = new ExamSubjectsService(
      prisma,
      new ModuleAccessService(prisma),
      new CampusAccessService(prisma),
      new EntityCustomFieldsService(prisma, context),
    );
    results = new ExamResultsService(
      prisma,
      new ModuleAccessService(prisma),
      new CampusAccessService(prisma),
      context,
    );

    const institution = await prisma.institution.create({
      data: { name: 'Exams setup test', slug: randomUUID() },
    });
    institutionId = institution.id;
    // Non-superadmin callers (teachers) are subject to module entitlements.
    await prisma.institutionEntitlement.create({
      data: { institutionId, moduleKey: 'EXAMINATIONS', isEnabled: true },
    });
    // Workflow actions stamp publishedBy, which is a foreign key to users.
    await prisma.user.create({
      data: {
        id: superadmin.sub,
        name: 'Exam test superadmin',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'SUPERADMIN',
      },
    });
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

    expect(dataOf(created).bands.map((band) => band.grade)).toEqual([
      'A',
      'B',
      'F',
    ]);

    await service.setCurrentGradingScale(
      institutionId,
      dataOf(created).id,
      superadmin,
    );
    const list = await service.listGradingScales(institutionId, superadmin);
    expect(
      list.data.find((scale) => scale.id === dataOf(created).id)?.isCurrent,
    ).toBe(true);

    await expect(
      service.deleteGradingScale(institutionId, dataOf(created).id, superadmin),
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

    await service.deleteGradingScale(
      institutionId,
      dataOf(first).id,
      superadmin,
    );

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
      dataOf(created).id,
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
      where: { gradingScaleId: dataOf(created).id, deletedAt: { not: null } },
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
    const bandRow = dataOf(created).bands[0];

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
    expect(Number(dataOf(term).weight)).toBe(1.5);

    await expect(
      service.createExamTerm(
        institutionId,
        { academicYearId, name: 'First Term' },
        superadmin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    await service.deleteExamTerm(institutionId, dataOf(term).id, superadmin);

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

  describe('exams', () => {
    let classId: string;
    let termId: string;
    let scaleId: string;
    let regularId: string;

    beforeAll(async () => {
      const campus = await prisma.campus.create({
        data: {
          institutionId,
          name: 'Exam campus',
          location: 'Test',
          studentStartTime: '08:00',
          studentEndTime: '14:00',
          staffStartTime: '08:00',
          staffEndTime: '14:00',
          lateThreshold: 10,
          earlyLeaveThreshold: 10,
        },
      });
      const level = await prisma.level.create({
        data: { name: 'Level 1', campusId: campus.id },
      });
      const academicClass = await prisma.academicClass.create({
        data: { name: 'Class 1', levelId: level.id },
      });
      classId = academicClass.id;

      const term = await service.createExamTerm(
        institutionId,
        { academicYearId, name: 'Exam Term' },
        superadmin,
      );
      termId = dataOf(term).id;
      const scale = await service.createGradingScale(
        institutionId,
        { name: 'Exam scale', bands: bands(['Pass', 0, 100]) },
        superadmin,
      );
      scaleId = scale.data.id;
      await service.setCurrentGradingScale(institutionId, scaleId, superadmin);
    });

    it('allows only one regular exam per class and term, and frees it on delete', async () => {
      const first = await service.createExam(superadmin, {
        classId,
        examTermId: termId,
        name: 'Regular',
      });
      regularId = dataOf(first).id;
      expect(dataOf(first).gradingScaleId).toBe(scaleId);
      expect(dataOf(first).retakeKey).toBe('REGULAR');

      await expect(
        service.createExam(superadmin, {
          classId,
          examTermId: termId,
          name: 'Regular again',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      const spare = await service.createExamTerm(
        institutionId,
        { academicYearId, name: 'Spare Term' },
        superadmin,
      );
      const other = await service.createExam(superadmin, {
        classId,
        examTermId: dataOf(spare).id,
        name: 'Other term',
      });
      await service.deleteExam(superadmin, dataOf(other).id);
      await expect(
        service.createExam(superadmin, {
          classId,
          examTermId: dataOf(spare).id,
          name: 'Other term again',
        }),
      ).resolves.toBeDefined();
    });

    it('lets each retake type coexist but rejects a duplicate of one type', async () => {
      await expect(
        service.createRetakeExam(superadmin, regularId, {
          examType: RetakeExamType.RETAKE,
          name: 'Too early',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      await service.publishExam(superadmin, regularId);

      const retake = await service.createRetakeExam(superadmin, regularId, {
        examType: RetakeExamType.RETAKE,
        name: 'Retake',
      });
      expect(dataOf(retake).retakeKey).toBe(`RETAKE:${regularId}`);
      expect(dataOf(retake).originalExamId).toBe(regularId);

      await expect(
        service.createRetakeExam(superadmin, regularId, {
          examType: RetakeExamType.IMPROVEMENT,
          name: 'Improvement',
        }),
      ).resolves.toBeDefined();
      await expect(
        service.createRetakeExam(superadmin, regularId, {
          examType: RetakeExamType.RETAKE,
          name: 'Second retake',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      const listed = await service.listRetakeExams(superadmin, regularId);
      expect(listed.data.map((row) => row.examType).sort()).toEqual([
        'IMPROVEMENT',
        'RETAKE',
      ]);
    });

    it('runs the publish, unlock, relock cycle with a dedicated audit entry for each', async () => {
      const exam = dataOf(
        await service.createExam(superadmin, {
          classId,
          examTermId: dataOf(
            await service.createExamTerm(
              institutionId,
              { academicYearId, name: 'Workflow Term' },
              superadmin,
            ),
          ).id,
          name: 'Workflow exam',
        }),
      );

      await expect(
        service.unlockExam(superadmin, exam.id),
      ).rejects.toBeInstanceOf(ConflictException);

      const published = dataOf(await service.publishExam(superadmin, exam.id));
      expect(published.status).toBe('PUBLISHED');
      expect(published.publishedAt).toBeInstanceOf(Date);
      await expect(
        service.publishExam(superadmin, exam.id),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(
        dataOf(await service.unlockExam(superadmin, exam.id))
          .unlockedForEditing,
      ).toBe(true);
      expect(
        dataOf(await service.relockExam(superadmin, exam.id))
          .unlockedForEditing,
      ).toBe(false);
      await expect(
        service.relockExam(superadmin, exam.id),
      ).rejects.toBeInstanceOf(ConflictException);

      const audit = await prisma.auditLog.findMany({
        where: {
          entity: 'Exam',
          entityId: exam.id,
          action: { in: ['EXAM_PUBLISHED', 'EXAM_UNLOCKED', 'EXAM_RELOCKED'] },
        },
      });
      expect(audit.map((row) => row.action).sort()).toEqual([
        'EXAM_PUBLISHED',
        'EXAM_RELOCKED',
        'EXAM_UNLOCKED',
      ]);
      expect(audit.every((row) => row.institutionId === institutionId)).toBe(
        true,
      );
    });

    it('lets only one of two simultaneous publishes win', async () => {
      const exam = dataOf(
        await service.createExam(superadmin, {
          classId,
          examTermId: dataOf(
            await service.createExamTerm(
              institutionId,
              { academicYearId, name: 'Race Term' },
              superadmin,
            ),
          ).id,
          name: 'Race exam',
        }),
      );

      const results = await Promise.allSettled([
        service.publishExam(superadmin, exam.id),
        service.publishExam(superadmin, exam.id),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    });

    it('refuses to delete an exam while retakes still point at it', async () => {
      await expect(
        service.deleteExam(superadmin, regularId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('locks the grading scale of a published exam', async () => {
      const spare = await service.createGradingScale(
        institutionId,
        { name: 'Spare scale', bands: bands(['OK', 0, 100]) },
        superadmin,
      );
      await expect(
        service.updateExam(superadmin, regularId, {
          gradingScaleId: dataOf(spare).id,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('custom field values on exam entities', () => {
    let fieldInstitutionId: string;
    let fieldYearId: string;
    let fieldClassId: string;
    let fieldTermId: string;

    beforeAll(async () => {
      // A dedicated institution, so the required definitions below cannot
      // affect the other scenarios in this file.
      const institution = await prisma.institution.create({
        data: { name: 'Exam fields test', slug: randomUUID() },
      });
      fieldInstitutionId = institution.id;
      const year = await prisma.academicYear.create({
        data: {
          institutionId: fieldInstitutionId,
          name: '2026-27',
          startDate: new Date('2026-08-01'),
          endDate: new Date('2027-06-30'),
        },
      });
      fieldYearId = year.id;
      const campus = await prisma.campus.create({
        data: {
          institutionId: fieldInstitutionId,
          name: 'Fields campus',
          location: 'Test',
          studentStartTime: '08:00',
          studentEndTime: '14:00',
          staffStartTime: '08:00',
          staffEndTime: '14:00',
          lateThreshold: 10,
          earlyLeaveThreshold: 10,
        },
      });
      const level = await prisma.level.create({
        data: { name: 'Level 1', campusId: campus.id },
      });
      const academicClass = await prisma.academicClass.create({
        data: { name: 'Class 1', levelId: level.id },
      });
      fieldClassId = academicClass.id;

      const scale = await service.createGradingScale(
        fieldInstitutionId,
        { name: 'Scale', bands: bands(['Pass', 0, 100]) },
        superadmin,
      );
      await service.setCurrentGradingScale(
        fieldInstitutionId,
        scale.data.id,
        superadmin,
      );
      // Created before the required definitions exist.
      const term = await service.createExamTerm(
        fieldInstitutionId,
        { academicYearId: fieldYearId, name: 'Term' },
        superadmin,
      );
      fieldTermId = dataOf(term).id;

      await prisma.customFieldDefinition.createMany({
        data: [
          {
            institutionId: fieldInstitutionId,
            moduleKey: 'EXAMINATIONS' as never,
            entityType: 'exam_term',
            fieldKey: 'venue',
            label: 'Venue',
            inputType: 'TEXT' as never,
            isRequired: true,
          },
          {
            institutionId: fieldInstitutionId,
            moduleKey: 'EXAMINATIONS' as never,
            entityType: 'exam',
            fieldKey: 'invigilator',
            label: 'Invigilator',
            inputType: 'TEXT' as never,
            isRequired: true,
          },
        ],
      });
    });

    it('rolls an exam term back when a required value is missing, and saves it with the value', async () => {
      await expect(
        service.createExamTerm(
          fieldInstitutionId,
          { academicYearId: fieldYearId, name: 'No venue' },
          superadmin,
        ),
      ).rejects.toThrow();
      expect(
        await prisma.examTerm.count({
          where: { institutionId: fieldInstitutionId, name: 'No venue' },
        }),
      ).toBe(0);

      const created = await service.createExamTerm(
        fieldInstitutionId,
        {
          academicYearId: fieldYearId,
          name: 'With venue',
          customFields: { venue: 'Hall A' },
        },
        superadmin,
      );
      const read = await service.getExamTerm(
        fieldInstitutionId,
        dataOf(created).id,
        superadmin,
      );
      expect(JSON.stringify(read.data)).toContain('Hall A');
    });

    it('rolls an exam back when a required value is missing, and saves it with the value', async () => {
      await expect(
        service.createExam(superadmin, {
          classId: fieldClassId,
          examTermId: fieldTermId,
          name: 'No invigilator',
        }),
      ).rejects.toThrow();
      expect(
        await prisma.exam.count({ where: { name: 'No invigilator' } }),
      ).toBe(0);

      const created = await service.createExam(superadmin, {
        classId: fieldClassId,
        examTermId: fieldTermId,
        name: 'With invigilator',
        customFields: { invigilator: 'Ms Ali' },
      });
      const read = await service.getExam(superadmin, dataOf(created).id);
      expect(JSON.stringify(read.data)).toContain('Ms Ali');
    });
  });

  describe('exam papers', () => {
    let classId: string;
    let otherClassSubjectId: string;
    let mathsId: string;
    let scienceId: string;
    let examId: string;

    beforeAll(async () => {
      const campus = await prisma.campus.create({
        data: {
          institutionId,
          name: 'Papers campus',
          location: 'Test',
          studentStartTime: '08:00',
          studentEndTime: '14:00',
          staffStartTime: '08:00',
          staffEndTime: '14:00',
          lateThreshold: 10,
          earlyLeaveThreshold: 10,
        },
      });
      const level = await prisma.level.create({
        data: { name: 'Papers level', campusId: campus.id },
      });
      const academicClass = await prisma.academicClass.create({
        data: { name: 'Papers class', levelId: level.id },
      });
      const otherClass = await prisma.academicClass.create({
        data: { name: 'Other class', levelId: level.id },
      });
      classId = academicClass.id;
      mathsId = (
        await prisma.subject.create({ data: { name: 'Maths', classId } })
      ).id;
      scienceId = (
        await prisma.subject.create({ data: { name: 'Science', classId } })
      ).id;
      otherClassSubjectId = (
        await prisma.subject.create({
          data: { name: 'Elsewhere', classId: otherClass.id },
        })
      ).id;

      const scale = await service.createGradingScale(
        institutionId,
        { name: 'Papers scale', bands: bands(['Pass', 0, 100]) },
        superadmin,
      );
      await service.setCurrentGradingScale(
        institutionId,
        dataOf(scale).id,
        superadmin,
      );
      const term = await service.createExamTerm(
        institutionId,
        { academicYearId, name: 'Papers term' },
        superadmin,
      );
      examId = dataOf(
        await service.createExam(superadmin, {
          classId,
          examTermId: dataOf(term).id,
          name: 'Papers exam',
        }),
      ).id;
    });

    it('adds papers with names, rejects a duplicate and a subject of another class', async () => {
      const maths = dataOf(
        await papers.createExamSubject(superadmin, {
          examId,
          subjectId: mathsId,
          maxMarks: 100,
          passingMarks: 40,
          examDate: '2026-12-01',
          startTime: '09:00',
          endTime: '11:00',
          room: 'A-1',
        }),
      );
      expect(maths.subject.name).toBe('Maths');
      expect(Number(maths.maxMarks)).toBe(100);

      await expect(
        papers.createExamSubject(superadmin, {
          examId,
          subjectId: mathsId,
          maxMarks: 50,
          passingMarks: 20,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        papers.createExamSubject(superadmin, {
          examId,
          subjectId: otherClassSubjectId,
          maxMarks: 50,
          passingMarks: 20,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('audits a paper under the institution of its exam', async () => {
      const science = dataOf(
        await papers.createExamSubject(superadmin, {
          examId,
          subjectId: scienceId,
          maxMarks: 50,
          passingMarks: 20,
          examDate: '2026-12-05',
        }),
      );

      const audit = await prisma.auditLog.findMany({
        where: { entity: 'ExamSubject', entityId: science.id },
      });
      expect(audit.length).toBeGreaterThan(0);
      expect(audit.every((row) => row.institutionId === institutionId)).toBe(
        true,
      );
    });

    it('computes the datesheet range from the papers', async () => {
      const exam = dataOf(await service.getExam(superadmin, examId));

      expect(exam.datesheetStart).toEqual(new Date('2026-12-01'));
      expect(exam.datesheetEnd).toEqual(new Date('2026-12-05'));
    });

    it('frees a subject after its paper is deleted from a draft', async () => {
      const list = dataOf(
        await papers.listExamSubjects(superadmin, { examId }),
      );
      const science = list.find((row) => row.subjectId === scienceId);

      await papers.deleteExamSubject(superadmin, science!.id, 'wrong subject');
      expect(
        dataOf(await papers.listExamSubjects(superadmin, { examId })),
      ).toHaveLength(1);

      await expect(
        papers.createExamSubject(superadmin, {
          examId,
          subjectId: scienceId,
          maxMarks: 50,
          passingMarks: 20,
          examDate: '2026-12-05',
        }),
      ).resolves.toBeDefined();
    });

    it('locks structure and marks once published, but never logistics', async () => {
      await service.publishExam(superadmin, examId);
      const list = dataOf(
        await papers.listExamSubjects(superadmin, { examId }),
      );
      const maths = list.find((row) => row.subjectId === mathsId)!;

      await expect(
        papers.createExamSubject(superadmin, {
          examId,
          subjectId: otherClassSubjectId,
          maxMarks: 10,
          passingMarks: 4,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        papers.deleteExamSubject(superadmin, maths.id),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        papers.updateExamSubject(superadmin, maths.id, { maxMarks: 80 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(
        dataOf(
          await papers.updateExamSubject(superadmin, maths.id, { room: 'B-9' }),
        ).room,
      ).toBe('B-9');

      await service.unlockExam(superadmin, examId);
      expect(
        Number(
          dataOf(
            await papers.updateExamSubject(superadmin, maths.id, {
              maxMarks: 80,
              passingMarks: 30,
            }),
          ).maxMarks,
        ),
      ).toBe(80);
      await expect(
        papers.deleteExamSubject(superadmin, maths.id),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('only allows a retake paper for a subject that was on the original exam', async () => {
      const retake = dataOf(
        await service.createRetakeExam(superadmin, examId, {
          examType: RetakeExamType.RETAKE,
          name: 'Papers retake',
        }),
      );

      await expect(
        papers.createExamSubject(superadmin, {
          examId: retake.id,
          subjectId: otherClassSubjectId,
          maxMarks: 10,
          passingMarks: 4,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        papers.createExamSubject(superadmin, {
          examId: retake.id,
          subjectId: mathsId,
          maxMarks: 80,
          passingMarks: 30,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('marks entry', () => {
    let campusId: string;
    let classId: string;
    let sectionId: string;
    let otherSectionId: string;
    let paperId: string;
    let examId: string;
    let ayeshaId: string;
    let bilalId: string;
    let saraId: string;
    let teacher: CurrentUser;
    let staffProfileId: string;
    let subjectId: string;

    const newStudent = async (name: string, regNo: string, section: string) => {
      const user = await prisma.user.create({
        data: {
          institutionId,
          name,
          email: `${randomUUID()}@example.test`,
          passwordHash: 'unused-test-value',
          role: 'STUDENT',
        },
      });
      const student = await prisma.student.create({
        data: {
          userId: user.id,
          institutionId,
          regNo,
          dob: new Date('2012-01-01'),
          gender: 'FEMALE',
          campusId,
          admissionDate: new Date('2026-04-01'),
        },
      });
      await prisma.studentEnrollment.create({
        data: {
          studentId: student.id,
          academicYearId,
          campusId,
          classId,
          sectionId: section,
        },
      });
      return student.id;
    };

    beforeAll(async () => {
      const campus = await prisma.campus.create({
        data: {
          institutionId,
          name: 'Marks campus',
          location: 'Test',
          studentStartTime: '08:00',
          studentEndTime: '14:00',
          staffStartTime: '08:00',
          staffEndTime: '14:00',
          lateThreshold: 10,
          earlyLeaveThreshold: 10,
        },
      });
      campusId = campus.id;
      const level = await prisma.level.create({
        data: { name: 'Marks level', campusId },
      });
      classId = (
        await prisma.academicClass.create({
          data: { name: 'Marks class', levelId: level.id },
        })
      ).id;
      sectionId = (
        await prisma.section.create({ data: { name: 'A', classId } })
      ).id;
      otherSectionId = (
        await prisma.section.create({ data: { name: 'B', classId } })
      ).id;
      subjectId = (
        await prisma.subject.create({ data: { name: 'Marks maths', classId } })
      ).id;

      ayeshaId = await newStudent('Ayesha', 'M-1', sectionId);
      bilalId = await newStudent('Bilal', 'M-2', sectionId);
      saraId = await newStudent('Sara', 'M-3', otherSectionId);

      const scale = await service.createGradingScale(
        institutionId,
        { name: 'Marks scale', bands: bands(['Pass', 0, 100]) },
        superadmin,
      );
      await service.setCurrentGradingScale(
        institutionId,
        dataOf(scale).id,
        superadmin,
      );
      const term = await service.createExamTerm(
        institutionId,
        { academicYearId, name: 'Marks term' },
        superadmin,
      );
      examId = dataOf(
        await service.createExam(superadmin, {
          classId,
          examTermId: dataOf(term).id,
          name: 'Marks exam',
        }),
      ).id;
      paperId = dataOf(
        await papers.createExamSubject(superadmin, {
          examId,
          subjectId,
          maxMarks: 100,
          passingMarks: 40,
        }),
      ).id;

      const teacherUser = await prisma.user.create({
        data: {
          institutionId,
          name: 'Teacher',
          email: `${randomUUID()}@example.test`,
          passwordHash: 'unused-test-value',
          role: 'STAFF',
        },
      });
      staffProfileId = (
        await prisma.staffProfile.create({
          data: {
            userId: teacherUser.id,
            employmentType: 'TEACHING',
            designation: 'Teacher',
            gender: 'FEMALE',
            campusId,
            joiningDate: new Date('2025-01-01'),
          },
        })
      ).id;
      // The people service creates this assignment with a staff profile.
      await prisma.userCampus.create({
        data: { userId: teacherUser.id, campusId },
      });
      teacher = {
        sub: teacherUser.id,
        email: teacherUser.email,
        role: UserRole.STAFF,
        institutionId,
      };
    });

    it('lists only the chosen section, ordered by name, and rejects a section of another class', async () => {
      const grid = dataOf(
        await results.getResults(superadmin, paperId, sectionId),
      );
      expect(grid.students.map((s) => s.name)).toEqual(['Ayesha', 'Bilal']);
      expect(grid.students.every((s) => s.result === null)).toBe(true);

      const foreignClass = await prisma.academicClass.create({
        data: {
          name: 'Foreign',
          levelId: (
            await prisma.level.findFirstOrThrow({ where: { campusId } })
          ).id,
        },
      });
      const foreignSection = await prisma.section.create({
        data: { name: 'Z', classId: foreignClass.id },
      });
      await expect(
        results.getResults(superadmin, paperId, foreignSection.id),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('saves marks, then reports an identical resave as unchanged', async () => {
      const first = dataOf(
        await results.bulkSave(superadmin, paperId, {
          sectionId,
          entries: [
            { studentId: ayeshaId, marksObtained: 82.5, remarks: 'Great' },
            { studentId: bilalId, isAbsent: true },
          ],
        }),
      );
      expect(first).toEqual({ saved: 2, unchanged: 0 });

      const again = dataOf(
        await results.bulkSave(superadmin, paperId, {
          sectionId,
          entries: [
            { studentId: ayeshaId, marksObtained: 82.5 },
            { studentId: bilalId, isAbsent: true },
          ],
        }),
      );
      expect(again).toEqual({ saved: 0, unchanged: 2 });

      const grid = dataOf(
        await results.getResults(superadmin, paperId, sectionId),
      );
      expect(grid.students[0].result).toMatchObject({
        marksObtained: 82.5,
        remarks: 'Great',
        isAbsent: false,
      });
      expect(grid.students[1].result).toMatchObject({
        marksObtained: null,
        isAbsent: true,
      });
    });

    it('audits each change under the student institution, with before and after values', async () => {
      await results.bulkSave(superadmin, paperId, {
        sectionId,
        entries: [{ studentId: ayeshaId, marksObtained: 90 }],
      });

      const row = await prisma.examResult.findFirstOrThrow({
        where: { examSubjectId: paperId, studentId: ayeshaId },
      });
      const audit = await prisma.auditLog.findMany({
        where: { entity: 'ExamResult', entityId: row.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit.length).toBeGreaterThanOrEqual(2);
      expect(
        audit.every((entry) => entry.institutionId === institutionId),
      ).toBe(true);
      expect(JSON.stringify(audit[audit.length - 1].before)).toContain('82.5');
      expect(JSON.stringify(audit[audit.length - 1].after)).toContain('90');
    });

    it('rejects out-of-range marks, marks with an absence, and a student of another section, writing nothing', async () => {
      await expect(
        results.bulkSave(superadmin, paperId, {
          sectionId,
          entries: [{ studentId: ayeshaId, marksObtained: 101 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        results.bulkSave(superadmin, paperId, {
          sectionId,
          entries: [{ studentId: ayeshaId, marksObtained: 50, isAbsent: true }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        results.bulkSave(superadmin, paperId, {
          sectionId,
          entries: [{ studentId: saraId, marksObtained: 50 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(
        await prisma.examResult.count({
          where: { examSubjectId: paperId, studentId: saraId },
        }),
      ).toBe(0);
    });

    it('lets two people save the same new student at once without an error', async () => {
      const outcomes = await Promise.allSettled([
        results.bulkSave(superadmin, paperId, {
          sectionId: otherSectionId,
          entries: [{ studentId: saraId, marksObtained: 60 }],
        }),
        results.bulkSave(superadmin, paperId, {
          sectionId: otherSectionId,
          entries: [{ studentId: saraId, marksObtained: 70 }],
        }),
      ]);

      expect(outcomes.every((o) => o.status === 'fulfilled')).toBe(true);
      expect(
        await prisma.examResult.count({
          where: { examSubjectId: paperId, studentId: saraId },
        }),
      ).toBe(1);
    });

    it('only lets a teacher save marks for a section they are assigned to teach', async () => {
      await expect(
        results.bulkSave(teacher, paperId, {
          sectionId,
          entries: [{ studentId: ayeshaId, marksObtained: 71 }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      await prisma.teacherSubject.create({
        data: { staffProfileId, classId, subjectId, sectionId, campusId },
      });
      await expect(
        results.bulkSave(teacher, paperId, {
          sectionId,
          entries: [{ studentId: ayeshaId, marksObtained: 71 }],
        }),
      ).resolves.toBeDefined();
      // Assigned to section A only.
      await expect(
        results.bulkSave(teacher, paperId, {
          sectionId: otherSectionId,
          entries: [{ studentId: saraId, marksObtained: 71 }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lists students who failed or were absent, and not those who passed', async () => {
      await results.bulkSave(superadmin, paperId, {
        sectionId,
        entries: [
          { studentId: ayeshaId, marksObtained: 39.99 },
          { studentId: bilalId, isAbsent: true },
        ],
      });

      const failing = dataOf(
        await results.getFailingStudents(superadmin, paperId, sectionId),
      );
      expect(failing.map((s) => s.name)).toEqual(['Ayesha', 'Bilal']);

      await results.bulkSave(superadmin, paperId, {
        sectionId,
        entries: [{ studentId: ayeshaId, marksObtained: 40 }],
      });
      expect(
        dataOf(
          await results.getFailingStudents(superadmin, paperId, sectionId),
        ).map((s) => s.name),
      ).toEqual(['Bilal']);
    });

    it('blocks lowering the maximum below existing marks, with a count', async () => {
      await results.bulkSave(superadmin, paperId, {
        sectionId,
        entries: [{ studentId: ayeshaId, marksObtained: 75 }],
      });

      await expect(
        papers.updateExamSubject(superadmin, paperId, {
          maxMarks: 60,
          passingMarks: 20,
        }),
      ).rejects.toThrow(/2 students have marks above 60/);
    });

    it('locks marks once published and allows corrections only while unlocked', async () => {
      await service.publishExam(superadmin, examId);
      await expect(
        results.bulkSave(superadmin, paperId, {
          sectionId,
          entries: [{ studentId: ayeshaId, marksObtained: 80 }],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(
        dataOf(await results.getResults(superadmin, paperId, sectionId)).locked,
      ).toBe(true);

      await service.unlockExam(superadmin, examId);
      await expect(
        results.bulkSave(superadmin, paperId, {
          sectionId,
          entries: [{ studentId: ayeshaId, marksObtained: 80 }],
        }),
      ).resolves.toBeDefined();
      await service.relockExam(superadmin, examId);
      await expect(
        results.bulkSave(superadmin, paperId, {
          sectionId,
          entries: [{ studentId: ayeshaId, marksObtained: 81 }],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
