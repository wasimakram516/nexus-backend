import { RequestContextService } from '../common/services/request-context.service';
import { AuditLogService } from '../common/services/audit-log.service';
import { Global, Module } from '@nestjs/common';
import { CampusAccessService } from '../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../common/services/module-access.service';
import { UserPermissionsService } from '../common/services/user-permissions.service';
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
  ],
  exports: [
    PrismaService,
    RequestContextService,
    AuditLogService,
    CampusAccessService,
    EntityCustomFieldsService,
    ModuleAccessService,
    UserPermissionsService,
  ],
})
export class PrismaModule {}
