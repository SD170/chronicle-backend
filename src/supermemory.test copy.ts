import { ENV } from './config.ts';
import type { ServerInput, PersonaSnapshot, Traits } from './types.ts';
import { computeTraits, personaText, topSignals } from './traitEngine.ts';

async function fetchLatestPersona(playerId: string, personaType: 'global' | 'game_specific', gameId?: string): Promise<PersonaSnapshot | null> {
  const apiKey = ENV.SUPERMEMORY_API_KEY;
  const baseUrl = ENV.SUPERMEMORY_BASE_URL || 'https://api.supermemory.ai';

  if (!apiKey) {
    throw new Error('SUPERMEMORY_API_KEY must be set');
  }

  const endpoint = `${baseUrl.replace(/\/$/, '')}/v3/documents/list`;

  const filters: any[] = [
    {
      filterType: 'metadata',
      key: 'player_id',
      negate: false,
      value: playerId,
    },
    {
      filterType: 'metadata',
      key: 'type',
      negate: false,
      value: 'persona',
    },
    {
      filterType: 'metadata',
      key: 'persona_type',
      negate: false,
      value: personaType,
    },
  ];

  if (personaType === 'game_specific' && gameId) {
    filters.push({
      filterType: 'metadata',
      key: 'game_id',
      negate: false,
      value: gameId,
    });
  }

  const payload = {
    filters: { AND: filters },
    limit: 1,
    page: 1,
    sort: 'createdAt',
    order: 'desc' as const,
    includeContent: true,
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return null; // No persona found
    }

    const result = await res.json();
    if (result.memories && result.memories.length > 0) {
      // Extract persona from the content
      const doc = result.memories[0];
      try {
        // Try to parse persona from the content JSON
        const contentMatch = doc.content?.match(/```json\n([\s\S]*?)\n```/);
        if (contentMatch) {
          const personaData = JSON.parse(contentMatch[1]);
          return personaData as PersonaSnapshot;
        }
      } catch {
        // If parsing fails, return null
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function saveGameDataToSupermemory(serverInput: ServerInput, gameId: string = ENV.GAME_ID) {
  const apiKey = ENV.SUPERMEMORY_API_KEY;
  const baseUrl = ENV.SUPERMEMORY_BASE_URL || 'https://api.supermemory.ai';

  if (!apiKey) {
    throw new Error('SUPERMEMORY_API_KEY must be set');
  }

  const playerId = serverInput.player_id;
  
  // Fetch previous personas
  console.log('Fetching previous personas...');
  const prevGlobalPersona = await fetchLatestPersona(playerId, 'global');
  const prevGamePersona = await fetchLatestPersona(playerId, 'game_specific', gameId);

  // Compute traits for global persona (blend with previous global)
  const globalTraits = computeTraits(serverInput.stats, prevGlobalPersona?.traits);
  const globalText = personaText(globalTraits);
  const globalSignals = topSignals(serverInput.stats);

  // Compute traits for game-specific persona (blend with previous game-specific)
  const gameTraits = computeTraits(serverInput.stats, prevGamePersona?.traits);
  const gameText = personaText(gameTraits);
  const gameSignals = topSignals(serverInput.stats);

  const now = new Date().toISOString();

  // Create global persona snapshot
  const globalPersona: PersonaSnapshot = {
    player_id: playerId,
    traits: globalTraits,
    persona_text: globalText,
    top_signals: globalSignals,
    updated_at: now,
  };

  // Create game-specific persona snapshot
  const gamePersona: PersonaSnapshot = {
    player_id: playerId,
    traits: gameTraits,
    persona_text: gameText,
    top_signals: gameSignals,
    updated_at: now,
  };

  // Format content for global persona
  const globalContent = `# Global Persona Snapshot

**Player:** ${globalPersona.player_id}
**Game:** All Games (Global)
**Updated At:** ${globalPersona.updated_at}

## Traits
- Aggression: ${globalPersona.traits.aggression}
- Stealth: ${globalPersona.traits.stealth}
- Curiosity: ${globalPersona.traits.curiosity}
- Puzzle Affinity: ${globalPersona.traits.puzzle_affinity}
- Independence: ${globalPersona.traits.independence}
- Resilience: ${globalPersona.traits.resilience}
- Goal Focus: ${globalPersona.traits.goal_focus}

## Persona Text
${globalPersona.persona_text}

## Top Signals
${globalPersona.top_signals.map(s => `- ${s}`).join('\n')}

## Derived From Run
- Game: ${gameId}
- Run Index: ${serverInput.run_index}
- Result: ${serverInput.run_outcome.result}
- Path: ${serverInput.run_outcome.path}
- Time: ${serverInput.stats.time_s}s

## Full Persona Data
\`\`\`json
${JSON.stringify(globalPersona, null, 2)}
\`\`\`
`;

  // Format content for game-specific persona
  const gameContent = `# Game-Specific Persona Snapshot

**Player:** ${gamePersona.player_id}
**Game:** ${gameId}
**Updated At:** ${gamePersona.updated_at}

## Traits
- Aggression: ${gamePersona.traits.aggression}
- Stealth: ${gamePersona.traits.stealth}
- Curiosity: ${gamePersona.traits.curiosity}
- Puzzle Affinity: ${gamePersona.traits.puzzle_affinity}
- Independence: ${gamePersona.traits.independence}
- Resilience: ${gamePersona.traits.resilience}
- Goal Focus: ${gamePersona.traits.goal_focus}

## Persona Text
${gamePersona.persona_text}

## Top Signals
${gamePersona.top_signals.map(s => `- ${s}`).join('\n')}

## Derived From Run
- Game: ${gameId}
- Run Index: ${serverInput.run_index}
- Result: ${serverInput.run_outcome.result}
- Path: ${serverInput.run_outcome.path}
- Time: ${serverInput.stats.time_s}s

## Full Persona Data
\`\`\`json
${JSON.stringify(gamePersona, null, 2)}
\`\`\`
`;

  // Use batch endpoint to save both personas
  const endpoint = `${baseUrl.replace(/\/$/, '')}/v3/documents/batch`;
  console.log(`Saving both personas (global + game-specific) for player: ${playerId}`);

  const payload = {
    documents: [
      {
        content: globalContent,
        containerTag: `personas_global_player_${playerId}`,
        customId: `persona_global_${playerId}_${Date.now()}`,
        metadata: {
          type: 'persona',
          persona_type: 'global',
          player_id: playerId,
          updated_at: now,
          run_index: serverInput.run_index,
          run_result: serverInput.run_outcome.result,
          run_path: serverInput.run_outcome.path,
        },
      },
      {
        content: gameContent,
        containerTag: `personas_game_${gameId}_player_${playerId}`,
        customId: `persona_game_${gameId}_${playerId}_${Date.now()}`,
        metadata: {
          type: 'persona',
          persona_type: 'game_specific',
          game_id: gameId,
          player_id: playerId,
          updated_at: now,
          run_index: serverInput.run_index,
          run_result: serverInput.run_outcome.result,
          run_path: serverInput.run_outcome.path,
        },
      },
    ],
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let errorText = '';
    try {
      errorText = await res.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }
      console.error(`API Error ${res.status}:`, errorData);
      throw new Error(`Supermemory API failed: ${res.status} - ${JSON.stringify(errorData)}`);
    } catch (err: any) {
      if (err.message.includes('Supermemory API failed')) {
        throw err;
      }
      console.error(`API Error ${res.status}:`, errorText);
      throw new Error(`Supermemory API failed: ${res.status} - ${errorText}`);
    }
  }

  const result = await res.json();
  console.log(`Success! Saved ${result.length} personas:`);
  result.forEach((r: any, i: number) => {
    console.log(`  ${i === 0 ? 'Global' : 'Game-specific'}: ID=${r.id}, Status=${r.status}`);
  });
  return { global: result[0], gameSpecific: result[1] };
}

async function getDocumentById(documentId: string) {
  const apiKey = ENV.SUPERMEMORY_API_KEY;
  const baseUrl = ENV.SUPERMEMORY_BASE_URL || 'https://api.supermemory.ai';

  if (!apiKey) {
    throw new Error('SUPERMEMORY_API_KEY must be set');
  }

  const endpoint = `${baseUrl.replace(/\/$/, '')}/v3/documents/${encodeURIComponent(documentId)}`;
  console.log(`Fetching document from: ${endpoint}`);

  const res = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    let errorText = '';
    try {
      errorText = await res.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }
      console.error(`API Error ${res.status}:`, errorData);
      throw new Error(`Supermemory API failed: ${res.status} - ${JSON.stringify(errorData)}`);
    } catch (err: any) {
      if (err.message.includes('Supermemory API failed')) {
        throw err;
      }
      console.error(`API Error ${res.status}:`, errorText);
      throw new Error(`Supermemory API failed: ${res.status} - ${errorText}`);
    }
  }

  const result = await res.json();
  return result;
}

