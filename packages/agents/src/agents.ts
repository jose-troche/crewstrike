import { ZONE_OWNERS, type Finding } from '@crewstrike/shared';
import { planRoute, type Hazard } from '@crewstrike/game-core';
import type { Agent } from './types';
import { clockOf, countWord, fromCompass, nearest, plural, side } from './words';

const pct = (v: number): number => Math.round(v * 100);
const sideClip = (b: number): string => `missile_${side(b)}`;

/** Radar: enemies, locks, missiles. Owns the radar and the threat ring. */
export function radarAgent(): Agent {
  return {
    id: 'radar',
    owns: ZONE_OWNERS.radar,
    step(s) {
      const out: Finding[] = [];
      const missile = nearest(s.threats, t => t.kind === 'missile');
      if (missile) {
        const sd = side(missile.bearing);
        out.push({
          key: 'missile', rank: 2, level: 'red', ttlMs: 2500, clip: sideClip(missile.bearing),
          text: `Missile, ${sd}! Flares.`,
          detail: `Inbound ${missile.km} km, impact in ${Math.round(missile.tti ?? 0)} s. Fire flares and turn hard.`,
        });
      }
      const lockers = s.threats.filter(t => t.state === 'locked');
      const lock = lockers[0];
      if (lock) {
        const what = lock.kind === 'fighter' ? 'Fighter locking' : lock.kind === 'ship' ? 'Ship lock' : 'SAM lock';
        out.push({
          key: 'locked', rank: 3, level: 'amber', ttlMs: 3000,
          clip: lock.kind === 'fighter' ? 'fighter_locking' : 'sam_lock',
          text: `${what}, ${clockOf(lock.bearing)}!`,
          detail: lock.kind === 'fighter'
            ? 'A fighter is behind you lining up a shot. Turn hard or boost away.'
            : 'A missile site is about to fire. Drop behind terrain, or get ready to flare.',
        });
      }
      const tracking = s.threats.find(t => (t.kind === 'sam' || t.kind === 'ship') && t.state === 'tracking');
      if (tracking && !lock) {
        out.push({
          key: 'tracking', rank: 7, level: 'amber', ttlMs: 4000,
          text: `SAM tracking, ${clockOf(tracking.bearing)}. Stay low.`,
          detail: 'Flying low behind hills breaks its radar lock (terrain masking).',
        });
      }
      const fighters = s.threats.filter(t => t.kind === 'fighter' && (t.state === 'chase' || t.state === 'attack') && t.km < 12);
      if (fighters.length > 0 && !lock) {
        const f = fighters[0]!;
        out.push({
          key: `fighters-${fighters.length}`, rank: 7, level: 'amber', ttlMs: 4000, clip: 'fighters_closing',
          text: `${countWord(fighters.length)} ${plural(fighters.length, 'fighter')} closing from ${fromCompass(f.compass)}.`,
          detail: `Nearest ${f.km} km at ${clockOf(f.bearing)}. Lock with the ring, then F for a heat-seeker.`,
        });
      }
      const swarm = s.threats.find(t => t.kind === 'drone' && t.state === 'chase' && t.km < 6);
      if (swarm) {
        out.push({
          key: 'drones', rank: 7, level: 'amber', ttlMs: 4000, clip: 'drones',
          text: `Drones ×${swarm.count ?? 1}, ${clockOf(swarm.bearing)}.`,
          detail: 'Drones are slow; the cannon works best. Do not let them ram you.',
        });
      }
      const flak = s.threats.find(t => (t.kind === 'aaa') && t.state === 'tracking');
      if (flak) {
        out.push({
          key: 'flak', rank: 7, level: 'amber', ttlMs: 3500, clip: 'flak',
          text: 'Flak zone! Get through fast.',
          detail: 'Anti-aircraft guns cover the orange area on radar. Boost through or go around.',
        });
      }
      return out;
    },
    status(s) {
      const f = s.threats.filter(t => t.kind === 'fighter').length;
      const m = s.threats.filter(t => t.kind === 'missile').length;
      const sams = s.threats.filter(t => (t.kind === 'sam' || t.kind === 'ship') && t.state !== 'idle').length;
      if (f + m + sams === 0) return 'Radar: clear.';
      const parts: string[] = [];
      if (m) parts.push(`${m} ${plural(m, 'missile')} inbound`);
      if (f) parts.push(`${f} ${plural(f, 'fighter')}`);
      if (sams) parts.push(`${sams} ${plural(sams, 'site')} active`);
      return `Radar: ${parts.join(', ')}.`;
    },
  };
}

