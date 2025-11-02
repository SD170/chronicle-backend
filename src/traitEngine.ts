// src/traitEngine.ts
import type { Stats, Traits } from './types.ts';

export function computeTraits(stats: Stats, prev?: Traits): Traits {
  const aggressionRaw   = stats.combats_initiated * 1.0 + stats.combats_won * 0.5;
  const puzzleRaw       = stats.riddles_correct * 1.0 + (stats.riddles_attempted - stats.riddles_correct) * 0.2;
  const curiosityRaw    = stats.collectibles_found * 0.7 + Math.min(stats.distance_traveled/500, 1) * 0.3;
  const resilienceRaw   = stats.retries * 0.8 + stats.deaths * 0.4 - Math.min(stats.time_s/600, 1) * 0.2;
  const independenceRaw = (stats.hint_offers > 0 && stats.hints_used === 0) ? 1 : Math.max(0, 1 - stats.hints_used * 0.5);
  const goalRaw         = (stats.time_s < 180 ? 1 : Math.max(0, 1 - (stats.time_s-180)/300)) + (stats.retries === 0 ? 0.2 : 0);

  const norm = (x:number) => Math.max(0, Math.min(1, x));
  const blend = (c:number,p?:number)=> p==null? c : (0.6*p + 0.4*c);

  const t: Traits = {
    aggression:      blend(norm(aggressionRaw/5), prev?.aggression),
    stealth:         blend(norm((1 - (stats.combats_initiated>0 ? 0.6 : 0) - (stats.deaths>0 ? 0.2 : 0))), prev?.stealth),
    curiosity:       blend(norm(curiosityRaw/5), prev?.curiosity),
    puzzle_affinity: blend(norm(puzzleRaw/3), prev?.puzzle_affinity),
    independence:    blend(norm(independenceRaw), prev?.independence),
    resilience:      blend(norm(resilienceRaw/3), prev?.resilience),
    goal_focus:      blend(norm(goalRaw/1.4), prev?.goal_focus)
  };
  return roundTraits(t);
}

function round(n:number){ return Number(n.toFixed(2)); }
export function roundTraits(t:Traits):Traits {
  return {
    aggression:round(t.aggression), stealth:round(t.stealth), curiosity:round(t.curiosity),
    puzzle_affinity:round(t.puzzle_affinity), independence:round(t.independence),
    resilience:round(t.resilience), goal_focus:round(t.goal_focus)
  };
}

export function personaText(t: Traits): string {
  const bits:string[] = [];
  if (t.puzzle_affinity>0.6) bits.push("puzzle-leaning");
  if (t.curiosity>0.6) bits.push("exploration-oriented");
  if (t.aggression>0.5) bits.push("combat-inclined");
  if (t.independence>0.6) bits.push("rarely uses hints");
  if (t.resilience>0.6) bits.push("bounces back after failures");
  if (bits.length===0) bits.push("balanced playstyle");
  return `Shows ${bits.join(", ")}; goal focus ${Math.round(t.goal_focus*100)}%.`;
}

export function topSignals(stats: Stats): string[] {
  const s:string[] = [];
  if (stats.riddles_correct>0) s.push(`Solved ${stats.riddles_correct} riddle(s)`);
  if (stats.combats_initiated>0) s.push(`Started ${stats.combats_initiated} combat(s), won ${stats.combats_won}`);
  if (stats.collectibles_found>0) s.push(`Found ${stats.collectibles_found} collectible(s)`);
  if (stats.hints_used>0) s.push(`Used ${stats.hints_used} hint(s)`);
  if (stats.retries>0) s.push(`Retried ${stats.retries} time(s)`);
  return s.slice(0,3);
}
