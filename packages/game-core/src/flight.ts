import type { ControlState } from './controls';
import { DEG, clamp, compass, copyInto, dist2d, forward, wrapPi, type V3 } from './math';
import { range } from './rng';
import { planRoute, type Hazard } from './route';
import { BURN_KG_S, CRUISE_SPEED, THROTTLE_SPEEDS, pushEvent, type GameState } from './state';
import { surfaceHeight } from './terrain';
import { inActiveStorm } from './weather';

export const GROUND_FLOOR = 150;
const MAX_PITCH = 60 * DEG;
const CEILING = 7000;

/** Autopilot is a difficulty lever: always, out of combat only, or off. */
export function autopilotAllowed(s: GameState): boolean {
  const mode = s.profile.autopilot;
  if (mode === 'off') return false;
  if (mode === 'outOfCombat') return !isInCombat(s);
  return true;
}

export function isInCombat(s: GameState): boolean {
  return s.t < s.inCombatUntil;
}

/** Ground positions of the current dangers, for route planning. */
export function hazardsOf(s: GameState): Hazard[] {
  const out: Hazard[] = [];
  const skill = s.profile.enemySkill;
  for (const e of s.enemies) {
    if (!e.alive) continue;
    if (e.kind === 'sam') out.push({ x: e.pos[0], z: e.pos[2], r: 12000 * (0.85 + 0.3 * skill), w: 1 });
    else if (e.kind === 'aaa') out.push({ x: e.pos[0], z: e.pos[2], r: 3000, w: 0.6 });
    else if (e.kind === 'ship') out.push({ x: e.pos[0], z: e.pos[2], r: 9000, w: 0.8 });
    else if (e.kind === 'fighter') out.push({ x: e.pos[0], z: e.pos[2], r: 7000, w: 0.9 });
    else out.push({ x: e.pos[0], z: e.pos[2], r: 2500, w: 0.15 });
  }
  return out;
}

/** Where the active route leads right now. */
export function routeDestination(s: GameState): V3 {
  const p = s.player;
  if (p.waypoint) return p.waypoint;
  const toExit = p.route === 'exit' || !s.target.alive;
  if (toExit) return s.mission.exit.center;
  if (s.training && s.training.step === 0) {
    const ring = s.training.rings[s.training.ringIndex];
    if (ring) return ring;
  }
  return s.target.pos;
}

/** Set a route; 'safest', 'north' and 'south' compute a detour waypoint toward the current objective. */
export function applyRoute(s: GameState, route: GameState['player']['route']): string {
  const p = s.player;
  const dest = !s.target.alive || route === 'exit' ? s.mission.exit.center : s.target.pos;
  p.waypoint = null;
  if (route === 'safest' || route === 'north' || route === 'south') {
    const plan = planRoute([p.pos[0], p.pos[2]], [dest[0], dest[2]], hazardsOf(s));
    let wp = plan.waypoint;
    if (route === 'north' || route === 'south') {
      // Force a detour to the requested side.
      const dx = dest[0] - p.pos[0];
      const dz = dest[2] - p.pos[2];
      const d = Math.hypot(dx, dz) || 1;
      const mx = p.pos[0] + dx / 2;
      const mz = p.pos[2] + dz / 2;
      const sign = route === 'north' ? -1 : 1;
      wp = [mx, mz + sign * Math.min(8000, d * 0.4)];
    }
    if (wp) p.waypoint = [wp[0], Math.max(p.pos[1], 900), wp[1]];
    p.route = !s.target.alive ? 'exit' : 'target';
    return plan.label;
  }
  p.route = route === 'none' ? 'target' : route;
  return route;
}

