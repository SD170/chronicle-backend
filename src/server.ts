// src/server.ts (only showing the parts that change)
import express from "express";
import { ENV } from "./config.ts";
import { connectMongo } from "./mongo.ts";
import { RunModel } from "./models/Run.model.ts";
import { ServerInputZ } from "./types.ts";
import type { ServerInput, Traits, PersonaSnapshot, Mode } from "./types.ts";
import { computeTraits, personaText, topSignals } from "./traitEngine.ts";
import { computeKnobs } from "./policyService.ts";
import { SupermemoryStore } from "./memory/SupermemoryStore.ts";
import { logger } from "./logger.ts";
import { logApiCall } from "./debugLogger.ts";
import { requireApiKey } from "./middleware/auth.ts";

const app = express();

// Parse JSON first so we can access req.body in logging middleware
app.use(express.json({ limit: "1mb" }));

// Logging middleware - log all incoming requests (after JSON parsing)
app.use((req, res, next) => {
  const start = Date.now();
  let responseBody: any = null;
  
  // Log request start
  logger.info(`→ ${req.method} ${req.path}`, {
    method: req.method,
    path: req.path,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    body: req.method === 'POST' && req.body ? {
      hasServerInput: !!req.body.serverInput,
      player_id: req.body.serverInput?.player_id,
      run_index: req.body.serverInput?.run_index,
    } : undefined,
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.get('user-agent'),
  });
  
  const originalSend = res.send;
  
  res.send = function(body) {
    const duration = Date.now() - start;
    
    // Try to parse response body for debugging
    try {
      if (typeof body === 'string') {
        responseBody = JSON.parse(body);
      } else {
        responseBody = body;
      }
    } catch {
      responseBody = body;
    }
    
    // Log response
    logger.info(`← ${req.method} ${req.path} ${res.statusCode}`, {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
    });
    
    // Save to debug log file
    logApiCall({
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      query: Object.keys(req.query).length > 0 ? (req.query as Record<string, any>) : undefined,
      requestBody: req.method === 'POST' ? req.body : undefined,
      responseStatus: res.statusCode,
      responseBody: responseBody,
      duration: duration,
      ip: req.ip || req.socket.remoteAddress?.toString(),
    });
    
    return originalSend.call(this, body);
  };
  
  // Log errors
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      logger.warn(`${req.method} ${req.path} ${res.statusCode}`, {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: `${Date.now() - start}ms`,
      });
    }
  });
  
  next();
});

const memory = new SupermemoryStore();

