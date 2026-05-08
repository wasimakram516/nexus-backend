import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns health data', () => {
    const controller = new HealthController();
    const result = controller.getHealth();

    expect(result.message).toBe('Health check completed');
    expect(result.data.uptime).toBeGreaterThanOrEqual(0);
    expect(result.data.timestamp).toBeDefined();
  });
});
