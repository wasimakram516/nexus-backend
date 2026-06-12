import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserDecorator } from '../../common/decorators/current-user.decorator';
import { DeleteRecordDto } from '../../common/dto/delete-record.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ModuleKey } from '../../prisma/client';
import { ModulePermission } from '../../common/decorators/module-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ModulePermissionsGuard } from '../../common/guards/module-permissions.guard';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import {
  AssignUserCampusDto,
  CreateCampusDto,
  RemoveUserCampusDto,
  UpdateCampusDto,
} from './dto/campuses.dto';
import { CampusesService } from './campuses.service';

@ApiTags('Campuses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ModulePermissionsGuard)
@ModulePermission(ModuleKey.ACADEMICS)
@Controller('campuses')
export class CampusesController {
  constructor(private readonly campusesService: CampusesService) {}

  @Post()
  @Version('1')
  @ApiOperation({
    summary: 'Create a campus',
    description:
      'Creates a campus inside the current institution for campus management and downstream people, attendance, and finance records.',
  })
  createCampus(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: CreateCampusDto,
  ) {
    return this.campusesService.createCampus(currentUser, dto);
  }

  @Get()
  @Version('1')
  @ApiOperation({
    summary: 'List campuses',
    description:
      'Returns paginated campuses visible to the authenticated user for campus selection and administration screens.',
  })
  listCampuses(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.campusesService.listCampuses(currentUser, query);
  }

  @Put(':campusId')
  @Version('1')
  @ApiOperation({
    summary: 'Update a campus',
    description:
      'Updates campus details such as name, location, or status for an existing campus in the current institution scope.',
  })
  updateCampus(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('campusId') campusId: string,
    @Body() dto: UpdateCampusDto,
  ) {
    return this.campusesService.updateCampus(currentUser, campusId, dto);
  }

  @Post(':campusId/delete')
  @Version('1')
  @ApiOperation({
    summary: 'Soft-delete a campus',
    description:
      'Moves a campus to the recycle bin. This is intended for managed deletion flows rather than immediate permanent removal.',
  })
  deleteCampus(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('campusId') campusId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.campusesService.deleteCampus(currentUser, campusId, dto.reason);
  }

  @Post('assign-user')
  @Version('1')
  @ApiOperation({
    summary: 'Assign a user to a campus',
    description:
      'Creates a campus assignment for a user so they can operate within that campus in role-scoped screens.',
  })
  assignUser(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: AssignUserCampusDto,
  ) {
    return this.campusesService.assignUser(currentUser, dto);
  }

  @Get(':campusId/users')
  @Version('1')
  @ApiOperation({
    summary: 'List users assigned to a campus',
    description:
      'Returns users linked to a campus for assignment, access review, and campus staffing screens.',
  })
  getCampusUsers(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('campusId') campusId: string,
  ) {
    return this.campusesService.getCampusUsers(currentUser, campusId);
  }

  @Post('remove-user')
  @Version('1')
  @ApiOperation({
    summary: 'Remove a user from a campus',
    description:
      'Deletes a campus assignment without deleting the underlying user account.',
  })
  removeUser(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: RemoveUserCampusDto,
  ) {
    return this.campusesService.removeUser(currentUser, dto);
  }
}