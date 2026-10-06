# CrewStrike — Cloudflare Free-Tier Implementation (TypeScript)

Oct 6, 2026 · @Jose

## 1. Summary and stack

CrewStrike is a TypeScript browser game: the game, the HUD and all six AI agents run on the player's device, and one Cloudflare Worker serves it, answers strategic questions with Workers AI, meters a free daily AI budget and keeps scores. It implements the companion game design spec.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript everywhere, strict | One type system from game loop to Worker |
| Build | Vite, pnpm workspaces | Fast dev server, small bundles |
| 3D | Three.js on WebGL2 | Mature, small, runs on phones |
| HUD | DOM overlay: SVG gauges and CSS grid, written directly each frame | Crisp at any size, responsive layout for free |
| Menus and explainer | React 19 | Only for non-real-time UI |
| Audio | Web Audio for effects and clips; `speechSynthesis` for non-critical voice | Instant critical alerts, zero cost |
| Speech input | Browser `SpeechRecognition`; Whisper on Workers AI as fallback | Push-to-talk on every browser |
| Edge | Hono on Workers, SQLite Durable Object, D1, Workers AI | All on the free plan |
| Tests | Vitest for logic, Playwright for UI (local-first) | One runner family |

**TypeScript policy.** TypeScript is the preferred language for all code: game, workers, Worker, tools, tests and code-based config. Plain JavaScript files are not allowed (`allowJs: false`), and every package extends one strict base config. The only non-TypeScript files are those a platform requires: SQL migrations, `wrangler.jsonc`, GitHub Actions YAML.

```jsonc
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true,
    "allowJs": false, "isolatedModules": true, "verbatimModuleSyntax": true, "skipLibCheck": true
  }
}
```

## 2. Architecture on Cloudflare

The main thread runs the game and draws it; a background worker runs the six agents ten times a second; the edge is touched only when a player asks a strategic question, finishes a mission or loads the leaderboard.

&#91;embedded content: CrewStrike architecture · 3 on-device parts, 3 edge services\]

Instant commands, tactical answers and every alert stay in the browser; only strategic phrasing, speech fallback and scores cross the dashed line.

- **Main thread:** fixed-step game core (60 Hz) with render interpolation, Three.js scene, HUD overlay, input, audio. Keeping the game here gives the lowest input-to-screen delay.
- **Agent worker:** receives a compact snapshot (about 2 KB) by `postMessage` at 10 Hz and returns messages and glow events. Agents are advisory, so they live off the main thread and can never cost a frame.
- **No shared memory.** Unlike the first prototype, nothing uses `SharedArrayBuffer`, so no cross-origin isolation headers are needed.
- **Edge:** Workers Static Assets for the game files (free, unmetered), one Worker for `/api/*`, a `BudgetDO` for the AI ledger and rate limits, Workers AI for strategic phrasing and recaps, and D1 for scores. No R2 and no KV.

## 3. Free-tier budget

Only strategic questions and the mission recap use Workers AI, about 40 neurons per mission, so the 9,000-neuron daily ceiling covers roughly 225 missions; every other free limit allows over 12,000. Limits are from Cloudflare's [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) (updated Oct 2, 2026) and [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) (updated Oct 1, 2026) pages; free limits reset at 00:00 UTC.

| AI call | Input tokens | Output tokens | Neurons | Reserved | Per mission |
| --- | --- | --- | --- | --- | --- |
| Strategic answer | 900 | 60 | 5.8 | 7 | 4 calls, 28 |
| Mission recap | 1,500 | 150 | 11.4 | 12 | 1 call, 12 |
| **Total** |  |  |  |  | **40** |

Rates are Llama 3.1 8B fast: 4,119 neurons per million input tokens, 34,868 per million output. Instant commands, tactical answers and how-to answers are local and cost nothing. Players with an on-device model (Tier 0) cost nothing either. When the ledger nears the ceiling, recaps switch to templates first.

| Resource | Free limit | Per mission | Missions per day |
| --- | --- | --- | --- |
| Workers AI | 10,000 neurons per day (ceiling 9,000) | About 40 | About 225 (binding) |
| Static asset requests | Free and unlimited | About 30 files on first load | Unlimited |
| Worker requests | 100,000 per day | About 8 | About 12,500 |
| Worker CPU | 10 ms per request | Under 3 ms; model wait is I/O | Per-request cap |
| Durable Object requests | 100,000 per day | About 6 | About 16,000 |
| D1 rows written | 100,000 per day | About 2 | About 50,000 |
| D1 rows read | 5 million per day | About 100 (leaderboard) | About 50,000 |

Open question carried over: confirm in week 1 that `llama-3.1-8b-instruct-fast` (JSON Mode list) and `llama-3.1-8b-instruct-fp8-fast` (pricing table) are the same model and rate.

