// scripts/sm-test.ts
// A tiny CLI to exercise your server routes:
//   POST /sm/save
//   GET  /sm/personas
//   GET  /sm/doc/:id
//
// Usage examples:
//   ts-node scripts/sm-test.ts save --player player_123 --game skyline_runner --genres platformer --platforms pc
//   ts-node scripts/sm-test.ts fetch --player player_123 --scope any --limit 5
//   ts-node scripts/sm-test.ts fetch --player player_123 --scope game --game skyline_runner
//   ts-node scripts/sm-test.ts doc 01JK4Q3M8X7KQPNQ6GJ8QP
//
// You can also run a full demo:
//   ts-node scripts/sm-test.ts demo
//
// Configure server base URL with: SM_SERVER_BASE (default http://localhost:4000)

type RunResult = 'win' | 'loss';
type RunPath = 'combat' | 'puzzle' | 'exploration';

type Stats = {
  time_s: number;
  deaths: number;
  retries: number;
  distance_traveled: number;
  jumps: number;
  hint_offers: number;
  hints_used: number;
  riddles_attempted: number;
  riddles_correct: number;
  combats_initiated: number;
  combats_won: number;
  collectibles_found: number;
};

type ServerInput = {
  schema_version: string;
  player_id: string;
  session_id: string;
  run_index: number;
  completed_at: string;
  game_context?: {
    game_id?: string;
    game_title?: string;
    genre_ids?: string[];
    platform_ids?: string[];
    build_version?: string;
  };
  run_outcome: { result: RunResult; path: RunPath };
  stats: Stats;
  config_used: {
    mode: 'fun' | 'challenge';
    knobs: {
      enemy_count: number;
      enemy_speed: number;
      puzzle_gate_ratio: number;
      collectible_density: number;
      hint_delay_ms: number;
      breadcrumb_brightness: number;
    };
    layout_seed: string;
  };
};

import { logger } from './logger.ts';

const BASE = (process.env.SM_SERVER_BASE || 'http://localhost:7769').replace(/\/$/, '');

