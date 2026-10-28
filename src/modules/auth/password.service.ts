import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { signInCandidates } from '../../common/utils/phone.util';
import { UserStatus } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** How long a reset link works. */
export const RESET_LINK_MINUTES = 30;
/** A person who asks again inside this time gets no second email, so the form cannot be used to flood a mailbox. */
const RESEND_AFTER_MS = 60_000;

const GENERIC_REQUEST_MESSAGE =
  'If an account matches, a link to choose a new password has been sent to its email address.';

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/**
 * Forgotten, forced and voluntary password changes. A reset link is a random
 * token of which only a hash is stored; it works once, for a short time, and
 * using it signs the person out everywhere.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Starts a reset. The answer is the same whether or not the account exists
   * or has an email address, so the form cannot be used to find out who has
   * an account.
   *
   * @param {string} identifier - The email address, registration number or phone number the person signs in with.
   * @param {string} [ipAddress] - Where the request came from, kept with the token.
   * @returns {Promise<{message: string, data: null}>} Always the same message.
   */
  async requestReset(identifier: string, ipAddress?: string) {
    const generic = { message: GENERIC_REQUEST_MESSAGE, data: null };
    const user = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        status: UserStatus.ACTIVE,
        OR: [
          { email: identifier.trim().toLowerCase() },
          { identifier: { in: signInCandidates(identifier) } },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        institution: { select: { name: true } },
      },
    });
    if (!user) return generic;

    const recent = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        createdAt: { gt: new Date(Date.now() - RESEND_AFTER_MS) },
      },
      select: { id: true },
    });
    if (recent) return generic;

    const token = randomBytes(32).toString('hex');
    await this.prisma.$transaction([
      // Only the newest link works.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + RESET_LINK_MINUTES * 60_000),
          requestedIp: ipAddress,
        },
      }),
    ]);
    await this.audit(user.id, 'PASSWORD_RESET_REQUESTED');

    const appUrl = this.configService
      .getOrThrow<string>('APP_URL')
      .replace(/\/$/, '');
    const result = await this.notifications.sendEmail(
      'PASSWORD_RESET',
      user.email,
      {
        name: user.name,
        resetUrl: `${appUrl}/reset-password?token=${token}`,
        expiresInMinutes: RESET_LINK_MINUTES,
        institutionName: user.institution?.name ?? null,
      },
    );
    if (!result.delivered) {
      // Not shown to the caller (that would reveal the account), but an operator needs to know.
      this.logger.warn(
        `Password reset email for user ${user.id} was not delivered: ${result.error}`,
      );
    }
    return generic;
  }

  /**
   * Chooses a new password with a reset link.
   *
   * @param {string} token - The token from the link.
   * @param {string} password - The new password.
   * @returns {Promise<{message: string, data: null}>} Done; the person signs in again.
   * @throws {BadRequestException} If the link is wrong, used or expired.
   */
  async reset(token: string, password: string) {
    const invalid = new BadRequestException(
      'This reset link is invalid or has expired. Ask for a new one.',
    );
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        user: { select: { id: true, status: true, deletedAt: true } },
      },
    });
    if (
      !record ||
      record.usedAt ||
      record.expiresAt.getTime() < Date.now() ||
      record.user.deletedAt ||
      record.user.status !== UserStatus.ACTIVE
    ) {
      throw invalid;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const claimed = await this.prisma.$transaction(async (transaction) => {
      // Claiming the token and changing the password happen together, and a
      // second use of the same link finds it already claimed.
      const used = await transaction.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count !== 1) return false;
      await transaction.user.update({
        where: { id: record.userId },
        data: { passwordHash, mustChangePassword: false },
      });
      await transaction.refreshSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return true;
    });
    if (!claimed) throw invalid;
    await this.audit(record.userId, 'PASSWORD_RESET_COMPLETED');
    return {
      message: 'Your password has been changed. Sign in with the new password.',
      data: null,
    };
  }

  /**
   * Changes the password of the person who is signed in.
   *
   * @param {CurrentUser} currentUser - The signed-in person.
   * @param {string} currentPassword - Their present password.
   * @param {string} newPassword - The new one.
   * @returns {Promise<{message: string, data: null}>} Done; their other sessions are signed out.
   * @throws {UnauthorizedException} If the present password is wrong.
   * @throws {BadRequestException} If the new password is the same as the present one.
   */
  async change(
    currentUser: CurrentUser,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: currentUser.sub },
      select: { id: true, passwordHash: true },
    });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Your current password is not correct.');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException(
        'Choose a password different from the current one.',
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false },
      }),
      // Anywhere else this account is signed in is signed out; this session stays.
      this.prisma.refreshSession.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
          ...(currentUser.sessionId
            ? { id: { not: currentUser.sessionId } }
            : {}),
        },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit(user.id, 'PASSWORD_CHANGED');
    return {
      message: 'Your password has been changed.',
      data: null,
    };
  }

  private audit(userId: string, action: string) {
    return this.prisma.auditLog.create({
      data: { userId, action, entity: 'User', entityId: userId },
    });
  }
}
