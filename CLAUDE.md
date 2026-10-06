# CrewStrike — conventions for Claude Code

Specs live in `docs/` (game design and Cloudflare implementation). Read them before changing behavior.

## Layout
- `packages/shared` — types every layer speaks (GameSnapshot, findings, console lines, advice, API shapes, prompts).
- `packages/game-core` — deterministic 60 Hz arcade simulation, missions (`src/missions/*.json`), scoring, snapshot. DOM-free.
- `packages/agents` — six agents + Wingman arbiter (`AgentRuntime`). DOM-free; runs in a Web Worker in the browser.
- `packages/nl` — normalizer, command grammar, tactical/how-to answers, strategic classifier, advisor, guardrails. DOM-free.
- `apps/web` — Vite + Three.js scene, DOM HUD, input, audio, voice, React menus, test hooks.
- `apps/edge` — Hono Worker (`/api/*`), `BudgetDO` (SQLite DO), D1 migrations, `wrangler.jsonc`.
- `tests/e2e` — Playwright (local-first). `tools/gen-voice.ts` renders critical voice clips.

## Rules
- TypeScript only, strict (`tsconfig.base.json`); no `.js` source files.
- Deterministic first, LLM second: verdicts come from `nl/advisor.ts`; models only phrase reasons, and every reason passes `validateReason`.
- Difficulty is data (`DifficultyProfile`), not code paths.
- Console lines are 8 words or fewer; color = urgency, icon = owning agent.
- Every HUD instrument has `data-zone`, crew icons `data-agent-icon`, controls `data-testid`.
- Never put the LLM in a time-critical path.

## Commands
- `pnpm test` (Vitest), `pnpm typecheck`, `pnpm test:e2e` (builds with `VITE_TEST_HOOKS=1`, runs `wrangler dev --var MOCK_AI:1`).
- `pnpm dev` — Vite on :5173 (proxying `/api`) plus `wrangler dev` on :8787.
- `pnpm deploy` — build, remote D1 migrations, `wrangler deploy`.
