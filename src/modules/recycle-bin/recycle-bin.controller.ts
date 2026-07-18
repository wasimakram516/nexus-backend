import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserDecorator } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import {
  ListRecycleBinQueryDto,
  RecycleBinRecordParamsDto,
} from './dto/recycle-bin.dto';
import { RecycleBinService } from './recycle-bin.service';

@ApiTags('Recycle Bin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('recycle-bin')
export class RecycleBinController {
  constructor(private readonly recycleBinService: RecycleBinService) {}

  @Get()
  @Version('1')
  @RequirePermission('recycle_bin', 'read')
  @ApiOperation({
    summary: 'List soft-deleted records',
    description:
      'Returns soft-deleted users and campuses, with who deleted them and when, for recycle-bin management screens.',
  })
  listDeletedItems(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: ListRecycleBinQueryDto,
  ) {
    return this.recycleBinService.listDeletedItems(currentUser, query);
  }

  @Post(':entity/:recordId/restore')
  @Version('1')
  @RequirePermission('recycle_bin', 'update')
  @ApiOperation({
    summary: 'Restore a recycle bin record',
  })
  restoreRecord(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param() params: RecycleBinRecordParamsDto,
  ) {
    return this.recycleBinService.restoreRecord(
      currentUser,
      params.entity,
      params.recordId,
    );
  }

  @Delete(':entity/:recordId/permanent')
  @Version('1')
  @RequirePermission('recycle_bin', 'delete')
  @ApiOperation({
    summary: 'Permanently delete a recycle bin record',
    description:
      'Permanently removes a soft-deleted record. This action should only be used after a record has already been moved to the recycle bin.',
  })
  permanentlyDeleteRecord(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param() params: RecycleBinRecordParamsDto,
  ) {
    return this.recycleBinService.permanentlyDeleteRecord(
      currentUser,
      params.entity,
      params.recordId,
    );
  }
}
