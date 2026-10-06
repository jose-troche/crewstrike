# CrewStrike

A fast, easy-to-fly arcade jet game for the browser. Fly a short mission, survive fighters and air defenses, destroy the target, and get out, while a crew of six AI agents watches your gauges and tells you, in one short line, what matters right now.

**Play it:** https://crewstrike.troche.workers.dev

It runs on Cloudflare's free tier. The game and all six agents run on your device; one Worker serves the files, answers strategic questions with Workers AI, meters a daily AI budget, and keeps scores.

The full design lives in [`docs/`](docs/): the game design spec and the Cloudflare free-tier implementation plan.

## How to play

Fly in, destroy the target, get out. The magenta arrow at the screen edge always points to the objective, and the phase chip shows where you are: Ingress, Fight, Strike, Egress.

| Action | Keyboard and mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Steer | Mouse or arrow keys | Left stick | Left-half virtual stick |
| Throttle | W / S | Right stick up and down | Slider on the left edge |
| Boost | Shift (hold) | Left trigger | Boost |
| Cannon | Space or left click (hold) | Right trigger | Fire (hold) |
| Heat-seeking missile | F | Right bumper | Missile |
| Strike missile (lock, then fire) | G, G | Y / Triangle | Strike (in the zone) |
| Flares | E | Left bumper | Flare |
| Next target | Tab | X / Square | Tap an enemy on radar |
| Autopilot | R | B / Circle | AP |
| Push-to-talk | V (hold) | D-pad down | Mic (hold) |
| Type a question | / | | Keyboard icon |
| Voice off, critical or all | M | Back | Speaker icon |
| Pause | Esc | Start | Pause icon |
| Explain instruments | H | | i button |
| Accept a suggestion | Y | A | Tap it |

Keys can be remapped in Settings. Difficulty is Cadet (flies itself if you want), Pilot, Ace, or Custom, where every lever is yours.

**Talk to the crew.** Hold V (or press /) and say or type:

- Commands act instantly: "flares", "boost", "autopilot on", "head home", "go north".
- Questions about your jet answer instantly from game state: "fuel?", "ammo?", "where's the target?", "what's that?".
- How-to questions highlight the control involved: "how do I use the strike missile?".
- Strategic questions get a verdict chip, a short reason and an optional one-tap action: "should I escape?", "dogfight or avoid?", "which route?", "should I abort?".

Missions: **Radar Breaker** (radar station on a ridge, two SAM sites), **Iron Tide** (warship at sea, escort fighters) and **Bridge Fall** (drone swarms, flak, a storm rolls in), plus a 60-second **Training flight**.

## Architecture

```text
Browser                                          Cloudflare (free tier)
┌──────────────────────────────────────────┐     ┌────────────────────────────────────────┐
│ Main thread: 60 Hz fixed-step game core, │     │ Workers Static Assets: game files      │
│ Three.js scene, DOM HUD, input, audio    │     │ Worker (Hono) on /api/*                │
│ Web Worker: six agents + Wingman arbiter │────▶│   session (Turnstile), advice, recap,  │
│ Local NL: grammar, answers, advisor      │     │   stt (Whisper), score, leaderboard,   │
│ Optional on-device model (Chrome AI)     │     │   budget                               │
└──────────────────────────────────────────┘     │ BudgetDO: SQLite Durable Object ledger │
                                                 │ Workers AI: Llama 3.1 8B, MeloTTS      │
                                                 │ D1: scores                             │
                                                 └────────────────────────────────────────┘
```

**Deterministic first, LLM second.** Every alert is a template computed locally in milliseconds. A strategic verdict always comes from the local advisor; a model only phrases the reason. Phrasing tries the on-device model first, then Workers AI, then a template. Every number a model says is checked against game state before it appears, and anything that fails falls back to the template. With no network or no budget, the game still answers.

**The crew.** Radar, Weapons, Flight, Mission, Weather and Wingman each own cockpit zones. When an agent speaks, its icon lights in the crew strip and its zones glow in the line's urgency color. The Wingman arbiter picks at most one new line every 2 seconds by a fixed safety order (ground collision first, tips last). It merges repeats, keeps quiet in combat (red and amber only), and keeps red lines up until the danger is over.

## Repository layout

```text
apps/web          Vite + Three.js client, DOM HUD, input, audio, voice, React menus
apps/edge         Hono Worker, BudgetDO, D1 migrations, wrangler.jsonc
packages/shared   Types and prompt text every layer speaks
packages/game-core Deterministic simulation, missions, scoring, snapshot
packages/agents   Six agents, Wingman arbiter, critical clip list
packages/nl       Normalizer, command grammar, answers, classifier, advisor, guardrails
tests/e2e         Playwright UI tests (five device projects)
tools/gen-voice.ts Renders the critical voice clips with MeloTTS on Workers AI
docs/             Game design and implementation specs
```

Everything is strict TypeScript; there are no plain JavaScript source files.

## Develop

