import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config';

/**
 * API Key Authentication Middleware.
 * Compares provided Bearer / X-API-Key against configured secret using
 * crypto.timingSafeEqual to defend against side-channel timing attacks.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  // If no API key is configured
  if (!config.apiKey) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(500).json({
        error: 'Server misconfiguration: EVENTRELAY_API_KEY is not configured in production.'
      });
    }
    return next(); // Unauthenticated bypass permitted only in non-production environments
  }

  const authHeader = req.header('Authorization');
  const apiKeyHeader = req.header('X-API-Key');

  let providedKey: string | null = null;
  if (apiKeyHeader) {
    providedKey = apiKeyHeader.trim();
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7).trim();
  }

  if (!providedKey) {
    return res.status(401).json({
      error: 'Unauthorized. Missing required API key via X-API-Key or Bearer token.'
    });
  }

  const expectedKeyBuffer = Buffer.from(config.apiKey);
  const providedKeyBuffer = Buffer.from(providedKey);

  if (expectedKeyBuffer.length !== providedKeyBuffer.length ||
      !crypto.timingSafeEqual(expectedKeyBuffer, providedKeyBuffer)) {
    return res.status(403).json({
      error: 'Forbidden. Invalid API key provided.'
    });
  }

  next();
}
