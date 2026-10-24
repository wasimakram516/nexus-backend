import {
  AUTOMATIC_FINE_REASON_PREFIX,
  calculateAttendanceFine,
  describeAttendanceFine,
  FineRuleAmounts,
} from './attendance-fine.util';

const rule: FineRuleAmounts = {
  allowedAbsences: 2,
  absenceFineAmount: 100,
  allowedLates: 3,
  lateFineAmount: 20,
  allowedHalfDays: 2,
  halfDayFineAmount: 50,
  allowedLeaves: 1,
  leaveFineAmount: 10,
};

describe('calculateAttendanceFine', () => {
  it('is zero while every count is within its allowance', () => {
    const fine = calculateAttendanceFine(
      { absent: 2, late: 3, halfDay: 2, leave: 1 },
      rule,
    );

    expect(fine.toFixed(2)).toBe('0.00');
  });

  it('charges only the marks beyond each allowance', () => {
    const fine = calculateAttendanceFine(
      { absent: 4, late: 5, halfDay: 3, leave: 3 },
      rule,
    );

    // 2*100 + 2*20 + 1*50 + 2*10
    expect(fine.toFixed(2)).toBe('310.00');
  });

  it('handles fractional amounts exactly', () => {
    const fine = calculateAttendanceFine(
      { absent: 3, late: 0, halfDay: 0, leave: 0 },
      { ...rule, absenceFineAmount: '33.33' },
    );

    expect(fine.toFixed(2)).toBe('33.33');
  });
});

describe('describeAttendanceFine', () => {
  it('starts with the automatic marker and lists the counts', () => {
    const text = describeAttendanceFine({
      absent: 4,
      late: 1,
      halfDay: 0,
      leave: 2,
    });

    expect(text.startsWith(AUTOMATIC_FINE_REASON_PREFIX)).toBe(true);
    expect(text).toContain('4 absent');
    expect(text).toContain('2 leave');
  });
});
