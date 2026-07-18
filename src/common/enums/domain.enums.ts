export enum UserRole {
  SUPERADMIN = 'SUPERADMIN',
  ADMIN = 'ADMIN',
  STAFF = 'STAFF',
  STUDENT = 'STUDENT',
  GUARDIAN = 'GUARDIAN',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  RESIGNED = 'RESIGNED',
  SUSPENDED = 'SUSPENDED',
}

export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
}

export enum Religion {
  ISLAM = 'ISLAM',
  CHRISTIANITY = 'CHRISTIANITY',
  HINDUISM = 'HINDUISM',
  OTHER = 'OTHER',
}

export enum GuardianRelation {
  FATHER = 'FATHER',
  MOTHER = 'MOTHER',
  UNCLE = 'UNCLE',
  AUNT = 'AUNT',
  OTHER = 'OTHER',
}

export enum ContactPersonType {
  STUDENT = 'STUDENT',
  GUARDIAN = 'GUARDIAN',
  TEACHER = 'TEACHER',
}

export enum AttendanceStatus {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  LATE = 'LATE',
  LEAVE = 'LEAVE',
}

export enum SalaryStatus {
  ACTIVE = 'ACTIVE',
  UPDATED = 'UPDATED',
  TERMINATED = 'TERMINATED',
}

export enum DeductionType {
  ABSENT = 'ABSENT',
  LATE = 'LATE',
  HALF_DAY = 'HALF_DAY',
  LEAVE = 'LEAVE',
}

export enum AdjustmentType {
  BONUS = 'BONUS',
  DEDUCTION = 'DEDUCTION',
}

export enum DiscountType {
  SIBLING = 'SIBLING',
  MERIT = 'MERIT',
  NEED_BASED = 'NEED_BASED',
  STAFF_CHILD = 'STAFF_CHILD',
}

export enum FineStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
}

export enum PaymentMethod {
  CASH = 'CASH',
  BANK_TRANSFER = 'BANK_TRANSFER',
}

export enum InstitutionStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export enum DeploymentMode {
  SHARED_HOSTED = 'SHARED_HOSTED',
  DEDICATED_HOSTED = 'DEDICATED_HOSTED',
  SELF_HOSTED = 'SELF_HOSTED',
}

export enum SubscriptionStatus {
  TRIAL = 'TRIAL',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  SUSPENDED = 'SUSPENDED',
  CANCELLED = 'CANCELLED',
}

export enum BillingCycle {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
  CUSTOM = 'CUSTOM',
}

export enum ModuleKey {
  ACADEMICS = 'ACADEMICS',
  ATTENDANCE = 'ATTENDANCE',
  FINANCE = 'FINANCE',
  PEOPLE = 'PEOPLE',
  REPORTING = 'REPORTING',
  EXAMINATIONS = 'EXAMINATIONS',
  DOCUMENTS = 'DOCUMENTS',
  REALTIME = 'REALTIME',
}
