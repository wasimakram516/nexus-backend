import { Controller, Get, Version } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
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
}