## 4. Repository layout

One pnpm monorepo; the game logic and agents are DOM-free packages, so the same code runs in the browser, in the agent worker and in fast Node tests.

```text
crewstrike/
├─ apps/
│  ├─ web/
│  │  ├─ src/
│  │  │  ├─ game/                # loop, Three.js scene, comfort camera, effects
│  │  │  ├─ hud/                 # gauges, radar, threat ring, console, crew strip
│  │  │  ├─ input/               # keyboard, gamepad, touch -> ControlState
│  │  │  ├─ audio/               # effects, critical voice clips, speech
│  │  │  ├─ voice/               # push-to-talk, typed bar, tier router
│  │  │  ├─ ui/                  # React: explainer, menus, settings
│  │  │  ├─ workers/agents.worker.ts
│  │  │  └─ test-hooks.ts        # window.__wm, test builds only
│  │  └─ public/                 # missions/*.json, models/*.glb, audio/*.mp3, help/*.json
│  └─ edge/
│     ├─ src/index.ts            # Hono routes
│     ├─ src/budget-do.ts
│     ├─ src/prompts/advice.ts
│     ├─ migrations/0001_init.sql
│     └─ wrangler.jsonc
├─ packages/
│  ├─ shared/                    # GameSnapshot, Message, Intent, Advice types
│  ├─ game-core/                 # flight, entities, weapons, enemies, missions
│  ├─ agents/                    # six agents, bus, arbiter
│  └─ nl/                        # grammar, local answers, help cards, templates, advisor
├─ tools/gen-voice.ts            # renders critical voice clips once
├─ tests/e2e/                    # Playwright
├─ docs/                         # spec.md, implementation.md
└─ CLAUDE.md                     # conventions for Claude Code
```

## 5. Game core

A fixed 60 Hz step drives a deliberately simple arcade model, and every assist from the spec's difficulty table is one field on a `DifficultyProfile`, so difficulty is data, not code paths.

### 5.1 Loop

```typescript
// apps/web/src/game/loop.ts
const STEP = 1 / 60;
let acc = 0, last = performance.now(), prev = initial, state = initial;

function frame(now: number) {
  acc += Math.min((now - last) / 1000, 0.25);            // clamp after tab switches
  last = now;
  while (acc >= STEP) {
    prev = state;
    state = step(state, input.read(), STEP, profile);      // pure, seeded, testable
    acc -= STEP;
  }
  scene.render(interpolate(prev, state, acc / STEP));
  hud.draw(state);
  agents.post(state);                                       // throttled to 10 Hz inside
  requestAnimationFrame(frame);
}
```

### 5.2 Difficulty as data

```typescript
// packages/game-core/src/difficulty.ts
export interface DifficultyProfile {
  steering: 'assisted' | 'semi' | 'manual';
  autoLevel: boolean;
  autopilot: 'always' | 'outOfCombat' | 'off';
  groundProtection: 'auto' | 'gentle' | 'warn';
  stall: 'none' | 'recover' | 'real';
  aimAssist: number;          // 0..1, magnetism and auto-lock strength
  enemySkill: number;         // 0..1, reaction time and accuracy
  missileSpeed: number;       // multiplier on enemy missile speed
  fuelBurn: number;           // multiplier
  damageTaken: number;        // multiplier
  chatter: 'tips' | 'key' | 'critical';
  sensitivity: number;        // stick multiplier
  fullRollCamera: boolean;
}

export const CADET: DifficultyProfile = {
  steering: 'assisted', autoLevel: true, autopilot: 'always', groundProtection: 'auto', stall: 'none',
  aimAssist: 0.8, enemySkill: 0.25, missileSpeed: 0.7, fuelBurn: 0.5, damageTaken: 0.5,
  chatter: 'tips', sensitivity: 0.8, fullRollCamera: false,
};
```

### 5.3 Arcade flight

- Stick X sets turn rate (scaled up at low speed); the jet's bank angle follows automatically and is visual only.
- Stick Y sets pitch; with `autoLevel`, releasing the stick eases the nose back to level.
- Throttle has three set speeds; boost multiplies speed and fuel burn.
- `groundProtection: 'auto'` overrides pitch upward when predicted height above ground in 2 seconds falls below the floor.
- Autopilot steers toward the next route point with the same controls a player would use, so any stick input simply takes over.

### 5.4 Comfort camera

```typescript
// apps/web/src/game/camera.ts
const MAX_ROLL = THREE.MathUtils.degToRad(15);
export function cameraRoll(bank: number, p: DifficultyProfile): number {
  return p.fullRollCamera ? bank : THREE.MathUtils.clamp(bank * 0.25, -MAX_ROLL, MAX_ROLL);
}
```

