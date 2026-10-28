import { Controller, Get, Version } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BackupService } from '../backup/backup.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly backups: BackupService) {}

  @Get()
  @Version('1')
  @ApiOperation({
    summary: 'Get service health',
    description:
      'Lightweight health endpoint for uptime and readiness checks used by monitoring and deployment verification.',
  })
  getHealth() {
    return {
      message: 'Health check completed',
      data: {
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      },
    };
  }

  @Get('backups')
  @Version('1')
  @ApiOperation({
    summary: 'Get backup freshness',
    description:
      'For uptime monitoring: whether backups are on, whether they are fresh, and when the newest backup of each tier was taken. Sizes and error details are not shown here.',
  })
  async getBackups() {
    const status = await this.backups.status();
    return {
      message: 'Backup health retrieved',
      data: {
        enabled: status.enabled,
        healthy: status.enabled
          ? this.backups.isHealthy(status, new Date())
          : null,
        tiers: status.tiers.map(({ tier, latestAt }) => ({ tier, latestAt })),
      },
    };
  }
}