function autopilotStick(s: GameState): [number, number] {
  const p = s.player;
  if (p.waypoint && dist2d(p.pos, p.waypoint) < 2000) p.waypoint = null;
  const dest = routeDestination(s);
  const desired = compass(p.pos, dest) * DEG;
  const dh = wrapPi(desired - p.heading);
  const sx = clamp(dh * 2.2, -1, 1);

  // Hold about 600 m above the highest ground in the next 4 km.
  const fwd = forward(p.heading, 0);
  let groundMax = 0;
  for (let k = 0; k <= 4; k++) {
    const g = surfaceHeight(s.mission.terrain, p.pos[0] + fwd[0] * k * 1000, p.pos[2] + fwd[2] * k * 1000);
    groundMax = Math.max(groundMax, g);
  }
  let wantY = groundMax + 600;
  if (s.training && s.training.step === 0) {
    const ring = s.training.rings[s.training.ringIndex];
    if (ring) wantY = Math.max(ring[1], groundMax + 150);
  }
  const wantPitch = clamp((wantY - p.pos[1]) / 1500, -0.22, 0.3);
  const sy = clamp((wantPitch - p.pitch) * 4, -1, 1);
  return [sx, sy];
}

export function updatePlayer(s: GameState, c: ControlState, dt: number): void {
  const p = s.player;
  const prof = s.profile;
  copyInto(p.prevPos, p.pos);
  p.prevHeading = p.heading;
  p.prevPitch = p.pitch;
  p.prevBank = p.bank;

  const stickActive = Math.abs(c.stickX) > 0.15 || Math.abs(c.stickY) > 0.15;
  if (p.autopilot && stickActive) {
    p.autopilot = false;
    pushEvent(s, { type: 'phase', detail: 'autopilot_off' });
  }
  if (p.autopilot && !autopilotAllowed(s)) {
    p.autopilot = false;
    pushEvent(s, { type: 'phase', detail: 'autopilot_combat' });
  }

  let sx: number;
  let sy: number;
  if (p.autopilot) {
    [sx, sy] = autopilotStick(s);
  } else {
    sx = clamp(c.stickX * prof.sensitivity, -1, 1);
    sy = clamp(c.stickY * prof.sensitivity, -1, 1);
  }

  if (inActiveStorm(s, p.pos)) {
    sx += Math.sin(s.t * 6.3) * 0.15 + range(s.rng, -0.12, 0.12);
    sy += Math.sin(s.t * 4.1 + 1) * 0.12 + range(s.rng, -0.1, 0.1);
  }

  if (p.stalled) {
    sx *= 0.4;
    sy = Math.min(sy, 0) * 0.4 - 0.4;
  }

  const speedFactor = clamp(230 / p.speed, 0.65, 1.4);
  const maxYaw = 0.8 * speedFactor;
  let pitchRate: number;
  if (prof.steering === 'manual') {
    p.bank = clamp(p.bank + sx * 2.2 * dt, -85 * DEG, 85 * DEG);
    p.yawRate = clamp((maxYaw * Math.sin(p.bank)) / Math.sin(60 * DEG), -maxYaw * 1.15, maxYaw * 1.15);
    pitchRate = sy * 0.75 * Math.cos(p.bank);
  } else {
    p.yawRate += (sx * maxYaw - p.yawRate) * Math.min(1, dt * 6);
    const targetBank = clamp(p.yawRate / maxYaw, -1, 1) * 65 * DEG;
    p.bank += (targetBank - p.bank) * Math.min(1, dt * 5);
    pitchRate = sy * (prof.steering === 'assisted' ? 0.6 : 0.7);
  }
  p.heading = wrapPi(p.heading + p.yawRate * dt);
  p.pitch += pitchRate * dt;
  if (prof.autoLevel && Math.abs(sy) < 0.05 && !p.autopilot) p.pitch -= p.pitch * Math.min(1, 1.5 * dt);

  // Ground protection: predicted height above ground two seconds out.
  const t = s.mission.terrain;
  const fwd0 = forward(p.heading, p.pitch);
  const groundHere = surfaceHeight(t, p.pos[0], p.pos[2]);
  const ax = p.pos[0] + fwd0[0] * p.speed * 2;
  const az = p.pos[2] + fwd0[2] * p.speed * 2;
  const groundAhead = Math.max(surfaceHeight(t, ax, az), surfaceHeight(t, (p.pos[0] + ax) / 2, (p.pos[2] + az) / 2));
  const predicted = p.pos[1] + fwd0[1] * p.speed * 2 - Math.max(groundHere, groundAhead);
  p.groundWarn = predicted < GROUND_FLOOR * 1.4 || p.agl < GROUND_FLOOR * 0.8;
  if (predicted < GROUND_FLOOR) {
    if (prof.groundProtection === 'auto') p.pitch += (0.4 - p.pitch) * Math.min(1, dt * 5);
    else if (prof.groundProtection === 'gentle') p.pitch += 0.35 * dt;
  }
  if (p.pos[1] > CEILING) p.pitch -= 0.3 * dt;
  p.pitch = clamp(p.pitch, -MAX_PITCH, MAX_PITCH);

  // Speed: throttle notch plus boost; climbing bleeds speed.
  const wantBoost = (c.boost || p.boostCommand) && p.boostEnergy > 0.02 && p.fuel > 0;
  p.boost = wantBoost;
  let target: number = THROTTLE_SPEEDS[p.throttle];
  if (wantBoost) {
    target *= 1.45;
    p.boostEnergy = Math.max(0, p.boostEnergy - dt / 6);
    if (p.boostEnergy <= 0.02) p.boostCommand = false;
  } else {
    p.boostEnergy = Math.min(1, p.boostEnergy + dt / 10);
  }
  target -= 70 * Math.sin(p.pitch);
  p.speed += (target - p.speed) * Math.min(1, dt * (target > p.speed ? 0.9 : 0.6));

  if (prof.stall === 'real') {
    if (!p.stalled && p.speed < 150) {
      p.stalled = true;
      pushEvent(s, { type: 'phase', detail: 'stall' });
    } else if (p.stalled && p.speed > 185) p.stalled = false;
    p.stallWarn = p.speed < 175;
  } else if (prof.stall === 'recover') {
    p.stallWarn = p.speed < 170;
    if (p.speed < 160) p.pitch -= 0.4 * dt;
    p.speed = Math.max(p.speed, 150);
  } else {
    p.stallWarn = false;
    p.speed = Math.max(p.speed, 160);
  }

  // Integrate.
  const fwd = forward(p.heading, p.pitch);
  p.vel[0] = fwd[0] * p.speed + s.wind[0];
  p.vel[1] = fwd[1] * p.speed;
  p.vel[2] = fwd[2] * p.speed + s.wind[2];
  p.pos[0] += p.vel[0] * dt;
  p.pos[1] += p.vel[1] * dt;
  p.pos[2] += p.vel[2] * dt;
  p.climbRate = p.vel[1];

  const ground = surfaceHeight(t, p.pos[0], p.pos[2]);
  if (prof.groundProtection === 'auto' && p.pos[1] - ground < 40) {
    p.pos[1] = ground + 40;
    p.pitch = Math.max(p.pitch, 0.1);
  }
  p.agl = p.pos[1] - ground;

  // Soft world boundary: steer back toward the mission area.
  const r = Math.hypot(p.pos[0] - s.target.pos[0] / 2, p.pos[2] - s.target.pos[2] / 2);
  if (r > 45000) {
    const home = compass(p.pos, [s.target.pos[0] / 2, 0, s.target.pos[2] / 2]) * DEG;
    p.heading = wrapPi(p.heading + clamp(wrapPi(home - p.heading), -0.6 * dt, 0.6 * dt));
  }

  // Fuel.
  const burn = BURN_KG_S[p.throttle] * (wantBoost ? 2.5 : 1) * prof.fuelBurn;
  p.fuel = Math.max(0, p.fuel - burn * dt);
}

/** Fuel needed to fly from here to the exit at cruise, with a 10% margin. */
export function fuelToExit(s: GameState): number {
  const d = dist2d(s.player.pos, s.mission.exit.center) - s.mission.exit.radius * 0.5;
  return (Math.max(0, d) / CRUISE_SPEED) * BURN_KG_S[1] * s.profile.fuelBurn * 1.1 + 20;
}

export function minutesToExit(s: GameState): number {
  const d = Math.max(0, dist2d(s.player.pos, s.mission.exit.center) - s.mission.exit.radius * 0.5);
  return d / CRUISE_SPEED / 60;
}
