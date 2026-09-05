export const CustomFieldEntity = {
  CAMPUS: 'campus',
  LEVEL: 'level',
  CLASS: 'class',
  SECTION: 'section',
  SUBJECT: 'subject',
  STUDENT: 'student',
  GUARDIAN: 'guardian',
  STAFF_PROFILE: 'staff_profile',
  STUDENT_GUARDIAN: 'student_guardian',
  STUDENT_HISTORY: 'student_history',
  TEACHER_SUBJECT: 'teacher_subject',
  CONTACT: 'contact',
  STAFF_SALARY: 'staff_salary',
  SALARY_DEDUCTION_RULE: 'salary_deduction_rule',
  SALARY_ADJUSTMENT: 'salary_adjustment',
  SALARY_PAYMENT: 'salary_payment',
  BANK_ACCOUNT: 'bank_account',
  FEE_STRUCTURE: 'fee_structure',
  STUDENT_DISCOUNT: 'student_discount',
  STUDENT_FINE_RULE: 'student_fine_rule',
  STUDENT_FINE: 'student_fine',
  FEE_VOUCHER: 'fee_voucher',
  FEE_PAYMENT: 'fee_payment',
} as const;

export type CustomFieldEntityType =
  (typeof CustomFieldEntity)[keyof typeof CustomFieldEntity];