// Health check endpoint (public, no auth required)
app.get('/health', (req, res) => {
  logger.debug('Health check requested');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API key authentication middleware - applies to all routes except /health
app.use((req, res, next) => {
  // Skip auth for health check
  if (req.path === '/health') {
    return next();
  }
  return requireApiKey(req, res, next);
});

// --- Supermemory v3 routes (generic, filterable) ---

// POST /sm/save
// Body: { serverInput, game_id?: string, genres?: string[], platforms?: string[] }
// Requires: X-API-Key header
app.post('/sm/save', async (req, res) => {
    try {
      const { serverInput } = req.body || {};
      if (!serverInput) {
        logger.warn('POST /sm/save: Missing serverInput in request body');
        return res.status(400).json({ error: 'serverInput required' });
      }

      logger.info('POST /sm/save', {
        player_id: serverInput.player_id,
        run_index: serverInput.run_index,
        game_id: serverInput.game_context?.game_id,
      });
  
      // new context extraction
      const ctx = serverInput.game_context || {};
      const game_id = ctx.game_id;
      const genres = Array.isArray(ctx.genre_ids) ? ctx.genre_ids : [];
      const platforms = Array.isArray(ctx.platform_ids) ? ctx.platform_ids : [];
  
      const result = await memory.saveFromServerInput(serverInput, {
        game_id,
        genres,
        platforms,
        extraMeta: {
          completed_at: serverInput.completed_at,
          build_version: ctx.build_version,
          game_title: ctx.game_title,
        },
      });

      logger.info('POST /sm/save: Success', {
        player_id: serverInput.player_id,
        user_node: result.user_node,
        memories_created: result.memories_created,
      });
  
      res.json(result);
  } catch (e: any) {
      logger.error('POST /sm/save: Error', {
        error: e.message,
        stack: e.stack,
      });
      res.status(502).json({
        error: 'supermemory_save_failed',
        message: e.message,
      });
    }
  });
  
  
  // Helper function to create default gameInput structure
  function createDefaultGameInput(player_id: string, game_id?: string, genre_id?: string, platform_id?: string) {
    const now = new Date().toISOString();
    const defaultTraits = {
      aggression: 0.5,
      stealth: 0.5,
      curiosity: 0.5,
      puzzle_affinity: 0.5,
      independence: 0.5,
      resilience: 0.5,
      goal_focus: 0.5,
    };

    const persona: any = {
      global: {
        traits: defaultTraits,
        persona_text: "New player - default balanced traits",
        top_signals: [],
        source: {
          provider: "default",
          snapshot_at: now
        }
      }
    };

    // Add game-specific persona if game_id provided
    if (game_id) {
      persona.game = {
        [game_id]: {
          traits: defaultTraits,
          persona_text: "New player - default balanced traits",
          top_signals: [],
          source: {
            provider: "default",
            snapshot_at: now
          }
        }
      };
    }

    // Add genre-specific persona if genre_id provided
    if (genre_id) {
      persona.genre = {
        [genre_id]: {
          traits: defaultTraits,
          persona_text: "New player - default balanced traits",
          top_signals: [],
          source: {
            provider: "default",
            snapshot_at: now
          }
        }
      };
    }

    // Add platform-specific persona if platform_id provided
    if (platform_id) {
      persona.platform = {
        [platform_id]: {
          traits: defaultTraits,
          persona_text: "New player - default balanced traits",
          top_signals: [],
          source: {
            provider: "default",
            snapshot_at: now
          }
        }
      };
    }

    return {
      schema_version: "1.0",
      player_id,
      game_id: game_id || null,
      generated_at: now,
      persona
    };
  }

  // GET /sm/personas?player_id=...&scope=global|genre|platform|game|any&game_id=...&genre_id=...&platform_id=...&limit=10
  app.get('/sm/personas', async (req, res) => {
    try {
      const player_id = String(req.query.player_id || '');
      if (!player_id) {
        logger.warn('GET /sm/personas: Missing player_id in query');
        return res.status(400).json({ error: 'player_id required' });
      }

      const scope = (req.query.scope as any) || 'any';
      const game_id = req.query.game_id as string | undefined;
      const genre_id = req.query.genre_id as string | undefined;
      const platform_id = req.query.platform_id as string | undefined;

      logger.debug('GET /sm/personas', {
        player_id,
        scope,
        game_id,
        genre_id,
        platform_id,
        limit: req.query.limit,
      });

      const result = await memory.fetchByFilters({
        player_id,
        scope,
        ...(game_id && { game_id }),
        ...(genre_id && { genre_id }),
        ...(platform_id && { platform_id }),
        limit: req.query.limit ? Number(req.query.limit) : 10,
        includeContent: true
      });

      // If no personas found, return default gameInput structure
      if (result.total === 0 || !result.items || result.items.length === 0) {
        logger.info('GET /sm/personas: No personas found, returning default', {
          player_id,
          game_id,
          genre_id,
          platform_id,
        });

        const defaultGameInput = createDefaultGameInput(player_id, game_id, genre_id, platform_id);
        return res.json({
          total: 0,
          items: [],
          default: defaultGameInput,
          message: "No personas found for this player. Returning default gameInput structure."
        });
      }

      logger.info('GET /sm/personas: Success', {
        player_id,
        total: result.total,
        items_count: result.items?.length || 0,
      });

      res.json(result);
    } catch (e:any) {
      logger.error('GET /sm/personas: Error', {
        error: e.message,
        stack: e.stack,
        player_id: req.query.player_id,
      });
      res.status(502).json({ error: 'supermemory_fetch_failed', message: e.message });
    }
  });
  
  // GET /sm/doc/:id
  app.get('/sm/doc/:id', async (req, res) => {
    try {
      const id = req.params.id;
      logger.debug('GET /sm/doc/:id', { document_id: id });
      const doc = await memory.fetchDocumentById(id);
      logger.info('GET /sm/doc/:id: Success', { document_id: id });
      res.json(doc);
    } catch (e:any) {
      logger.error('GET /sm/doc/:id: Error', {
        error: e.message,
        stack: e.stack,
        document_id: req.params.id,
      });
      res.status(502).json({ error: 'supermemory_doc_failed', message: e.message });
    }
  });
  

// app.post("/events", async (req, res) => {
//   const parsed = ServerInputZ.safeParse(req.body);
//   if (!parsed.success) {
//     return res.status(400).json({
//       error: "invalid_payload",
//       details: parsed.error.flatten(),
//     });
//   }
//   const p: ServerInput = parsed.data;

//   await RunModel.create({
//     player_id: p.player_id,
//     session_id: p.session_id,
//     run_index: p.run_index,
//     completed_at: p.completed_at,
//     result: p.run_outcome.result,
//     path: p.run_outcome.path,
//     stats_json: p.stats,
//     config_json: p.config_used,
//     events_digest: p.events_digest ?? [],
//   });

//   let prevTraits: Traits | undefined;
//   try {
//     const prev = await memory.getPersona(p.player_id);
//     prevTraits = prev?.traits;
//   } catch (e: any) {
//     console.error("Supermemory getPersona failed:", e.message);
//   }

//   const traits = computeTraits(p.stats, prevTraits);
//   const text = personaText(traits);
//   const signals = topSignals(p.stats);
//   const snap: PersonaSnapshot = {
//     player_id: p.player_id,
//     traits,
//     persona_text: text,
//     top_signals: signals,
//     updated_at: new Date().toISOString(),
//   };

//   try {
//     await memory.setPersona(snap);
//   } catch (e: any) {
//     console.error("Supermemory setPersona failed:", e.message);
//     return res.status(502).json({ error: "supermemory_write_failed" });
//   }

//   return res.status(202).json({ ok: true });
// });

// app.get("/persona/:player_id", async (req, res) => {
//   try {
//     const snap = await memory.getPersona(req.params.player_id);
//     if (!snap) return res.status(404).json({ error: "not_found" });
//     return res.json(snap);
//   } catch (e: any) {
//     return res
//       .status(502)
//       .json({ error: "supermemory_read_failed", message: e.message });
//   }
// });

// app.get("/next-run/knobs", async (req, res) => {
//   const player_id = String(req.query.player_id ?? "");
//   const mode: Mode =
//     String(req.query.mode ?? "fun") === "challenge" ? "challenge" : "fun";
//   const rawIntensity = Number(req.query.intensity);
//   const intensity = Number.isFinite(rawIntensity) ? rawIntensity : 0.5;

//   try {
//     const snap = await memory.getPersona(player_id);
//     const traits =
//       snap?.traits ?? {
//         aggression: 0,
//         stealth: 0,
//         curiosity: 0,
//         puzzle_affinity: 0,
//         independence: 0,
//         resilience: 0,
//         goal_focus: 0,
//       };
//     const knobs = computeKnobs(traits, mode, intensity);
//     return res.json(knobs);
//   } catch (e: any) {
//     return res
//       .status(502)
//       .json({ error: "supermemory_read_failed", message: e.message });
//   }
// });

// Start server
async function start() {
  try {
    await connectMongo();
    app.listen(ENV.PORT, () => {
      logger.info(`Server listening on port ${ENV.PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

start();
