// src/memory/SupermemoryStore.ts
import { ENV } from '../config.ts';
import type { PersonaSnapshot, ServerInput, Traits } from '../types.ts';
import { computeTraits, personaText, topSignals, generateTraitExplanations } from '../traitEngine.ts';
import { logger } from '../logger.ts';

type PersonaScope = 'global' | 'genre' | 'platform' | 'game';
type ListOrder = 'asc' | 'desc';

type ScopeKey =
  | { scope: 'global' }
  | { scope: 'genre'; genre_id: string }
  | { scope: 'platform'; platform_id: string }
  | { scope: 'game'; game_id: string };

export class SupermemoryStore {
  private base = (ENV.SUPERMEMORY_BASE_URL || 'https://api.supermemory.ai').replace(/\/$/, '');
  private key = ENV.SUPERMEMORY_API_KEY;

  private headersJSON() {
    if (!this.key) throw new Error('SUPERMEMORY_API_KEY must be set');
    return { 'Authorization': `Bearer ${this.key}`, 'Content-Type': 'application/json' };
  }

  // ---------- Helpers ----------
  // User node containerTag - all memories for a user are linked via this single tag
  private userNodeTag(playerId: string): string {
    return playerId; // e.g., "user10" - this is the user node
  }

  // Legacy method kept for backward compatibility during transition
  private containerTag(playerId: string, key: ScopeKey) {
    // For now, still use user node as primary tag
    return this.userNodeTag(playerId);
  }

  private metadata(playerId: string, key: ScopeKey, nowISO: string, extra?: Record<string, any>) {
    const base: any = {
      type: 'persona',
      persona_scope: key.scope,
      player_id: playerId,
      updated_at: nowISO,
      ...extra
    };
    if (key.scope === 'genre')    base.genre_id = key.genre_id;
    if (key.scope === 'platform') base.platform_id = key.platform_id;
    if (key.scope === 'game')     base.game_id = key.game_id;
    return base;
  }

  private mdFromSnapshot(title: string, key: ScopeKey, snap: PersonaSnapshot, derived: Record<string, any> = {}) {
    const lines = [
      `# ${title}`,
      ``,
      `**Player:** ${snap.player_id}`,
      key.scope === 'game'     ? `**Game:** ${key.game_id}` :
      key.scope === 'genre'    ? `**Genre:** ${key.genre_id}` :
      key.scope === 'platform' ? `**Platform:** ${key.platform_id}` :
                                  `**Scope:** Global`,
      `**Updated At:** ${snap.updated_at}`,
      ``,
      `## Traits`,
      `- Aggression: ${snap.traits.aggression}`,
      `- Stealth: ${snap.traits.stealth}`,
      `- Curiosity: ${snap.traits.curiosity}`,
      `- Puzzle Affinity: ${snap.traits.puzzle_affinity}`,
      `- Independence: ${snap.traits.independence}`,
      `- Resilience: ${snap.traits.resilience}`,
      `- Goal Focus: ${snap.traits.goal_focus}`,
      ``,
      `## Persona Text`,
      snap.persona_text,
      ``,
      `## Top Signals`,
      ...(snap.top_signals?.length ? snap.top_signals.map(s => `- ${s}`) : ['- (none)']),
      ``,
      `## Full Persona JSON`,
      '```json',
      JSON.stringify({ ...snap, ...derived }, null, 2),
      '```',
      ''
    ];
    return lines.join('\n');
  }

  private parsePersona(content?: string): PersonaSnapshot | null {
    if (!content) return null;
    const match = content.match(/```json\n([\s\S]*?)\n```/);
    if (!match || !match[1]) return null;
    try { return JSON.parse(match[1]) as PersonaSnapshot; } catch { return null; }
  }