/** Weapons: ammo, locks, targets in range. Owns weapon cards and flares. */
export function weaponsAgent(): Agent {
  return {
    id: 'weapons',
    owns: ZONE_OWNERS.weapons,
    step(s) {
      const out: Finding[] = [];
      const w = s.weapons;
      if (w.strikeAvailable) {
        if (w.strikeLock === 'locked') {
          out.push({ key: 'strike-locked', rank: 6, level: 'green', ttlMs: 4000, clip: 'strike_locked', text: 'Strike locked. Press G to fire!', detail: 'The strike missile flies an arc to the target. Then turn for home.' });
        } else if (w.strikeLock === 'none') {
          out.push({ key: 'strike-ready', rank: 6, level: 'green', ttlMs: 5000, clip: 'strike_ready', text: 'Strike missile in range. Press G.', detail: 'Point roughly at the magenta target, press G to lock, press G again to fire.' });
        }
      }
      if (w.lock === 'locked' && w.missiles > 0) {
        out.push({ key: 'lock', rank: 6, level: 'green', ttlMs: 2500, text: `Locked${w.lockKm ? ` ${w.lockKm} km` : ''}. Fire missile!`, detail: 'Press F to launch a heat-seeker at the locked target.' });
      }
      if (w.rounds > 0 && w.rounds < 100) {
        out.push({ key: 'cannon-low', rank: 7, level: 'amber', ttlMs: 4000, text: `Cannon low: ${w.rounds} rounds.`, detail: 'Short bursts. Save missiles for fighters.' });
      }
      if (w.missiles === 0) {
        out.push({ key: 'missiles-out', rank: 7, level: 'amber', ttlMs: 4000, clip: 'out_of_missiles', text: 'Out of missiles. Use the cannon.', detail: 'Heat-seekers are gone; get close and use the cannon lead marker.' });
      }
      if (w.flares > 0 && w.flares <= 3) {
        out.push({ key: 'flares-low', rank: 7, level: 'amber', ttlMs: 4000, text: `Flares low: ${w.flares} left.`, detail: 'Save flares for missiles that are actually launched (red wedge).' });
      }
      return out;
    },
    status(s) {
      const w = s.weapons;
      return `Weapons: ${w.rounds} rounds, ${w.missiles} ${plural(w.missiles, 'missile')}, ${w.strike} strike, ${w.flares} flares.`;
    },
  };
}

/** Flight: fuel versus distance home, damage, terrain. Owns damage, fuel, speed and altitude. */
export function flightAgent(): Agent {
  return {
    id: 'flight',
    owns: ZONE_OWNERS.flight,
    step(s) {
      const out: Finding[] = [];
      const o = s.own;
      if ((o.groundWarn && o.climbRate < 0) || (o.agl < 150 && o.climbRate < 0)) {
        out.push({ key: 'pull-up', rank: 1, level: 'red', text: 'Pull up!', ttlMs: 1500, clip: 'pull_up', detail: 'Ground ahead. Pull the stick back now.' });
      }
      if (o.stalled) out.push({ key: 'stall', rank: 1, level: 'red', text: 'Stall! Nose down, throttle up.', ttlMs: 2000, clip: 'stall', detail: 'Too slow to fly. Lower the nose and add throttle.' });
      else if (o.stallWarn) out.push({ key: 'slow', rank: 4, level: 'amber', text: 'Speed low. Throttle up.', ttlMs: 3000, detail: 'Climbing hard at low throttle bleeds speed.' });
      if (s.damage >= 0.6) out.push({ key: 'damage-heavy', rank: 4, level: 'red', text: `Heavy damage: ${pct(s.damage)}%.`, ttlMs: 4000, clip: 'heavy_damage', detail: 'One or two more hits will bring you down. Avoid fights and head for the exit.' });
      else if (s.damage >= 0.3) out.push({ key: 'damage', rank: 4, level: 'amber', text: `Damage ${pct(s.damage)}%. Avoid hits.`, ttlMs: 4000, detail: 'Amber or red sections on the jet silhouette show where you were hit.' });
      const margin = s.fuel.kg / Math.max(s.fuel.needToExitKg, 1);
      if (margin < 1.15 || s.fuel.fraction < 0.2) {
        out.push({
          key: 'fuel-home', rank: 5, level: margin < 1 ? 'red' : 'amber', ttlMs: 6000,
          clip: margin < 1 ? 'bingo_fuel' : 'fuel_low',
          text: `Fuel: ${Math.max(1, Math.round(s.nav.minutesToExit))} min to exit.`,
          detail: `${s.fuel.kg} kg left; about ${s.fuel.needToExitKg} kg needed to reach the exit. Avoid boost.`,
        });
      }
      for (const e of s.events) {
        if (e.type === 'hit') {
          const where = e.bearing === undefined ? 'body' : Math.abs(e.bearing) < 45 ? 'nose' : Math.abs(e.bearing) > 135 ? 'tail' : e.bearing < 0 ? 'left wing' : 'right wing';
          out.push({ key: 'hit', repeat: true, rank: 4, level: 'amber', ttlMs: 2500, clip: 'hit', text: `Hit, ${where}!`, detail: `Damage now ${pct(s.damage)}%.` });
        }
      }
      return out;
    },
    status(s) {
      return `Flight: fuel ${pct(s.fuel.fraction)}%, damage ${pct(s.damage)}%, ${s.nav.minutesToExit} min to exit.`;
    },
  };
}

