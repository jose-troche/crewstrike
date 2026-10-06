import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { MISSIONS, MISSION_ORDER, PILOT, type DifficultyProfile } from '@crewstrike/game-core';
import { AGENT_IDS, ZONE_OWNERS, type DifficultyName } from '@crewstrike/shared';
import type { GameApp, UiState } from '../app';
import { AGENT_ICON_PATHS, AGENT_NAMES } from '../hud/icons';
import { ACTION_LABELS, DEFAULT_KEYS, keyLabel, type Action, type Palette } from '../settings';

function useUi(app: GameApp): UiState {
  return useSyncExternalStore(app.ui.subscribe, app.ui.get);
}

function AgentIcon({ id, size = 22 }: { id: (typeof AGENT_IDS)[number]; size?: number }): ReactNode {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" dangerouslySetInnerHTML={{ __html: AGENT_ICON_PATHS[id] }} />;
}

const DIFFS: { id: DifficultyName; label: string; blurb: string }[] = [
  { id: 'cadet', label: 'Cadet', blurb: 'Flies itself if you want' },
  { id: 'pilot', label: 'Pilot', blurb: 'Assisted, real fights' },
  { id: 'ace', label: 'Ace', blurb: 'Manual, fast, no autopilot' },
  { id: 'custom', label: 'Custom', blurb: 'Every lever yours' },
];

function DifficultyPicker({ value, onChange }: { value: DifficultyName; onChange: (d: DifficultyName) => void }): ReactNode {
  return (
    <div className="seg" role="radiogroup" aria-label="Difficulty">
      {DIFFS.map(d => (
        <button key={d.id} type="button" role="radio" aria-checked={value === d.id} className={value === d.id ? 'on' : ''} onClick={() => onChange(d.id)} title={d.blurb}>
          {d.label}
        </button>
      ))}
    </div>
  );
}

// ---- first-visit explainer: three cards, mostly pictures ----

function MissionPicture(): ReactNode {
  return (
    <svg viewBox="0 0 420 110" className="pic" aria-label="Your jet flies past enemies to the target, then to the exit zone">
      <g transform="translate(40 55)">
        <path d="M0 -18 L6 -2 L22 4 L22 8 L6 5 L4 14 L9 18 L9 20 L0 18 L-9 20 L-9 18 L-4 14 L-6 5 L-22 8 L-22 4 L-6 -2 Z" fill="var(--cyan)" transform="rotate(90)" />
        <text y="40" textAnchor="middle">You</text>
      </g>
      <path d="M75 55 H140" stroke="var(--cyan)" strokeDasharray="5 5" strokeWidth="2" />
      <g transform="translate(160 55)">
        <path d="M0 -10 L8 7 L0 3 L-8 7 Z" fill="var(--red)" transform="translate(-12 -6)" />
        <path d="M0 -10 L8 7 L0 3 L-8 7 Z" fill="var(--red)" transform="translate(10 4)" />
        <path d="M-14 22 A14 14 0 0 1 14 22 Z" fill="var(--red)" opacity="0.8" />
        <text y="40" textAnchor="middle">Enemies</text>
      </g>
      <path d="M185 55 H250" stroke="var(--cyan)" strokeDasharray="5 5" strokeWidth="2" />
      <g transform="translate(275 55)">
        <circle r="24" fill="none" stroke="var(--magenta)" strokeDasharray="4 4" strokeWidth="2" />
        <path d="M0 -12 L12 0 L0 12 L-12 0 Z" fill="var(--magenta)" />
        <text y="40" textAnchor="middle">Target</text>
      </g>
      <path d="M302 55 H345" stroke="var(--green)" strokeDasharray="5 5" strokeWidth="2" />
      <g transform="translate(375 55)">
        <circle r="22" fill="rgba(61,255,138,0.15)" stroke="var(--green)" strokeWidth="2" />
        <text y="5" textAnchor="middle" fill="var(--green)" fontWeight="800">EXIT</text>
        <text y="40" textAnchor="middle">Get out</text>
      </g>
    </svg>
  );
}

