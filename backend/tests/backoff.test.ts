import { calculateFullJitterDelay } from '../src/resilience/backoff';

describe('calculateFullJitterDelay', () => {
  it('should return a delay between 1 and the exponential ceiling', () => {
    const baseSeconds = 2;
    const maxSeconds = 60;

    for (let attempt = 1; attempt <= 5; attempt++) {
      const delay = calculateFullJitterDelay(attempt, { baseSeconds, maxSeconds });
      const maxPossible = Math.min(maxSeconds, baseSeconds * Math.pow(2, attempt - 1));

      expect(delay).toBeGreaterThanOrEqual(1);
      expect(delay).toBeLessThanOrEqual(maxPossible + 1);
    }
  });

  it('should respect the maxSeconds cap', () => {
    const maxSeconds = 30;
    for (let i = 0; i < 50; i++) {
      const delay = calculateFullJitterDelay(10, { baseSeconds: 2, maxSeconds });
      expect(delay).toBeLessThanOrEqual(maxSeconds);
    }
  });
});
