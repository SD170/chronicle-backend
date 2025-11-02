// src/policyService.ts
import type { Traits } from './types.ts';

export type Knobs = {
  enemy_count:number; enemy_speed:number; puzzle_gate_ratio:number;
  collectible_density:number; hint_delay_ms:number; breadcrumb_brightness:number;
};

const clamp = (v:number,min:number,max:number)=> Math.max(min, Math.min(max, v));
const lerp = (a:number,b:number,t:number)=> a + (b-a)*t;

export function computeKnobs(t: Traits, mode:'fun'|'challenge', intensity=0.5): Knobs {
  const baseEnemies = clamp( Math.round(1 + t.aggression*3), 0, 6 );
  const baseSpeed   = clamp( 0.8 + t.aggression*0.8, 0.5, 1.5 );
  const basePuzzles = clamp( 0.3 + t.puzzle_affinity*0.6, 0, 1 );
  const baseCollect = clamp( 0.2 + t.curiosity*0.7, 0, 1 );
  const baseHintMs  = Math.round( (1 - t.independence) * 15000 );
  const baseCrumbs  = clamp( 0.3 + t.curiosity*0.6, 0, 1 );

  let k:Knobs = {
    enemy_count: baseEnemies,
    enemy_speed: baseSpeed,
    puzzle_gate_ratio: basePuzzles,
    collectible_density: baseCollect,
    hint_delay_ms: baseHintMs,
    breadcrumb_brightness: baseCrumbs
  };

  const s = intensity;
  if (mode==='fun') {
    k.enemy_count = clamp(Math.round(lerp(k.enemy_count, Math.max(1, baseEnemies-1), s)), 0, 6);
    k.enemy_speed = clamp(lerp(k.enemy_speed, Math.max(0.7, baseSpeed-0.2), s), 0.5, 1.5);
    k.puzzle_gate_ratio = clamp(lerp(k.puzzle_gate_ratio, k.puzzle_gate_ratio + 0.2*(t.puzzle_affinity>t.aggression?1:0), s),0,1);
    k.collectible_density = clamp(lerp(k.collectible_density, baseCollect + 0.2, s),0,1);
    k.hint_delay_ms = Math.round(lerp(k.hint_delay_ms, 0, s));
    k.breadcrumb_brightness = clamp(lerp(k.breadcrumb_brightness, Math.max(k.breadcrumb_brightness, 0.9), s),0,1);
  } else {
    k.enemy_count = clamp(Math.round(lerp(k.enemy_count, baseEnemies+1, s)), 0, 6);
    k.enemy_speed = clamp(lerp(k.enemy_speed, baseSpeed+0.2, s), 0.5, 1.5);
    k.puzzle_gate_ratio = clamp(lerp(k.puzzle_gate_ratio, 0.4 + 0.3*(t.puzzle_affinity<0.5?1:0), s),0,1);
    k.collectible_density = clamp(lerp(k.collectible_density, Math.max(0.15, baseCollect-0.25), s),0,1);
    k.hint_delay_ms = Math.round(lerp(k.hint_delay_ms, 15000, s));
    k.breadcrumb_brightness = clamp(lerp(k.breadcrumb_brightness, Math.max(0.2, k.breadcrumb_brightness-0.3), s),0,1);
  }
  return k;
}
