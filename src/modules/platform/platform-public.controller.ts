import { Controller, Get, Version } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformService } from './platform.service';

@ApiTags('Platform')
@Controller('platform')
export class PlatformPublicController {
  constructor(private readonly platformService: PlatformService) {}

  @Get('plans')
  @Version('1')
  @ApiOperation({
    summary: 'List public plan definitions',
    description:
      'Public endpoint for pricing or onboarding screens to read active plan information without authentication.',
  })
  listPlans() {
    return this.platformService.listPlans();
  }
}
