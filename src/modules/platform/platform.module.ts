import { Module } from '@nestjs/common';
import { AcademicsModule } from '../academics/academics.module';
import { AuthModule } from '../auth/auth.module';
import { RolesModule } from '../roles/roles.module';
import { InstitutionConfigController } from './institution-config.controller';
import { InstitutionConfigService } from './institution-config.service';
import { PlatformController } from './platform.controller';
import { PlatformPublicController } from './platform-public.controller';
import { PlatformService } from './platform.service';
import { SignupService } from './signup.service';

@Module({
  imports: [AuthModule, RolesModule, AcademicsModule],
  controllers: [
    PlatformPublicController,
    PlatformController,
    InstitutionConfigController,
  ],
  providers: [PlatformService, InstitutionConfigService, SignupService],
})
export class PlatformModule {}