/** Mission: phase, route risk, exit. Owns the objective marker, phase chip and mission bar. */
export function missionAgent(): Agent {
  let lastRouteAt = -60000;
  let lastExitAt = -60000;
  let behindSince = -1;
  return {
    id: 'mission',
    owns: ZONE_OWNERS.mission,
    step(s) {
      const out: Finding[] = [];
      for (const e of s.events) {
        if (e.type === 'target_destroyed') out.push({ key: 'target-destroyed', rank: 6, level: 'green', ttlMs: 5000, clip: 'target_destroyed', text: 'Target destroyed! Head for exit.', detail: 'Follow the arrow to the green exit zone.' });
        if (e.type === 'phase' && e.detail === 'strike') out.push({ key: 'strike-zone', rank: 6, level: 'green', ttlMs: 4000, clip: 'strike_zone', text: 'Strike zone. Lock the target.', detail: 'Inside the magenta circle the strike missile can lock.' });
        if (e.type === 'phase' && e.detail === 'autopilot_combat') out.push({ key: 'ap-combat', rank: 7, level: 'amber', ttlMs: 3000, clip: 'autopilot_off', text: 'Autopilot off: combat.', detail: 'At this difficulty autopilot only flies outside combat.' });
        if (e.type === 'phase' && e.detail === 'autopilot_off') out.push({ key: 'ap-off', rank: 8, level: 'info', ttlMs: 2500, text: 'Autopilot off. You have control.' });
      }
      if (s.training) return out;
      if (s.target.alive && !s.nav.inStrikeZone && s.nav.kmToStrikeZone < 3) {
        out.push({ key: 'strike-ahead', rank: 6, level: 'info', ttlMs: 4000, text: `Target ${s.nav.kmToTarget} km. Strike zone ahead.` });
      }
      // Route advice: a safer detour exists while sites are tracking you.
      const active = s.threats.some(t => (t.kind === 'sam' || t.kind === 'ship') && t.state !== 'idle' && t.state !== 'cooldown');
      if (s.target.alive && active && s.now - lastRouteAt > 30000) {
        const hazards: Hazard[] = s.threats
          .filter(t => t.kind !== 'missile')
          .map(t => {
            const r = t.km * 1000;
            const a = (t.compass * Math.PI) / 180;
            return { x: Math.sin(a) * r, z: -Math.cos(a) * r, r: t.kind === 'sam' ? 12000 : t.kind === 'aaa' ? 3000 : 7000, w: t.danger };
          });
        const ta = ((s.own.heading + s.nav.targetBearing) * Math.PI) / 180;
        const dest: [number, number] = [Math.sin(ta) * s.nav.kmToTarget * 1000, -Math.cos(ta) * s.nav.kmToTarget * 1000];
        const plan = planRoute([0, 0], dest, hazards);
        if (plan.waypoint && plan.directExposure - plan.exposure > 0.3) {
          lastRouteAt = s.now;
          out.push({ key: 'route', rank: 7, level: 'info', ttlMs: 5000, text: `Safer route: ${plan.label} side.`, detail: `Say "go ${plan.label}" or ask "which route?" to set it.` });
        }
      }
      if (!s.target.alive && s.now - lastExitAt > 40000) {
        lastExitAt = s.now;
        out.push({ key: 'exit', rank: 7, level: 'info', ttlMs: 4000, clip: 'head_home', text: `Exit ${s.nav.kmToExit} km, ${clockOf(s.nav.exitBearing)}.` });
      }
      const margin = s.fuel.kg / Math.max(s.fuel.needToExitKg, 1);
      if (s.target.alive && (margin < 1.05 || s.damage > 0.75)) {
        out.push({ key: 'abort', rank: 7, level: 'amber', ttlMs: 5000, clip: 'abort', text: 'Recommend abort. Head home.', detail: 'Reaching the exit now still scores partial points. Say "head home".' });
      }
      const behind = Math.abs(s.target.alive ? s.nav.targetBearing : s.nav.exitBearing) > 120;
      if (behind && behindSince < 0) behindSince = s.now;
      if (!behind) behindSince = -1;
      if (behind && behindSince >= 0 && s.now - behindSince > 6000 && !s.inCombat) {
        out.push({ key: 'turn-around', rank: 8, level: 'info', ttlMs: 4000, text: 'Objective behind you. Follow the arrow.', detail: 'The magenta arrow at the screen edge always points to the objective.' });
      }
      return out;
    },
    status(s) {
      const phase = s.phase[0]!.toUpperCase() + s.phase.slice(1);
      return s.target.alive
        ? `Mission: ${phase}, target ${s.nav.kmToTarget} km.`
        : `Mission: ${phase}, exit ${s.nav.kmToExit} km.`;
    },
  };
}

