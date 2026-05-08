import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UserRole, UserStatus } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SuperadminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(SuperadminBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    const email = this.configService
      .get<string>('SUPERADMIN_SEED_EMAIL')
      ?.toLowerCase()
      .trim();
    const password = this.configService.get<string>('SUPERADMIN_SEED_PASSWORD');

    if (!email || !password) {
      return;
    }

    const name =
      this.configService.get<string>('SUPERADMIN_SEED_NAME')?.trim() ||
      'Super Admin';
    const passwordHash = await bcrypt.hash(password, 12);
    const existingUser = await this.prisma.user.findFirst({
      where: {
        email,
      },
      select: {
        id: true,
      },
    });

    const user = existingUser
      ? await this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            name,
            email,
            passwordHash,
            role: UserRole.SUPERADMIN,
            status: UserStatus.ACTIVE,
            institutionId: null,
          },
          select: {
            id: true,
            email: true,
          },
        })
      : await this.prisma.user.create({
          data: {
            name,
            email,
            passwordHash,
            role: UserRole.SUPERADMIN,
            status: UserStatus.ACTIVE,
            institutionId: null,
          },
          select: {
            id: true,
            email: true,
          },
        });

    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'SUPERADMIN_BOOTSTRAPPED',
        entity: 'User',
        entityId: user.id,
        metadata: {
          email: user.email,
          mode: existingUser ? 'updated' : 'created',
        },
      },
    });

    this.logger.log(
      `Superadmin seed ${existingUser ? 'updated' : 'created'} for ${user.email}`,
    );
  }
}
