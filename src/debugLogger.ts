// src/debugLogger.ts
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from './logger.ts';

const DEBUG_DIR = 'debug';

// Ensure debug directory exists
try {
  mkdirSync(DEBUG_DIR, { recursive: true });
} catch (e) {
  // Directory might already exist
}

interface DebugLogEntry {
  timestamp: string;
  method: string;
  path: string;
  query?: Record<string, any> | undefined;
  requestBody?: any;
  responseStatus: number;
  responseBody?: any;
  duration: number;
  ip?: string | undefined;
}

export function logApiCall(entry: DebugLogEntry) {
  try {
    // Create filename with timestamp to make each file unique
    // Format: api_YYYY-MM-DDTHH-MM-SS-SSS.json
    const timestamp = entry.timestamp.replace(/:/g, '-').replace(/\./g, '-');
    const filename = join(DEBUG_DIR, `api_${timestamp}.json`);
    
    // Write as formatted JSON (not JSONL)
    writeFileSync(filename, JSON.stringify(entry, null, 2), 'utf8');
  } catch (error) {
    logger.error('Failed to write debug log', { error });
  }
}