Field of view stays fixed (75° default). Hit feedback is an edge flash in the HUD layer, never camera shake.

### 5.5 Weapons and enemies

| Element | Model |
| --- | --- |
| Cannon | Ray test per bullet group; lead marker from target velocity |
| Heat-seeker | Pursuit with a turn-rate cap; lock after the target stays in the ring for 1 s; flares decoy it by a probability scaled by angle |
| Strike missile | Fires only inside the strike zone with a lock; flies a fixed arc to the target |
| Enemy missiles | Same pursuit model, speed scaled by `missileSpeed` |
| Fighters | State machine: patrol, chase, attack, evade, retreat on damage |
| SAM and guns | Idle, tracking (amber), locked, launch (red), cooldown |
| Drones | Flocking cluster that steers at the player |
| Storms | Cells that add turbulence, radar static and occasional lightning damage |

Collisions and targeting use a spatial hash rebuilt each step.

### 5.6 Missions as data

```json
{
  "id": "radar-breaker",
  "title": "Radar Breaker",
  "seed": 42,
  "start": { "pos": [0, 1200, 0], "heading": 90 },
  "target": { "type": "radar_station", "pos": [24000, 600, 3000], "hp": 2 },
  "strikeZone": { "center": [24000, 0, 3000], "radius": 5000 },
  "exit": { "center": [-2000, 0, -6000], "radius": 3000 },
  "enemies": [
    { "type": "sam", "pos": [15000, 400, 6000] },
    { "type": "sam", "pos": [20000, 500, -2000] },
    { "type": "fighter", "count": 2, "spawn": { "phase": "fight" } }
  ],
  "weather": { "storms": [{ "pos": [12000, 0, -8000], "radius": 4000 }], "windKt": [270, 15] }
}
```

## 6. Agents, message console and voice

Each agent is a small pure function over the snapshot that returns ranked findings; the Wingman arbiter turns them into at most one new console line every 2 seconds, and the main thread lights the speaking agent's icon and zone.

### 6.1 Agent contract

```typescript
// packages/agents/src/types.ts
export type AgentId = 'radar' | 'weapons' | 'flight' | 'mission' | 'weather' | 'wingman';
export type Level = 'red' | 'amber' | 'green' | 'info';

export interface Finding {
  key: string;             // dedupe key, e.g. 'fuel-home'
  rank: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;   // spec section 9.2 order
  level: Level;
  text: string;            // eight words or fewer
  detail?: string;         // one more sentence on hover or tap
  ttlMs: number;
}

export interface Agent {
  id: AgentId;
  owns: HudZone[];         // zones that glow when this agent speaks
  step(s: GameSnapshot): Finding[];
}
```

```typescript
// packages/agents/src/flight.ts (excerpt)
export const flight: Agent = {
  id: 'flight',
  owns: ['fuel', 'damage', 'speed', 'altitude'],
  step(s) {
    const out: Finding[] = [];
    if (s.own.agl < 150 && s.own.climbRate < 0)
      out.push({ key: 'pull-up', rank: 1, level: 'red', text: 'Pull up!', ttlMs: 1500 });
    const margin = s.fuel.kg / Math.max(s.fuel.needToExitKg, 1);
    if (margin < 1.15)
      out.push({ key: 'fuel-home', rank: 5, level: margin < 1 ? 'red' : 'amber',
        text: `Fuel: ${Math.round(s.nav.minutesToExit)} min to exit.`, ttlMs: 6000 });
    return out;
  },
};
```

### 6.2 Wingman arbiter

```typescript
// packages/agents/src/wingman.ts
export function pick(findings: Tagged[], st: ConsoleState, s: GameSnapshot, p: DifficultyProfile): Tagged | null {
  const allowed = findings
    .filter(f => !st.recent.has(f.key))                                  // dedupe
    .filter(f => !s.inCombat || f.level === 'red' || f.level === 'amber') // combat quiet
    .filter(f => chatterAllows(p.chatter, f));
  allowed.sort((a, b) => a.rank - b.rank);
  const top = allowed[0];
  if (!top) return null;
  if (top.level !== 'red' && s.now - st.lastShownAt < 2000) return null; // pace
  return top;
}
```

The worker posts `{ line, agent, zones, level }` to the main thread. The console renders the line with the agent's icon; the crew strip sets `data-active` on that icon; every element with a matching `data-zone` gets a 900 ms glow class in the line's color (a static outline when reduced motion is on).

### 6.3 Voice

