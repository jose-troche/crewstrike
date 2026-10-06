/// <reference lib="webworker" />
import { AgentRuntime } from '@crewstrike/agents';
import type { ToWorker } from './protocol';

// The six agents run here, off the main thread, so they can never cost a frame.
const runtime = new AgentRuntime('tips');

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'reset') runtime.reset(msg.chatter);
  else if (msg.type === 'chatter') runtime.chatter = msg.chatter;
  else (self as unknown as Worker).postMessage(runtime.tick(msg.snap));
};
