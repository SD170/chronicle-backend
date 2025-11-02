// src/types.ts
import { z } from "zod";

export const StatsZ = z.object({
  time_s: z.number(),
  deaths: z.number(),
  retries: z.number(),
  distance_traveled: z.number(),
  jumps: z.number(),
  hint_offers: z.number(),
  hints_used: z.number(),
  riddles_attempted: z.number(),
  riddles_correct: z.number(),
  combats_initiated: z.number(),
  combats_won: z.number(),
  collectibles_found: z.number(),
});
export type Stats = z.infer<typeof StatsZ>;

export const RunPathZ = z.enum(["combat", "puzzle", "exploration"]);
export type RunPath = z.infer<typeof RunPathZ>;

export const RunResultZ = z.enum(["win", "loss"]);
export type RunResult = z.infer<typeof RunResultZ>;

export const RunOutcomeZ = z.object({
  result: RunResultZ,
  path: RunPathZ,
});
export type RunOutcome = z.infer<typeof RunOutcomeZ>;

export const ModeZ = z.enum(["fun", "challenge"]);
export type Mode = z.infer<typeof ModeZ>;

export const KnobsZ = z.object({
  enemy_count: z.number(),
  enemy_speed: z.number(),
  puzzle_gate_ratio: z.number(),
  collectible_density: z.number(),
  hint_delay_ms: z.number(),
  breadcrumb_brightness: z.number(),
});

export const ServerInputZ = z.object({
  schema_version: z.string(),
  player_id: z.string(),
  session_id: z.string(),
  run_index: z.number().int().positive(),
  completed_at: z.string(), // ISO
  game_context: z.object({
    game_id: z.string().optional(),
    game_title: z.string().optional(),
    genre_ids: z.array(z.string()).optional(),
    platform_ids: z.array(z.string()).optional(),
    build_version: z.string().optional(),
  }).optional(),
  run_outcome: RunOutcomeZ,
  stats: StatsZ,
  events_digest: z.array(z.object({ type: z.string(), count: z.number() })).optional(),
  config_used: z.object({
    mode: ModeZ,
    knobs: KnobsZ,
    layout_seed: z.string(),
  }),
  performance_summary: z.unknown().optional(),
});
export type ServerInput = z.infer<typeof ServerInputZ>;

export const TraitsZ = z.object({
  aggression: z.number(),
  stealth: z.number(),
  curiosity: z.number(),
  puzzle_affinity: z.number(),
  independence: z.number(),
  resilience: z.number(),
  goal_focus: z.number(),
});
export type Traits = z.infer<typeof TraitsZ>;

export const PersonaSnapshotZ = z.object({
  player_id: z.string(),
  traits: TraitsZ,          // 0..1 normalized
  persona_text: z.string(), // 1–3 sentences
  top_signals: z.array(z.string()),
  updated_at: z.string(),   // ISO
});
export type PersonaSnapshot = z.infer<typeof PersonaSnapshotZ>;
