import type { AgentId } from '@crewstrike/shared';

/** Agent icons: Eye, Crosshair, Wing, Flag, Cloud, Star (24x24, currentColor). */
export const AGENT_ICON_PATHS: Record<AgentId, string> = {
  radar: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>',
  weapons: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6" stroke="currentColor" stroke-width="2"/>',
  flight: '<path d="M2 14l9-3.5V5.5c0-1 .5-2 1-2s1 1 1 2v5L22 14v2l-9-2v4l2.5 2v1.5L12 20.5 8.5 21.5V20l2.5-2v-4l-9 2z" fill="currentColor"/>',
  mission: '<path d="M5 22V3" stroke="currentColor" stroke-width="2"/><path d="M6 4h12l-3 4 3 4H6z" fill="currentColor"/>',
  weather: '<path d="M7 18h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.5-1.5A4.8 4.8 0 0 0 7 18z" fill="none" stroke="currentColor" stroke-width="2"/>',
  wingman: '<path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5L2.5 9.3l6.6-.8z" fill="currentColor"/>',
};

export const AGENT_NAMES: Record<AgentId, string> = {
  radar: 'Radar', weapons: 'Weapons', flight: 'Flight', mission: 'Mission', weather: 'Weather', wingman: 'Wingman',
};

export function agentIcon(id: AgentId, size = 18): string {
  return `<svg class="agent-svg" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${AGENT_ICON_PATHS[id]}</svg>`;
}
