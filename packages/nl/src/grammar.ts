import type { CommandSink, RouteKind, VoiceMode } from '@crewstrike/shared';

export interface Rule {
  re: RegExp;
  run: (g: CommandSink, m: RegExpMatchArray) => void;
  confirm: string | ((m: RegExpMatchArray) => string);
}

/** Instant command grammar: anchored patterns, executed locally in well under 300 ms. */
export const commands: Rule[] = [
  { re: /^(?:fire )?(?:flares?|flare out|pop flares?|deploy flares?|countermeasures)$/, run: g => g.fire('flare'), confirm: 'Flares' },
  { re: /^(?:fire (?:a )?missile|missile|launch missile|fire heat ?seeker|fire)$/, run: g => g.fire('missile'), confirm: 'Missile away' },
  { re: /^(?:strike|fire strike(?: missile)?|lock (?:the )?target|strike missile|lock strike)$/, run: g => g.fire('strike'), confirm: 'Strike' },
  { re: /^(?:cannon|select cannon|cannon on)$/, run: g => g.fire('cannon'), confirm: 'Cannon' },
  { re: /^boost(?: on)?$/, run: g => g.setBoost(true), confirm: 'Boost' },
  { re: /^(?:boost off|stop boost(?:ing)?|no boost)$/, run: g => g.setBoost(false), confirm: 'Boost off' },
  { re: /^(?:full throttle|throttle up|faster|speed up|go fast|max speed)$/, run: g => g.setThrottle(2), confirm: 'Throttle fast' },
  { re: /^(?:cruise|cruise speed|normal speed|throttle (?:middle|mid|cruise))$/, run: g => g.setThrottle(1), confirm: 'Throttle cruise' },
  { re: /^(?:throttle down|slower|slow down|go slow|min(?:imum)? speed)$/, run: g => g.setThrottle(0), confirm: 'Throttle slow' },
  { re: /^(?:next|nearest|switch|new|change) target$|^target next$|^next enemy$|^nearest enemy$/, run: g => g.cycleTarget('nearest'), confirm: 'Target' },
  { re: /^autopilot (on|off)$/, run: (g, m) => g.setAutopilot(m[1] === 'on'), confirm: m => `Autopilot ${m[1]}` },
  { re: /^(?:engage autopilot|autopilot|auto ?pilot please|fly (?:the route|for me))$/, run: g => g.setAutopilot(true), confirm: 'Autopilot on' },
  { re: /^(?:disengage autopilot|my controls?|i have control|manual)$/, run: g => g.setAutopilot(false), confirm: 'Autopilot off' },
  { re: /^(?:go to|head to|head for|fly to|route to|attack) (?:the )?target$/, run: g => g.setRoute('target'), confirm: 'Routing to target' },
  { re: /^(?:(?:head|go|fly|take me|route) )?home$|^(?:head|go|fly) (?:to )?(?:the )?exit$|^go back$/, run: g => g.setRoute('exit'), confirm: 'Routing home' },
  {
    re: /^(?:go|route|fly|head|take the|take|set route) (north|south)(?: valley| side| route)?$/,
    run: (g, m) => g.setRoute(m[1] as RouteKind),
    confirm: m => `Routing ${m[1]}`,
  },
  { re: /^(?:safer|safest|safe) route$|^(?:take|set|use) (?:the )?(?:safer|safest|safe) route$|^avoid (?:the )?sam$/, run: g => g.setRoute('safest'), confirm: 'Safer route set' },
  { re: /^voice (off|critical|all)$/, run: (g, m) => g.setVoice(m[1] as VoiceMode), confirm: m => `Voice ${m[1]}` },
  { re: /^(?:mute|quiet|silence|shut up)$/, run: g => g.setVoice('off'), confirm: 'Voice off' },
  { re: /^(?:unmute|voice on|talk to me)$/, run: g => g.setVoice('critical'), confirm: 'Voice critical' },
  { re: /^(?:pause|pause game|hold on|wait)$/, run: g => g.pause(), confirm: 'Paused' },
  { re: /^(?:resume|unpause|continue game|go on)$/, run: g => g.resume(), confirm: 'Resumed' },
];

export function matchCommand(t: string, g: CommandSink): string | null {
  for (const r of commands) {
    const m = t.match(r.re);
    if (!m) continue;
    r.run(g, m);
    return typeof r.confirm === 'string' ? r.confirm : r.confirm(m);
  }
  return null;
}
