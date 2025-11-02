// src/logger.ts
import winston from 'winston';
import { mkdirSync } from 'fs';

// Ensure logs directory exists
try {
  mkdirSync('logs', { recursive: true });
} catch (e) {
  // Directory might already exist
}

// Simple console format
const consoleFormat = winston.format.printf((info) => {
  const { timestamp, level, message, ...meta } = info;
  let msg = `${timestamp} ${level}: ${message}`;
  // Only add metadata if it exists and isn't just the default service meta
  const metaKeys = Object.keys(meta).filter(k => k !== 'service');
  if (metaKeys.length > 0) {
    const cleanMeta: any = {};
    metaKeys.forEach(k => cleanMeta[k] = meta[k]);
    msg += ` ${JSON.stringify(cleanMeta)}`;
  }
  return msg;
});

// File format with more details
const fileFormat = winston.format.printf((info) => {
  const { timestamp, level, message, stack, ...meta } = info;
  let msg = `${timestamp} [${level}]: ${stack || message}`;
  if (Object.keys(meta).length > 0) {
    msg += ` ${JSON.stringify(meta)}`;
  }
  return msg;
});

// Create logger with explicit console transport
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true })
  ),
  transports: [
    // Console transport - always first, always enabled
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        consoleFormat
      ),
      silent: false, // Explicitly enable console output
      handleExceptions: true,
      handleRejections: true,
      stderrLevels: ['error'],
    }),
    // File transport for errors
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      format: fileFormat,
      maxsize: 5242880,
      maxFiles: 5,
    }),
    // File transport for all logs
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      format: fileFormat,
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
  exceptionHandlers: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        consoleFormat
      )
    }),
    new winston.transports.File({ filename: 'logs/exceptions.log', format: fileFormat })
  ],
  rejectionHandlers: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        consoleFormat
      )
    }),
    new winston.transports.File({ filename: 'logs/rejections.log', format: fileFormat })
  ],
});

