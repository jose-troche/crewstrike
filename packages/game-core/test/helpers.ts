import { createGame, neutralControls, setAutopilot, snapshot, step, type ControlState, type GameState } from '../src';
import type { DifficultyName } from '@crewstrike/shared';

/** Fly a mission on autopilot, locking and firing strike missiles when available, flaring at inbound missiles. */
export function autopilotRun(missionId: string, difficulty: DifficultyName, maxS = 900, log = false): GameState {
  const s = createGame(missionId, { difficulty, seed: 42 });
  setAutopilot(s, true);
  let c: ControlState = neutralControls();
  let frame = 0;
  while (s.status === 'playing' && s.t < maxS) {
    c = neutralControls();
    if (!s.player.autopilot && s.profile.autopilot !== 'off' && frame % 30 === 0) setAutopilot(s, true);
    const snap = frame % 6 === 0 ? snapshot(s) : null;
    if (snap) {
      if (snap.weapons.strikeAvailable && frame % 20 === 0) c.strike = true;
      if (snap.threats.some(t => t.kind === 'missile' && t.km < 2.5) && frame % 30 === 0) c.flare = true;
      if (snap.weapons.lock === 'locked' && frame % 60 === 0) c.missile = true;
      if (log && frame % 600 === 0)
        console.log(Math.round(s.t), snap.phase, snap.nav.kmToTarget, 'agl', snap.own.agl, 'dmg', snap.damage, 'fuel', snap.fuel.kg, 'thr', snap.threats.map(t => `${t.kind}:${t.state}:${t.km}`).join(' '));
    }
    step(s, c);
    frame++;
  }
  return s;
}
