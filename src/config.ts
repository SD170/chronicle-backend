import 'dotenv/config';

export const ENV = {
  PORT: Number(process.env.PORT ?? 7769),
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/echorun',
  SUPERMEMORY_BASE_URL: process.env.SUPERMEMORY_BASE_URL || '',
  SUPERMEMORY_API_KEY: process.env.SUPERMEMORY_API_KEY || '',
  GAME_ID: process.env.GAME_ID || 'echorun'
};
