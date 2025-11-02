// src/middleware/auth.ts
import type { Request, Response, NextFunction } from 'express';
import { ENV } from '../config.ts';
import { logger } from '../logger.ts';

/**
 * Middleware to check API key authentication
 * Checks for API key in:
 * - X-API-Key header (preferred)
 * - Authorization: Bearer <key> header
 * - x-api-key header (case-insensitive fallback)
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  // Get API key from headers
  const apiKey = 
    req.headers['x-api-key'] || 
    req.headers['X-API-Key'] ||
    (req.headers.authorization?.startsWith('Bearer ') 
      ? req.headers.authorization.substring(7) 
      : null);

  if (!apiKey || typeof apiKey !== 'string') {
    logger.warn('API key missing', {
      path: req.path,
      method: req.method,
      ip: req.ip || req.socket.remoteAddress,
    });
    return res.status(401).json({
      error: 'unauthorized',
      message: 'API key required. Provide via X-API-Key header or Authorization: Bearer <key>',
    });
  }

  // Check if API key is valid
  const validKeys = ENV.API_KEYS;
  if (!validKeys || validKeys.length === 0) {
    logger.error('No API keys configured in environment');
    return res.status(500).json({
      error: 'server_configuration_error',
      message: 'API keys not configured',
    });
  }

  if (!validKeys.includes(apiKey)) {
    logger.warn('Invalid API key', {
      path: req.path,
      method: req.method,
      ip: req.ip || req.socket.remoteAddress,
      keyPrefix: apiKey.substring(0, 8) + '...',
    });
    return res.status(403).json({
      error: 'forbidden',
      message: 'Invalid API key',
    });
  }

  // API key is valid, continue
  logger.debug('API key validated', {
    path: req.path,
    keyPrefix: apiKey.substring(0, 8) + '...',
  });
  next();
}