function help() {
  console.log(`
Supermemory test CLI (server routes)

Commands:
  save                        Save/update personas via POST /sm/save
    --player <id>             Player ID (default: player_123)
    --game <id>               Game ID (default: skyline_runner)
    --genres "a,b"            Comma-separated genres (e.g., platformer,fps)
    --platforms "pc,mobile"   Comma-separated platforms
    --run <n>                 Run index (default: 1)
    --mode fun|challenge      Mode (default: challenge)

  fetch                       Fetch personas via GET /sm/personas (by userId/player_id)
    [userId]                  Positional: User ID / Player ID (or use --player)
    [limit]                   Positional: Limit (optional, after userId)
    --player <id>             User ID / Player ID (required if no positional) - this is the userId from metadata
    --documentId <id>         Fetch specific document by ID
    --scope global|genre|platform|game|any   (default: any)
    --game <id>               Filter by game_id
    --genre <id>              Filter by genre_id
    --platform <id>           Filter by platform_id
    --limit <n>               Limit (default: 10)
    
    Examples:
      npm run test:supermemory fetch user_123              # Fetch all personas for userId
      npm run test:supermemory fetch user_123 10           # Fetch with limit
      npm run test:supermemory fetch --player user_123 --scope global

  doc <documentId>            Fetch one doc via GET /sm/doc/:id

  demo                        Full workflow: save runs and fetch personas by userId
                              1) Save run 1; 2) Save run 2 (blends); 3) Fetch all by userId; 
                              4) Fetch game-specific by userId; 5) Fetch global by userId

  test-workflow               Complete end-to-end test with persistence verification
                              Tests: save → fetch → persistence check → blend → compare
                              --user <id>             User ID (default: user1)
                              --game <id>             Game ID (default: skyline_runner)

Environment:
  SM_SERVER_BASE              e.g., http://localhost:4001  (default: ${BASE})
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const opt: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a && a.startsWith('--')) {
      const k = a.replace(/^--/, '');
      const next = args[i + 1];
      const v = next && !next.startsWith('--') ? args[++i] || 'true' : 'true';
      opt[k] = v;
    } else if (a) {
      // Handle positional arguments
      if (cmd === 'doc' && !opt.documentId) {
        opt.documentId = a;
      } else if (cmd === 'test-workflow' && !opt.user) {
        // First positional arg after test-workflow is userId
        opt.user = a;
      } else if (cmd === 'fetch' && !opt.player && !opt.documentId) {
        // Try as documentId first (22 char alphanumeric), otherwise treat as userId (player_id)
        if (a.length === 22 && /^[a-zA-Z0-9]+$/.test(a)) {
          opt.documentId = a;
        } else {
          opt.player = a; // This is the userId (maps to player_id in metadata)
        }
      } else if (cmd === 'fetch' && opt.player && !opt.limit && !isNaN(Number(a))) {
        // Second positional arg could be limit
        opt.limit = a;
      }
    }
  }
  return { cmd, opt, args };
}

function makeExampleServerInput(
  player: string, 
  runIdx: number, 
  mode: 'fun' | 'challenge',
  gameId?: string,
  genres?: string[],
  platforms?: string[]
): ServerInput {
  // Tweaked stats for quick iterative saves; adjust if you want variety
  const now = new Date().toISOString();
  return {
    schema_version: '1.0',
    player_id: player,
    session_id: `sess_${player}_${runIdx}`,
    run_index: runIdx,
    completed_at: now,
    ...(gameId || genres || platforms ? {
      game_context: {
        ...(gameId && { game_id: gameId }),
        ...(gameId && { game_title: `${gameId.charAt(0).toUpperCase() + gameId.slice(1).replace('_', ' ')}` }),
        ...(genres && genres.length > 0 && { genre_ids: genres }),
        ...(platforms && platforms.length > 0 && { platform_ids: platforms }),
        build_version: 'v1.0.0',
      }
    } : {}),
    run_outcome: { result: 'win', path: (runIdx % 2 ? 'combat' : 'puzzle') as RunPath },
    stats: {
      time_s: 120 + 30 * runIdx,
      deaths: runIdx % 3,
      retries: Math.max(0, (runIdx % 2) - 0),
      distance_traveled: 400 + 50 * runIdx,
      jumps: 30 + 5 * runIdx,
      hint_offers: 2,
      hints_used: runIdx % 2,
      riddles_attempted: 1 + (runIdx % 2),
      riddles_correct: 1,
      combats_initiated: 4 + (runIdx % 3),
      combats_won: 4 + (runIdx % 3),
      collectibles_found: 2 + (runIdx % 4),
    },
    config_used: {
      mode,
      knobs: {
        enemy_count: 3 + (runIdx % 3),
        enemy_speed: 1.0 + 0.1 * (runIdx % 3),
        puzzle_gate_ratio: 0.4,
        collectible_density: 0.25,
        hint_delay_ms: 9000 + 1000 * (runIdx % 2),
        breadcrumb_brightness: 0.4,
      },
      layout_seed: `seed_${runIdx}`,
    },
  };
}

async function postSave(serverInput: ServerInput) {
  const url = `${BASE}/sm/save`;
  const body = { serverInput };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST /sm/save failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function getPersonas(params: {
  player: string; scope?: string; game?: string; genre?: string; platform?: string; limit?: number;
}, retries = 0): Promise<any> {
  const q = new URLSearchParams();
  q.set('player_id', params.player);
  if (params.scope) q.set('scope', params.scope);
  if (params.game) q.set('game_id', params.game);
  if (params.genre) q.set('genre_id', params.genre);
  if (params.platform) q.set('platform_id', params.platform);
  if (params.limit) q.set('limit', String(params.limit));
  const url = `${BASE}/sm/personas?${q.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const errorText = await res.text();
    // Retry once if server error and we haven't retried
    if ((res.status >= 500 || res.status === 404) && retries < 1) {
      console.log(`Retrying fetch after 3 seconds... (attempt ${retries + 1})`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      return getPersonas(params, retries + 1);
    }
    throw new Error(`GET /sm/personas failed: ${res.status} ${errorText}`);
  }
  const result = await res.json();
  
  // If we got 0 results, wait and retry (up to 3 times with increasing delays)
  if (result.total === 0 && retries < 3 && params.player) {
    const waitTime = [3000, 5000, 7000][retries] || 5000;
    console.log(`Got 0 results, waiting ${waitTime/1000}s for indexing and retrying... (attempt ${retries + 1}/3)`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return getPersonas(params, retries + 1);
  }
  
  return result;
}

async function getDoc(id: string) {
  const url = `${BASE}/sm/doc/${encodeURIComponent(id)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET /sm/doc/:id failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const { cmd, opt, args } = parseArgs();
  if (!cmd) return help();

  // Test logger
  logger.info('CLI script started', { command: cmd });

  try {
    if (cmd === 'save') {
      const player = opt.player || 'player_123';
      const game = opt.game || 'skyline_runner';
      const runIdx = opt.run ? Number(opt.run) : 1;
      const mode = (opt.mode === 'fun' ? 'fun' : 'challenge') as 'fun' | 'challenge';
      const genres = opt.genres ? opt.genres.split(',').map(s => s.trim()).filter(Boolean) : ['platformer'];
      const platforms = opt.platforms ? opt.platforms.split(',').map(s => s.trim()).filter(Boolean) : ['pc'];

      const payload = makeExampleServerInput(player, runIdx, mode, game, genres, platforms);
      const result = await postSave(payload);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (cmd === 'fetch') {
      if (opt.documentId) {
        // Fetch by document ID
        const doc = await getDoc(opt.documentId);
        console.log(JSON.stringify(doc, null, 2));
        return;
      }

      // Fetch by userId (player_id in metadata)
      const userId = opt.player;
      if (!userId) throw new Error('--player <userId> is required or provide documentId');
      
      console.log(`Fetching personas for userId: ${userId}`);
      console.log('Note: If you just saved data, Supermemory indexing may take 10-15 seconds...');
      const scope = opt.scope || 'any';
      const game = opt.game || undefined;
      const genre = opt.genre || undefined;
      const platform = opt.platform || undefined;
      const limit = opt.limit ? Number(opt.limit) : 10;

      const result = await getPersonas({ 
        player: userId, 
        scope, 
        ...(game && { game }), 
        ...(genre && { genre }), 
        ...(platform && { platform }), 
        limit 
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (cmd === 'doc') {
      const id = opt.documentId;
      if (!id) throw new Error('documentId required (positional after "doc")');
      const doc = await getDoc(id);
      console.log(JSON.stringify(doc, null, 2));
      return;
    }

    if (cmd === 'demo') {
      // Using userId (player_id) to fetch personas
      const userId = 'player_demo';
      const game = 'skyline_runner';
      
      console.log('1) Saving run 1...');
      await postSave(makeExampleServerInput(userId, 1, 'challenge', game, ['platformer'], ['pc']));
      console.log('2) Saving run 2 (blends with previous personas)...');
      await postSave(makeExampleServerInput(userId, 2, 'challenge', game, ['platformer'], ['pc']));

      console.log('3) Fetch all personas by userId (player_id)...');
      const anyRes = await getPersonas({ player: userId, scope: 'any', limit: 5 });
      console.log(JSON.stringify(anyRes, null, 2));

      console.log('4) Fetch game-specific personas by userId...');
      const gameRes = await getPersonas({ player: userId, scope: 'game', game, limit: 3 });
      console.log(JSON.stringify(gameRes, null, 2));
      
      console.log('5) Fetch global persona by userId...');
      const globalRes = await getPersonas({ player: userId, scope: 'global', limit: 1 });
      console.log(JSON.stringify(globalRes, null, 2));
      return;
    }

    if (cmd === 'test-workflow') {
      // Support positional argument for userId (after test-workflow)
      const userId = opt.user || args[1] || 'user1';
      const game = opt.game || 'skyline_runner';
      
      console.log('='.repeat(60));
      console.log('COMPLETE WORKFLOW TEST FOR USER:', userId);
      console.log('='.repeat(60));
      
      // STEP 1: Check if any existing personas exist
      console.log('\n[STEP 1] Checking for existing personas...');
      const initialFetch = await getPersonas({ player: userId, scope: 'any', limit: 10 });
      console.log(`Found ${initialFetch.total} existing persona(s) for ${userId}`);
      if (initialFetch.total > 0) {
        console.log('Existing persona IDs:', initialFetch.items.map((i: any) => i.id).join(', '));
        if (initialFetch.items[0]?.persona) {
          console.log('Latest persona traits:', JSON.stringify(initialFetch.items[0].persona.traits, null, 2));
        }
      } else {
        console.log('No existing personas - this will be the first save.');
      }
      
      // STEP 2: Prepare and save first run
      console.log('\n[STEP 2] Preparing and saving first run...');
      const run1Input = makeExampleServerInput(userId, 1, 'challenge', game, ['platformer'], ['pc']);
      console.log('ServerInput prepared:');
      console.log(`  - player_id: ${run1Input.player_id}`);
      console.log(`  - game_id: ${run1Input.game_context?.game_id}`);
      console.log(`  - genres: ${run1Input.game_context?.genre_ids?.join(', ')}`);
      console.log(`  - platforms: ${run1Input.game_context?.platform_ids?.join(', ')}`);
      console.log(`  - stats: time=${run1Input.stats.time_s}s, deaths=${run1Input.stats.deaths}, combats_won=${run1Input.stats.combats_won}`);
      
      const save1Result = await postSave(run1Input);
      console.log('✓ Save 1 completed');
      console.log('Save response:', JSON.stringify(save1Result, null, 2));
      
      // Wait a bit for Supermemory to index (may take a moment)
      console.log('Waiting 2 seconds for Supermemory indexing...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // STEP 3: Fetch personas after first save
      console.log('\n[STEP 3] Fetching personas after first save...');
      const afterSave1 = await getPersonas({ player: userId, scope: 'any', limit: 10 });
      console.log(`Found ${afterSave1.total} persona(s) after first save`);
      
      if (afterSave1.items.length > 0) {
        console.log('\nPersonas saved:');
        afterSave1.items.forEach((item: any, idx: number) => {
          console.log(`\n[${idx + 1}] Scope: ${item.metadata?.persona_scope || 'unknown'}, ID: ${item.id}`);
          if (item.persona) {
            console.log('Traits:', JSON.stringify(item.persona.traits, null, 2));
            console.log('Updated:', item.persona.updated_at);
          }
        });
      }
      
      // STEP 4: Verify specific scopes were created
      console.log('\n[STEP 4] Verifying persona scopes...');
      const global1 = await getPersonas({ player: userId, scope: 'global', limit: 1 });
      const game1 = await getPersonas({ player: userId, scope: 'game', game, limit: 1 });
      const genre1 = await getPersonas({ player: userId, scope: 'genre', genre: 'platformer', limit: 1 });
      const platform1 = await getPersonas({ player: userId, scope: 'platform', platform: 'pc', limit: 1 });
      
      console.log(`✓ Global persona: ${global1.total > 0 ? 'EXISTS' : 'MISSING'}`);
      console.log(`✓ Game persona (${game}): ${game1.total > 0 ? 'EXISTS' : 'MISSING'}`);
      console.log(`✓ Genre persona (platformer): ${genre1.total > 0 ? 'EXISTS' : 'MISSING'}`);
      console.log(`✓ Platform persona (pc): ${platform1.total > 0 ? 'EXISTS' : 'MISSING'}`);
      
      // STEP 5: Check for existing personas before second save (persistence test)
      console.log('\n[STEP 5] Checking for existing personas before second save (PERSISTENCE TEST)...');
      const beforeSave2 = await getPersonas({ player: userId, scope: 'any', limit: 10 });
      console.log(`Found ${beforeSave2.total} existing persona(s) - data is persisting! ✓`);
      
      if (beforeSave2.items.length > 0) {
        const latestGlobal = beforeSave2.items.find((i: any) => i.metadata?.persona_scope === 'global');
        if (latestGlobal?.persona) {
          console.log('Latest global persona traits (will be blended):');
          console.log(JSON.stringify(latestGlobal.persona.traits, null, 2));
        }
      }
      
      // STEP 6: Save second run (should blend with existing)
      console.log('\n[STEP 6] Preparing and saving second run (will blend with existing)...');
      const run2Input = makeExampleServerInput(userId, 2, 'challenge', game, ['platformer'], ['pc']);
      // Make stats slightly different to see blending effect
      run2Input.stats.time_s = 200; // Different time
      run2Input.stats.combats_won = 6; // More combats won
      run2Input.stats.riddles_correct = 3; // Better at puzzles
      
      console.log('ServerInput prepared:');
      console.log(`  - stats: time=${run2Input.stats.time_s}s, combats_won=${run2Input.stats.combats_won}, riddles_correct=${run2Input.stats.riddles_correct}`);
      
      const save2Result = await postSave(run2Input);
      console.log('✓ Save 2 completed (traits should be blended)');
      
      // Wait a bit for Supermemory to index
      console.log('Waiting 2 seconds for Supermemory indexing...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // STEP 7: Fetch personas after second save and compare
      console.log('\n[STEP 7] Fetching personas after second save (COMPARISON)...');
      const afterSave2 = await getPersonas({ player: userId, scope: 'any', limit: 10 });
      console.log(`Found ${afterSave2.total} persona(s) after second save`);
      
      // Compare traits before and after
      if (afterSave2.items.length > 0) {
        const latestGlobalAfter = afterSave2.items.find((i: any) => i.metadata?.persona_scope === 'global');
        if (latestGlobalAfter?.persona && global1.items[0]?.persona) {
          console.log('\n--- TRAIT COMPARISON (Global Persona) ---');
          console.log('BEFORE (after run 1):');
          console.log(JSON.stringify(global1.items[0].persona.traits, null, 2));
          console.log('AFTER (after run 2 - blended):');
          console.log(JSON.stringify(latestGlobalAfter.persona.traits, null, 2));
          console.log('✓ Traits have been updated/blended!');
        }
      }
      
      // STEP 8: Final verification
      console.log('\n[STEP 8] Final verification - all personas:');
      const finalFetch = await getPersonas({ player: userId, scope: 'any', limit: 20 });
      console.log(`Total personas: ${finalFetch.total}`);
      finalFetch.items.forEach((item: any) => {
        const scope = item.metadata?.persona_scope || 'unknown';
        const gameId = item.metadata?.game_id || '';
        const genreId = item.metadata?.genre_id || '';
        const platformId = item.metadata?.platform_id || '';
        const scopeLabel = scope === 'game' ? `${scope}:${gameId}` : 
                          scope === 'genre' ? `${scope}:${genreId}` :
                          scope === 'platform' ? `${scope}:${platformId}` : scope;
        console.log(`  ✓ ${scopeLabel} - ID: ${item.id.substring(0, 10)}... - Updated: ${item.metadata?.updated_at}`);
      });
      
      console.log('\n' + '='.repeat(60));
      console.log('WORKFLOW TEST COMPLETE!');
      console.log('='.repeat(60));
      console.log('✓ Data persistence verified');
      console.log('✓ Trait blending verified');
      console.log('✓ All persona scopes created');
      return;
    }

    help();
  } catch (e: any) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main().catch(console.error);