- **Modes:** Off, Critical (default), All; stored in the browser.
- **Critical clips:** about 30 short lines ("Missile, left!", "Pull up!", "Flares!", "Locked!", "Fuel low", "Strike zone") rendered once by `tools/gen-voice.ts` with MeloTTS on Workers AI and shipped as MP3 static assets. At 18.63 neurons per audio minute the whole set costs well under 20 neurons, once.
- **All mode** speaks other lines with `speechSynthesis` at rate 1.1; a new red line cancels any speech in progress.

## 7. Commands, tactical answers and the strategic advisor

Every utterance or typed line passes through the same pipeline, and it stops at the first step that can handle it; only strategic questions ever leave the device, and even then the verdict is computed locally.

1. **Normalize:** lowercase, spoken numbers to digits, strip filler, map synonyms ("bogey" to enemy).
2. **Instant command grammar:** about 25 patterns; executes and shows a one-word confirmation.
3. **Tactical and how-to matcher:** answers from game state or a help card, and glows the related gauge or button.
4. **Strategic classifier:** keyword rules map to one of five question kinds: escape, engage or avoid, route choice, abort, attack plan.
5. **Advisor:** deterministic verdict and action from game state.
6. **Phrasing:** on-device model (Tier 0) or `/api/advice` (Tier 1) writes a reason of 15 words or fewer; template if neither is available.
7. **Validate:** numbers checked against the snapshot, word limit enforced, fallback to template on any failure.

```typescript
// packages/nl/src/grammar.ts (excerpt)
export const commands: Rule[] = [
  { re: /^(?:flares?|flare out)$/, run: g => g.fire('flare'), confirm: 'Flares' },
  { re: /^boost(?: on)?$/, run: g => g.setBoost(true), confirm: 'Boost' },
  { re: /^(?:next|nearest) target$/, run: g => g.cycleTarget('nearest'), confirm: 'Target' },
  { re: /^autopilot (on|off)$/, run: (g, m) => g.setAutopilot(m[1] === 'on'), confirm: m => `Autopilot ${m[1]}` },
  { re: /^(?:go to|head to) target$/, run: g => g.setRoute('target'), confirm: 'Routing to target' },
  { re: /^(?:head|go) home$/, run: g => g.setRoute('exit'), confirm: 'Routing home' },
  { re: /^voice (off|critical|all)$/, run: (g, m) => g.setVoice(m[1]), confirm: m => `Voice ${m[1]}` },
];

export const tactical: Answer[] = [
  { re: /fuel/, say: s => `Fuel ${pct(s.fuel)}, ${Math.round(s.nav.minutesToExit)} min to exit.`, glow: ['fuel'] },
  { re: /ammo|rounds|bullets/, say: s => `Cannon ${s.weapons.rounds} rounds.`, glow: ['weapons'] },
  { re: /missiles?/, say: s => `${s.weapons.missiles} missiles, ${s.weapons.strike} strike.`, glow: ['weapons'] },
  { re: /where.*target/, say: s => `Target ${km(s.nav.kmToTarget)}, ${clock(s.nav.targetBearing)}.`, glow: ['objective'] },
];
```

```json
// apps/web/public/help/strike-missile.json
{ "answer": "Fly into the magenta strike zone, press G to lock, press again to fire.",
  "highlight": ["weapon-strike", "objective", "key-g"] }
```

### 7.1 Advisor

```typescript
// packages/nl/src/advisor.ts
export function advise(kind: StrategicKind, s: GameSnapshot): Advice {
  const threat = s.threats.reduce((sum, t) => sum + t.danger, 0);            // 0..n
  const strength = 0.15 * s.weapons.missiles + 0.5 * (1 - s.damage) + 0.2 * s.weapons.cannonPct;
  const fuelMargin = s.fuel.kg / Math.max(s.fuel.needToExitKg, 1);

  if (fuelMargin < 1.05 || s.damage > 0.75)
    return { verdict: 'ABORT', facts: { fuelMargin, damage: s.damage }, action: 'route_exit' };
  if (kind === 'engage_or_avoid' || kind === 'escape')
    return strength >= threat
      ? { verdict: 'ENGAGE', facts: { strength, threat } }
      : { verdict: kind === 'escape' ? 'ESCAPE' : 'AVOID', facts: { strength, threat }, action: 'route_safest' };
  if (kind === 'route_choice')
    return bestRoute(s);                                                     // lowest exposure x time
  return { verdict: 'CONTINUE', facts: { fuelMargin, threat } };
}
```

The verdict always comes from the advisor. The model only explains it and may pick one action from an allowed list, which keeps advice consistent and testable.

### 7.2 Edge prompt and schema