You need Node 22 or later, pnpm 12, and a Cloudflare account with `npx wrangler login` done.

```bash
pnpm install
pnpm --filter edge run migrate:local     # create the local D1 tables
pnpm dev                                 # Vite on :5173 (proxies /api) + wrangler dev on :8787
```

Workers AI calls the real service even in local development. For routine work, run the Worker with canned answers instead: `pnpm --filter edge exec wrangler dev --var MOCK_AI:1`.

| Command | What it does |
| --- | --- |
| `pnpm typecheck` | Type-checks every package, the tests and the tools |
| `pnpm test` | Vitest unit tests: game core, agents, NL pipeline, edge routes (62 tests) |
| `pnpm test:e2e` | Builds with test hooks, starts `wrangler dev` with `MOCK_AI=1`, runs Playwright |
| `pnpm test:e2e:ui` | Playwright UI mode |
| `pnpm gen:voice` | Re-renders `apps/web/public/audio/*.mp3` (MeloTTS, or `--local` for macOS `say`) |
| `pnpm deploy` | Production build, remote D1 migrations, `wrangler deploy` |

## Tests

**Unit tests (Vitest)** cover determinism, flight assists, ground protection, strike missiles, flares, fuel, route planning, and that Cadet autopilot completes all three missions. They also cover the arbiter's pace, dedupe, combat-quiet and priority rules, the 8-word line limit, every command, answer and classifier case, the advisor, the number guardrail, and the edge routes with fake bindings.

**UI tests (Playwright)** run locally against a seeded, steppable game exposed as `window.__wm`. This hook exists only in `VITE_TEST_HOOKS=1` builds and is stripped from production. The tests mock all AI calls. Projects are `desktop` (1600×900), `laptop` (1280×720), `tablet` (iPad Pro 11, WebKit), `phone` (Pixel 7 landscape) and `portrait`. The suite covers:

- onboarding
- layout: the aim area stays clear, everything fits on screen, touch targets are at least 44 px, the rotate prompt shows in portrait
- keyboard, touch and mocked-gamepad controls
- HUD thresholds and explain mode
- crew glow and status
- console rules
- voice modes and critical clips
- local commands with no network calls
- the advisor with a mocked model, including the guardrail and the 429 fallback
- a full Cadet mission with score submission
- a frame-budget check

```bash
pnpm exec playwright install chromium webkit   # once
pnpm test:e2e                                  # all projects (141 tests)
pnpm test:e2e --project=phone --headed         # watch the phone layout
pnpm test:e2e --grep-invert @perf              # quick run
```

Headless runs use software WebGL, so the perf test asserts the CPU frame budget (game step plus agents, under 4 ms) and records fps as an annotation instead of asserting 60 fps.

## Deploy

One-time setup (already done for the live instance):

```bash
npx wrangler login
npx wrangler d1 create crewstrike                 # put the id in apps/edge/wrangler.jsonc
npx wrangler d1 migrations apply crewstrike --remote
npx wrangler secret put TURNSTILE_SECRET          # optional; the site key is the TURNSTILE_SITE_KEY var
```

After that, `pnpm deploy`. GitHub Actions (`.github/workflows/deploy.yml`) type-checks, unit-tests and builds on every push to `main`. It also deploys when the repository has `CF_API_TOKEN` and `CF_ACCOUNT_ID` secrets. Playwright in CI (`e2e.yml`) is optional, started by hand, and never blocks a deploy.

## Free-tier budget

Only strategic answers (7 neurons reserved) and the end-of-mission recap (12) use Workers AI, about 40 neurons per mission. Everything else is local and free. `BudgetDO` enforces:

- a daily ceiling of 9,000 of the 10,000 free neurons
- 120 neurons per IP per hour
- 150 neurons per session, with at most one call every 3 seconds

When the ledger is near the ceiling, recaps switch to templates first. `GET /api/budget` drives the AI status light next to the crew strip. Turnstile protects session creation; without a session the game uses the local advisor.

## Decisions and deviations from the docs

- **Model.** The implementation doc's open question resolved itself: neither `llama-3.1-8b-instruct-fast` nor `-fp8-fast` is in the current Workers AI catalog. The Worker uses `@cf/meta/llama-3.1-8b-instruct-fp8`, set by the `AI_MODEL` var. It requests JSON mode and falls back to plain output parsed in code; both paths are validated.
- **Models and missions are code, not downloads.** Jets, ships, sites and the radar station are built procedurally, and mission JSON is bundled with the game core. The first load is about 280 KB gzipped plus 30 small voice clips loaded after the cockpit appears.
- **MeloTTS returns WAV.** `gen-voice` transcodes it to 48 kbps mono MP3.
- **Explain mode.** The `?` button reopens the explainer, and explain mode (lines from each crew icon to its gauges) has its own `i` button and the H key.
- **Layout breakpoints.** The `laptop` project (1280×720) gets the compact layout, as the implementation doc's test table expects.

## License

Private project; all rights reserved.
