import { Injectable, NotFoundException } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PdfService } from '../../common/pdf/pdf.service';
import { PrintableMetaService } from '../../common/services/printable-meta.service';
import { PrismaService } from '../../prisma/prisma.service';
import { drawTimetables } from './timetable.pdf';
import {
  TimetableGroup,
  TimetableViewsService,
  TimetableWeek,
} from './timetable-views.service';

export interface PdfFile {
  buffer: Buffer;
  filename: string;
}

const safe = (text: string) =>
  text
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'timetable';

/**
 * Timetables as downloadable PDF files, drawn from exactly the week the
 * on-screen timetable shows, with that week's cover applied. Access is decided
 * by the same views that serve the on-screen timetables.
 */
@Injectable()
export class TimetablePdfService {
  constructor(
    private readonly views: TimetableViewsService,
    private readonly pdf: PdfService,
    private readonly printableMeta: PrintableMetaService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * A section's week.
   *
   * @param {CurrentUser} currentUser - Authenticated staff caller.
   * @param {string} sectionId - The section.
   * @param {string} [date] - Any date in the week wanted.
   * @returns {Promise<PdfFile>} The PDF and a file name.
   * @throws {NotFoundException} If the section does not exist.
   */
  async forSection(
    currentUser: CurrentUser,
    sectionId: string,
    date?: string,
  ): Promise<PdfFile> {
    const { data } = await this.views.sectionSchedule(
      currentUser,
      sectionId,
      date,
    );
    const section = await this.prisma.section.findUnique({
      where: { id: sectionId },
      select: { class: { select: { level: { select: { campusId: true } } } } },
    });
    if (!section) throw new NotFoundException('Section not found.');
    return this.render(
      [data.group],
      data.week,
      section.class.level.campusId,
      `timetable-${safe(data.group.title)}`,
    );
  }

  /**
   * A teacher's week.
   *
   * @param {CurrentUser} currentUser - Authenticated staff caller.
   * @param {string} staffProfileId - The teacher.
   * @param {string} [date] - Any date in the week wanted.
   * @returns {Promise<PdfFile>} The PDF and a file name.
   * @throws {NotFoundException} If the teacher does not exist.
   */
  async forTeacher(
    currentUser: CurrentUser,
    staffProfileId: string,
    date?: string,
  ): Promise<PdfFile> {
    const { data } = await this.views.teacherSchedule(
      currentUser,
      staffProfileId,
      date,
    );
    const profile = await this.prisma.staffProfile.findUnique({
      where: { id: staffProfileId },
      select: { campusId: true },
    });
    if (!profile) throw new NotFoundException('Teacher not found.');
    return this.render(
      [data.group],
      data.week,
      profile.campusId,
      `timetable-${safe(data.group.title)}`,
    );
  }

  /**
   * The signed-in person's own timetable: a student's, each of a guardian's
   * children's, or a teacher's.
   *
   * @param {CurrentUser} currentUser - Any signed-in caller.
   * @param {string} [date] - Any date in the week wanted.
   * @returns {Promise<PdfFile>} The PDF and a file name.
   * @throws {NotFoundException} If there is no timetable to print.
   */
  async forMe(currentUser: CurrentUser, date?: string): Promise<PdfFile> {
    const { data } = await this.views.mySchedule(currentUser, date);
    if (data.groups.length === 0) {
      throw new NotFoundException('There is no timetable to print yet.');
    }
    const campusId = await this.campusOf(data.groups[0]);
    return this.render(data.groups, data.week, campusId, 'my-timetable');
  }

  /** The campus a timetable group belongs to, for the school header. */
  private async campusOf(group: TimetableGroup): Promise<string> {
    if (group.kind === 'TEACHER') {
      const profile = await this.prisma.staffProfile.findUnique({
        where: { id: group.id },
        select: { campusId: true },
      });
      if (profile) return profile.campusId;
    } else {
      const student = await this.prisma.student.findUnique({
        where: { id: group.id },
        select: { campusId: true },
      });
      if (student) return student.campusId;
    }
    throw new NotFoundException('There is no timetable to print yet.');
  }

  private async render(
    groups: TimetableGroup[],
    week: TimetableWeek,
    campusId: string,
    name: string,
  ): Promise<PdfFile> {
    const campus = await this.prisma.campus.findUnique({
      where: { id: campusId },
      select: { institutionId: true },
    });
    if (!campus?.institutionId)
      throw new NotFoundException('Campus not found.');
    const meta = await this.printableMeta.build(
      'TIMETABLE',
      campus.institutionId,
      campusId,
    );
    const logo = await this.pdf.fetchImage(meta.institution.logoUrl);
    const buffer = await this.pdf.render(
      (doc) => drawTimetables(doc, groups, week, meta, logo),
      { layout: 'landscape', title: 'Timetable' },
    );
    return { buffer, filename: `${name}-${week.from}.pdf` };
  }
}