```typescript
// apps/edge/src/prompts/advice.ts
export const ADVICE_SYSTEM = `You are the wingman in an arcade jet game. You receive a verdict computed by the game
and a few facts. Explain the verdict to the pilot in 15 words or fewer, plain words, no jargon.
Use only numbers present in the facts. Never change the verdict.`;

export const ADVICE_SCHEMA = {
  type: 'object',
  properties: {
    reason: { type: 'string' },
    action: { type: 'string', enum: ['none', 'route_exit', 'route_safest', 'route_target', 'climb', 'descend'] },
  },
  required: ['reason', 'action'],
};
```

## 8. Responsive UI and input

A full-screen canvas sits under a CSS-grid HUD whose named areas rearrange per mode; one `ControlState` hides whether the player uses keys, a gamepad or touch; and dynamic resolution holds the frame rate on weaker devices.

### 8.1 Layout modes

| Mode | Detected by | Grid areas (top / middle / bottom) |
| --- | --- | --- |
| Wide | Landscape, width 1280 px or more, fine pointer | weather, mission, objective / speed, center, altitude / radar, console, weapons |
| Compact | Landscape, 900–1279 px wide or under 720 px tall | mission, objective / speed, center, altitude / radar, console, weapons (weather folds into radar) |
| Touch | `(pointer: coarse)` in landscape | radar, mission, weapons / ., center, . / stick, console, fire |
| Rotate | Portrait | Full-screen rotate prompt; game paused |

```css
/* apps/web/src/hud/hud.css (excerpt) */
.hud {
  position: fixed; inset: 0; display: grid; pointer-events: none;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr);
  grid-template-rows: auto 1fr auto;
  grid-template-areas: "weather mission objective" "speed center altitude" "radar console weapons";
  font-size: clamp(11px, 1.1vw, 16px);
}
.hud[data-mode="touch"] { grid-template-areas: "radar mission weapons" ". center ." "stick console fire"; }
.hud [data-zone], .hud button { pointer-events: auto; min-width: 44px; min-height: 44px; }
.gauge { container-type: inline-size; }
@container (max-width: 120px) { .gauge .label { display: none; } }
@media (prefers-reduced-motion: reduce) { .glow { animation: none; outline: 2px solid currentColor; } }
```

The center area is reserved for the crosshair and threat ring; no gauge may grow into it at any size.

### 8.2 Input

```typescript
// apps/web/src/input/control-state.ts
export interface ControlState {
  stickX: number; stickY: number;           // -1..1
  throttle: 0 | 1 | 2; boost: boolean;
  cannon: boolean; missile: boolean; strike: boolean; flare: boolean;
  nextTarget: boolean; autopilot: boolean; pushToTalk: boolean;
}
```

- **Keyboard and mouse:** a remappable key map; the mouse steers relative to screen center.
- **Gamepad:** `navigator.getGamepads()` polled each frame, 0.12 dead zone.
- **Touch:** pointer events; the left half is a floating virtual stick that starts where the thumb lands; buttons on the right; throttle slider on the left edge.

### 8.3 Performance

- HUD values are written to the DOM only when they change; gauges refresh at 30 Hz, crosshair and threat ring at 60 Hz.
- **Dynamic resolution:** if the 90th-percentile frame time over 60 frames exceeds 18 ms, the pixel ratio drops by 0.1 (down to 0.6); it rises again below 12 ms. Device pixel ratio is capped at 2.
- Touch mode turns off shadows and halves particle counts by default.
- First load stays under 5 MB compressed: low-poly models, compressed textures, audio clips loaded after the cockpit appears.

## 9. Edge implementation

One Worker, seven routes, one Durable Object that meters every AI call before it happens, and one D1 table for scores.

| Route | Purpose | Bindings | Neurons reserved |
| --- | --- | --- | --- |
| `POST /api/session` | Start a mission after a Turnstile check; returns a session id | `BUDGET` | 0 |
| `POST /api/advice` | Phrase a strategic verdict | `AI`, `BUDGET` | 7 |
| `POST /api/recap` | Three-line mission recap | `AI`, `BUDGET` | 12 |
| `POST /api/stt` | Speech-to-text fallback, clips up to 6 s | `AI`, `BUDGET` | 1 per second |
| `POST /api/score` | Save a mission result | `DB` | 0 |
| `GET /api/leaderboard/:mission` | Top 20 for a mission | `DB` | 0 |
| `GET /api/budget` | Neurons left today, for the AI status light | `BUDGET` | 0 |

```typescript
// apps/edge/src/index.ts (excerpt)
app.post('/api/advice', async c => {
  const { session, verdict, facts } = await c.req.json<AdviceReq>();
  const budget = c.env.BUDGET.get(c.env.BUDGET.idFromName('global'));
  const gate = await budget.reserve(7, session, await hashIp(c.req.header('CF-Connecting-IP')));
  if (!gate.ok) return c.json({ error: gate.reason }, 429);

  const out = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
    messages: [
      { role: 'system', content: ADVICE_SYSTEM },
      { role: 'user', content: JSON.stringify({ verdict, facts }) },
    ],
    response_format: { type: 'json_schema', json_schema: ADVICE_SCHEMA },
    max_tokens: 60,
    temperature: 0.2,
  });
  c.header('X-Neurons-Remaining', String(gate.remaining));
  return c.json(out.response);
});
```

