import type { GameSnapshot } from '@crewstrike/shared';
import type { Chatter } from '@crewstrike/agents';

export type ToWorker =
  | { type: 'reset'; chatter: Chatter }
  | { type: 'chatter'; chatter: Chatter }
  | { type: 'snap'; snap: GameSnapshot };
