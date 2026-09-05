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
  'Role',
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

/** Never persisted into an audit snapshot, even redacted-in-place. */
const SNAPSHOT_REDACTED_FIELDS = new Set(['passwordHash', 'tokenHash']);
const SNAPSHOT_REDACTED_PLACEHOLDER = '[REDACTED]';
/** Roughly 8KB of serialized JSON per snapshot side (before/after). */
const SNAPSHOT_MAX_BYTES = 8_000;

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
  staffProfileId: string;
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

            // Snapshots are only meaningful (and cheap) for single-record
            // mutations — update/delete always require a unique `where` by
            // Prisma's own typing, so this is a safe, reliable fetch. Bulk
            // updateMany/deleteMany are skipped, matching the pre-existing
            // entityId-capture limitation for those operations. Computed
            // before the mutation runs, since the pre-image is gone after.
            const willAudit =
              !shouldSkipAudit && !AUTO_AUDIT_EXCLUDED_MODELS.has(model);
            const beforeSnapshot =
              willAudit && (operation === 'update' || operation === 'delete')
                ? await PrismaService.fetchPreImage(
                    service,
                    contextService,
                    model,
                    nextArgs.where,
                  )
                : undefined;

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
            // Hard deletes (allowHardDelete) leave effectiveOperation as
            // 'delete', so there's no post-image — the row is truly gone.
            // Every other tracked action (create/update/upsert, including
            // soft-delete and restore, which are 'update' under the hood)
            // has a real result row to use as the after-state.
            const afterSnapshot = ['create', 'update', 'upsert'].includes(
              effectiveOperation,
            )
              ? result
              : undefined;

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
                  before: PrismaService.buildSnapshot(beforeSnapshot),
                  after: PrismaService.buildSnapshot(afterSnapshot),
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
        'staffProfileId',
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

    if (refs.staffProfileId) {
      const staffProfile = await fetchWithinContext(() =>
        service.staffProfile.findUnique({
          where: { id: refs.staffProfileId! },
          select: { campus: { select: { institutionId: true } } },
        }),
      );
      if (staffProfile?.campus.institutionId) {
        return staffProfile.campus.institutionId;
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

  /**
   * Fetches the current (pre-mutation) row for a single-record update/delete,
   * to use as the audit snapshot's "before" side. Never throws — a snapshot
   * miss should never take down the actual mutation it's describing.
   */
  private static async fetchPreImage(
    service: PrismaService,
    contextService: RequestContextService,
    model: string,
    where: unknown,
  ): Promise<unknown> {
    if (!where || typeof where !== 'object' || Array.isArray(where)) {
      return undefined;
    }

    const modelProperty = PrismaService.toModelPropertyName(model);
    const delegate = (service as unknown as Record<string, unknown>)[
      modelProperty
    ] as { findUnique?: (args: { where: unknown }) => Promise<unknown> };

    if (!delegate?.findUnique) {
      return undefined;
    }

    try {
      return await contextService.runWith({ skipAudit: true }, () =>
        delegate.findUnique!({ where }),
      );
    } catch {
      return undefined;
    }
  }

  /** Prisma client delegates are the model name with a lowercase first letter. */
  private static toModelPropertyName(model: string): string {
    return model.charAt(0).toLowerCase() + model.slice(1);
  }

  private static redactSnapshot(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) =>
        SNAPSHOT_REDACTED_FIELDS.has(key)
          ? [key, SNAPSHOT_REDACTED_PLACEHOLDER]
          : [key, val],
      ),
    );
  }

  private static capSnapshotSize(value: unknown): unknown {
    const serialized = JSON.stringify(value);
    if (serialized.length <= SNAPSHOT_MAX_BYTES) {
      return value;
    }

    return {
      truncated: true,
      note: `Snapshot exceeded ${SNAPSHOT_MAX_BYTES} bytes and was omitted.`,
    };
  }

  private static buildSnapshot(
    value: unknown,
  ): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    const redacted = PrismaService.redactSnapshot(value);
    const capped = PrismaService.capSnapshotSize(redacted);
    return PrismaService.toInputJsonValue(capped);
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