async function fetchPersonasByPlayerId(playerId: string, personaType?: 'global' | 'game_specific', gameId?: string, limit?: number) {
  const apiKey = ENV.SUPERMEMORY_API_KEY;
  const baseUrl = ENV.SUPERMEMORY_BASE_URL || 'https://api.supermemory.ai';

  if (!apiKey) {
    throw new Error('SUPERMEMORY_API_KEY must be set');
  }

  const endpoint = `${baseUrl.replace(/\/$/, '')}/v3/documents/list`;
  console.log(`Fetching personas for player: ${playerId}${personaType ? ` (type: ${personaType})` : ''}`);

  const filters: any[] = [
    {
      filterType: 'metadata',
      key: 'player_id',
      negate: false,
      value: playerId,
    },
    {
      filterType: 'metadata',
      key: 'type',
      negate: false,
      value: 'persona',
    },
  ];

  if (personaType) {
    filters.push({
      filterType: 'metadata',
      key: 'persona_type',
      negate: false,
      value: personaType,
    });
    if (personaType === 'game_specific' && gameId) {
      filters.push({
        filterType: 'metadata',
        key: 'game_id',
        negate: false,
        value: gameId,
      });
    }
  }

  const payload = {
    filters: { AND: filters },
    limit: limit || 10,
    page: 1,
    sort: 'createdAt',
    order: 'desc' as const,
    includeContent: true,
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let errorText = '';
    try {
      errorText = await res.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }
      console.error(`API Error ${res.status}:`, errorData);
      throw new Error(`Supermemory API failed: ${res.status} - ${JSON.stringify(errorData)}`);
    } catch (err: any) {
      if (err.message.includes('Supermemory API failed')) {
        throw err;
      }
      console.error(`API Error ${res.status}:`, errorText);
      throw new Error(`Supermemory API failed: ${res.status} - ${errorText}`);
    }
  }

  const result = await res.json();
  console.log(`Found ${result.memories?.length || 0} personas`);
  return result;
}