**`BudgetDO`** is a single SQLite-backed Durable Object with three small tables: a daily ledger (ceiling 9,000), a per-IP hourly count (120 neurons) and a per-session count (150 neurons, one call every 3 s at most). One object processes one call at a time, so no locks are needed, and each AI call costs one Durable Object request. A daily alarm deletes rows older than a day.

```sql
-- apps/edge/migrations/0001_init.sql
CREATE TABLE scores (
  id          TEXT PRIMARY KEY,
  player      TEXT NOT NULL,          -- anonymous id stored in the browser; no accounts
  callsign    TEXT NOT NULL,
  mission_id  TEXT NOT NULL,
  difficulty  TEXT NOT NULL CHECK (difficulty IN ('cadet', 'pilot', 'ace', 'custom')),
  stars       INTEGER NOT NULL,
  score       INTEGER NOT NULL,
  duration_s  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_scores_board ON scores(mission_id, difficulty, score DESC);
```

```jsonc
// apps/edge/wrangler.jsonc
{
  "name": "crewstrike",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "assets": {
    "directory": "../web/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "ai": { "binding": "AI" },
  "d1_databases": [{ "binding": "DB", "database_name": "crewstrike", "database_id": "<from wrangler d1 create>" }],
  "durable_objects": { "bindings": [{ "name": "BUDGET", "class_name": "BudgetDO" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["BudgetDO"] }],
  "observability": { "enabled": true, "head_sampling_rate": 0.2 },
  "vars": { "NEURON_CEILING": "9000" }
}
```

The free plan only offers SQLite-backed Durable Objects, hence `new_sqlite_classes`. The `Env` type is generated with `wrangler types`.

## 10. Build, deploy and CI

After a one-time setup, daily work is three commands; pushes to `main` deploy after type checks and unit tests, and Playwright never sits in the deploy path.

```bash
# one-time
npx wrangler login
npx wrangler d1 create crewstrike                # paste the id into wrangler.jsonc
npx wrangler d1 migrations apply crewstrike --remote
npx wrangler secret put TURNSTILE_SECRET

# daily
pnpm install
pnpm dev        # Vite on :5173 plus wrangler dev on :8787 for /api (MOCK_AI=1 for a canned model)
pnpm deploy     # build, apply migrations, wrangler deploy
```

The Workers AI binding calls the real service even in local development, so set `MOCK_AI=1` for routine work.

```yaml
# .github/workflows/deploy.yml
name: deploy
on: { push: { branches: [main] } }
jobs:
  ship:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck && pnpm test          # Vitest only; Playwright is not here
      - run: pnpm --filter web build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          workingDirectory: apps/edge
          preCommands: npx wrangler d1 migrations apply crewstrike --remote
          command: deploy
```

**Optional Playwright CI** lives in its own `e2e.yml`, runs only when started by hand from the Actions tab, is marked `continue-on-error`, and `deploy.yml` never references it (section 11.5).

## 11. Playwright UI tests (local-first)

Playwright runs on the dev machine against a seeded, steppable game across five device profiles, so every test is repeatable, responsive layouts are checked on real viewport sizes, and no test spends a neuron.

### 11.1 What makes the game testable

- **Test hooks.** Builds with `VITE_TEST_HOOKS=1` expose `window.__wm`: `start(mission, { seed, difficulty })`, `pause()`, `step(frames)`, `spawn(event)`, `ask(text)`, `snapshot()`, `lines()`. Production builds strip them.
- **Stable selectors:** every instrument has `data-zone` (`radar`, `threat-ring`, `fuel`, `damage`, `speed`, `altitude`, `weapons`, `flares`, `weather`, `objective`, `mission-bar`, `console`), crew icons have `data-agent`, controls have `data-testid`.
- **No real AI:** the server runs with `MOCK_AI=1`, and tests override `/api/advice` and `/api/recap` with `page.route()`.

### 11.2 Device projects and spec files

| Project | Device | Checks |
| --- | --- | --- |
| `desktop` | Chromium 1600 × 900 | Everything |
| `laptop` | Chromium 1280 × 720 | Compact layout, HUD fit |
| `tablet` | iPad Pro 11 landscape (WebKit, touch) | Touch layout and controls |
| `phone` | Pixel 7 landscape (Chromium, touch) | Touch layout, frame rate smoke |
| `portrait` | Pixel 7 portrait | Rotate prompt only |

