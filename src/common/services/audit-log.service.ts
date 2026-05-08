import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { CurrentUser } from '../interfaces/current-user.interface';
import { PrismaService } from '../../prisma/prisma.service';

type AuditLogParams = {
  action: string;
  entity: string;
  entityId?: string | null;
  institutionId?: string | null;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async log(
    currentUser: CurrentUser | null | undefined,
    params: AuditLogParams,
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId: currentUser?.sub ?? null,
        institutionId:
          params.institutionId ?? currentUser?.institutionId ?? null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId ?? null,
        metadata: params.metadata
          ? (params.metadata as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }
}
