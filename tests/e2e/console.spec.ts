import { test, expect } from './fixtures';

interface Out { fresh: { key: string; level: string; at: number; agent: string } | null; lines: { key: string; level: string }[] }
type W = { __wm: { step(n: number, r?: boolean): void; output(): Out | null; spawn(e: unknown): void } };

/** Step in agent ticks (6 frames) and record every fresh line. */
async function record(page: import('@playwright/test').Page, ticks: number): Promise<{ fresh: NonNullable<Out['fresh']>[]; maxLines: number }> {
  return page.evaluate(n => {
    const w = (window as unknown as W).__wm;
    const fresh: NonNullable<Out['fresh']>[] = [];
    let maxLines = 0;
    let last: Out['fresh'] = null;
    for (let i = 0; i < n; i++) {
      w.step(6, false);
      const o = w.output();
      if (o?.fresh && o.fresh !== last) {
        fresh.push(o.fresh);
        last = o.fresh;
      }
      maxLines = Math.max(maxLines, o?.lines.length ?? 0);
    }
    return { fresh, maxLines };
  }, ticks);
}

test('pace: at most one new non-red line every 2 seconds, two lines max', async ({ page, wm }) => {
  await wm.start('bridge-fall', 'cadet');
  await page.keyboard.press('KeyR');
  const { fresh, maxLines } = await record(page, 600);
  expect(maxLines).toBeLessThanOrEqual(2);
  const calm = fresh.filter(f => f.level !== 'red');
  expect(calm.length).toBeGreaterThan(2);
  for (let i = 1; i < calm.length; i++) expect(calm[i]!.at - calm[i - 1]!.at).toBeGreaterThanOrEqual(2000);
});

test('dedupe: the same alert does not repeat within 8 seconds', async ({ page, wm }) => {
  await wm.start('radar-breaker', 'pilot');
  await wm.spawn({ type: 'set_fuel', fraction: 0.12 });
  const { fresh } = await record(page, 150);
  const fuel = fresh.filter(f => f.key === 'fuel-home');
  expect(fuel.length).toBeGreaterThanOrEqual(1);
  for (let i = 1; i < fuel.length; i++) expect(fuel[i]!.at - fuel[i - 1]!.at).toBeGreaterThanOrEqual(8000);
});

test('combat quiet: only red and amber lines while defending', async ({ page, wm }) => {
  await wm.start('radar-breaker', 'cadet');
  await wm.step(6);
  await wm.spawn({ type: 'fighters', count: 2, range_km: 2.5 });
  await wm.spawn({ type: 'missile', bearing: 180, range_km: 5 });
  const { fresh } = await record(page, 40);
  expect(fresh.length).toBeGreaterThan(0);
  for (const f of fresh) expect(['red', 'amber']).toContain(f.level);
});

test('red lines stay until the danger is over', async ({ page, wm }) => {
  await wm.start('radar-breaker', 'pilot');
  await wm.step(6);
  await wm.spawn({ type: 'missile', bearing: 180, range_km: 9 });
  await wm.step(30);
  const red = page.getByTestId('console').locator('li[data-level="red"]');
  await expect(red).toHaveCount(1);
  await wm.step(60 * 6); // well past the 4-second fade
  const inbound = (await wm.snapshot()).threats.some(t => t.kind === 'missile');
  if (inbound) await expect(red).toHaveCount(1);
  await wm.spawn({ type: 'ammo', flares: 16 });
  // Flares and time take care of it; once nothing is inbound the red line clears.
  for (let i = 0; i < 20 && (await wm.snapshot()).threats.some(t => t.kind === 'missile'); i++) {
    await page.keyboard.press('KeyE');
    await wm.step(60);
  }
  await wm.step(60);
  if (!(await wm.snapshot()).threats.some(t => t.kind === 'missile')) await expect(page.getByTestId('console').locator('li[data-key="missile"]')).toHaveCount(0);
});

test('history keeps the last messages', async ({ page, wm }) => {
  await wm.start('radar-breaker', 'pilot');
  await wm.spawn({ type: 'set_fuel', fraction: 0.12 });
  await wm.step(30);
  await page.getByTestId('log-btn').click();
  await expect(page.getByTestId('history')).toBeVisible();
  await expect(page.getByTestId('history')).toContainText('Fuel:');
});
