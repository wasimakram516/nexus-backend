import {
  AdjustmentType,
  PaymentMethod,
  UserRole,
  VoucherStatus,
} from '../../prisma/client';
import { DemoContext, StudentRecord } from './demo-context';
import {
  DEMO_GRADE_BANDS,
  DEMO_PAPERS,
  demoMarks,
  recentWeekdays,
  seededRandom,
  staffDayStatus,
  studentDayStatus,
} from './demo-data';

/** School days of attendance to create. */
const ATTENDANCE_DAYS = 20;

const dayDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** The month `back` months before the one `today` falls in. */
function monthBack(today: Date, back: number): { year: number; month: number } {
  const first = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1),
  );
  return { year: first.getUTCFullYear(), month: first.getUTCMonth() + 1 };
}

/**
 * Adds a school's activity on top of its people: attendance for recent school
 * days, fee vouchers and payments for three months, a published exam per class
 * with marks, and payroll for the two months before this one.
 *
 * @param {DemoContext} context - The school and the people already created.
 */
export async function seedActivity(context: DemoContext): Promise<void> {
  await seedAttendance(context);
  await seedFees(context);
  await seedExams(context);
  await seedPayroll(context);
}

async function seedAttendance(context: DemoContext) {
  const days = recentWeekdays(context.today, ATTENDANCE_DAYS);
  const rows = [
    ...context.students.flatMap((student) =>
      days.map((day, dayIndex) => ({
        userId: student.userId,
        campusId: student.campusId,
        role: UserRole.STUDENT,
        date: dayDate(day),
        status: studentDayStatus(student.index, dayIndex),
        halfDay: false,
      })),
    ),
    ...context.staff.flatMap((member) =>
      days.map((day, dayIndex) => ({
        userId: member.userId,
        campusId: member.campusId,
        role: UserRole.STAFF,
        date: dayDate(day),
        status: staffDayStatus(member.index, dayIndex),
        halfDay: false,
      })),
    ),
  ];
  for (let from = 0; from < rows.length; from += 500) {
    await context.prisma.attendance.createMany({
      data: rows.slice(from, from + 500),
    });
  }
}

/** How a voucher was settled: nothing, part of it, or all of it. */
type Settlement = 'NONE' | 'PART' | 'FULL';

function settlementFor(student: StudentRecord, back: number): Settlement {
  const roll = seededRandom(student.index * 131 + back * 17 + 5)();
  if (back === 2) return roll < 0.85 ? 'FULL' : 'PART';
  if (back === 1) return roll < 0.7 ? 'FULL' : roll < 0.85 ? 'PART' : 'NONE';
  return roll < 0.4 ? 'FULL' : 'NONE';
}

async function seedFees(context: DemoContext) {
  const todayDay = context.today.getUTCDate();
  for (const student of context.students) {
    for (const back of [2, 1, 0]) {
      const { year, month } = monthBack(context.today, back);
      const settlement = settlementFor(student, back);
      const discount = student.isSecondSibling
        ? Math.round(student.tuition * 0.1)
        : 0;
      // One student has an attendance fine last month, to show it on the fee reports.
      const fine = student.index === 7 && back === 1 ? 200 : 0;
      const dueDate = new Date(Date.UTC(year, month - 1, 10));
      const pastDue = dueDate.getTime() < context.today.getTime();
      const late = settlement !== 'FULL' && pastDue ? 100 : 0;
      const total = student.tuition - discount + fine + late;
      const paid =
        settlement === 'FULL'
          ? total
          : settlement === 'PART'
            ? Math.round(total / 2)
            : 0;
      const status =
        settlement === 'FULL'
          ? VoucherStatus.PAID
          : settlement === 'PART'
            ? VoucherStatus.PARTIAL
            : pastDue
              ? VoucherStatus.OVERDUE
              : VoucherStatus.PENDING;

      const voucher = await context.prisma.feeVoucher.create({
        data: {
          studentId: student.studentId,
          feeStructureId: student.feeStructureId,
          month,
          year,
          feeBreakdown: { tuition: student.tuition },
          discountAmount: discount,
          fineAmount: fine,
          lateFeeFine: late,
          finalAmountDue: total,
          dueDate,
          status,
        },
      });
      if (paid === 0) continue;

      const roll = seededRandom(student.index * 977 + back * 41)();
      // Paid in the first part of the month, and never in the future.
      const payDay =
        back === 0
          ? Math.max(1, Math.min(todayDay, 2 + Math.floor(roll * 7)))
          : 2 + Math.floor(roll * 8);
      await context.prisma.feePayment.create({
        data: {
          voucherId: voucher.id,
          month,
          year,
          paidAmount: paid,
          paymentMethod:
            (student.index + back) % 3 === 0
              ? PaymentMethod.BANK_TRANSFER
              : PaymentMethod.CASH,
          // Midday in Pakistan.
          paymentDate: new Date(Date.UTC(year, month - 1, payDay, 7, 0)),
          receivedBy: context.adminId,
        },
      });
    }
  }
}

