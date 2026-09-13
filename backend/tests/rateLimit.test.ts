import { Request, Response, NextFunction } from 'express';
import { inboundRateLimiter } from '../src/middleware/rateLimit';
import { redis } from '../src/redis/client';
import { metrics } from '../src/metrics/prometheus';

jest.mock('../src/redis/client', () => ({
  redis: {
    eval: jest.fn()
  }
}));

jest.mock('../src/metrics/prometheus', () => ({
  metrics: {
    incRateLimiterError: jest.fn()
  }
}));

describe('inboundRateLimiter (Distributed Ingestion Throttle)', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = {
      header: jest.fn().mockReturnValue('test-api-key-caller'),
      ip: '127.0.0.1'
    };
    mockResponse = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    nextFunction = jest.fn();
    jest.clearAllMocks();
  });

  it('should permit request when Redis token quota is available', async () => {
    (redis.eval as jest.Mock).mockResolvedValueOnce([1, 199]);

    await inboundRateLimiter(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '200');
    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '199');
    expect(nextFunction).toHaveBeenCalled();
    expect(mockResponse.status).not.toHaveBeenCalled();
  });

  it('should reject request with HTTP 429 when Redis tokens are exhausted', async () => {
    (redis.eval as jest.Mock).mockResolvedValueOnce([0, 0]);

    await inboundRateLimiter(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.setHeader).toHaveBeenCalledWith('Retry-After', '1');
    expect(mockResponse.status).toHaveBeenCalledWith(429);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('rate limit exceeded') })
    );
    expect(nextFunction).not.toHaveBeenCalled();
  });

  it('should gracefully degrade to in-memory bucket when Redis errors', async () => {
    (redis.eval as jest.Mock).mockRejectedValueOnce(new Error('Redis connection timed out'));

    await inboundRateLimiter(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(metrics.incRateLimiterError).toHaveBeenCalled();
    expect(nextFunction).toHaveBeenCalled();
    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '200');
  });
});
