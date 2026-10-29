import { Injectable, NotFoundException } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { ExamStatus } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SubjectOutcome } from '../examinations/exam-computation';
import {
  ExamContext,
  ExamResultsViewService,
  StudentOutcome,
} from '../examinations/exam-results-view.service';
import { ExamReportQueryDto } from './dto/reports.dto';
import { percent, ReportRow, ReportTable } from './report-table';
import { ReportsAccessService } from './reports-access.service';

const NOT_GRADED = 'Not graded';

interface LoadedExam {
  institutionId: string;
  exam: ExamContext;
  students: StudentOutcome[];
  /** "Midterm, Grade 5, Main" style line that says which exam this is. */
  subtitle: string;
  campusId: string;
}

const roundOne = (value: number) => Math.round(value * 10) / 10;

/**
 * Exam reports for administrators. They are built on the same computation as
 * the report cards (grades, pass policy, how absences are treated), so a figure
 * here always agrees with what a student's report card says.
 */
@Injectable()
export class ExamReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ReportsAccessService,
    private readonly results: ExamResultsViewService,
  ) {}

  /**
   * How each paper of an exam went: who sat it, how many passed and the marks.
   *
   * @param {CurrentUser} currentUser - The administrator.
   * @param {ExamReportQueryDto} query - The exam.
   * @returns {Promise<ReportTable>} One row per paper.
   */
  async subjectResults(
    currentUser: CurrentUser,
    query: ExamReportQueryDto,
  ): Promise<ReportTable> {
    const loaded = await this.load(currentUser, query);
    const rows = loaded.exam.papers.map((paper): ReportRow => {
      const entries = loaded.students
        .map((student) =>
          student.outcome.subjects.find(
            (subject) => subject.examSubjectId === paper.examSubjectId,
          ),
        )
        .filter((subject): subject is SubjectOutcome => subject !== undefined);
      const marked = entries.filter((subject) => subject.state === 'MARKED');
      const passed = marked.filter((subject) => subject.passed === true).length;
      const marks = marked.map((subject) => subject.marksObtained ?? 0);
      const percentages = marked.map((subject) => subject.percentage ?? 0);
      return {
        subject: paper.subjectName,
        maxMarks: paper.maxMarks,
        passingMarks: paper.passingMarks,
        appeared: entries.filter((subject) => subject.state !== 'ABSENT')
          .length,
        absent: entries.filter((subject) => subject.state === 'ABSENT').length,
        awaiting: entries.filter((subject) => subject.state === 'UNMARKED')
          .length,
        passed,
        failed: marked.length - passed,
        passPercent: percent(passed, marked.length),
        averagePercent:
          percentages.length > 0
            ? roundOne(
                percentages.reduce((sum, value) => sum + value, 0) /
                  percentages.length,
              )
            : null,
        highest: marks.length > 0 ? Math.max(...marks) : null,
        lowest: marks.length > 0 ? Math.min(...marks) : null,
      };
    });

    return {
      key: 'exam-subject-results',
      title: 'Exam results by subject',
      subtitle: loaded.subtitle,
      columns: [
        { key: 'subject', label: 'Subject', weight: 2.5 },
        { key: 'maxMarks', label: 'Out of', align: 'right' },
        { key: 'passingMarks', label: 'Pass mark', align: 'right' },
        { key: 'appeared', label: 'Sat', align: 'right' },
        { key: 'absent', label: 'Absent', align: 'right' },
        {
          key: 'awaiting',
          label: 'Awaiting marks',
          align: 'right',
          weight: 1.4,
        },
        { key: 'passed', label: 'Passed', align: 'right' },
        { key: 'failed', label: 'Failed', align: 'right' },
        { key: 'passPercent', label: 'Pass %', align: 'right' },
        { key: 'averagePercent', label: 'Average %', align: 'right' },
        { key: 'highest', label: 'Highest', align: 'right' },
        { key: 'lowest', label: 'Lowest', align: 'right' },
      ],
      rows,
      totals: null,
      notes: [
        ...this.draftNote(loaded.exam),
        'Pass % and the averages are over students whose paper has marks. A student who was absent is counted as absent, not as zero.',
      ],
      institutionId: loaded.institutionId,
      campusId: loaded.campusId,
    };
  }

  /**
   * How many students earned each grade overall.
   *
   * @param {CurrentUser} currentUser - The administrator.
   * @param {ExamReportQueryDto} query - The exam.
   * @returns {Promise<ReportTable>} One row per grade, with those without a grade last.
   */
  async gradeDistribution(
    currentUser: CurrentUser,
    query: ExamReportQueryDto,
  ): Promise<ReportTable> {
    const loaded = await this.load(currentUser, query);
    const total = loaded.students.length;
    // A grade is only shown once every paper the student sat has marks.
    const complete = loaded.students.filter(
      (student) =>
        student.outcome.status === 'PASS' || student.outcome.status === 'FAIL',
    );
    const countFor = (grade: string) =>
      complete.filter((student) => student.outcome.grade === grade).length;

    const bands = [...loaded.exam.bands].sort(
      (a, b) => b.maxPercentage - a.maxPercentage,
    );
    const graded = bands.map((band): ReportRow => {
      const students = countFor(band.grade);
      return {
        grade: band.grade,
        range: `${band.minPercentage} to ${band.maxPercentage}%`,
        students,
        share: percent(students, total),
      };
    });
    const gradedCount = graded.reduce(
      (sum, row) => sum + (row.students as number),
      0,
    );
    const notGraded = total - gradedCount;

    const tally = (status: string) =>
      loaded.students.filter((student) => student.outcome.status === status)
        .length;

    return {
      key: 'exam-grade-distribution',
      title: 'Grade distribution',
      subtitle: loaded.subtitle,
      columns: [
        { key: 'grade', label: 'Grade', weight: 1.5 },
        { key: 'range', label: 'Percentage range', weight: 2 },
        { key: 'students', label: 'Students', align: 'right' },
        {
          key: 'share',
          label: 'Share of class %',
          align: 'right',
          weight: 1.4,
        },
      ],
      rows: [
        ...graded,
        {
          grade: NOT_GRADED,
          range: 'Absent, or marks still to enter',
          students: notGraded,
          share: percent(notGraded, total),
        },
      ],
      totals: { grade: 'Total', students: total, share: total > 0 ? 100 : 0 },
      notes: [
        ...this.draftNote(loaded.exam),
        `Overall result: ${tally('PASS')} passed, ${tally('FAIL')} failed, ${tally('INCOMPLETE')} with marks still to enter, ${tally('ABSENT')} absent for every paper.`,
        'A grade is shown only once every paper a student sat has marks, using their overall percentage.',
      ],
      institutionId: loaded.institutionId,
      campusId: loaded.campusId,
    };
  }

  /**
   * Students who did not pass the exam overall, with the papers they failed.
   *
   * @param {CurrentUser} currentUser - The administrator.
   * @param {ExamReportQueryDto} query - The exam.
   * @returns {Promise<ReportTable>} One row per failing student, lowest percentage first.
   */
  async failedStudents(
    currentUser: CurrentUser,
    query: ExamReportQueryDto,
  ): Promise<ReportTable> {
    const loaded = await this.load(currentUser, query);
    const failing = loaded.students
      .filter((student) => student.outcome.status === 'FAIL')
      .sort(
        (a, b) =>
          (a.outcome.percentage ?? 0) - (b.outcome.percentage ?? 0) ||
          a.name.localeCompare(b.name),
      );

    const rows = failing.map((student): ReportRow => {
      const failedPapers = student.outcome.subjects.filter(
        (subject) => subject.state === 'MARKED' && subject.passed === false,
      );
      return {
        name: student.name,
        regNo: student.regNo,
        sectionName: student.sectionName ?? '',
        percentage: student.outcome.percentage,
        failedPapers: failedPapers.length,
        subjects:
          failedPapers.length > 0
            ? failedPapers.map((subject) => subject.subjectName).join(', ')
            : 'Overall percentage is below the pass mark',
      };
    });

    return {
      key: 'exam-failed-students',
      title: 'Students who did not pass',
      subtitle: loaded.subtitle,
      columns: [
        { key: 'name', label: 'Student', weight: 3 },
        { key: 'regNo', label: 'Reg no', weight: 1.4 },
        { key: 'sectionName', label: 'Section', weight: 1.2 },
        { key: 'percentage', label: 'Overall %', align: 'right' },
        { key: 'failedPapers', label: 'Papers failed', align: 'right' },
        { key: 'subjects', label: 'Failed in', weight: 4 },
      ],
      rows,
      totals: {
        name: `Total, ${rows.length} student${rows.length === 1 ? '' : 's'}`,
      },
      notes: [
        ...this.draftNote(loaded.exam),
        'Pass or fail follows the pass policy set for the school. Students whose marks are still to be entered are not listed.',
      ],
      institutionId: loaded.institutionId,
      campusId: loaded.campusId,
    };
  }

  /**
   * Loads one exam and every student's outcome, only if it belongs to a campus
   * the administrator may report on. An exam elsewhere is reported as not found
   * so its existence is not revealed.
   */
  private async load(
    currentUser: CurrentUser,
    query: ExamReportQueryDto,
  ): Promise<LoadedExam> {
    const scope = await this.access.resolve(currentUser, {
      institutionId: query.institutionId,
    });
    const exam = await this.results.loadExam(query.examId);
    const campus = scope.campuses.find((item) => item.id === exam.campusId);
    if (exam.institutionId !== scope.institutionId || !campus) {
      throw new NotFoundException('Exam not found.');
    }
    const label = await this.prisma.exam.findUnique({
      where: { id: exam.id },
      select: {
        name: true,
        class: { select: { name: true } },
        examTerm: { select: { name: true } },
      },
    });
    const students = await this.results.computeStudentOutcomes(exam);
    return {
      institutionId: scope.institutionId,
      exam,
      students,
      campusId: campus.id,
      subtitle: [
        label?.name ?? exam.name,
        label?.examTerm.name,
        label?.class.name,
        campus.name,
      ]
        .filter(Boolean)
        .join(', '),
    };
  }

  private draftNote(exam: ExamContext): string[] {
    return exam.status === ExamStatus.DRAFT
      ? [
          'This exam is not published yet. Students and guardians cannot see these results.',
        ]
      : [];
  }
}