async function seedExams(context: DemoContext) {
  const scale = await context.prisma.gradingScale.create({
    data: {
      institutionId: context.institutionId,
      name: 'Standard scale',
      bands: {
        create: DEMO_GRADE_BANDS.map((band, sortOrder) => ({
          grade: band.grade,
          minPercentage: band.min,
          maxPercentage: band.max,
          remarks: band.remarks,
          sortOrder,
        })),
      },
    },
  });
  await context.prisma.institution.update({
    where: { id: context.institutionId },
    data: { currentGradingScaleId: scale.id },
  });
  const term = await context.prisma.examTerm.create({
    data: {
      institutionId: context.institutionId,
      academicYearId: context.academicYearId,
      name: 'Term 1',
    },
  });

  const sitting = new Date(context.today);
  sitting.setUTCDate(sitting.getUTCDate() - 14);
  for (const item of context.classes) {
    const exam = await context.prisma.exam.create({
      data: {
        examTermId: term.id,
        academicYearId: context.academicYearId,
        campusId: item.campusId,
        classId: item.classId,
        name: 'Mid-Term Exam',
        gradingScaleId: scale.id,
        status: 'PUBLISHED',
        publishedAt: context.today,
        publishedBy: context.adminId,
      },
    });
    const students = context.students.filter(
      (student) => student.classId === item.classId,
    );
    for (const [paperIndex, paper] of DEMO_PAPERS.entries()) {
      const subjectId = item.subjectIds.get(paper.subject);
      if (!subjectId) continue;
      const examDate = new Date(sitting);
      examDate.setUTCDate(examDate.getUTCDate() + paperIndex);
      const examPaper = await context.prisma.examSubject.create({
        data: {
          examId: exam.id,
          subjectId,
          maxMarks: paper.maxMarks,
          passingMarks: paper.passingMarks,
          examDate,
        },
      });
      await context.prisma.examResult.createMany({
        data: students.map((student) => {
          const marks = demoMarks(student.index, paperIndex, paper);
          return {
            examSubjectId: examPaper.id,
            studentId: student.studentId,
            sectionId: student.sectionId,
            marksObtained: marks,
            isAbsent: marks === null,
          };
        }),
      });
    }
  }
}

async function seedPayroll(context: DemoContext) {
  for (const campusId of new Set(
    context.staff.map((member) => member.campusId),
  )) {
    await context.prisma.salaryDeductionRule.create({
      data: { campusId, role: UserRole.STAFF },
    });
  }
  for (const member of context.staff) {
    const salary = await context.prisma.staffSalary.create({
      data: {
        userId: member.userId,
        campusId: member.campusId,
        role: UserRole.STAFF,
        joiningDate: dayDate('2025-04-01'),
        baseSalary: member.baseSalary,
        effectiveDate: dayDate('2025-04-01'),
      },
    });

    // The month before last is plain; last month has a bonus, and one person a deduction.
    for (const back of [2, 1]) {
      const { year, month } = monthBack(context.today, back);
      const bonus = back === 1 && member.index % 2 === 0 ? 2000 : 0;
      const manual = back === 1 && member.index === 1 ? 1500 : 0;
      for (const [type, amount] of [
        [AdjustmentType.BONUS, bonus],
        [AdjustmentType.DEDUCTION, manual],
      ] as const) {
        if (amount === 0) continue;
        await context.prisma.salaryAdjustment.create({
          data: {
            userId: member.userId,
            salaryId: salary.id,
            campusId: member.campusId,
            adjustmentType: type,
            amount,
            month,
            year,
            remarks:
              type === AdjustmentType.BONUS
                ? 'Term performance'
                : 'Advance recovered',
            adjustedBy: context.adminId,
          },
        });
      }
      const net = member.baseSalary + bonus - manual;
      const payment = await context.prisma.salaryPayment.create({
        data: {
          userId: member.userId,
          salaryId: salary.id,
          campusId: member.campusId,
          month,
          year,
          baseSalaryAtPayment: member.baseSalary,
          totalDeductions: manual,
          totalBonuses: bonus,
          finalSalaryPaid: net,
          paymentDate: new Date(Date.UTC(year, month, 0, 10, 0)),
          paidBy: context.adminId,
        },
      });
      await context.prisma.salaryDeductionSummary.create({
        data: {
          salaryPaymentId: payment.id,
          userId: member.userId,
          campusId: member.campusId,
          month,
          year,
          manualDeductions: manual,
          bonuses: bonus,
          totalDeductions: manual,
          finalSalaryPaid: net,
        },
      });
    }
  }
}