/** Weather: storms, clouds, wind. Owns the weather gauge. */
export function weatherAgent(): Agent {
  let windTold = false;
  return {
    id: 'weather',
    owns: ZONE_OWNERS.weather,
    step(s) {
      const out: Finding[] = [];
      const w = s.weather;
      if (w.inStorm) {
        out.push({ key: 'in-storm', rank: 7, level: 'info', ttlMs: 4000, text: 'In storm: hidden, radar static.', detail: 'Enemy radar cannot see you in here, but lightning can hit you.' });
      } else if (w.stormKm !== null && w.stormKm < 6 && w.stormBearing !== null && Math.abs(w.stormBearing) < 60) {
        const blind = Math.round(8000 / Math.max(150, s.own.speed));
        out.push({ key: 'storm-ahead', rank: 7, level: 'amber', ttlMs: 5000, clip: 'storm', text: `Storm ahead: radar blind ${blind} seconds.`, detail: 'Storms hide you from enemies but cause turbulence and lightning.' });
      }
      for (const e of s.events) if (e.type === 'lightning') out.push({ key: 'lightning', repeat: true, rank: 4, level: 'amber', ttlMs: 3000, clip: 'lightning', text: 'Lightning hit! Leave the storm.' });
      if (!windTold && w.windKt >= 20 && s.now > 15000) {
        windTold = true;
        out.push({ key: 'wind', rank: 8, level: 'info', ttlMs: 4000, text: `Strong wind from ${fromCompass(w.windFrom)}: ${w.windKt} knots.`, detail: 'Wind pushes the jet sideways a little; the autopilot corrects for it.' });
      }
      return out;
    },
    status(s) {
      const w = s.weather;
      const storm = w.inStorm ? 'inside a storm' : w.stormKm !== null ? `storm ${w.stormKm} km` : 'no storms';
      return `Weather: wind ${w.windKt} kt from ${fromCompass(w.windFrom)}, ${storm}.`;
    },
  };
}

/** Wingman: tips, kills and training prompts; also the single voice (see the arbiter). */
export function wingmanAgent(): Agent {
  const tipped = new Set<string>();
  return {
    id: 'wingman',
    owns: ZONE_OWNERS.wingman,
    step(s) {
      const out: Finding[] = [];
      for (const e of s.events) {
        if (e.type === 'kill') out.push({ key: 'kill', repeat: true, rank: 8, level: 'green', ttlMs: 3000, clip: 'splash', text: e.detail === 'drone' ? 'Drone down. Nice shooting.' : 'Splash one! Good kill.' });
        if (e.type === 'decoyed') out.push({ key: 'decoy', repeat: true, rank: 8, level: 'green', ttlMs: 2500, text: 'Missile decoyed. Nice flares.' });
      }
      if (s.trainingStep) {
        out.push({ key: `train-${s.trainingStep.index}-${s.trainingStep.text}`, rank: 6, level: 'info', ttlMs: 6000, text: s.trainingStep.text + '.' });
        return out;
      }
      const tip = (key: string, text: string, detail: string): void => {
        if (tipped.has(key)) return;
        tipped.add(key);
        out.push({ key: `tip-${key}`, rank: 8, level: 'info', ttlMs: 5000, text, detail });
      };
      if (s.now > 3000 && s.now < 60000) tip('arrow', 'Follow the magenta arrow to target.', 'The arrow and distance at the screen edge always lead to the current objective.');
      if (s.now > 12000 && !s.own.autopilot && s.own.autopilotAllowed && s.phase === 'ingress') tip('autopilot', 'Press R: autopilot flies the route.', 'Autopilot steers to the objective while you handle weapons. Any stick input takes over.');
      if (s.threats.some(t => t.kind === 'fighter' && t.km < 6)) tip('lock', 'Keep fighters in the ring to lock.', 'Hold a fighter inside the circle until the lock tone, then press F.');
      if (s.weapons.strikeAvailable) tip('strike', 'Press G twice: lock, then fire.', 'Strike missiles only work inside the magenta strike zone.');
      return out;
    },
    status(s) {
      return s.inCombat ? 'Wingman: in the fight with you.' : 'Wingman: on comms. Press / or hold V to ask.';
    },
  };
}

export function createAgents(): Agent[] {
  return [radarAgent(), weaponsAgent(), flightAgent(), missionAgent(), weatherAgent(), wingmanAgent()];
}

