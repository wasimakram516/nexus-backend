import { BackupService } from '../backup/backup.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const backups = { status: jest.fn(), isHealthy: jest.fn() };
  const controller = new HealthController(backups as unknown as BackupService);

  it('returns health data', () => {
    const result = controller.getHealth();

    expect(result.message).toBe('Health check completed');
    expect(result.data.uptime).toBeGreaterThanOrEqual(0);
    expect(result.data.timestamp).toBeDefined();
  });

  describe('getBackups', () => {
    it('says only that backups are off, with no verdict, while they are off', async () => {
      backups.status.mockResolvedValue({ enabled: false, tiers: [] });

      const { data } = await controller.getBackups();

      expect(data).toEqual({ enabled: false, healthy: null, tiers: [] });
      expect(backups.isHealthy).not.toHaveBeenCalled();
    });

    it('shows when each tier was last taken, and leaves out sizes and errors', async () => {
      backups.status.mockResolvedValue({
        enabled: true,
        totalSizeBytes: 999,
        lastError: { jobName: 'x', reason: 'secret detail', at: 'now' },
        tiers: [
          {
            tier: 'daily',
            count: 3,
            latestAt: '2026-10-28T23:30:00.000Z',
            latestSizeBytes: 123,
          },
        ],
      });
      backups.isHealthy.mockReturnValue(true);

      const { data } = await controller.getBackups();

      expect(data).toEqual({
        enabled: true,
        healthy: true,
        tiers: [{ tier: 'daily', latestAt: '2026-10-28T23:30:00.000Z' }],
      });
      expect(JSON.stringify(data)).not.toContain('secret detail');
    });
  });
});
