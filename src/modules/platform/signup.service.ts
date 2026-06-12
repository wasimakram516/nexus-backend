import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, SubscriptionStatus, UserRole } from '../../prisma/client';
import * as bcrypt from 'bcrypt';
import { Response } from 'express';
import { generateUniqueSlug } from '../../common/utils/slug.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { PublicSignupDto } from './dto/signup.dto';
import { PlatformService } from './platform.service';

@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformService: PlatformService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Public self-signup: provisions a TRIAL institution on the default plan
   * together with its first ADMIN account in one transaction, then logs the
   * admin in so the frontend can land straight on the dashboard.
   */
  async signup(
    dto: PublicSignupDto,
    response: Response,
    metadata: { userAgent?: string; ipAddress?: string },
  ) {
    const email = dto.email.toLowerCase();

    const existingUser = await this.prisma.user.findFirst({
      where: { email },
      select: { id: true },
    });
    if (existingUser) {
      throw new ConflictException('A user with this email already exists.');
    }

    const { plan, deploymentModes, defaultModules, agreedPrice, setupFee } =
      await this.platformService.getSignupPlanContext();
    const trialDates = this.platformService.getTrialDates();

    const slug = await generateUniqueSlug(
      dto.institutionName,
      async (candidate) => {
        const institution = await this.prisma.institution.findFirst({
          where: { slug: candidate },
          select: { id: true },
        });
        return Boolean(institution);
      },
      'institution',
    );

    const passwordHash = await bcrypt.hash(dto.password, 12);

    try {
      const { institution, adminUser } = await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const institution = await tx.institution.create({
            data: {
              name: dto.institutionName,
              slug,
              deploymentMode: deploymentModes[0],
              contactEmail: email,
              branding: {
                create: {
                  displayName: dto.institutionName,
                  theme: 'default',
                },
              },
              subscriptions: {
                create: {
                  planId: plan.id,
                  agreedPrice,
                  currency: plan.currency,
                  billingCycle: plan.billingCycle,
                  setupFee,
                  status: SubscriptionStatus.TRIAL,
                  startsAt: trialDates.startsAt,
                  endsAt: trialDates.endsAt,
                  autoRenew: false,
                  metadata: {
                    source: 'self-signup',
                    planKey: plan.key,
                  },
                },
              },
              entitlements: {
                create: defaultModules.map((moduleKey) => ({
                  moduleKey,
                  isEnabled: true,
                  configuration: {},
                })),
              },
            },
            select: { id: true, name: true, slug: true },
          });

          const adminUser = await tx.user.create({
            data: {
              name: dto.name,
              email,
              passwordHash,
              role: UserRole.ADMIN,
              institutionId: institution.id,
            },
          });

          await tx.auditLog.create({
            data: {
              userId: adminUser.id,
              institutionId: institution.id,
              action: 'INSTITUTION_SELF_SIGNUP',
              entity: 'Institution',
              entityId: institution.id,
              metadata: {
                slug: institution.slug,
                planKey: plan.key,
                trialEndsAt: trialDates.endsAt.toISOString(),
                adminEmail: email,
              },
            },
          });

          return { institution, adminUser };
        },
      );

      const session = await this.authService.createSessionForUser(
        adminUser,
        response,
        metadata,
        { auditAction: 'AUTH_SIGNUP_LOGIN' },
      );

      return {
        message: 'Welcome to Nexus! Your free trial is ready.',
        data: {
          ...session,
          institution: {
            id: institution.id,
            name: institution.name,
            slug: institution.slug,
            trialEndsAt: trialDates.endsAt.toISOString(),
          },
        },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException(
            'An account or institution with these details already exists. Try a different email or institution name.',
          );
        }
      }
      throw error;
    }
  }
}
