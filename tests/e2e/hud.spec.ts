import { test, expect } from './fixtures';

const ZONES = ['objective', 'radar', 'threat-ring', 'damage', 'fuel', 'speed', 'altitude', 'weapons', 'flares', 'weather', 'console', 'mission-bar'];

test('every instrument is present with its one-line "?" help', async ({ page, wm }) => {
  await wm.start();
  for (const z of ZONES) {
    const el = page.locator(`[data-zone="${z}"]`);
    await expect(el, z).toHaveCount(1);
    const help = await el.getAttribute('title');
    expect(help, z).toBeTruthy();
    expect(help!.split(/\s+/).length, z).toBeLessThanOrEqual(14);
  }
  expect(ZONES).toHaveLength(12); // twelve instruments at most
});

test('explain mode links crew icons to their gauges, then fades', async ({ page, wm }) => {
  await wm.start();
  await page.getByTestId('explain-btn').click();
  const layer = page.getByTestId('explain-layer');
  await expect(layer).toHaveClass(/on/);
  await expect(layer.locator('line')).toHaveCount(12);
  await expect(layer.locator('[data-zone-label="fuel"]')).toContainText('home line');
  await expect(layer).not.toHaveClass(/on/, { timeout: 5000 });
});

test('gauge colors change green, amber, red at thresholds', async ({ page, wm }) => {
  await wm.start('radar-breaker', 'pilot');
  await wm.step(4);
  const fuel = page.locator('[data-zone="fuel"]');
  const damage = page.locator('[data-zone="damage"]');
  const alt = page.locator('[data-zone="altitude"]');
  await expect(fuel).toHaveAttribute('data-level', 'green');
  await expect(damage).toHaveAttribute('data-level', 'green');
  await expect(alt).toHaveAttribute('data-level', 'green');

  await wm.spawn({ type: 'set_fuel', fraction: 0.15 });
  await wm.spawn({ type: 'damage', amount: 0.4 });
  await wm.step(4);
  await expect(fuel).toHaveAttribute('data-level', /amber|red/);
  await expect(damage).toHaveAttribute('data-level', 'amber');

  await wm.spawn({ type: 'set_fuel', fraction: 0.02 });
  await wm.spawn({ type: 'damage', amount: 0.3 });
  await wm.spawn({ type: 'ground', agl: 120 });
  await wm.step(2);
  await expect(fuel).toHaveAttribute('data-level', 'red');
  await expect(damage).toHaveAttribute('data-level', 'red');
  await expect(alt).toHaveAttribute('data-level', 'red');
});

test('weapon cards show counts and the strike card only lights in the zone', async ({ page, wm }) => {
  await wm.start();
  const strike = page.locator('[data-zone="weapons"] [data-w="strike"]');
  await expect(page.locator('[data-zone="weapons"] [data-w="cannon"] .wcount')).toHaveText('600');
  await expect(strike).toHaveClass(/disabled/);
  await wm.spawn({ type: 'teleport', to: 'strike' });
  await wm.step(4);
  await expect(strike).not.toHaveClass(/disabled/);
  await expect(page.locator('[data-zone="objective"] .phase-chip')).toHaveText('STRIKE');
});

test('threat ring shows a red wedge for an inbound missile', async ({ page, wm }) => {
  await wm.start('radar-breaker', 'pilot');
  await wm.spawn({ type: 'missile', bearing: 90, range_km: 4 });
  await wm.step(2);
  await expect(page.locator('[data-zone="threat-ring"] .wedge[data-level="red"]')).toHaveCount(1);
});
