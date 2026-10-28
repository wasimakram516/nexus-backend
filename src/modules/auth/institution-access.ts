import { UnauthorizedException } from '@nestjs/common';
import { InstitutionStatus } from '../../prisma/client';

/**
 * Blocks everyone who belongs to an institution that a platform administrator
 * has put on hold (INACTIVE or SUSPENDED). Platform accounts have no
 * institution and are never blocked by this.
 *
 * @param {{ status: InstitutionStatus } | null | undefined} institution - The user's institution, when they have one.
 * @throws {UnauthorizedException} When the institution is not active.
 */
export function assertInstitutionActive(
  institution: { status: InstitutionStatus } | null | undefined,
): void {
  if (institution && institution.status !== InstitutionStatus.ACTIVE) {
    throw new UnauthorizedException(
      'Your institution account is on hold. Please contact Nexus support.',
    );
  }
}
