// src/utils/generateApiKey.ts
import { randomBytes } from 'crypto';

/**
 * Generate a secure random API key
 * Format: chk_<32 bytes hex> = 67 characters total
 */
export function generateApiKey(): string {
  const randomPart = randomBytes(32).toString('hex');
  return `chk_${randomPart}`;
}

/**
 * CLI utility to generate API keys
 * Usage: npx tsx src/utils/generateApiKey.ts
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const key = generateApiKey();
  console.log('\n🔑 Generated API Key:');
  console.log(key);
  console.log('\n📋 Add this to your .env file:');
  console.log(`API_KEYS=${key}`);
  console.log('\n💡 For multiple keys, comma-separate them:');
  console.log(`API_KEYS=${key},chk_another_key_here`);
  console.log('');
}

