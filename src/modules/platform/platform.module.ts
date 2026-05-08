import { Module } from '@nestjs/common';
import { InstitutionConfigController } from './institution-config.controller';
import { InstitutionConfigService } from './institution-config.service';
import { PlatformController } from './platform.controller';
import { PlatformPublicController } from './platform-public.controller';
import { PlatformService } from './platform.service';

@Module({
  controllers: [
    PlatformPublicController,
    PlatformController,
    InstitutionConfigController,
  ],
  providers: [PlatformService, InstitutionConfigService],
})
export class PlatformModule {}
