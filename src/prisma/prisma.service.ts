import { INestApplication, Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { RequestContextService } from '../common/services/request-context.service';

const AUTO_AUDIT_EXCLUDED_MODELS = new Set([
  'AuditLog',
  'RefreshSession',
  'User',
  'Campus',
  'Institution',
  'PlanDefinition',
  'InstitutionBranding',
  'InstitutionSetting',
  'InstitutionEntitlement',
  'InstitutionSubscription',
  'PermissionTemplate',
]);

type ModelCapabilities = {
  createdBy: boolean;
  updatedBy: boolean;
  deletedAt: boolean;
  deletedBy: boolean;
  deleteReason: boolean;
  activeScopeKey: boolean;
};

const ACTIVE_SCOPE_KEY = 'ACTIVE';

const MODEL_CAPABILITIES = new Map<string, ModelCapabilities>(
  Prisma.dmmf.datamodel.models.map((model) => {
    const fields = new Set(model.fields.map((field) => field.name));
    return [
      model.name,
      {
        createdBy: fields.has('createdBy'),
        updatedBy: fields.has('updatedBy'),
        deletedAt: fields.has('deletedAt'),
        deletedBy: fields.has('deletedBy'),
        deleteReason: fields.has('deleteReason'),
        activeScopeKey: fields.has('activeScopeKey'),
      },
    ];
  }),
);

type QueryArgs = Record<string, unknown>;

type QueryHandler = (args: unknown) => Promise<unknown>;

type AuditReferenceIds = Partial<{
  institutionId: string;
  campusId: string;
  levelId: string;
  classId: string;
  sectionId: string;
  studentId: string;
  guardianId: string;
  teacherId: string;
  userId: string;
  salaryId: string;
  salaryPaymentId: string;
  feeStructureId: string;
  voucherId: string;
  bankId: string;
  definitionId: string;
  planId: string;
}>;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(private readonly requestContext: RequestContextService) {
    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL ?? '',
      }),
    });

    const contextService = this.requestContext;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const service = this;
    const client = this.$extends({
      query: {
        $allModels: {
          async $allOperations({
            model,
            operation,
            args,
            query,
          }: {
            model?: string;
            operation: string;
            args: unknown;
            query: QueryHandler;
          }) {
            if (!model) {
              return query(args);
            }

            const actor = contextService.get('currentUser');
            const shouldSkipAudit =
              contextService.get('skipAudit') || model === 'AuditLog';
            let nextArgs = PrismaService.normalizeArgs(args);
            let effectiveOperation = operation;
            const capabilities = PrismaService.getModelCapabilities(model);

            if (capabilities.deletedAt) {
              nextArgs = PrismaService.applySoftDeleteFilters(
                operation,
                nextArgs,
              );

              if (
                operation === 'delete' &&
                !contextService.get('allowHardDelete')
              ) {
                effectiveOperation = 'update';
                nextArgs = {
                  where: nextArgs.where,
                  data: PrismaService.stampMutationData(
                    {},
                    capabilities,
                    'softDelete',
                    actor?.sub ?? null,
                    contextService.get('deleteReason'),
                    PrismaService.resolveSoftDeleteScopeValue(nextArgs.where),
                  ),
                };
              }

              if (
                operation === 'deleteMany' &&
                !contextService.get('allowHardDelete')
              ) {
                effectiveOperation = 'updateMany';
                nextArgs = {
                  where: nextArgs.where,
                  data: PrismaService.stampMutationData(
                    {},
                    capabilities,
                    'softDelete',
                    actor?.sub ?? null,
                    contextService.get('deleteReason'),
                    PrismaService.resolveSoftDeleteScopeValue(),
                  ),
                };
              }
            }

            nextArgs = PrismaService.applyLifecycleStamps(
              nextArgs,
              effectiveOperation,
              capabilities,
              actor?.sub ?? null,
            );

            const result = await query(nextArgs);
            const auditAction = PrismaService.resolveAuditAction(
              operation,
              effectiveOperation,
              nextArgs,
            );

            if (
              shouldSkipAudit ||
              AUTO_AUDIT_EXCLUDED_MODELS.has(model) ||
              !auditAction
            ) {
              return result;
            }

            const metadata = PrismaService.buildAuditMetadata(
              auditAction,
              nextArgs,
              contextService.get('deleteReason'),
            );
            const entityId = PrismaService.extractEntityId(result);
            const institutionId = await PrismaService.resolveAuditInstitutionId(
              service,
              contextService,
              nextArgs,
              result,
              actor?.institutionId ?? null,
            );

            await contextService.runWith({ skipAudit: true }, async () => {
              await service.auditLog.create({
                data: {
                  userId: actor?.sub ?? null,
                  institutionId,
                  action: `${model.toUpperCase()}_${auditAction}`,
                  entity: model,
                  entityId,
                  metadata: metadata
                    ? PrismaService.toInputJsonValue(metadata)
                    : undefined,
                },
              });
            });

            return result;
          },
        },
      },
    });

    Object.assign(this, client);
  }

  enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', () => {
      void app.close();
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private static normalizeArgs(args: unknown): QueryArgs {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return {};
    }

    return args as QueryArgs;
  }

  private static applySoftDeleteFilters(action: string, args: QueryArgs) {
    const nextArgs: QueryArgs = {
      ...args,
    };

    if (
      [
        'findMany',
        'findFirst',
        'findUnique',
        'count',
        'update',
        'updateMany',
      ].includes(action)
    ) {
      const where =
        args.where &&
        typeof args.where === 'object' &&
        !Array.isArray(args.where)
          ? args.where
          : {};
      if (!('deletedAt' in where)) {
        nextArgs.where = {
          ...where,
          deletedAt: null,
        };
      }
    }

    return nextArgs;
  }

  private static applyLifecycleStamps(
    args: QueryArgs,
    action: string,
    capabilities: ModelCapabilities,
    actorId: string | null,
  ) {
    if (!actorId) {
      return args;
    }

    const nextArgs: QueryArgs = {
      ...args,
    };

    if (action === 'create' || action === 'update' || action === 'updateMany') {
      nextArgs.data = PrismaService.stampMutationData(
        args.data,
        capabilities,
        action === 'create' ? 'create' : 'update',
        actorId,
      );
    }

    if (action === 'createMany') {
      nextArgs.data = PrismaService.stampMutationData(
        args.data,
        capabilities,
        'create',
        actorId,
      );
    }

    if (action === 'upsert') {
      nextArgs.create = PrismaService.stampMutationData(
        args.create,
        capabilities,
        'create',
        actorId,
      );
      nextArgs.update = PrismaService.stampMutationData(
        args.update,
        capabilities,
        'update',
        actorId,
      );
    }

    return nextArgs;
  }

  private static stampMutationData(
    value: unknown,
    capabilities: ModelCapabilities,
    mode: 'create' | 'update' | 'softDelete',
    actorId: string | null,
    deleteReason?: string | null,
    deletedScopeValue?: string,
  ): unknown {
    if (Array.isArray(value)) {
      return value.map((item) =>
        PrismaService.stampMutationData(
          item,
          capabilities,
          mode,
          actorId,
          deleteReason,
          deletedScopeValue,
        ),
      );
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const nextValue = { ...(value as Record<string, unknown>) };

    if (mode === 'create') {
      if (capabilities.createdBy && nextValue.createdBy === undefined) {
        nextValue.createdBy = actorId;
      }
      if (capabilities.updatedBy && nextValue.updatedBy === undefined) {
        nextValue.updatedBy = actorId;
      }
      if (
        capabilities.activeScopeKey &&
        nextValue.activeScopeKey === undefined
      ) {
        nextValue.activeScopeKey = ACTIVE_SCOPE_KEY;
      }
    }

    if (mode === 'update' && capabilities.updatedBy) {
      if (nextValue.updatedBy === undefined) {
        nextValue.updatedBy = actorId;
      }
    }

    if (
      mode === 'update' &&
      capabilities.activeScopeKey &&
      nextValue.deletedAt === null &&
      nextValue.activeScopeKey === undefined
    ) {
      nextValue.activeScopeKey = ACTIVE_SCOPE_KEY;
    }

    if (mode === 'softDelete') {
      if (capabilities.deletedAt && nextValue.deletedAt === undefined) {
        nextValue.deletedAt = new Date();
      }
      if (capabilities.deletedBy && nextValue.deletedBy === undefined) {
        nextValue.deletedBy = actorId;
      }
      if (capabilities.deleteReason && nextValue.deleteReason === undefined) {
        nextValue.deleteReason = deleteReason ?? null;
      }
      if (capabilities.updatedBy && nextValue.updatedBy === undefined) {
        nextValue.updatedBy = actorId;
      }
      if (
        capabilities.activeScopeKey &&
        nextValue.activeScopeKey === undefined
      ) {
        nextValue.activeScopeKey =
          deletedScopeValue ?? PrismaService.resolveSoftDeleteScopeValue();
      }
    }

    return nextValue;
  }

  private static resolveSoftDeleteScopeValue(where?: unknown) {
    if (where && typeof where === 'object' && !Array.isArray(where)) {
      const id = (where as { id?: unknown }).id;
      if (typeof id === 'string') {
        return `DELETED:${id}`;
      }
    }

    return `DELETED:${randomUUID()}`;
  }

  private static shouldAuditAction(action: string) {
    return [
      'create',
      'update',
      'updateMany',
      'upsert',
      'delete',
      'deleteMany',
    ].includes(action);
  }

  private static resolveAuditAction(
    originalOperation: string,
    effectiveOperation: string,
    args: QueryArgs,
  ) {
    if (originalOperation === 'delete' || originalOperation === 'deleteMany') {
      return 'DELETED';
    }

    if (effectiveOperation === 'create') {
      return 'CREATED';
    }

    if (effectiveOperation === 'upsert') {
      return 'UPSERTED';
    }

    if (
      effectiveOperation === 'update' ||
      effectiveOperation === 'updateMany'
    ) {
      const data = PrismaService.extractMutationData(args);

      if (data?.deletedAt === null) {
        return 'RESTORED';
      }

      if (
        data?.deletedAt instanceof Date ||
        typeof data?.deletedAt === 'string'
      ) {
        return 'DELETED';
      }

      return 'UPDATED';
    }

    return PrismaService.shouldAuditAction(effectiveOperation)
      ? effectiveOperation.toUpperCase()
      : null;
  }

  private static buildAuditMetadata(
    action: string,
    args: QueryArgs,
    deleteReason?: string | null,
  ) {
    if (action === 'CREATED' || action === 'UPDATED' || action === 'RESTORED') {
      const data = PrismaService.extractMutationData(args);
      return data
        ? {
            fields: PrismaService.extractTrackedFieldNames(data),
            ...(args.where ? { where: args.where } : {}),
          }
        : args.where
          ? { where: args.where }
          : undefined;
    }

    if (action === 'UPSERTED') {
      return {
        ...(args.where ? { where: args.where } : {}),
        createFields: PrismaService.extractTrackedFieldNames(args.create),
        updateFields: PrismaService.extractTrackedFieldNames(args.update),
      };
    }

    if (action === 'DELETED') {
      return {
        ...(args.where ? { where: args.where } : {}),
        ...(deleteReason !== undefined ? { reason: deleteReason ?? null } : {}),
      };
    }

    return undefined;
  }

  private static extractEntityId(result: unknown) {
    if (result && typeof result === 'object' && 'id' in result) {
      const value = (result as { id?: unknown }).id;
      return typeof value === 'string' ? value : null;
    }

    return null;
  }

  private static extractInstitutionId(result: unknown) {
    if (result && typeof result === 'object' && 'institutionId' in result) {
      const value = (result as { institutionId?: unknown }).institutionId;
      return typeof value === 'string' ? value : null;
    }

    return null;
  }

  private static extractMutationData(args: QueryArgs) {
    if (
      args.data &&
      typeof args.data === 'object' &&
      !Array.isArray(args.data)
    ) {
      return args.data as Record<string, unknown>;
    }

    return null;
  }

  private static extractTrackedFieldNames(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }

    return Object.keys(value as Record<string, unknown>).filter(
      (field) =>
        ![
          'createdBy',
          'updatedBy',
          'deletedAt',
          'deletedBy',
          'deleteReason',
          'activeScopeKey',
        ].includes(field),
    );
  }

  private static extractAuditReferenceIds(
    args: QueryArgs,
    result: unknown,
  ): AuditReferenceIds {
    const refs: AuditReferenceIds = {};
    const sources = [result, args.data, args.create, args.update, args.where];

    for (const source of sources) {
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        continue;
      }

      const record = source as Record<string, unknown>;
      const keys: Array<keyof AuditReferenceIds> = [
        'institutionId',
        'campusId',
        'levelId',
        'classId',
        'sectionId',
        'studentId',
        'guardianId',
        'teacherId',
        'userId',
        'salaryId',
        'salaryPaymentId',
        'feeStructureId',
        'voucherId',
        'bankId',
        'definitionId',
        'planId',
      ];

      for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && !refs[key]) {
          refs[key] = value;
        }
      }
    }

    return refs;
  }

  private static async resolveAuditInstitutionId(
    service: PrismaService,
    contextService: RequestContextService,
    args: QueryArgs,
    result: unknown,
    fallbackInstitutionId: string | null,
  ) {
    const directInstitutionId =
      PrismaService.extractInstitutionId(result) ??
      PrismaService.extractInstitutionId(args.data) ??
      PrismaService.extractInstitutionId(args.create) ??
      PrismaService.extractInstitutionId(args.where);

    if (directInstitutionId) {
      return directInstitutionId;
    }

    const refs = PrismaService.extractAuditReferenceIds(args, result);

    const fetchWithinContext = async <T>(loader: () => Promise<T>) =>
      contextService.runWith({ skipAudit: true }, loader);

    if (refs.campusId) {
      const campus = await fetchWithinContext(() =>
        service.campus.findUnique({
          where: { id: refs.campusId! },
          select: { institutionId: true },
        }),
      );
      if (campus?.institutionId) {
        return campus.institutionId;
      }
    }

    if (refs.levelId) {
      const level = await fetchWithinContext(() =>
        service.level.findUnique({
          where: { id: refs.levelId! },
          select: { campus: { select: { institutionId: true } } },
        }),
      );
      if (level?.campus.institutionId) {
        return level.campus.institutionId;
      }
    }

    if (refs.classId) {
      const item = await fetchWithinContext(() =>
        service.academicClass.findUnique({
          where: { id: refs.classId! },
          select: {
            level: {
              select: {
                campus: {
                  select: { institutionId: true },
                },
              },
            },
          },
        }),
      );
      if (item?.level.campus.institutionId) {
        return item.level.campus.institutionId;
      }
    }

    if (refs.sectionId) {
      const section = await fetchWithinContext(() =>
        service.section.findUnique({
          where: { id: refs.sectionId! },
          select: {
            class: {
              select: {
                level: {
                  select: {
                    campus: {
                      select: { institutionId: true },
                    },
                  },
                },
              },
            },
          },
        }),
      );
      if (section?.class.level.campus.institutionId) {
        return section.class.level.campus.institutionId;
      }
    }

    if (refs.studentId) {
      const student = await fetchWithinContext(() =>
        service.student.findUnique({
          where: { id: refs.studentId! },
          select: { campus: { select: { institutionId: true } } },
        }),
      );
      if (student?.campus.institutionId) {
        return student.campus.institutionId;
      }
    }

    if (refs.guardianId) {
      const guardian = await fetchWithinContext(() =>
        service.guardian.findUnique({
          where: { id: refs.guardianId! },
          select: { campus: { select: { institutionId: true } } },
        }),
      );
      if (guardian?.campus.institutionId) {
        return guardian.campus.institutionId;
      }
    }

    if (refs.teacherId) {
      const teacher = await fetchWithinContext(() =>
        service.teacher.findUnique({
          where: { id: refs.teacherId! },
          select: { campus: { select: { institutionId: true } } },
        }),
      );
      if (teacher?.campus.institutionId) {
        return teacher.campus.institutionId;
      }
    }

    if (refs.userId) {
      const user = await fetchWithinContext(() =>
        service.user.findUnique({
          where: { id: refs.userId! },
          select: { institutionId: true },
        }),
      );
      if (user?.institutionId) {
        return user.institutionId;
      }
    }

    if (refs.salaryId) {
      const salary = await fetchWithinContext(() =>
        service.staffSalary.findUnique({
          where: { id: refs.salaryId! },
          select: { campus: { select: { institutionId: true } } },
        }),
      );
      if (salary?.campus.institutionId) {
        return salary.campus.institutionId;
      }
    }

    if (refs.salaryPaymentId) {
      const payment = await fetchWithinContext(() =>
        service.salaryPayment.findUnique({
          where: { id: refs.salaryPaymentId! },
          select: { campus: { select: { institutionId: true } } },
        }),
      );
      if (payment?.campus.institutionId) {
        return payment.campus.institutionId;
      }
    }

    if (refs.feeStructureId) {
      const structure = await fetchWithinContext(() =>
        service.feeStructure.findUnique({
          where: { id: refs.feeStructureId! },
          select: { campus: { select: { institutionId: true } } },
        }),
      );
      if (structure?.campus.institutionId) {
        return structure.campus.institutionId;
      }
    }

    if (refs.voucherId) {
      const voucher = await fetchWithinContext(() =>
        service.feeVoucher.findUnique({
          where: { id: refs.voucherId! },
          select: {
            student: {
              select: {
                campus: {
                  select: { institutionId: true },
                },
              },
            },
          },
        }),
      );
      if (voucher?.student.campus.institutionId) {
        return voucher.student.campus.institutionId;
      }
    }

    if (refs.bankId) {
      const bank = await fetchWithinContext(() =>
        service.bankAccount.findUnique({
          where: { id: refs.bankId! },
          select: { campus: { select: { institutionId: true } } },
        }),
      );
      if (bank?.campus.institutionId) {
        return bank.campus.institutionId;
      }
    }

    if (refs.definitionId) {
      const definition = await fetchWithinContext(() =>
        service.customFieldDefinition.findUnique({
          where: { id: refs.definitionId! },
          select: { institutionId: true },
        }),
      );
      if (definition?.institutionId) {
        return definition.institutionId;
      }
    }

    if (refs.planId) {
      const plan = await fetchWithinContext(() =>
        service.planDefinition.findUnique({
          where: { id: refs.planId! },
          select: { institutionId: true },
        }),
      );
      if (plan?.institutionId) {
        return plan.institutionId;
      }
    }

    return fallbackInstitutionId;
  }

  private static toInputJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private static getModelCapabilities(model: string): ModelCapabilities {
    return (
      MODEL_CAPABILITIES.get(model) ?? {
        createdBy: false,
        updatedBy: false,
        deletedAt: false,
        deletedBy: false,
        deleteReason: false,
        activeScopeKey: false,
      }
    );
  }
}
