import 'dotenv/config';

// Parse API keys from env (comma-separated string)
const parseApiKeys = (): string[] => {
  const keysStr = process.env.API_KEYS || '';
  if (!keysStr.trim()) {
    return [];
  }
  // Split by comma and trim whitespace, filter out empty strings
  return keysStr
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0);
};

export const ENV = {
  PORT: Number(process.env.PORT ?? 7769),
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/echorun',
  SUPERMEMORY_BASE_URL: process.env.SUPERMEMORY_BASE_URL || '',
  SUPERMEMORY_API_KEY: process.env.SUPERMEMORY_API_KEY || '',
  GAME_ID: process.env.GAME_ID || 'echorun',
  API_KEYS: parseApiKeys(),
};