function CrewPicture(): ReactNode {
  const pos: Record<string, [number, number]> = {
    radar: [40, 30], weapons: [380, 30], flight: [40, 150], mission: [210, 20], weather: [380, 150], wingman: [210, 170],
  };
  const gauges: Record<string, [number, number, string]> = {
    radar: [140, 125, 'Radar'], 'threat-ring': [210, 95, 'Threats'], weapons: [280, 125, 'Weapons'], flares: [300, 145, 'Flares'],
    damage: [120, 75, 'Damage'], fuel: [120, 98, 'Fuel'], speed: [150, 60, 'Speed'], altitude: [280, 60, 'Alt'],
    objective: [250, 45, 'Objective'], 'mission-bar': [175, 45, 'Score'], weather: [300, 98, 'Weather'], console: [210, 140, 'Console'],
  };
  return (
    <svg viewBox="0 0 420 200" className="pic" aria-label="Six agent icons, each linked to the gauges it owns">
      <rect x="100" y="35" width="220" height="125" rx="16" fill="rgba(6,18,28,0.6)" stroke="var(--panel-edge)" />
      {AGENT_IDS.map(id => ZONE_OWNERS[id].map(z => {
        const g = gauges[z];
        const p = pos[id];
        return g && p ? <line key={`${id}-${z}`} x1={p[0]} y1={p[1]} x2={g[0]} y2={g[1]} stroke="var(--cyan)" strokeOpacity="0.5" strokeDasharray="3 3" /> : null;
      }))}
      {Object.entries(gauges).map(([z, [x, y, label]]) => (
        <g key={z}>
          <rect x={x - 22} y={y - 8} width="44" height="16" rx="4" fill="rgba(150,210,255,0.12)" stroke="rgba(150,210,255,0.4)" />
          <text x={x} y={y + 4} textAnchor="middle" fontSize="9">{label}</text>
        </g>
      ))}
      {AGENT_IDS.map(id => {
        const [x, y] = pos[id]!;
        return (
          <g key={id} transform={`translate(${x - 14} ${y - 14})`}>
            <circle cx="14" cy="14" r="17" fill="var(--bg)" stroke="var(--cyan)" />
            <g color="var(--white)" transform="translate(2 2)" dangerouslySetInnerHTML={{ __html: AGENT_ICON_PATHS[id] }} />
            <text x="14" y="44" textAnchor="middle" fontSize="10">{AGENT_NAMES[id]}</text>
          </g>
        );
      })}
    </svg>
  );
}

function ControlsPicture({ device }: { device: UiState['device'] }): ReactNode {
  if (device === 'touch') {
    return (
      <div className="ctl-touch" aria-label="Touch controls">
        <div><span className="ctl-big">◎</span><b>Left thumb</b> steer anywhere on the left half</div>
        <div><span className="ctl-big">●</span><b>Fire</b> hold · <b>Missile</b> · <b>Flare</b> · <b>Strike</b> in the zone</div>
        <div><span className="ctl-big">▮</span><b>Slider</b> on the left edge sets speed · <b>AP</b> autopilot</div>
      </div>
    );
  }
  const rows: [string, string][] = [
    ['Mouse / Arrows', 'Steer'], ['W / S', 'Throttle'], ['Shift', 'Boost'], ['Space / Click', 'Cannon'],
    ['F', 'Heat-seeker'], ['G', 'Strike missile'], ['E', 'Flares'], ['R', 'Autopilot'], ['V hold / /', 'Talk / type to crew'],
  ];
  return (
    <div className="ctl-keys" aria-label="Keyboard controls">
      {rows.map(([k, v]) => (
        <div key={k}><kbd>{k}</kbd><span>{v}</span></div>
      ))}
      <div className="hint">Gamepad works too: left stick steers, triggers boost and fire.</div>
    </div>
  );
}

