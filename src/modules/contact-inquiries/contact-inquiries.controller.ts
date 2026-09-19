import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUserDecorator } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DeleteRecordDto } from '../../common/dto/delete-record.dto';
import { UserRole } from '../../common/enums/domain.enums';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { ContactInquiriesService } from './contact-inquiries.service';
import {
  CreateContactInquiryDto,
  ListContactInquiriesQueryDto,
  UpdateContactInquiryStatusDto,
} from './dto/contact-inquiry.dto';

@ApiTags('Contact')
@Controller('contact')
export class ContactInquiriesPublicController {
  constructor(private readonly service: ContactInquiriesService) {}

  @Post('inquiries')
  @Version('1')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Submit a public contact inquiry' })
  create(@Body() dto: CreateContactInquiryDto, @Req() req: Request) {
    return this.service.create(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}

@ApiTags('Platform')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPERADMIN)
@Controller('platform/contact-inquiries')
export class ContactInquiriesAdminController {
  constructor(private readonly service: ContactInquiriesService) {}

  @Get()
  @Version('1')
  @ApiOperation({ summary: 'List contact inquiries' })
  list(@Query() query: ListContactInquiriesQueryDto) {
    return this.service.list(query);
  }

  @Patch(':id/status')
  @Version('1')
  @ApiOperation({ summary: 'Mark an inquiry NEW, READ or ARCHIVED' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactInquiryStatusDto,
  ) {
    return this.service.updateStatus(id, dto.status);
  }

  @Delete(':id')
  @Version('1')
  @ApiOperation({ summary: 'Soft-delete an inquiry' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserDecorator() user: CurrentUser,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.service.remove(id, user, dto.reason);
  }
}