| Spec file | Covers |
| --- | --- |
| `onboarding.spec.ts` | Explainer on first visit only; skip; "?" reopens; difficulty picker; training flight starts |
| `layout.spec.ts` | No gauge overlaps the center area; touch controls only in touch mode; touch targets at least 44 px; rotate prompt in portrait |
| `controls.spec.ts` | Keyboard throttle and boost change speed; touch stick steers; gamepad mocked; autopilot hands back on stick input |
| `hud.spec.ts` | Every instrument present with its "?" line; colors change green, amber, red at thresholds |
| `crew.spec.ts` | A finding shows the agent icon, lights the crew strip and glows the owned zone |
| `console.spec.ts` | Pace limit, combat quiet, red lines persist, dedupe |
| `voice.spec.ts` | Voice modes and the M key; critical clip played on a missile launch |
| `commands.spec.ts` | Instant commands; tactical and how-to answers make no network request and highlight the right control |
| `advisor.spec.ts` | Verdict chip and reason from a mocked model; number guardrail; template fallback on 429 |
| `mission.spec.ts` | Cadet with autopilot completes Radar Breaker from scripted inputs |
| `perf.spec.ts` (`@perf`) | Frame-rate smoke on desktop and phone projects |

### 11.3 Configuration and fixture

```typescript
// tests/e2e/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: { baseURL: process.env.BASE_URL ?? 'http://localhost:8787', trace: 'retain-on-failure' },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } } },
    { name: 'laptop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    { name: 'tablet', use: { ...devices['iPad Pro 11 landscape'] } },
    { name: 'phone', use: { ...devices['Pixel 7 landscape'] } },
    { name: 'portrait', use: { ...devices['Pixel 7'] }, testMatch: /layout/ },
  ],
  webServer: {
    command: 'VITE_TEST_HOOKS=1 pnpm --filter web build && pnpm --filter edge exec wrangler dev --port 8787 --var MOCK_AI:1',
    url: 'http://localhost:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

```typescript
// tests/e2e/fixtures.ts (excerpt)
export const test = base.extend<{ wm: Wm }>({
  wm: async ({ page }, use) => {
    await page.addInitScript(() => localStorage.setItem('wm.seenExplainer', '1'));   // skip explainer by default
    await use({
      start: async (mission = 'radar-breaker', difficulty = 'cadet') => {
        await page.goto('/');
        await page.evaluate(([m, d]) => window.__wm.start(m, { seed: 42, difficulty: d }), [mission, difficulty] as const);
        await page.evaluate(() => window.__wm.pause());
      },
      step: f => page.evaluate(n => window.__wm.step(n), f),
      spawn: e => page.evaluate(ev => window.__wm.spawn(ev), e),
      ask: t => page.evaluate(s => window.__wm.ask(s), t),
    });
  },
});
```

### 11.4 Example tests

```typescript
// tests/e2e/onboarding.spec.ts
import { test, expect } from '@playwright/test';

