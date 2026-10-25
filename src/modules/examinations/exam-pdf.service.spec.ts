import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PdfService } from '../../common/pdf/pdf.service';
import { UserRole } from '../../prisma/client';
import { formatPercent, formatPosition, ordinal } from './exam-documents.pdf';
import { ExamPdfService } from './exam-pdf.service';
import { ExamPrintablesService } from './exam-printables.service';
import { ExamReportCardsService } from './exam-report-cards.service';

const pageCount = (buffer: Buffer) =>
  (buffer.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;

describe('exam document PDF helpers', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [101, '101st'],
    [111, '111th'],
  ])('writes %i as %s', (value, text) => {
    expect(ordinal(value)).toBe(text);
  });

  it('writes percentages to at most two decimals, or a dash', () => {
    expect(formatPercent(78)).toBe('78%');
    expect(formatPercent(78.456)).toBe('78.46%');
    expect(formatPercent(null)).toBe('-');
    expect(formatPercent(undefined)).toBe('-');
  });

  it('writes a position with the class size, or a dash when there is none', () => {
    expect(formatPosition(2, 30)).toBe('2nd of 30');
    expect(formatPosition(null, 30)).toBe('-');
    expect(formatPosition(1, 0)).toBe('-');
  });
});

describe('ExamPdfService', () => {
  const staff: CurrentUser = {
    sub: 'staff-1',
    email: 's@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };

  const meta = {
    documentType: 'X',
    generatedAt: '2026-10-25T00:00:00.000Z',
    institution: {
      id: 'i',
      name: 'Greenfield School',
      logoUrl: 'https://x/logo.png',
      branding: { primaryColorLight: null },
    },
    campus: { id: 'c', name: 'Main Campus' },
  };
  const exam = {
    id: 'e1',
    name: 'First Term / Exam',
    examType: 'REGULAR',
    className: 'Grade 5',
    termName: 'Term 1',
    academicYearName: '2026-27',
    customValues: [{ label: 'Venue', value: 'Main Hall' }],
  };
  const papers = [
    {
      examSubjectId: 'p1',
      subjectName: 'Maths',
      maxMarks: 100,
      passingMarks: 40,
      examDate: new Date('2026-12-01'),
      startTime: '09:00',
      endTime: '11:00',
      room: 'R-1',
    },
  ];
  const student = (name: string) => ({
    id: name,
    name,
    regNo: `R-${name}`,
    picture: null,
    className: 'Grade 5',
    sectionName: 'A',
  });
  const outcome = {
    subjects: [
      {
        examSubjectId: 'p1',
        subjectName: 'Maths',
        maxMarks: 100,
        marksObtained: 80,
        state: 'MARKED',
        percentage: 80,
        grade: 'A',
        isRetake: false,
      },
    ],
    totalMarks: 80,
    totalMaxMarks: 100,
    percentage: 80,
    grade: 'A',
    status: 'PASS',
  };
  const card = (name: string) => ({
    student: student(name),
    academicYear: { name: '2026-27' },
    passPolicy: 'PER_SUBJECT',
    terms: [
      {
        term: { id: 't1', name: 'Term 1', weight: 1 },
        exam: { id: 'e1', name: 'First Term', customValues: [] },
        outcome,
        positionInClass: 1,
        classSize: 10,
        positionInSection: 1,
        sectionSize: 5,
      },
    ],
    annual: null,
  });

  const printablesMock = {
    getDatesheet: jest.fn(),
    getAdmitCard: jest.fn(),
    getAdmitCards: jest.fn(),
  };
  const reportCardsMock = {
    getReportCard: jest.fn(),
    getReportCards: jest.fn(),
  };
  const pdf = new PdfService();
  const fetchImage = jest.spyOn(pdf, 'fetchImage');
  const service = new ExamPdfService(
    printablesMock as unknown as ExamPrintablesService,
    reportCardsMock as unknown as ExamReportCardsService,
    pdf,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    fetchImage.mockResolvedValue(null);
  });

  it('draws the datesheet as one PDF page named after the exam', async () => {
    printablesMock.getDatesheet.mockResolvedValue({
      data: { exam, papers, printMeta: meta },
    });

    const file = await service.datesheet(staff, 'e1');

    expect(printablesMock.getDatesheet).toHaveBeenCalledWith(staff, 'e1');
    expect(file.filename).toBe('datesheet-first-term-exam.pdf');
    expect(file.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(file.buffer)).toBe(1);
  });

  it('draws one admit card on one page, and a class of them as one page each', async () => {
    printablesMock.getAdmitCard.mockResolvedValue({
      data: { student: student('Ayesha'), exam, papers, printMeta: meta },
    });
    const one = await service.admitCard(staff, 'e1', 'Ayesha');
    expect(one.filename).toBe('admit-card-ayesha.pdf');
    expect(pageCount(one.buffer)).toBe(1);

    printablesMock.getAdmitCards.mockResolvedValue({
      data: {
        cards: ['Ayesha', 'Bilal', 'Omar'].map((name) => ({
          student: student(name),
          exam,
          papers,
        })),
        printMeta: meta,
      },
    });
    const many = await service.admitCards(staff, 'e1', 'sec-1');
    expect(printablesMock.getAdmitCards).toHaveBeenCalledWith(
      staff,
      'e1',
      'sec-1',
    );
    expect(many.filename).toBe('admit-cards.pdf');
    expect(pageCount(many.buffer)).toBe(3);
  });

  it('draws a report card, and a class of them as one page per student', async () => {
    reportCardsMock.getReportCard.mockResolvedValue({
      data: { ...card('Ayesha'), printMeta: meta },
    });
    const one = await service.reportCard(staff, 'Ayesha', 'year-1');
    expect(reportCardsMock.getReportCard).toHaveBeenCalledWith(
      staff,
      'Ayesha',
      'year-1',
    );
    expect(one.filename).toBe('report-card-ayesha.pdf');
    expect(pageCount(one.buffer)).toBe(1);

    reportCardsMock.getReportCards.mockResolvedValue({
      data: { cards: [card('Ayesha'), card('Bilal')], printMeta: meta },
    });
    const many = await service.classReportCards(staff, 'year-1', 'class-1');
    expect(reportCardsMock.getReportCards).toHaveBeenCalledWith(
      staff,
      'year-1',
      'class-1',
      undefined,
    );
    expect(pageCount(many.buffer)).toBe(2);
  });

  it('draws a card with nothing published, and an empty class, without failing', async () => {
    reportCardsMock.getReportCard.mockResolvedValue({
      data: { ...card('Ayesha'), terms: [], printMeta: meta },
    });
    expect(
      pageCount((await service.reportCard(staff, 'Ayesha', 'year-1')).buffer),
    ).toBe(1);

    printablesMock.getAdmitCards.mockResolvedValue({
      data: { cards: [], printMeta: meta },
    });
    reportCardsMock.getReportCards.mockResolvedValue({
      data: { cards: [], printMeta: meta },
    });
    expect(pageCount((await service.admitCards(staff, 'e1')).buffer)).toBe(1);
    expect(
      pageCount((await service.classReportCards(staff, 'y', 'c')).buffer),
    ).toBe(1);
  });

  it('flows a long report card onto a second page instead of running off the first', async () => {
    const many = {
      ...card('Ayesha'),
      terms: Array.from({ length: 8 }, (_, index) => ({
        ...card('Ayesha').terms[0],
        term: { id: `t${index}`, name: `Term ${index}`, weight: 1 },
        exam: { id: `e${index}`, name: `Exam ${index}`, customValues: [] },
      })),
    };
    reportCardsMock.getReportCard.mockResolvedValue({
      data: { ...many, printMeta: meta },
    });

    const file = await service.reportCard(staff, 'Ayesha', 'year-1');

    expect(pageCount(file.buffer)).toBeGreaterThan(1);
  });

  it('does not draw anything for a document the caller may not see', async () => {
    printablesMock.getDatesheet.mockRejectedValue(new Error('forbidden'));

    await expect(service.datesheet(staff, 'e1')).rejects.toThrow('forbidden');
  });

  it('fetches the logo for each document', async () => {
    printablesMock.getDatesheet.mockResolvedValue({
      data: { exam, papers, printMeta: meta },
    });

    await service.datesheet(staff, 'e1');

    expect(fetchImage).toHaveBeenCalledWith('https://x/logo.png');
  });
});