async function fetchBothPersonas(playerId: string, gameId: string = ENV.GAME_ID) {
  const [globalResult, gameResult] = await Promise.all([
    fetchPersonasByPlayerId(playerId, 'global', undefined, 1),
    fetchPersonasByPlayerId(playerId, 'game_specific', gameId, 1),
  ]);

  const extractPersona = (result: any): PersonaSnapshot | null => {
    if (result.memories && result.memories.length > 0) {
      const doc = result.memories[0];
      try {
        const contentMatch = doc.content?.match(/```json\n([\s\S]*?)\n```/);
        if (contentMatch) {
          return JSON.parse(contentMatch[1]) as PersonaSnapshot;
        }
      } catch {
        return null;
      }
    }
    return null;
  };

  return {
    global: extractPersona(globalResult),
    game: extractPersona(gameResult),
  };
}

// Note: Supermemory v3 API may not have a search/list endpoint
// Use getDocumentById with the document ID from save response, or try fetchPersonasByPlayerId
async function fetchPersonasFromSupermemory(options: {
  documentId?: string;
  playerId?: string;
  personaType?: 'global' | 'game_specific' | 'both';
  gameId?: string;
  limit?: number;
}) {
  if (options.documentId) {
    return getDocumentById(options.documentId);
  }
  
  if (options.playerId) {
    if (options.personaType === 'both') {
      // Fetch both personas
      return fetchBothPersonas(options.playerId, options.gameId);
    } else {
      return fetchPersonasByPlayerId(options.playerId, options.personaType, options.gameId, options.limit);
    }
  }
  
  throw new Error('Either --documentId or --playerId is required.');
}

async function getPersonasForPlayer(playerId: string, personaType?: 'global' | 'game_specific' | 'both', gameId?: string, limit?: number) {
  if (personaType === 'both') {
    return fetchBothPersonas(playerId, gameId);
  }
  return fetchPersonasByPlayerId(playerId, personaType, gameId, limit);
}

// Fixed example ServerInput data (like serverInput.js)
const exampleServerInput: ServerInput = {
  schema_version: '1.0',
  player_id: 'player_123',
  session_id: 'session_456',
  run_index: 1,
  completed_at: new Date().toISOString(),
  run_outcome: {
    result: 'win',
    path: 'combat',
  },
  stats: {
    time_s: 120,
    deaths: 2,
    retries: 1,
    distance_traveled: 500,
    jumps: 45,
    hint_offers: 3,
    hints_used: 1,
    riddles_attempted: 2,
    riddles_correct: 2,
    combats_initiated: 5,
    combats_won: 5,
    collectibles_found: 3,
  },
  config_used: {
    mode: 'fun',
    knobs: {
      enemy_count: 3,
      enemy_speed: 1.0,
      puzzle_gate_ratio: 0.5,
      collectible_density: 0.7,
      hint_delay_ms: 5000,
      breadcrumb_brightness: 0.8,
    },
    layout_seed: 'seed_abc123',
  },
};


