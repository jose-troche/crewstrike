import { test, expect } from './fixtures';

test('low fuel lights the Flight agent and the fuel gauge', async ({ page, wm }) => {
  await wm.start('radar-breaker', 'pilot');
  await wm.spawn({ type: 'set_fuel', fraction: 0.12 });
  await wm.step(30, false); // no software-GL render between the glow and the check
  await expect(page.locator('[data-zone="fuel"]')).toHaveClass(/glow-(amber|red)/); // 900 ms glow: check first
  const line = page.getByTestId('console').locator('li').first();
  await expect(line).toHaveAttribute('data-agent', 'flight');
  await expect(line).toHaveText(/Fuel: \d+ min to exit/);
  await expect(page.locator('[data-agent-icon="flight"]')).toHaveAttribute('data-active', 'true');
});

test('a missile launch speaks as Radar and glows the radar and threat ring', async ({ page, wm }) => {
  await wm.start('radar-breaker', 'pilot');
  await wm.step(6);
  await wm.spawn({ type: 'missile', bearing: -90, range_km: 4 });
  await wm.step(6, false); // no software-GL render between the glow and the check
  await expect(page.locator('[data-zone="radar"]')).toHaveClass(/glow-red/); // 900 ms glow: check first
  const line = page.getByTestId('console').locator('li[data-agent="radar"]');
  await expect(line).toHaveAttribute('data-level', 'red');
  await expect(line).toContainText(/Missile, (left|behind)! Flares\./);
  await expect(page.locator('[data-agent-icon="radar"]')).toHaveAttribute('data-active', 'true');
});

test('crew strip shows a one-line status per agent', async ({ page, wm }) => {
  await wm.start();
  await wm.step(12);
  await expect(page.locator('[data-agent-icon="weapons"]')).toHaveAttribute('title', /^Weapons: 600 rounds, 6 missiles, 2 strike/);
  await expect(page.locator('[data-agent-icon="flight"]')).toHaveAttribute('title', /^Flight: fuel \d+%/);
  for (const a of ['radar', 'weapons', 'flight', 'mission', 'weather', 'wingman']) await expect(page.locator(`[data-agent-icon="${a}"]`)).toHaveCount(1);
});
