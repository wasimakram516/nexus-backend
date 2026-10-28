import { UnauthorizedException } from '@nestjs/common';
import { InstitutionStatus } from '../../prisma/client';
import { assertInstitutionActive } from './institution-access';

describe('assertInstitutionActive', () => {
  it('lets an active institution through', () => {
    expect(() =>
      assertInstitutionActive({ status: InstitutionStatus.ACTIVE }),
    ).not.toThrow();
  });

  it('never blocks platform accounts, which have no institution', () => {
    expect(() => assertInstitutionActive(null)).not.toThrow();
    expect(() => assertInstitutionActive(undefined)).not.toThrow();
  });

  it.each([InstitutionStatus.SUSPENDED, InstitutionStatus.INACTIVE])(
    'blocks a %s institution',
    (status) => {
      expect(() => assertInstitutionActive({ status })).toThrow(
        UnauthorizedException,
      );
    },
  );
});
