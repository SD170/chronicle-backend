// src/traitEngine.ts
import type { Stats, Traits } from './types.ts';

export function computeTraits(stats: Stats, prev?: Traits): Traits {
  // Mashing intensity affects aggression and goal_focus (high mashing = more aggressive, more focused)
  const mashingBonus = stats.mashing_intensity ? Math.min(stats.mashing_intensity, 1) * 0.3 : 0;
  
  const aggressionRaw   = (stats.combats_initiated * 1.0 + stats.combats_won * 0.5) + mashingBonus;
  const puzzleRaw       = stats.riddles_correct * 1.0 + (stats.riddles_attempted - stats.riddles_correct) * 0.2;
  const curiosityRaw    = stats.collectibles_found * 0.7 + Math.min(stats.distance_traveled/500, 1) * 0.3;
  const resilienceRaw   = stats.retries * 0.8 + stats.deaths * 0.4 - Math.min(stats.time_s/600, 1) * 0.2;
  const independenceRaw = (stats.hint_offers > 0 && stats.hints_used === 0) ? 1 : Math.max(0, 1 - stats.hints_used * 0.5);
  const goalRaw         = (stats.time_s < 180 ? 1 : Math.max(0, 1 - (stats.time_s-180)/300)) + (stats.retries === 0 ? 0.2 : 0) + mashingBonus;

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

/**
 * Generate trait explanations showing how stats affected each trait
 */
export function generateTraitExplanations(
  stats: Stats,
  prevTraits: Traits | undefined,
  newTraits: Traits
): string[] {
  const explanations: string[] = [];
  const prev = prevTraits || {
    aggression: 0.5, stealth: 0.5, curiosity: 0.5,
    puzzle_affinity: 0.5, independence: 0.5, resilience: 0.5, goal_focus: 0.5
  };
  
  const formatChange = (traitName: string, prevVal: number, newVal: number, reason: string) => {
    const change = newVal > prevVal ? 'increased' : newVal < prevVal ? 'decreased' : 'unchanged';
    const prevStr = prevTraits ? prevVal.toFixed(2) : 'default (0.50)';
    return `${traitName}: ${change} from ${prevStr} to ${newVal.toFixed(2)}. ${reason}`;
  };

  // Aggression
  const aggReasons: string[] = [];
  if (stats.combats_initiated > 0) aggReasons.push(`Started ${stats.combats_initiated} combat(s)`);
  if (stats.combats_won > 0) aggReasons.push(`won ${stats.combats_won} combat(s)`);
  if (stats.mashing_intensity && stats.mashing_intensity > 0.5) aggReasons.push(`high button mashing intensity (${(stats.mashing_intensity * 100).toFixed(0)}%)`);
  explanations.push(formatChange(
    'Aggression',
    prev.aggression,
    newTraits.aggression,
    aggReasons.length > 0 ? `Affected by: ${aggReasons.join(', ')}.` : 'No combat activity or mashing detected.'
  ));

  // Stealth
  const stealthReasons: string[] = [];
  if (stats.combats_initiated > 0) stealthReasons.push(`combat engagement (${stats.combats_initiated} combat(s))`);
  if (stats.deaths > 0) stealthReasons.push(`death(s) (${stats.deaths})`);
  explanations.push(formatChange(
    'Stealth',
    prev.stealth,
    newTraits.stealth,
    stealthReasons.length > 0 ? `Decreased due to: ${stealthReasons.join(', ')}.` : 'No combat or deaths detected.'
  ));

  // Curiosity
  const curiosityReasons: string[] = [];
  if (stats.collectibles_found > 0) curiosityReasons.push(`found ${stats.collectibles_found} collectible(s)`);
  if (stats.distance_traveled > 0) curiosityReasons.push(`traveled ${stats.distance_traveled} units`);
  explanations.push(formatChange(
    'Curiosity',
    prev.curiosity,
    newTraits.curiosity,
    curiosityReasons.length > 0 ? `Affected by: ${curiosityReasons.join(', ')}.` : 'Limited exploration and no collectibles found.'
  ));

  // Puzzle Affinity
  const puzzleReasons: string[] = [];
  if (stats.riddles_correct > 0) puzzleReasons.push(`solved ${stats.riddles_correct} riddle(s) correctly`);
  if (stats.riddles_attempted > stats.riddles_correct) puzzleReasons.push(`attempted ${stats.riddles_attempted - stats.riddles_correct} additional riddle(s)`);
  explanations.push(formatChange(
    'Puzzle Affinity',
    prev.puzzle_affinity,
    newTraits.puzzle_affinity,
    puzzleReasons.length > 0 ? `Affected by: ${puzzleReasons.join(', ')}.` : 'No puzzle-solving activity detected.'
  ));

  // Independence
  const indepReasons: string[] = [];
  if (stats.hint_offers > 0 && stats.hints_used === 0) {
    indepReasons.push(`hints offered but none used`);
  } else if (stats.hints_used > 0) {
    indepReasons.push(`used ${stats.hints_used} hint(s)`);
  }
  explanations.push(formatChange(
    'Independence',
    prev.independence,
    newTraits.independence,
    indepReasons.length > 0 ? `Affected by: ${indepReasons.join(', ')}.` : 'No hint activity detected.'
  ));

  // Resilience
  const resReasons: string[] = [];
  if (stats.retries > 0) resReasons.push(`retried ${stats.retries} time(s) after failure`);
  if (stats.deaths > 0) resReasons.push(`experienced ${stats.deaths} death(s) but persisted`);
  if (stats.time_s < 600) resReasons.push(`completed quickly (${stats.time_s}s), potentially avoiding challenges`);
  explanations.push(formatChange(
    'Resilience',
    prev.resilience,
    newTraits.resilience,
    resReasons.length > 0 ? `Affected by: ${resReasons.join(', ')}.` : 'No failure recovery data detected.'
  ));

  // Goal Focus
  const goalReasons: string[] = [];
  if (stats.time_s < 180) goalReasons.push(`fast completion (${stats.time_s}s)`);
  if (stats.retries === 0) goalReasons.push(`no retries needed`);
  if (stats.mashing_intensity && stats.mashing_intensity > 0.5) goalReasons.push(`high button mashing intensity (${(stats.mashing_intensity * 100).toFixed(0)}%) indicating focused effort`);
  explanations.push(formatChange(
    'Goal Focus',
    prev.goal_focus,
    newTraits.goal_focus,
    goalReasons.length > 0 ? `Affected by: ${goalReasons.join(', ')}.` : 'Standard completion time and retries.'
  ));

  return explanations;
}
