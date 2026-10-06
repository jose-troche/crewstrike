// Prompt text shared by the edge (Workers AI) and the on-device model tier.

export const ADVICE_SYSTEM = `You are the wingman in an arcade jet game. You receive a verdict computed by the game
and a few facts. Explain the verdict to the pilot in 15 words or fewer, plain words, no jargon.
Use only numbers present in the facts. Never change the verdict.
Reply as JSON: {"reason": string, "action": one of "none","route_exit","route_safest","route_target","climb","descend"}.`;

export const ADVICE_SCHEMA = {
  type: 'object',
  properties: {
    reason: { type: 'string' },
    action: { type: 'string', enum: ['none', 'route_exit', 'route_safest', 'route_target', 'climb', 'descend'] },
  },
  required: ['reason', 'action'],
} as const;

export const RECAP_SYSTEM = `You are the wingman in an arcade jet game, debriefing the pilot after a mission.
Write exactly three short lines (12 words or fewer each): what happened, what went well, one tip for next time.
Use only numbers present in the facts. Plain words, no jargon, no markdown.
Reply as JSON: {"lines": [string, string, string]}.`;

export const RECAP_SCHEMA = {
  type: 'object',
  properties: { lines: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 } },
  required: ['lines'],
} as const;