  // ---------- Raw API ----------
  private async list(filters: any[], limit = 10, order: ListOrder = 'desc', includeContent = true, containerTags: string[] = [], retries = 0): Promise<any> {
    const payload: any = {
      filters: { AND: filters },
      limit,
      page: 1,
      sort: 'createdAt',
      order,
      includeContent
    };
    // Add containerTags if provided (can help with indexing delays)
    if (containerTags.length > 0) {
      payload.containerTags = containerTags;
    }
    
    const res = await fetch(`${this.base}/v3/documents/list`, {
      method: 'POST',
      headers: this.headersJSON(),
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      // If it's a 404 or similar, retry with increasing delays (up to 3 times)
      if ((res.status === 404 || res.status >= 500) && retries < 3) {
        const waitTime = [2000, 4000, 6000][retries] || 4000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.list(filters, limit, order, includeContent, containerTags, retries + 1);
      }
      throw new Error(`Supermemory list failed: ${res.status} ${errorText}`);
    }
    
    const result = await res.json();
    
    // Debug: log response structure if needed
    if (process.env.DEBUG_SUPERMEMORY === 'true') {
      logger.debug('[Supermemory List] Response', {
        memoriesCount: result?.memories?.length ?? 0,
        hasPagination: !!result?.pagination,
        totalItems: result?.pagination?.totalItems
      });
    }
    
    // Supermemory may return empty results immediately after save due to indexing delay
    // Return the result anyway (caller can handle empty results)
    return result;
  }

  private async get(docId: string) {
    const res = await fetch(`${this.base}/v3/documents/${encodeURIComponent(docId)}`, {
      method: 'GET',
      headers: this.headersJSON()
    });
    if (!res.ok) throw new Error(`Supermemory get failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  private async update(docId: string, payload: { content: string; metadata?: Record<string, any> }) {
    const res = await fetch(`${this.base}/v3/documents/${encodeURIComponent(docId)}`, {
      method: 'PUT',
      headers: this.headersJSON(),
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`Supermemory update failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  private async batchCreate(docs: Array<{ content: string; metadata: Record<string, any>; containerTag?: string; customId?: string }>) {
    const res = await fetch(`${this.base}/v3/documents/batch`, {
      method: 'POST',
      headers: this.headersJSON(),
      body: JSON.stringify({ documents: docs })
    });
    if (!res.ok) throw new Error(`Supermemory batch create failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  // ---------- High-level ----------
  /** Fetch latest persona for a specific scope key (global/genre/platform/game). 
   * Now aggregates from individual trait memories instead of persona documents. */
  async fetchLatestPersona(playerId: string, key: ScopeKey): Promise<{ doc?: any; persona?: PersonaSnapshot } | null> {
    // Fetch individual trait memories for this scope
    const filters: any[] = [
      { filterType: 'metadata', key: 'player_id', value: playerId, negate: false },
      { filterType: 'metadata', key: 'type', value: 'trait_memory', negate: false },
      { filterType: 'metadata', key: 'persona_scope', value: key.scope, negate: false }
    ];
    if (key.scope === 'game')     filters.push({ filterType: 'metadata', key: 'game_id', value: key.game_id, negate: false });
    if (key.scope === 'genre')    filters.push({ filterType: 'metadata', key: 'genre_id', value: key.genre_id, negate: false });
    if (key.scope === 'platform') filters.push({ filterType: 'metadata', key: 'platform_id', value: key.platform_id, negate: false });

    const userNode = this.userNodeTag(playerId);
    const result = await this.list(filters, 100, 'desc', true, [userNode]);
    const memories = result?.memories ?? [];
    
    if (memories.length === 0) return null;
    
    // Aggregate trait memories into persona
    const traits: Partial<Traits> = {};
    let latestUpdated = '';
    
    if (key.scope === 'global') {
      // For global: Use the LATEST value (not average)
      // Because each global memory is already blended sequentially when saved,
      // averaging would cause double-averaging. The latest global memory contains
      // the complete blending history up to that point.
      for (const memory of memories) {
        const traitName = memory.metadata?.trait_name;
        const traitValue = memory.metadata?.trait_value;
        const updatedAt = memory.metadata?.updated_at || '';
        
        if (traitName && traitValue !== undefined) {
          // Use latest value (most recent update wins)
          if (!traits[traitName as keyof Traits] || updatedAt >= latestUpdated) {
            traits[traitName as keyof Traits] = traitValue;
            if (updatedAt > latestUpdated) {
              latestUpdated = updatedAt;
            }
          }
        }
      }
    } else {
      // For game/genre/platform: use latest value per trait
      for (const memory of memories) {
        const traitName = memory.metadata?.trait_name;
        const traitValue = memory.metadata?.trait_value;
        const updatedAt = memory.metadata?.updated_at || '';
        
        if (traitName && traitValue !== undefined) {
          if (!traits[traitName as keyof Traits] || updatedAt >= latestUpdated) {
            traits[traitName as keyof Traits] = traitValue;
            if (updatedAt > latestUpdated) {
              latestUpdated = updatedAt;
            }
          }
        }
      }
    }
    
    // Check if we have all required traits
    const requiredTraits: Array<keyof Traits> = [
      'aggression', 'stealth', 'curiosity', 'puzzle_affinity',
      'independence', 'resilience', 'goal_focus'
    ];
    
    const hasAllTraits = requiredTraits.every(t => traits[t] !== undefined);
    if (!hasAllTraits) {
      // Not enough traits to form a complete persona
      return null;
    }
    
    // Build PersonaSnapshot
    const persona: PersonaSnapshot = {
      player_id: playerId,
      traits: traits as Traits,
      persona_text: personaText(traits as Traits),
      top_signals: [],
      updated_at: latestUpdated || new Date().toISOString()
    };
    
    // Create a synthetic doc for backward compatibility
    const doc = {
      id: 'aggregated',
      metadata: {
        type: 'persona',
        persona_scope: key.scope,
        player_id: playerId,
        updated_at: latestUpdated
      },
      content: this.mdFromSnapshot('Persona Snapshot', key, persona)
    };
    
    return { doc, persona };
  }

  /** Upsert a persona document (list → update or create). */
  async upsertPersonaDoc(playerId: string, key: ScopeKey, snap: PersonaSnapshot, derivedMeta: Record<string, any> = {}) {
    const now = snap.updated_at || new Date().toISOString();
    const metadata = this.metadata(playerId, key, now, derivedMeta);
    const content  = this.mdFromSnapshot('Persona Snapshot', key, snap);

    // find latest existing
    const existing = await this.fetchLatestPersona(playerId, key);
    if (existing?.doc?.id) {
      try {
        // Try to update existing document
        return await this.update(existing.doc.id, { content, metadata });
      } catch (error: any) {
        // If update fails (e.g., 404 - document was deleted), fall back to create
        if (error.message?.includes('404') || error.message?.includes('Not Found')) {
          logger.info(`Update failed (404), creating new document for ${key.scope} persona`);
          return this.batchCreate([{
            content,
            containerTag: this.containerTag(playerId, key),
            customId: `persona_${key.scope}_${playerId}_${Date.now()}`,
            metadata
          }]);
        }
        // Re-throw if it's a different error
        throw error;
      }
    } else {
      return this.batchCreate([{
        content,
        containerTag: this.containerTag(playerId, key),
        customId: `persona_${key.scope}_${playerId}_${Date.now()}`,
        metadata
      }]);
    }
  }

  /** Save from ServerInput - Creates individual memories linked to user node */
  async saveFromServerInput(
    serverInput: ServerInput,
    options: { game_id?: string; genres?: string[]; platforms?: string[]; extraMeta?: Record<string, any> } = {}
  ) {
    const playerId  = serverInput.player_id;
    const gameId    = options.game_id ?? ENV.GAME_ID;
    const genres    = options.genres ?? [];
    const platforms = options.platforms ?? [];
    const userNode  = this.userNodeTag(playerId);
    
    const extraMeta = {
      run_index: serverInput.run_index,
      run_result: serverInput.run_outcome.result,
      run_path: serverInput.run_outcome.path,
      game_id: gameId,
      completed_at: serverInput.completed_at,
      ...options.extraMeta
    };

    // Collect all memories to batch create
    const allMemories: Array<{ content: string; metadata: Record<string, any>; containerTag: string; customId?: string }> = [];

    // GLOBAL - fetch previous traits for blending
    const prevGlobal = await this.fetchLatestPersona(playerId, { scope: 'global' });
    // If no previous persona exists, use default traits (all 0.5) for blending
    const defaultTraits: Traits = {
      aggression: 0.5,
      stealth: 0.5,
      curiosity: 0.5,
      puzzle_affinity: 0.5,
      independence: 0.5,
      resilience: 0.5,
      goal_focus: 0.5,
    };
    const globalSnap = this.buildSnapshot(playerId, serverInput.stats, prevGlobal?.persona?.traits || defaultTraits);
    const globalMemories = this.createTraitMemories(playerId, globalSnap.traits, { scope: 'global' }, extraMeta);
    allMemories.push(...globalMemories);

    // GAME
    if (gameId) {
      const prevGame = await this.fetchLatestPersona(playerId, { scope: 'game', game_id: gameId });
      // Use default traits if no previous game persona exists
      const gameSnap = this.buildSnapshot(playerId, serverInput.stats, prevGame?.persona?.traits || defaultTraits);
      const gameMemories = this.createTraitMemories(playerId, gameSnap.traits, { scope: 'game', game_id: gameId }, extraMeta);
      allMemories.push(...gameMemories);
    }

    // GENRES - only create ONE genre (first genre if multiple provided)
    if (genres.length > 0) {
      const genre = genres[0]!;
      const prev = await this.fetchLatestPersona(playerId, { scope: 'genre', genre_id: genre });
      const snap = this.buildSnapshot(playerId, serverInput.stats, prev?.persona?.traits || defaultTraits);
      const genreMemories = this.createTraitMemories(playerId, snap.traits, { scope: 'genre', genre_id: genre }, { ...extraMeta, genre_id: genre });
      allMemories.push(...genreMemories);
    }

    // PLATFORMS - only create ONE platform (first platform if multiple provided)
    if (platforms.length > 0) {
      const plat = platforms[0]!;
      const prev = await this.fetchLatestPersona(playerId, { scope: 'platform', platform_id: plat });
      const snap = this.buildSnapshot(playerId, serverInput.stats, prev?.persona?.traits || defaultTraits);
      const platformMemories = this.createTraitMemories(playerId, snap.traits, { scope: 'platform', platform_id: plat }, { ...extraMeta, platform_id: plat });
      allMemories.push(...platformMemories);
    }

    // Batch create all memories - all linked to user node via containerTag
    logger.info(`Creating ${allMemories.length} memories for user node: ${userNode}`);
    const batchResult = await this.batchCreate(allMemories);

    return {
      user_node: userNode,
      memories_created: allMemories.length,
      batch_result: batchResult
    };
  }

  /** Generic fetch by filters - fetches individual memories linked to user node */
  async fetchByFilters(params: {
    player_id: string;
    scope?: PersonaScope | 'any';
    game_id?: string;
    genre_id?: string;
    platform_id?: string;
    limit?: number;
    order?: ListOrder;
    includeContent?: boolean;
  }) {
    const {
      player_id, scope = 'any', game_id, genre_id, platform_id,
      limit = 100, order = 'desc', includeContent = true
    } = params;

    const userNode = this.userNodeTag(player_id);
    
    // Filter for memories linked to user node
    const filters: any[] = [
      { filterType: 'metadata', key: 'player_id', value: player_id, negate: false },
      { filterType: 'metadata', key: 'type', value: 'trait_memory', negate: false }
    ];
    
    // When scope is specified, filter by persona_scope
    if (scope !== 'any') {
      filters.push({ filterType: 'metadata', key: 'persona_scope', value: scope, negate: false });
    }
    
    // Additional filters
    if (game_id && (scope === 'game' || scope === 'any')) {
      filters.push({ filterType: 'metadata', key: 'game_id', value: game_id, negate: false });
    }
    if (genre_id && (scope === 'genre' || scope === 'any')) {
      filters.push({ filterType: 'metadata', key: 'genre_id', value: genre_id, negate: false });
    }
    if (platform_id && (scope === 'platform' || scope === 'any')) {
      filters.push({ filterType: 'metadata', key: 'platform_id', value: platform_id, negate: false });
    }

    // Use user node as containerTag to fetch all memories for this user
    // Fetch a large number of memories to ensure we get all traits for all scopes
    // The limit will be applied after aggregating into personas
    const containerTags: string[] = [userNode];
    const memoryFetchLimit = 500; // Fetch up to 500 memories to ensure we get all traits

    const result = await this.list(filters, memoryFetchLimit, order, includeContent, containerTags);
    const memories = result?.memories ?? [];
    
    // Client-side filtering for accuracy
    const filteredMemories = memories.filter((m: any) => {
      if (m.metadata?.player_id !== player_id) return false;
      if (m.metadata?.type !== 'trait_memory') return false;
      if (scope !== 'any' && m.metadata?.persona_scope !== scope) return false;
      if (genre_id && m.metadata?.genre_id !== genre_id) return false;
      if (platform_id && m.metadata?.platform_id !== platform_id) return false;
      if (game_id && m.metadata?.game_id !== game_id) return false;
      return true;
    });
    
    // Group memories by scope and aggregate into personas
    const personasByScope = new Map<string, any>();
    
    for (const memory of filteredMemories) {
      const memScope = memory.metadata?.persona_scope || 'global';
      const memGameId = memory.metadata?.game_id;
      const memGenreId = memory.metadata?.genre_id;
      const memPlatformId = memory.metadata?.platform_id;
      
      // Create a unique key for this scope combination
      let scopeKey = memScope;
      if (memScope === 'game' && memGameId) scopeKey = `game:${memGameId}`;
      else if (memScope === 'genre' && memGenreId) scopeKey = `genre:${memGenreId}`;
      else if (memScope === 'platform' && memPlatformId) scopeKey = `platform:${memPlatformId}`;
      
      if (!personasByScope.has(scopeKey)) {
        personasByScope.set(scopeKey, {
          scope: memScope,
          game_id: memGameId,
          genre_id: memGenreId,
          platform_id: memPlatformId,
          traits: {} as Traits,
          trait_memories: [] as any[],
          latest_updated_at: memory.metadata?.updated_at || new Date().toISOString(),
        });
      }
      
      const persona = personasByScope.get(scopeKey)!;
      const traitName = memory.metadata?.trait_name;
      const traitValue = memory.metadata?.trait_value;
      
      if (traitName && traitValue !== undefined) {
        // For all scopes (including global): use latest value
        // For global scope: each global memory is already sequentially blended when saved,
        // so we just use the latest value (not average)
        const currentUpdated = persona.trait_memories.find((m: any) => m.trait_name === traitName)?.updated_at || '';
        if (!currentUpdated || memory.metadata?.updated_at >= currentUpdated) {
          persona.traits[traitName as keyof Traits] = traitValue;
          // Remove old memory for this trait if exists
          persona.trait_memories = persona.trait_memories.filter((m: any) => m.trait_name !== traitName);
          // Add new memory
          persona.trait_memories.push({
            id: memory.id,
            trait_name: traitName,
            trait_value: traitValue,
            content: includeContent ? memory.content : undefined,
            updated_at: memory.metadata?.updated_at,
            ...(memGameId ? { game_id: memGameId } : {}),
          });
        }
        
        // Update latest timestamp
        if (memory.metadata?.updated_at && memory.metadata.updated_at > persona.latest_updated_at) {
          persona.latest_updated_at = memory.metadata.updated_at;
        }
      }
    }
    
    // Convert map to array of persona objects
    let personas = Array.from(personasByScope.values()).map(p => {
      // Reconstruct PersonaSnapshot structure
      const traits = p.traits as Traits;
      
      // Check if we have all required traits
      const requiredTraits: Array<keyof Traits> = [
        'aggression', 'stealth', 'curiosity', 'puzzle_affinity',
        'independence', 'resilience', 'goal_focus'
      ];
      const hasAllTraits = requiredTraits.every(t => traits[t] !== undefined);
      
      // Only include personas that have all traits
      if (!hasAllTraits) return null;
      
      // Generate persona_text from traits
      const persona_text = personaText(traits);
      
      // Build persona object similar to what was returned before
      return {
        id: p.trait_memories[0]?.id || 'aggregated',
        metadata: {
          type: 'persona',
          persona_scope: p.scope,
          player_id: player_id,
          ...(p.game_id && { game_id: p.game_id }),
          ...(p.genre_id && { genre_id: p.genre_id }),
          ...(p.platform_id && { platform_id: p.platform_id }),
          updated_at: p.latest_updated_at,
        },
        persona: {
          player_id: player_id,
          traits: traits,
          persona_text: persona_text,
          top_signals: [], // Would need to store this separately if needed
          updated_at: p.latest_updated_at,
        } as PersonaSnapshot
      };
    }).filter((p): p is NonNullable<typeof p> => p !== null);
    
    // Apply limit to personas (not memories)
    personas = personas.slice(0, limit);
    
    const total = personas.length;
    return { total, items: personas, user_node: userNode };
  }

  /** Fetch a document by id (pass-through) */
  async fetchDocumentById(docId: string) {
    return this.get(docId);
  }

  /** Build a PersonaSnapshot */
  private buildSnapshot(playerId: string, stats: any, prev?: Traits): PersonaSnapshot {
    const traits = computeTraits(stats, prev);
    return {
      player_id: playerId,
      traits,
      persona_text: personaText(traits),
      top_signals: topSignals(stats),
      updated_at: new Date().toISOString()
    };
  }


  /** Create individual memory documents for each trait, all linked to user node */
  private createTraitMemories(
    playerId: string,
    traits: Traits,
    scope: ScopeKey,
    metadata: Record<string, any>
  ): Array<{ content: string; metadata: Record<string, any>; containerTag: string; customId?: string }> {
    const memories: Array<{ content: string; metadata: Record<string, any>; containerTag: string; customId?: string }> = [];
    const userNode = this.userNodeTag(playerId);
    const now = new Date().toISOString();
    
    // Create a memory for each trait
    const traitNames: Array<keyof Traits> = [
      'aggression',
      'stealth',
      'curiosity',
      'puzzle_affinity',
      'independence',
      'resilience',
      'goal_focus'
    ];

    for (const traitName of traitNames) {
      const traitValue = traits[traitName];
      const traitLabel = traitName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      
      // Create simple memory content - avoid words that trigger "Report" title generation
      // Just a simple statement: "Independence: 0.50" (shorter, more direct)
      const content = `${traitLabel}: ${traitValue.toFixed(2)}`;
      
      // Scope identifier for customId (e.g., "global", "game_test_game", "genre_platformer")
      let scopeId: string = scope.scope;
      if (scope.scope === 'game') scopeId = `game_${scope.game_id}`;
      else if (scope.scope === 'genre') scopeId = `genre_${scope.genre_id}`;
      else if (scope.scope === 'platform') scopeId = `platform_${scope.platform_id}`;
      
      // For global scope: Create separate memory per game so we can aggregate all contributions
      // For other scopes: Use stable customId to update existing memory
      let customId: string;
      if (scope.scope === 'global') {
        // Include game_id in global scope customId so each game contributes separately
        // Then aggregate when fetching
        const gameId = metadata.game_id || 'unknown';
        customId = `memory_${playerId}_${scopeId}_${gameId}_${traitName}`;
      } else {
        // Game/genre/platform scopes: stable ID to update existing
        customId = `memory_${playerId}_${scopeId}_${traitName}`;
      }
      
      memories.push({
        content,
        containerTag: userNode, // All memories linked to user node
        customId,
        metadata: {
          type: 'trait_memory',
          player_id: playerId,
          trait_name: traitName,
          trait_value: traitValue,
          persona_scope: scope.scope,
          updated_at: now,
          ...(scope.scope === 'game' && { game_id: scope.game_id }),
          ...(scope.scope === 'genre' && { genre_id: scope.genre_id }),
          ...(scope.scope === 'platform' && { platform_id: scope.platform_id }),
          ...metadata
        }
      });
    }

    return memories;
  }

  // ---------- (Legacy) keep these for backwards compatibility ----------
  // NOTE: These are from your earlier version; safe to keep if something calls them.
  async getPersona(_player_id: string): Promise<PersonaSnapshot | null> {
    // Use fetchByFilters instead in new code.
    return null;
  }
  async setPersona(_snap: PersonaSnapshot): Promise<void> {
    // Use upsertPersonaDoc instead in new code.
    return;
  }
}
