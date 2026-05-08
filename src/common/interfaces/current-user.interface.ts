import type { UserRole } from '../../prisma/client';

export interface CurrentUser {
  sub: string;
  email: string;
  role: UserRole;
  institutionId?: string | null;
  sessionId?: string;
}
