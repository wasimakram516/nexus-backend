import { NotFoundException } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PdfService } from '../../common/pdf/pdf.service';
import { PrintableMetaService } from '../../common/services/printable-meta.service';
import { DayOfWeek, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TimetablePdfService } from './timetable-pdf.service';
import { TimetableViewsService } from './timetable-views.service';
import { decorateWeek, weekDatesOf } from './timetable-week.util';

const pageCount = (buffer: Buffer) =>
  (buffer.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;

describe('TimetablePdfService', () => {
  const admin: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };

  const dates = weekDatesOf('2026-11-02');
  const week = { from: dates.MONDAY, to: dates.SUNDAY, dates };
  const slot = (id: string, day: DayOfWeek = DayOfWeek.MONDAY) => ({
    id,
    dayOfWeek: day,
    periodNumber: 1,
    name: 'Period 1',
    startTime: '08:00',
    endTime: '08:40',
    room: 'R1',
    sectionId: 'sec-1',
    className: 'Grade 5',
    sectionName: 'A',
    subjectName: 'Maths',
    staffProfileId: 't1',
    teacherName: 'Teacher One',
  });
  const group = (
    kind: 'SECTION' | 'TEACHER' | 'STUDENT',
    id: string,
    title: string,
  ) => ({
    kind,
    id,
    title,
    subtitle: null,
    entries: decorateWeek([slot('s1')], [], dates),
  });

  const viewsMock = {
    sectionSchedule: jest.fn(),
    teacherSchedule: jest.fn(),
    mySchedule: jest.fn(),
  };
  const metaMock = { build: jest.fn() };
  const prismaMock = {
    section: { findUnique: jest.fn() },
    staffProfile: { findUnique: jest.fn() },
    student: { findUnique: jest.fn() },
    campus: { findUnique: jest.fn() },
  };
  const pdf = new PdfService();
  const fetchImage = jest.spyOn(pdf, 'fetchImage');
  const service = new TimetablePdfService(
    viewsMock as unknown as TimetableViewsService,
    pdf,
    metaMock as unknown as PrintableMetaService,
    prismaMock as unknown as PrismaService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    fetchImage.mockResolvedValue(null);
    prismaMock.campus.findUnique.mockResolvedValue({ institutionId: 'inst-1' });
    metaMock.build.mockResolvedValue({
      documentType: 'TIMETABLE',
      generatedAt: '2026-10-25T00:00:00.000Z',
      institution: {
        id: 'inst-1',
        name: 'Greenfield School',
        logoUrl: null,
        branding: { primaryColorLight: null },
      },
      campus: { id: 'campus-1', name: 'Main Campus' },
    });
  });

  it("draws a section's week on one landscape page named after it and the week", async () => {
    viewsMock.sectionSchedule.mockResolvedValue({
      data: { week, group: group('SECTION', 'sec-1', 'Grade 5, section A') },
    });
    prismaMock.section.findUnique.mockResolvedValue({
      class: { level: { campusId: 'campus-1' } },
    });

    const file = await service.forSection(admin, 'sec-1', '2026-11-04');

    expect(viewsMock.sectionSchedule).toHaveBeenCalledWith(
      admin,
      'sec-1',
      '2026-11-04',
    );
    expect(metaMock.build).toHaveBeenCalledWith(
      'TIMETABLE',
      'inst-1',
      'campus-1',
    );
    expect(file.filename).toBe('timetable-grade-5-section-a-2026-11-02.pdf');
    expect(file.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(file.buffer)).toBe(1);
    expect(file.buffer.toString('latin1')).toMatch(/\/MediaBox \[0 0 841\.89/);
  });

  it("draws a teacher's week", async () => {
    viewsMock.teacherSchedule.mockResolvedValue({
      data: { week, group: group('TEACHER', 't1', 'Teacher One') },
    });
    prismaMock.staffProfile.findUnique.mockResolvedValue({
      campusId: 'campus-1',
    });

    const file = await service.forTeacher(admin, 't1');

    expect(file.filename).toBe('timetable-teacher-one-2026-11-02.pdf');
    expect(pageCount(file.buffer)).toBe(1);
  });

  it("draws each of a guardian's children on its own page", async () => {
    viewsMock.mySchedule.mockResolvedValue({
      data: {
        week,
        groups: [
          group('STUDENT', 'stu-1', 'Ayesha'),
          group('STUDENT', 'stu-2', 'Bilal'),
        ],
      },
    });
    prismaMock.student.findUnique.mockResolvedValue({ campusId: 'campus-1' });

    const file = await service.forMe(admin, '2026-11-02');

    expect(file.filename).toBe('my-timetable-2026-11-02.pdf');
    expect(pageCount(file.buffer)).toBe(2);
  });

  it("finds a teacher's own campus for their own timetable", async () => {
    viewsMock.mySchedule.mockResolvedValue({
      data: { week, groups: [group('TEACHER', 't1', 'Teacher One')] },
    });
    prismaMock.staffProfile.findUnique.mockResolvedValue({
      campusId: 'campus-1',
    });

    await service.forMe(admin);

    expect(prismaMock.staffProfile.findUnique).toHaveBeenCalledWith({
      where: { id: 't1' },
      select: { campusId: true },
    });
  });

  it('says so when there is no timetable to print', async () => {
    viewsMock.mySchedule.mockResolvedValue({ data: { week, groups: [] } });

    await expect(service.forMe(admin)).rejects.toThrow(
      'There is no timetable to print yet.',
    );
  });

  it('is not found for a section, teacher or campus that does not exist', async () => {
    viewsMock.sectionSchedule.mockResolvedValue({
      data: { week, group: group('SECTION', 'sec-1', 'x') },
    });
    prismaMock.section.findUnique.mockResolvedValue(null);
    await expect(service.forSection(admin, 'sec-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    viewsMock.teacherSchedule.mockResolvedValue({
      data: { week, group: group('TEACHER', 't1', 'x') },
    });
    prismaMock.staffProfile.findUnique.mockResolvedValue(null);
    await expect(service.forTeacher(admin, 't1')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prismaMock.section.findUnique.mockResolvedValue({
      class: { level: { campusId: 'campus-1' } },
    });
    prismaMock.campus.findUnique.mockResolvedValue({ institutionId: null });
    await expect(service.forSection(admin, 'sec-1')).rejects.toThrow(
      'Campus not found.',
    );
  });

  it('draws an empty week with a note instead of failing', async () => {
    viewsMock.sectionSchedule.mockResolvedValue({
      data: {
        week,
        group: {
          ...group('SECTION', 'sec-1', 'Grade 5, section A'),
          entries: [],
        },
      },
    });
    prismaMock.section.findUnique.mockResolvedValue({
      class: { level: { campusId: 'campus-1' } },
    });

    const file = await service.forSection(admin, 'sec-1');

    expect(pageCount(file.buffer)).toBe(1);
  });

  it('does not draw anything for a timetable the caller may not see', async () => {
    viewsMock.sectionSchedule.mockRejectedValue(new Error('forbidden'));

    await expect(service.forSection(admin, 'sec-1')).rejects.toThrow(
      'forbidden',
    );
  });
});
