import { AgentRuntime, type Chatter } from '@crewstrike/agents';
import type { AgentOutput, GameSnapshot } from '@crewstrike/shared';
import type { ToWorker } from './workers/protocol';

export interface AgentHost {
  post(snap: GameSnapshot): void;
  reset(chatter: Chatter): void;
  setChatter(chatter: Chatter): void;
  onOutput: (o: AgentOutput) => void;
}

/** Production: agents in a background worker; snapshots go over postMessage at 10 Hz. */
export class WorkerAgentHost implements AgentHost {
  private worker: Worker;
  onOutput: (o: AgentOutput) => void = () => {};
  constructor() {
    this.worker = new Worker(new URL('./workers/agents.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<AgentOutput>) => this.onOutput(e.data);
  }
  private send(m: ToWorker): void {
    this.worker.postMessage(m);
  }
  post(snap: GameSnapshot): void {
    this.send({ type: 'snap', snap });
  }
  reset(chatter: Chatter): void {
    this.send({ type: 'reset', chatter });
  }
  setChatter(chatter: Chatter): void {
    this.send({ type: 'chatter', chatter });
  }
}

/** Test builds: the same runtime, run synchronously so stepped tests are deterministic. */
export class InlineAgentHost implements AgentHost {
  readonly runtime = new AgentRuntime('tips');
  onOutput: (o: AgentOutput) => void = () => {};
  post(snap: GameSnapshot): void {
    this.onOutput(this.runtime.tick(snap));
  }
  reset(chatter: Chatter): void {
    this.runtime.reset(chatter);
  }
  setChatter(chatter: Chatter): void {
    this.runtime.chatter = chatter;
  }
}
