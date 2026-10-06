import type { AgentId, Finding, GameSnapshot, HudZone } from '@crewstrike/shared';

export type { Finding };

export interface Agent {
  id: AgentId;
  /** Zones that glow when this agent speaks. */
  owns: readonly HudZone[];
  /** Pure-ish function over the snapshot returning ranked findings; may keep small private memory. */
  step(s: GameSnapshot): Finding[];
  /** One-line status for the crew strip tooltip. */
  status(s: GameSnapshot): string;
}

export interface Tagged extends Finding {
  agent: AgentId;
}

export type Chatter = 'tips' | 'key' | 'critical';