// CLI argument parsing
function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const options: Record<string, string | number | boolean> = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith('--')) {
      const key = arg.replace(/^--?/, '');
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        i++; // consume the value
        // Try to parse as number or boolean
        if (value === 'true') options[key] = true;
        else if (value === 'false') options[key] = false;
        else if (!isNaN(Number(value))) options[key] = Number(value);
        else options[key] = value;
      }
    } else if (arg && command === 'fetch' && !options.documentId && !options.playerId) {
      // For fetch command, treat positional arg as documentId or playerId if not already set
      // Try as documentId first (22 char alphanumeric), otherwise treat as playerId
      if (arg.length === 22 && /^[a-zA-Z0-9]+$/.test(arg)) {
        options.documentId = arg;
      } else {
        options.playerId = arg;
      }
    } else if (arg && (command === 'personas' || command === 'persona') && !options.playerId) {
      // For personas command, treat positional arg as playerId
      options.playerId = arg;
    }
  }

  return { command, options };
}

async function main() {
  const { command, options } = parseArgs();

  if (!command) {
    console.log(`
Usage: npm run test:supermemory <command> [options]

Commands:
  save                   Process ServerInput and save persona to Supermemory (uses fixed example data)
    --gameId <id>        Game ID (default: from ENV.GAME_ID)
  
  fetch                  Fetch personas
    --documentId <id>    Document ID (from save response)
    --playerId <id>      Player ID (queries by metadata)
    --personaType <type> 'global', 'game_specific', or 'both' (default: both)
    --gameId <id>        Game ID (required for game_specific, default: from ENV)
    --limit <number>     Limit results (when using playerId)
  
  personas               Get personas for a player
    --playerId <id>      Player ID (required)
    --personaType <type> 'global', 'game_specific', or 'both' (default: both)
    --gameId <id>        Game ID (required for game_specific, default: from ENV)
    --limit <number>     Limit results

Examples:
  npm run test:supermemory save
  npm run test:supermemory fetch --documentId <id_from_save_response>
  npm run test:supermemory fetch --playerId player_123
  npm run test:supermemory personas --playerId player_123 --limit 10
    `);
    return;
  }

  try {
    switch (command) {
      case 'save': {
        console.log('Processing ServerInput and saving persona to Supermemory...');
        const gameId = options.gameId ? String(options.gameId) : ENV.GAME_ID;
        const result = await saveGameDataToSupermemory(exampleServerInput, gameId);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'fetch': {
        if (!options.documentId && !options.playerId) {
          console.error('Error: Either --documentId or --playerId is required.');
          process.exit(1);
        }
        const fetchOptions: Parameters<typeof fetchPersonasFromSupermemory>[0] = {};
        if (options.documentId) fetchOptions.documentId = String(options.documentId);
        if (options.playerId) fetchOptions.playerId = String(options.playerId);
        if (options.personaType) {
          const pt = String(options.personaType);
          if (pt === 'global' || pt === 'game_specific' || pt === 'both') {
            fetchOptions.personaType = pt;
          }
        } else if (options.playerId) {
          fetchOptions.personaType = 'both'; // Default to both when fetching by playerId
        }
        if (options.gameId) fetchOptions.gameId = String(options.gameId);
        if (options.limit) fetchOptions.limit = Number(options.limit);
        
        const result = await fetchPersonasFromSupermemory(fetchOptions);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'personas':
      case 'persona': {
        if (!options.playerId) {
          console.error('Error: --playerId is required.');
          process.exit(1);
        }
        const personaType = options.personaType 
          ? (String(options.personaType) as 'global' | 'game_specific' | 'both')
          : 'both';
        const result = await getPersonasForPlayer(
          String(options.playerId),
          personaType,
          options.gameId ? String(options.gameId) : undefined,
          options.limit ? Number(options.limit) : undefined
        );
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.log('Run without arguments to see usage');
        process.exit(1);
    }
  } catch (error: any) {
    console.error('Error:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

// Example usage (only run if no CLI args)
async function runExamples() {
  try {
    console.log('=== PROCESSING SERVERINPUT AND SAVING PERSONA ===\n');
    
    console.log('Processing ServerInput and saving persona...');
    const result = await saveGameDataToSupermemory(exampleServerInput);
    console.log('Persona saved:', result);

    console.log('\n=== FETCHING DATA ===\n');

    console.log('Fetching personas for player_123...');
    const personas = await getPersonasForPlayer('player_123', 'both', undefined, 5);
    console.log('Personas:', JSON.stringify(personas, null, 2));

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (process.argv.length > 2) {
  // CLI mode
  main().catch(console.error);
} else {
  // Example mode
  runExamples().catch(console.error);
}

export { 
  saveGameDataToSupermemory,
  fetchPersonasFromSupermemory,
  getPersonasForPlayer,
};

