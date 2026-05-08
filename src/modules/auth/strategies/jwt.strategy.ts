import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserStatus } from '../../../prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { CurrentUser } from '../../../common/interfaces/current-user.interface';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: CurrentUser): Promise<CurrentUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        deletedAt: true,
        institutionId: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Authenticated user no longer exists.');
    }

    if (user.deletedAt) {
      throw new UnauthorizedException('Authenticated user no longer exists.');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Your account is not active.');
    }

    if (payload.sessionId) {
      const session = await this.prisma.refreshSession.findFirst({
        where: {
          id: payload.sessionId,
          userId: user.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });

      if (!session) {
        throw new UnauthorizedException('Your session is no longer active.');
      }
    }

    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      institutionId: user.institutionId,
      sessionId: payload.sessionId,
    };
  }
}