test('explainer appears on first visit only', async ({ page }) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: /your mission/i });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('cockpit')).toBeVisible();          // cockpit live behind it
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.reload();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Help' }).click();         // the ? button reopens it
  await expect(dialog).toBeVisible();
});
```

```typescript
// tests/e2e/layout.spec.ts (excerpt)
test('no instrument overlaps the aiming area', async ({ page, wm }) => {
  await wm.start();
  const center = (await page.getByTestId('aim-area').boundingBox())!;
  for (const zone of await page.locator('[data-zone]:not([data-zone="threat-ring"])').all()) {
    const b = (await zone.boundingBox())!;
    const overlaps = b.x < center.x + center.width && b.x + b.width > center.x &&
                     b.y < center.y + center.height && b.y + b.height > center.y;
    expect(overlaps, await zone.getAttribute('data-zone') ?? '').toBe(false);
  }
});
```

```typescript
// tests/e2e/crew.spec.ts
test('low fuel lights the Flight agent and the fuel gauge', async ({ page, wm }) => {
  await wm.start('radar-breaker', 'pilot');
  await wm.spawn({ type: 'set_fuel', fraction: 0.12 });
  await wm.step(30);
  const line = page.getByTestId('console').locator('li').first();
  await expect(line).toHaveAttribute('data-agent', 'flight');
  await expect(line).toHaveText(/Fuel: \d+ min to exit/);
  await expect(page.locator('[data-agent-icon="flight"]')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[data-zone="fuel"]')).toHaveClass(/glow-(amber|red)/);
});
```

```typescript
// tests/e2e/advisor.spec.ts
test('tactical questions stay local; strategic ones show a verdict', async ({ page, wm }) => {
  const calls: string[] = [];
  page.on('request', r => r.url().includes('/api/') && calls.push(r.url()));
  await page.route('**/api/advice', r => r.fulfill({ json: { reason: 'Two fighters ahead, two missiles left. Go north.', action: 'route_safest' } }));
  await wm.start('radar-breaker', 'pilot');

  await wm.ask('fuel?');
  await expect(page.getByTestId('console')).toContainText('Fuel');
  expect(calls.filter(u => u.includes('/api/advice'))).toHaveLength(0);

  await wm.spawn({ type: 'fighters', count: 2, range_km: 8 });
  await wm.ask('should I dogfight or avoid them?');
  await expect(page.getByTestId('verdict-chip')).toHaveText(/AVOID|ENGAGE/);
  await expect(page.getByTestId('verdict-action')).toHaveText('Set route north?');
});
```

### 11.5 Running locally, and optional CI

```bash
pnpm exec playwright install chromium webkit     # once
pnpm test:e2e                                    # every project, headless
pnpm test:e2e:ui                                 # UI mode: pick tests, watch, step through actions
pnpm test:e2e --project=phone --headed           # watch the phone layout run
pnpm test:e2e --grep-invert @perf                # quick run
pnpm test:e2e --update-snapshots                 # refresh baselines after an intended UI change
pnpm exec playwright show-report
```

**Fast loop:** keep `VITE_TEST_HOOKS=1 MOCK_AI=1 pnpm dev` running and use `BASE_URL=http://localhost:5173 pnpm test:e2e:ui`; Playwright reuses the running `wrangler dev` and tests hot-reload with the UI.

Screenshot baselines (tagged `@visual`) are generated on the dev machine; Playwright stores them per operating system, so CI keeps its own set.

```yaml
# .github/workflows/e2e.yml (optional; never blocks deploy)
name: e2e (optional)
on: { workflow_dispatch: {} }
jobs:
  e2e:
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium webkit
      - run: pnpm test:e2e --grep-invert "@visual|@perf"
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: playwright-report, path: playwright-report }
```

## 12. Milestones

Four milestones follow the spec's roadmap, each ending in something playable on the live URL, so requirements can be adjusted by playing.

1. **Playable core.** Monorepo, Worker with static assets and CI deploy; game loop, arcade flight, comfort camera, Radar Breaker mission, cannon and heat-seekers, radar and threat ring, Cadet profile; first Playwright smoke tests. *Done when:* a Cadet run can win or lose Radar Breaker on desktop and phone.
2. **AI crew.** Agent worker, six agents, Wingman arbiter, message console, crew strip, zone glow, critical voice clips, voice modes. *Done when:* `crew.spec.ts` and `console.spec.ts` pass and playtesters can name four agents.
3. **Talk to your wingman.** Push-to-talk and typed bar, grammar, tactical and how-to answers, advisor, `/api/advice` with `BudgetDO`, Turnstile. *Done when:* `commands.spec.ts` and `advisor.spec.ts` pass and the budget ledger shows 40 neurons or fewer per mission.
4. **Full game.** Iron Tide and Bridge Fall, Pilot, Ace and Custom profiles, storms, explainer and training flight, leaderboard, mission recap, visual polish. *Done when:* the spec's acceptance table is met.

## 13. Risks and mitigations

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Game still feels hard to fly | Players quit early | Cadet defaults, autopilot, auto-level; playtest every milestone; tune `DifficultyProfile` values, not code |
| Motion sickness on some screens | Short sessions | Comfort camera, fixed field of view, no shake, vignette option, reduced-motion support |
| HUD crowded on small phones | Aiming area blocked | Center area reserved; compact and touch layouts; `layout.spec.ts` overlap check on every device project |
| Weak phones drop frames | Choppy play | Dynamic resolution, shadows off in touch mode, low-poly assets |
| AI budget drained by scripted abuse | Strategic phrasing offline | Turnstile, per-IP and per-session caps, 9,000 ceiling; the local advisor still answers with templates |
| Model name or JSON mode mismatch | Advice calls fail | Week-1 check; fall back to plain JSON output validated in code |
| No speech recognition in the browser | No voice commands | Whisper fallback route and the typed command bar |
| Browser blocks audio until a click | Silent first alert | Audio unlocked on the first click of the explainer or the cockpit |
| Free-plan limits change | Budget math drifts | Limits held in `vars`; `/api/budget` shows the live ledger; check pricing pages monthly |

## 14. Sources

- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/): Workers, Durable Objects and D1 free limits (page updated Oct 2, 2026)
- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/): 10,000 neurons per day and per-model rates (page updated Oct 1, 2026)
- [Workers AI JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/): models that accept a JSON schema
