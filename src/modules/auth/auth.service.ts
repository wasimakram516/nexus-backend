import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User, UserStatus } from '../../prisma/client';
import * as bcrypt from 'bcrypt';
import { timingSafeEqual } from 'crypto';
import { Response } from 'express';
import { REFRESH_TOKEN_COOKIE } from '../../common/constants/auth.constants';
import { UserRole } from '../../common/enums/domain.enums';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto, actor?: CurrentUser) {
    if (
      actor?.role === UserRole.ADMIN &&
      [UserRole.SUPERADMIN, UserRole.ADMIN].includes(dto.role)
    ) {
      throw new UnauthorizedException(
        'Admins cannot create admin-level users.',
      );
    }

    const existingUser = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase() },
    });
    if (existingUser) {
      throw new ConflictException('A user with this email already exists.');
    }

    const institutionId =
      actor?.role === UserRole.SUPERADMIN
        ? (dto.institutionId ?? null)
        : (actor?.institutionId ?? null);

    if (actor?.role === UserRole.ADMIN && dto.institutionId) {
      throw new UnauthorizedException(
        'Admins cannot override the institution for new users.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email.toLowerCase(),
        passwordHash,
        role: dto.role,
        institutionId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        institutionId: true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actor?.sub,
        action: 'USER_REGISTERED',
        entity: 'User',
        entityId: user.id,
        metadata: {
          role: dto.role,
          email: user.email,
          institutionId,
        },
      },
    });

    return {
      message: 'User registered successfully',
      data: user,
    };
  }

  async login(
    dto: LoginDto,
    response: Response,
    metadata: { userAgent?: string; ipAddress?: string },
  ) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Your account is not active.');
    }

    const masterLoginKey = this.configService.get<string>('MASTER_LOGIN_KEY');
    const masterKeyUsed = this.matchesMasterLoginKey(
      dto.password,
      masterLoginKey,
    );
    const passwordMatches =
      masterKeyUsed || (await bcrypt.compare(dto.password, user.passwordHash));
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const data = await this.createSessionForUser(user, response, metadata, {
      auditAction: 'AUTH_LOGIN',
      auditMetadata: { masterKeyUsed },
    });

    return {
      message: 'Login successful',
      data,
    };
  }

  /**
   * Issues a refresh session + access token, sets the refresh cookie, and
   * audit-logs the event. Shared by credential login and trial signup
   * auto-login so both produce identical session state.
   */
  async createSessionForUser(
    user: User,
    response: Response,
    metadata: { userAgent?: string; ipAddress?: string },
    options?: { auditAction?: string; auditMetadata?: Record<string, unknown> },
  ) {
    const refreshToken = await this.jwtService.signAsync(
      { sub: user.id, tokenType: 'refresh' },
      {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: `${this.configService.getOrThrow<number>('JWT_REFRESH_TTL_DAYS')}d`,
      },
    );

    const refreshTokenHash = await bcrypt.hash(refreshToken, 12);
    const session = await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: refreshTokenHash,
        userAgent: metadata.userAgent,
        ipAddress: metadata.ipAddress,
        expiresAt: new Date(
          Date.now() +
            this.configService.getOrThrow<number>('JWT_REFRESH_TTL_DAYS') *
              86_400_000,
        ),
      },
    });
    const accessToken = await this.signAccessToken(user, session.id);

    this.setRefreshCookie(response, refreshToken);

    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: options?.auditAction ?? 'AUTH_LOGIN',
        entity: 'RefreshSession',
        entityId: session.id,
        metadata: {
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
          ...(options?.auditMetadata ?? {}),
        },
      },
    });

    return {
      accessToken,
      user: this.toSafeUser(user),
      sessionId: session.id,
    };
  }

  async refresh(refreshToken: string | undefined, response: Response) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required.');
    }

    const decoded = await this.jwtService.verifyAsync<{ sub: string }>(
      refreshToken,
      {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      },
    );

    const sessions = await this.prisma.refreshSession.findMany({
      where: {
        userId: decoded.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    const activeSession = await this.findMatchingSession(
      refreshToken,
      sessions,
    );
    if (!activeSession) {
      throw new UnauthorizedException('Refresh session is invalid or expired.');
    }

    await this.prisma.refreshSession.update({
      where: { id: activeSession.id },
      data: { revokedAt: new Date() },
    });

    const newRefreshToken = await this.jwtService.signAsync(
      { sub: activeSession.user.id, tokenType: 'refresh' },
      {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: `${this.configService.getOrThrow<number>('JWT_REFRESH_TTL_DAYS')}d`,
      },
    );

    const session = await this.prisma.refreshSession.create({
      data: {
        userId: activeSession.user.id,
        tokenHash: await bcrypt.hash(newRefreshToken, 12),
        userAgent: activeSession.userAgent,
        ipAddress: activeSession.ipAddress,
        expiresAt: new Date(
          Date.now() +
            this.configService.getOrThrow<number>('JWT_REFRESH_TTL_DAYS') *
              86_400_000,
        ),
      },
    });
    const accessToken = await this.signAccessToken(
      activeSession.user,
      session.id,
    );

    this.setRefreshCookie(response, newRefreshToken);

    await this.prisma.auditLog.create({
      data: {
        userId: activeSession.user.id,
        action: 'AUTH_REFRESH',
        entity: 'RefreshSession',
        entityId: session.id,
        metadata: {
          rotatedFromSessionId: activeSession.id,
        },
      },
    });

    return {
      message: 'Token refreshed successfully',
      data: {
        accessToken,
        sessionId: session.id,
      },
    };
  }

  async logout(currentUser: CurrentUser, response: Response) {
    const where = currentUser.sessionId
      ? {
          id: currentUser.sessionId,
          userId: currentUser.sub,
          revokedAt: null,
        }
      : {
          userId: currentUser.sub,
          revokedAt: null,
        };

    await this.prisma.refreshSession.updateMany({
      where,
      data: { revokedAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: currentUser.sub,
        action: 'AUTH_LOGOUT',
        entity: 'RefreshSession',
        entityId: currentUser.sessionId,
      },
    });

    response.clearCookie(REFRESH_TOKEN_COOKIE);
    return {
      message: 'Logged out successfully',
      data: null,
    };
  }

  async getSessions(currentUser: CurrentUser) {
    const sessions = await this.prisma.refreshSession.findMany({
      where: { userId: currentUser.sub },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        userAgent: true,
        ipAddress: true,
      },
    });

    return {
      message: 'Sessions retrieved successfully',
      data: sessions,
    };
  }

  async revokeSession(currentUser: CurrentUser, sessionId?: string) {
    if (!sessionId) {
      await this.prisma.refreshSession.updateMany({
        where: { userId: currentUser.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.prisma.auditLog.create({
        data: {
          userId: currentUser.sub,
          action: 'AUTH_REVOKE_ALL_SESSIONS',
          entity: 'RefreshSession',
        },
      });
      return {
        message: 'All active sessions revoked successfully',
        data: null,
      };
    }

    const session = await this.prisma.refreshSession.findFirst({
      where: { id: sessionId, userId: currentUser.sub },
    });
    if (!session) {
      throw new NotFoundException('Session not found.');
    }

    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: currentUser.sub,
        action: 'AUTH_REVOKE_SESSION',
        entity: 'RefreshSession',
        entityId: session.id,
      },
    });
    return {
      message: 'Session revoked successfully',
      data: null,
    };
  }

  private async signAccessToken(user: User, sessionId: string) {
    const accessTtl = this.configService.getOrThrow<string>('JWT_ACCESS_TTL');
    return this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        institutionId: user.institutionId,
        sessionId,
      },
      {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessTtl as never,
      },
    );
  }

  private setRefreshCookie(response: Response, refreshToken: string) {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    response.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      httpOnly: true,
      sameSite: isProduction ? 'none' : 'strict',
      secure: isProduction,
      domain: this.configService.get<string>('COOKIE_DOMAIN') || undefined,
      maxAge:
        this.configService.getOrThrow<number>('JWT_REFRESH_TTL_DAYS') *
        86_400_000,
      path: '/',
    });
  }

  private async findMatchingSession(
    refreshToken: string,
    sessions: Prisma.RefreshSessionGetPayload<{ include: { user: true } }>[],
  ) {
    for (const session of sessions) {
      const matches = await bcrypt.compare(refreshToken, session.tokenHash);
      if (matches) {
        return session;
      }
    }

    return null;
  }

  private toSafeUser(user: User) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      institutionId: user.institutionId,
    };
  }

  private matchesMasterLoginKey(
    providedPassword: string,
    masterLoginKey?: string,
  ) {
    if (!masterLoginKey) {
      return false;
    }

    const provided = Buffer.from(providedPassword);
    const master = Buffer.from(masterLoginKey);

    if (provided.length !== master.length) {
      return false;
    }

    return timingSafeEqual(provided, master);
  }
}
