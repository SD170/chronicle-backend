// global.d.ts
declare namespace NodeJS {
  interface ProcessEnv {
    PORT: string;
    MONGO_URI: string;
    SUPERMEMORY_BASE_URL: string;
    SUPERMEMORY_API_KEY: string;
  }
}
declare const fetch: typeof globalThis.fetch;
