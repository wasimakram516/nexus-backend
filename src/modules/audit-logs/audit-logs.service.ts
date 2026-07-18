import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '../../prisma/client';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAuditLogsQueryDto } from './dto/audit-logs.dto';

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAuditLogs(currentUser: CurrentUser, query: ListAuditLogsQueryDto) {
    const skip = (query.page! - 1) * query.limit!;
    const fromDate = query.fromDate ? new Date(query.fromDate) : null;
    const toDate = query.toDate ? this.normalizeToDate(query.toDate) : null;
    // Only SUPERADMIN may cross institutions; everyone else — including a
    // STAFF actor reaching this via a delegated audit_logs.read grant — is
    // locked to their own institution regardless of what institutionId the
    // query asked for. A non-superadmin with no institution at all (should
    // never happen in practice) gets refused outright rather than silently
    // falling through to an unscoped, cross-institution query.
    if (
      currentUser.role !== UserRole.SUPERADMIN &&
      !currentUser.institutionId
    ) {
      throw new ForbiddenException(
        'Your account is not linked to an institution.',
      );
    }
    const scopedInstitutionId =
      currentUser.role === UserRole.SUPERADMIN
        ? query.institutionId
        : currentUser.institutionId!;
    const where: Prisma.AuditLogWhereInput = {
      ...(query.search
        ? {
            OR: [
              {
                action: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
              {
                entity: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
              {
                entityId: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
              {
                user: {
                  name: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                user: {
                  email: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                institution: {
                  name: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                institution: {
                  slug: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
              },
            ],
          }
        : {}),
      ...(query.action
        ? {
            action: {
              contains: query.action,
              mode: 'insensitive',
            },
          }
        : {}),
      ...(query.entity
        ? {
            entity: {
              contains: query.entity,
              mode: 'insensitive',
            },
          }
        : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(scopedInstitutionId ? { institutionId: scopedInstitutionId } : {}),
      ...(fromDate || toDate
        ? {
            createdAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
          institution: {
            select: {
              id: true,
              name: true,
              slug: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      message: 'Audit logs retrieved successfully',
      data: {
        items,
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(total / query.limit!),
        hasNextPage: skip + items.length < total,
        hasPreviousPage: query.page! > 1,
      },
    };
  }

  private normalizeToDate(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T23:59:59.999Z`);
    }

    return new Date(value);
  }
}
