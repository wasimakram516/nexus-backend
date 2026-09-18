import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { CustomFieldsService } from './custom-fields.service';
import { CUSTOM_FIELD_ENTITY_MODULES } from '../../common/utils/custom-field-entity.util';
import {
  CreateCustomFieldDefinitionDto,
  FormCustomFieldDefinitionsQueryDto,
  ListCustomFieldDefinitionsQueryDto,
  ListCustomFieldValuesQueryDto,
  UpdateCustomFieldDefinitionDto,
  UpsertCustomFieldValueDto,
} from './dto/custom-fields.dto';

@ApiTags('Custom Fields')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('custom-fields')
export class CustomFieldsController {
  constructor(private readonly customFieldsService: CustomFieldsService) {}

  /** Authorization is resolved against the requested record feature in the service. */
  @Get('form-definitions')
  @Version('1')
  listFormDefinitions(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: FormCustomFieldDefinitionsQueryDto,
  ) {
    return this.customFieldsService.listFormDefinitions(currentUser, query);
  }

  /** Lists only entity/module combinations implemented by record services. */
  @Get('entities')
  @Version('1')
  @RequirePermission('custom_fields', 'read')
  listEntities() {
    return {
      message: 'Custom field entities retrieved successfully',
      data: Object.entries(CUSTOM_FIELD_ENTITY_MODULES).map(
        ([entityType, moduleKey]) => ({ entityType, moduleKey }),
      ),
    };
  }

  @Post('definitions')
  @Version('1')
  @RequirePermission('custom_fields', 'create')
  @ApiOperation({
    summary: 'Create a custom field definition',
    description:
      'Creates a reusable custom field definition for a module and entity type within the current institution scope.',
  })
  createDefinition(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: CreateCustomFieldDefinitionDto,
  ) {
    return this.customFieldsService.createDefinition(currentUser, dto);
  }

  @Get('definitions')
  @Version('1')
  @RequirePermission('custom_fields', 'read')
  @ApiOperation({
    summary: 'List custom field definitions',
    description:
      'Returns custom field definitions filtered by institution, module, entity type, and active state for builder or form-rendering screens.',
  })
  listDefinitions(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: ListCustomFieldDefinitionsQueryDto,
  ) {
    return this.customFieldsService.listDefinitions(currentUser, query);
  }

  @Patch('definitions/:definitionId')
  @Version('1')
  @RequirePermission('custom_fields', 'update')
  @ApiOperation({
    summary: 'Update a custom field definition',
    description:
      'Updates metadata, validation rules, and visibility settings for an existing custom field definition.',
  })
  updateDefinition(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('definitionId') definitionId: string,
    @Body() dto: UpdateCustomFieldDefinitionDto,
  ) {
    return this.customFieldsService.updateDefinition(
      currentUser,
      definitionId,
      dto,
    );
  }

  @Post('values')
  @Version('1')
  @RequirePermission('custom_fields', 'update')
  @ApiOperation({
    summary: 'Upsert a custom field value',
    description:
      'Creates or updates a custom field value for a specific entity after validating module access, institution scope, and entity access.',
  })
  upsertValue(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: UpsertCustomFieldValueDto,
  ) {
    return this.customFieldsService.upsertValue(currentUser, dto);
  }

  @Get('values')
  @Version('1')
  @RequirePermission('custom_fields', 'read')
  @ApiOperation({
    summary: 'List custom field values',
    description:
      'Returns saved custom field values filtered by institution, definition, or entity for admin and diagnostics screens.',
  })
  listValues(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: ListCustomFieldValuesQueryDto,
  ) {
    return this.customFieldsService.listValues(currentUser, query);
  }
}
