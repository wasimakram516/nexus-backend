import { Controller, Get, Query, UseGuards, Version } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserDecorator } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AuditLogsService } from './audit-logs.service';
import { ListAuditLogsQueryDto } from './dto/audit-logs.dto';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @Version('1')
  @RequirePermission('audit_logs', 'read')
  @ApiOperation({
    summary: 'List audit trail entries',
    description:
      'Institution-scoped Activity page endpoint for create, update, delete, login, and other tracked actions. SUPERADMIN sees every institution; everyone else is locked to their own regardless of the institutionId filter.',
  })
  listAuditLogs(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: ListAuditLogsQueryDto,
  ) {
    return this.auditLogsService.listAuditLogs(currentUser, query);
  }
}
