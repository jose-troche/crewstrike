import type { Advice, AdviceAction, GameSnapshot, StrategicKind, Verdict } from '@crewstrike/shared';
import { planRoute, type Hazard, type RoutePlan } from '@crewstrike/game-core';
import { templateReason } from './templates';

const HAZARD_R: Record<string, number> = { sam: 12000, ship: 9000, aaa: 3000, fighter: 7000, drone: 2500, missile: 0 };

/** Threat positions relative to the player (player at origin, x east, z south). */
export function hazardsFromSnapshot(s: GameSnapshot): Hazard[] {
  return s.threats
    .filter(t => t.kind !== 'missile')
    .map(t => {
      const a = (t.compass * Math.PI) / 180;
      const r = t.km * 1000;
      return { x: Math.sin(a) * r, z: -Math.cos(a) * r, r: HAZARD_R[t.kind] ?? 5000, w: Math.max(0.2, t.danger) };
    });
}

export function bestRoute(s: GameSnapshot): RoutePlan {
  const toTarget = s.target.alive;
  const bearing = toTarget ? s.nav.targetBearing : s.nav.exitBearing;
  const d = (toTarget ? s.nav.kmToTarget : s.nav.kmToExit) * 1000;
  const a = ((s.own.heading + bearing) * Math.PI) / 180;
  return planRoute([0, 0], [Math.sin(a) * d, -Math.cos(a) * d], hazardsFromSnapshot(s));
}

export function actionLabel(action: AdviceAction, route: string): string | null {
  switch (action) {
    case 'route_exit': return 'Set route home?';
    case 'route_safest': return `Set route ${route}?`;
    case 'route_target': return 'Set route to target?';
    case 'climb': return 'Climb above the hills?';
    case 'descend': return 'Drop low to hide?';
    default: return null;
  }
}

function make(kind: StrategicKind, verdict: Verdict, facts: Advice['facts'], action: AdviceAction): Advice {
  const route = String(facts.route ?? 'north');
  return { kind, verdict, facts, action, actionLabel: actionLabel(action, route), reason: templateReason(verdict, facts), source: 'template' };
}

/**
 * Deterministic advisor: the verdict always comes from here, from fuel, damage, ammo, threats and distance.
 * The model only phrases the reason.
 */
export function advise(kind: StrategicKind, s: GameSnapshot): Advice {
  const near = s.threats.filter(t => t.km < 20);
  const threat = near.reduce((sum, t) => sum + t.danger, 0);
  const strength = 0.15 * s.weapons.missiles + 0.5 * (1 - s.damage) + 0.2 * s.weapons.cannonPct;
  const fuelMargin = s.fuel.kg / Math.max(s.fuel.needToExitKg, 1);
  const plan = bestRoute(s);
  const fighters = near.filter(t => t.kind === 'fighter').length;
  const facts: Advice['facts'] = {
    threats: near.filter(t => t.danger >= 0.4).length,
    fighters,
    missiles: s.weapons.missiles,
    strike: s.weapons.strike,
    damagePct: Math.round(s.damage * 100),
    fuelPct: Math.round(s.fuel.fraction * 100),
    minutesToExit: Math.round(s.nav.minutesToExit),
    kmToTarget: Math.round(s.nav.kmToTarget),
    strength: Math.round(strength * 100) / 100,
    threat: Math.round(threat * 100) / 100,
    fuelMargin: Math.round(fuelMargin * 100) / 100,
    route: plan.label,
  };

  if (fuelMargin < 1.05 || s.damage > 0.75) return make(kind, 'ABORT', facts, 'route_exit');
  switch (kind) {
    case 'engage_or_avoid':
    case 'escape':
      return strength >= threat
        ? make(kind, 'ENGAGE', facts, 'none')
        : make(kind, kind === 'escape' ? 'ESCAPE' : 'AVOID', facts, 'route_safest');
    case 'route_choice':
      return plan.waypoint && plan.directExposure - plan.exposure > 0.1
        ? make(kind, 'REROUTE', facts, 'route_safest')
        : make(kind, 'CONTINUE', facts, 'route_target');
    case 'abort':
      return s.damage > 0.5 || fuelMargin < 1.3
        ? make(kind, 'ABORT', facts, 'route_exit')
        : make(kind, 'CONTINUE', facts, 'none');
    case 'attack_plan': {
      if (!s.target.alive) return make(kind, 'CONTINUE', facts, 'route_exit');
      const sites = near.some(t => (t.kind === 'sam' || t.kind === 'ship') && t.state !== 'idle');
      if (sites && plan.waypoint) return make(kind, 'REROUTE', facts, 'route_safest');
      return make(kind, 'CONTINUE', facts, 'route_target');
    }
  }
}
