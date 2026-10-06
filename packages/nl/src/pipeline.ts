import type { CommandSink, GameSnapshot, NlResult } from '@crewstrike/shared';
import { advise } from './advisor';
import { classify } from './classify';
import { matchCommand } from './grammar';
import { matchHowTo } from './help';
import { bare, normalize } from './normalize';
import { matchTactical } from './tactical';

/**
 * Every utterance or typed line passes through the same pipeline and stops at the first step that
 * handles it. Everything here is local and synchronous; only the phrasing of a strategic reason
 * may later be improved by a model (see the web voice router).
 */
export function handle(text: string, s: GameSnapshot, g: CommandSink): NlResult {
  const t = normalize(text);
  if (!t) return { kind: 'unknown', text: 'Say again?' };
  const b = bare(t);

  const confirm = matchCommand(b, g);
  if (confirm) return { kind: 'command', confirm };

  const card = matchHowTo(b);
  if (card) return { kind: 'howto', text: card.answer, highlight: card.highlight };

  const kind = classify(t);
  if (kind) return { kind: 'strategic', advice: advise(kind, s) };

  const ans = matchTactical(t, s);
  if (ans) return { kind: 'tactical', text: ans.text, glow: ans.glow, agent: ans.agent };

  return { kind: 'unknown', text: 'Say again? Try "fuel?" or "should I escape?"' };
}
