import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InstitutionConfigController } from './institution-config.controller';
import { InstitutionConfigService } from './institution-config.service';
import { PlatformController } from './platform.controller';
import { PlatformPublicController } from './platform-public.controller';
import { PlatformService } from './platform.service';
import { SignupService } from './signup.service';

@Module({
  imports: [AuthModule],
  controllers: [
    PlatformPublicController,
    PlatformController,
    InstitutionConfigController,
  ],
  providers: [PlatformService, InstitutionConfigService, SignupService],
})
export class PlatformModule {}
