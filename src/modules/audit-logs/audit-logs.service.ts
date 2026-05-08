import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAuditLogsQueryDto } from './dto/audit-logs.dto';

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAuditLogs(query: ListAuditLogsQueryDto) {
    const skip = (query.page! - 1) * query.limit!;
    const fromDate = query.fromDate ? new Date(query.fromDate) : null;
    const toDate = query.toDate ? this.normalizeToDate(query.toDate) : null;
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
      ...(query.institutionId ? { institutionId: query.institutionId } : {}),
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