function Explainer({ app, ui }: { app: GameApp; ui: UiState }): ReactNode {
  const [card, setCard] = useState(0);
  const [diff, setDiff] = useState<DifficultyName>(ui.difficulty);
  const titles = ['Your mission', 'Your AI crew', 'Fly'];
  return (
    <div className="modal-backdrop">
      <div className="modal explainer" role="dialog" aria-modal="true" aria-label="Your mission briefing">
        <div className="explainer-top">
          <div className="dots" aria-hidden="true">{titles.map((t, i) => <span key={t} className={i === card ? 'on' : ''} />)}</div>
          <button type="button" className="link" onClick={() => app.closeExplainer()}>Skip</button>
        </div>
        <h2>{titles[card]}</h2>
        {card === 0 && (
          <>
            <MissionPicture />
            <p className="lead">Fly in, destroy the target, get out.</p>
          </>
        )}
        {card === 1 && (
          <>
            <CrewPicture />
            <p className="lead">Six AI agents watch your instruments and tell you what matters.</p>
          </>
        )}
        {card === 2 && (
          <>
            <ControlsPicture device={ui.device} />
            <DifficultyPicker value={diff} onChange={setDiff} />
          </>
        )}
        <div className="row">
          {card > 0 && <button type="button" className="btn ghost" onClick={() => setCard(card - 1)}>Back</button>}
          {card < 2 && <button type="button" className="btn primary" onClick={() => setCard(card + 1)}>Next</button>}
          {card === 2 && (
            <>
              <button type="button" className="btn" onClick={() => { app.closeExplainer(); app.startMission('training', diff); }}>Training flight</button>
              <button type="button" className="btn primary" onClick={() => { app.closeExplainer(); app.startMission(ui.missionId, diff); }}>Start mission</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- menu, pause, results ----

function Menu({ app, ui }: { app: GameApp; ui: UiState }): ReactNode {
  const [mission, setMission] = useState(ui.missionId);
  return (
    <div className="menu" role="region" aria-label="Main menu">
      <h1 className="logo">CREW<span>STRIKE</span></h1>
      <div className="missions" role="radiogroup" aria-label="Mission">
        {MISSION_ORDER.map(id => {
          const m = MISSIONS[id]!;
          return (
            <button key={id} type="button" role="radio" aria-checked={mission === id} className={`mcard ${mission === id ? 'on' : ''}`} onClick={() => setMission(id)} data-testid={`mission-${id}`}>
              <b>{m.title}</b>
              <span>{m.hard}</span>
            </button>
          );
        })}
      </div>
      <DifficultyPicker value={ui.difficulty} onChange={d => app.updateSettings({ difficulty: d })} />
      <div className="row">
        <button type="button" className="btn primary" data-testid="start-mission" onClick={() => app.startMission(mission, ui.difficulty)}>Start mission</button>
        <button type="button" className="btn" onClick={() => app.startMission('training', ui.difficulty)}>Training flight</button>
        <button type="button" className="btn ghost" onClick={() => app.ui.set({ settingsOpen: true })}>Settings</button>
      </div>
    </div>
  );
}

function PauseMenu({ app, ui }: { app: GameApp; ui: UiState }): ReactNode {
  return (
    <div className="modal-backdrop soft">
      <div className="modal small" role="dialog" aria-label="Paused">
        <h2>Paused</h2>
        <div className="col">
          <button type="button" className="btn primary" onClick={() => app.resume()} autoFocus>Resume</button>
          <button type="button" className="btn" onClick={() => app.startMission(ui.missionId, ui.difficulty)}>Restart</button>
          <button type="button" className="btn" onClick={() => app.ui.set({ settingsOpen: true })}>Settings</button>
          <button type="button" className="btn ghost" onClick={() => app.quitToMenu()}>Quit to menu</button>
        </div>
      </div>
    </div>
  );
}

function Stars({ n }: { n: number }): ReactNode {
  return <span className="stars-big" aria-label={`${n} of 3 stars`}>{'★'.repeat(n)}{'☆'.repeat(3 - n)}</span>;
}

function ResultsView({ app, ui }: { app: GameApp; ui: UiState }): ReactNode {
  const r = ui.results!;
  const [callsign, setCallsign] = useState(ui.settings.callsign);
  const [busy, setBusy] = useState(false);
  const headline = r.training ? 'Training complete' : r.score.outcome === 'won' ? 'Mission complete' : r.score.outcome === 'aborted' ? 'Mission aborted' : r.reason === 'out of fuel' ? 'Out of fuel' : r.reason === 'crashed' ? 'Crashed' : 'Shot down';
  const idx = MISSION_ORDER.indexOf(r.missionId as (typeof MISSION_ORDER)[number]);
  const next = MISSION_ORDER[(idx + 1) % MISSION_ORDER.length]!;
  const b = r.score.breakdown;
  const canSubmit = !r.training && r.score.outcome !== 'lost' && !r.submitted;
  return (
    <div className="modal-backdrop">
      <div className="modal results" role="dialog" aria-label="Mission results" data-testid="results">
        <h2 data-outcome={r.score.outcome}>{headline}</h2>
        {!r.training && <Stars n={r.score.stars} />}
        {!r.training && <div className="score" data-testid="final-score">{r.score.score.toLocaleString('en-US')} pts <small>×{r.score.multiplier} {ui.difficulty}</small></div>}
        {!r.training && (
          <div className="breakdown">
            <span>Target {b.target}</span><span>Kills {b.kills}</span><span>Damage {b.damage}</span><span>Time {b.time}</span><span>Leftover {b.leftover}</span>
          </div>
        )}
        <ol className="recap" data-testid="recap" data-source={r.recapSource}>{r.recap.map(l => <li key={l}>{l}</li>)}</ol>
        {canSubmit && (
          <form className="row" onSubmit={async e => {
            e.preventDefault();
            if (!callsign.trim()) return;
            setBusy(true);
            await app.submitScore(callsign);
            setBusy(false);
          }}>
            <input className="field" aria-label="Callsign" placeholder="Callsign" maxLength={16} value={callsign} pattern="[A-Za-z0-9 _\-]{1,16}" onChange={e => setCallsign(e.target.value)} />
            <button type="submit" className="btn" disabled={busy || !callsign.trim()}>Submit score</button>
          </form>
        )}
        {r.submitted && <p className="ok">Score saved.</p>}
        {!r.training && ui.leaderboard.length > 0 && (
          <table className="board" aria-label="Leaderboard">
            <thead><tr><th>#</th><th>Callsign</th><th>Level</th><th>Stars</th><th>Score</th></tr></thead>
            <tbody>
              {ui.leaderboard.map((row, i) => (
                <tr key={`${row.callsign}-${row.createdAt}-${i}`}><td>{i + 1}</td><td>{row.callsign}</td><td>{row.difficulty}</td><td>{'★'.repeat(row.stars)}</td><td>{row.score.toLocaleString('en-US')}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="row">
          <button type="button" className="btn" onClick={() => app.startMission(r.missionId, ui.difficulty)}>{r.training ? 'Fly again' : 'Retry'}</button>
          {r.training
            ? <button type="button" className="btn primary" onClick={() => app.startMission(ui.settings.lastMission, ui.difficulty)}>Start mission</button>
            : <button type="button" className="btn primary" onClick={() => app.startMission(next, ui.difficulty)}>Next mission</button>}
          <button type="button" className="btn ghost" onClick={() => app.quitToMenu()}>Menu</button>
        </div>
      </div>
    </div>
  );
}

// ---- settings ----

const LEVERS: { key: keyof DifficultyProfile; label: string; options?: string[]; min?: number; max?: number; step?: number }[] = [
  { key: 'steering', label: 'Steering', options: ['assisted', 'semi', 'manual'] },
  { key: 'autopilot', label: 'Autopilot', options: ['always', 'outOfCombat', 'off'] },
  { key: 'groundProtection', label: 'Ground protection', options: ['auto', 'gentle', 'warn'] },
  { key: 'stall', label: 'Stall', options: ['none', 'recover', 'real'] },
  { key: 'aimAssist', label: 'Aim assist', min: 0, max: 1, step: 0.05 },
  { key: 'enemySkill', label: 'Enemy skill', min: 0, max: 1, step: 0.05 },
  { key: 'missileSpeed', label: 'Enemy missile speed', min: 0.5, max: 1.2, step: 0.05 },
  { key: 'fuelBurn', label: 'Fuel burn', min: 0.5, max: 1.5, step: 0.1 },
  { key: 'damageTaken', label: 'Damage taken', min: 0.5, max: 1.5, step: 0.1 },
  { key: 'chatter', label: 'Crew chatter', options: ['tips', 'key', 'critical'] },
  { key: 'sensitivity', label: 'Stick sensitivity', min: 0.5, max: 1.6, step: 0.05 },
];

function SettingsView({ app, ui }: { app: GameApp; ui: UiState }): ReactNode {
  const s = ui.settings;
  const [remap, setRemap] = useState<Action | null>(null);
  useEffect(() => {
    if (!remap) return;
    app.input.remapListener = code => {
      if (code !== 'Escape') app.updateSettings({ keys: { ...s.keys, [remap]: [code] } });
      app.input.remapListener = null;
      setRemap(null);
    };
    return () => {
      app.input.remapListener = null;
    };
  }, [remap, app, s.keys]);
  const custom = { ...PILOT, ...s.custom };
  const opt = <T extends string>(label: string, value: T, options: readonly T[], on: (v: T) => void): ReactNode => (
    <label className="set-row"><span>{label}</span>
      <select value={value} onChange={e => on(e.target.value as T)}>{options.map(o => <option key={o} value={o}>{o}</option>)}</select>
    </label>
  );
  const toggle = (label: string, value: boolean, on: (v: boolean) => void): ReactNode => (
    <label className="set-row"><span>{label}</span><input type="checkbox" checked={value} onChange={e => on(e.target.checked)} /></label>
  );
  return (
    <div className="modal-backdrop">
      <div className="modal settings" role="dialog" aria-label="Settings">
        <div className="explainer-top"><h2>Settings</h2><button type="button" className="btn ghost" onClick={() => app.ui.set({ settingsOpen: false })}>Close</button></div>
        <section>
          <h3>Difficulty</h3>
          <DifficultyPicker value={s.difficulty} onChange={d => app.updateSettings({ difficulty: d })} />
          {s.difficulty === 'custom' && (
            <div className="levers">
              {LEVERS.map(l => l.options
                ? opt(l.label, String(custom[l.key]), l.options, v => app.updateSettings({ custom: { ...s.custom, [l.key]: v } }))
                : (
                  <label key={l.key} className="set-row"><span>{l.label} <small>{Number(custom[l.key]).toFixed(2)}</small></span>
                    <input type="range" min={l.min} max={l.max} step={l.step} value={Number(custom[l.key])} onChange={e => app.updateSettings({ custom: { ...s.custom, [l.key]: Number(e.target.value) } })} />
                  </label>
                ))}
            </div>
          )}
        </section>
        <section>
          <h3>Voice and crew</h3>
          {opt('Voice', s.voice, ['off', 'critical', 'all'] as const, v => app.updateSettings({ voice: v }))}
          {opt('Chatter', s.chatter, ['auto', 'tips', 'key', 'critical'] as const, v => app.updateSettings({ chatter: v }))}
        </section>
        <section>
          <h3>Comfort and display</h3>
          {opt<Palette>('Colorblind palette', s.palette, ['default', 'deuteranopia', 'protanopia', 'tritanopia'], v => app.updateSettings({ palette: v }))}
          <label className="set-row"><span>Field of view <small>{s.fov}°</small></span><input type="range" min={60} max={100} step={1} value={s.fov} onChange={e => app.updateSettings({ fov: Number(e.target.value) })} /></label>
          {toggle('Comfort vignette in hard turns', s.vignette, v => app.updateSettings({ vignette: v }))}
          {toggle('Full camera roll (Ace or Custom)', s.fullRoll, v => app.updateSettings({ fullRoll: v }))}
          {opt('Reduced motion', s.reducedMotion, ['auto', 'on', 'off'] as const, v => app.updateSettings({ reducedMotion: v }))}
        </section>
        <section>
          <h3>Controls</h3>
          {toggle('Mouse steering', s.mouseSteer, v => app.updateSettings({ mouseSteer: v }))}
          {toggle('Invert pitch', s.invertPitch, v => app.updateSettings({ invertPitch: v }))}
          <div className="keys">
            {(Object.keys(ACTION_LABELS) as Action[]).map(a => (
              <div key={a} className="set-row"><span>{ACTION_LABELS[a]}</span>
                <button type="button" className={`btn key ${remap === a ? 'listening' : ''}`} onClick={() => setRemap(a)}>
                  {remap === a ? 'Press a key…' : (s.keys[a] ?? []).map(keyLabel).join(' / ')}
                </button>
              </div>
            ))}
            <button type="button" className="btn ghost" onClick={() => app.updateSettings({ keys: DEFAULT_KEYS })}>Reset keys</button>
          </div>
        </section>
      </div>
    </div>
  );
}

function RotatePrompt(): ReactNode {
  return (
    <div className="rotate" data-testid="rotate-prompt" role="alert" aria-label="Turn your device">
      <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">
        <rect x="40" y="20" width="40" height="70" rx="6" fill="none" stroke="var(--cyan)" strokeWidth="4" />
        <path d="M95 60 a35 35 0 0 1 -35 35" fill="none" stroke="var(--white)" strokeWidth="4" />
        <path d="M60 88 l-4 10 l10 -2" fill="var(--white)" />
      </svg>
      <p>Turn your device sideways to fly.</p>
    </div>
  );
}

export function Root({ app }: { app: GameApp }): ReactNode {
  const ui = useUi(app);
  useEffect(() => {
    app.hud.setDim(ui.screen !== 'playing');
  }, [app, ui.screen]);
  if (ui.rotate) return <RotatePrompt />;
  return (
    <>
      {ui.screen === 'menu' && !ui.explainer && !ui.settingsOpen && <Menu app={app} ui={ui} />}
      {ui.screen === 'paused' && !ui.explainer && !ui.settingsOpen && <PauseMenu app={app} ui={ui} />}
      {ui.screen === 'results' && ui.results && !ui.settingsOpen && <ResultsView app={app} ui={ui} />}
      {ui.explainer && <Explainer app={app} ui={ui} />}
      {ui.settingsOpen && <SettingsView app={app} ui={ui} />}
    </>
  );
}
