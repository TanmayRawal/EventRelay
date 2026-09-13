import { Request, Response, NextFunction } from 'express';
import { requireApiKey } from '../src/middleware/auth';
import { config } from '../src/config';

describe('requireApiKey Middleware (Authentication Boundary)', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;
  let originalApiKey: string | null;

  beforeEach(() => {
    originalApiKey = config.apiKey;
    config.apiKey = 'er_test_api_key_secure_123';
    mockRequest = {
      header: jest.fn()
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    nextFunction = jest.fn();
  });

  afterEach(() => {
    config.apiKey = originalApiKey;
    jest.clearAllMocks();
  });

  it('should reject requests with 401 when no API key header is provided', () => {
    (mockRequest.header as jest.Mock).mockReturnValue(undefined);

    requireApiKey(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Missing required API key') })
    );
    expect(nextFunction).not.toHaveBeenCalled();
  });

  it('should reject requests with 403 when an invalid X-API-Key is provided', () => {
    (mockRequest.header as jest.Mock).mockImplementation((headerName: string) => {
      if (headerName === 'X-API-Key') return 'wrong_api_key';
      return undefined;
    });

    requireApiKey(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Invalid API key') })
    );
    expect(nextFunction).not.toHaveBeenCalled();
  });

  it('should reject requests with 403 when key length does not match without timing crash', () => {
    (mockRequest.header as jest.Mock).mockImplementation((headerName: string) => {
      if (headerName === 'X-API-Key') return 'short';
      return undefined;
    });

    requireApiKey(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(nextFunction).not.toHaveBeenCalled();
  });

  it('should accept requests when valid X-API-Key is provided', () => {
    (mockRequest.header as jest.Mock).mockImplementation((headerName: string) => {
      if (headerName === 'X-API-Key') return 'er_test_api_key_secure_123';
      return undefined;
    });

    requireApiKey(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(nextFunction).toHaveBeenCalled();
    expect(mockResponse.status).not.toHaveBeenCalled();
  });

  it('should accept requests when valid Authorization: Bearer token is provided', () => {
    (mockRequest.header as jest.Mock).mockImplementation((headerName: string) => {
      if (headerName === 'Authorization') return 'Bearer er_test_api_key_secure_123';
      return undefined;
    });

    requireApiKey(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(nextFunction).toHaveBeenCalled();
    expect(mockResponse.status).not.toHaveBeenCalled();
  });

  it('should reject non-Bearer Authorization schemes with 401', () => {
    (mockRequest.header as jest.Mock).mockImplementation((headerName: string) => {
      if (headerName === 'Authorization') return 'Basic dXNlcjpwYXNz';
      return undefined;
    });

    requireApiKey(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(nextFunction).not.toHaveBeenCalled();
  });

  it('should allow requests through if config.apiKey is not set (open bypass mode)', () => {
    config.apiKey = null;
    (mockRequest.header as jest.Mock).mockReturnValue(undefined);

    requireApiKey(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(nextFunction).toHaveBeenCalled();
    expect(mockResponse.status).not.toHaveBeenCalled();
  });
});
