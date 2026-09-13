import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config';

/**
 * Enterprise API Key Authentication Middleware.
 * Compares provided Bearer / X-API-Key against configured secret using
 * crypto.timingSafeEqual to defend against side-channel timing attacks.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  // If no API key is enforced in environment (e.g. local open demo mode), allow request
  if (!config.apiKey) {
    return next();
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
