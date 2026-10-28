import { RequestContextService } from '../common/services/request-context.service';
import { AuditLogService } from '../common/services/audit-log.service';
import { Global, Module } from '@nestjs/common';
import { CampusAccessService } from '../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../common/services/module-access.service';
import { TimezoneResolverService } from '../common/services/timezone-resolver.service';
import { UserPermissionsService } from '../common/services/user-permissions.service';
import { WorkingDayResolverService } from '../common/services/working-day-resolver.service';
import { PrintableMetaService } from '../common/services/printable-meta.service';
import { OwnedStudentsService } from '../common/services/owned-students.service';
import { PrintableCustomValuesService } from '../common/services/printable-custom-values.service';
import { PdfService } from '../common/pdf/pdf.service';
import { PlanLimitsService } from '../common/services/plan-limits.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [
    PrismaService,
    RequestContextService,
    AuditLogService,
    CampusAccessService,
    EntityCustomFieldsService,
    ModuleAccessService,
    UserPermissionsService,
    TimezoneResolverService,
    WorkingDayResolverService,
    PrintableMetaService,
    OwnedStudentsService,
    PrintableCustomValuesService,
    PdfService,
    PlanLimitsService,
  ],
  exports: [
    PrismaService,
    RequestContextService,
    AuditLogService,
    CampusAccessService,
    EntityCustomFieldsService,
    ModuleAccessService,
    UserPermissionsService,
    TimezoneResolverService,
    WorkingDayResolverService,
    PrintableMetaService,
    OwnedStudentsService,
    PrintableCustomValuesService,
    PdfService,
    PlanLimitsService,
  ],
})
export class PrismaModule {}
