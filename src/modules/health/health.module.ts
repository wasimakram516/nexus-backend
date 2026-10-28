import { Module } from '@nestjs/common';
import { BackupModule } from '../backup/backup.module';
import { HealthController } from './health.controller';

@Module({
  imports: [BackupModule],
  controllers: [HealthController],
})
export class HealthModule {}
