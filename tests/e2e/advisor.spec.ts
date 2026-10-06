import { test, expect, type Page } from '@playwright/test';
import { driver } from './fixtures';

async function setup(page: Page): Promise<ReturnType<typeof driver>> {
  await page.addInitScript(() => localStorage.setItem('wm.seenExplainer', '1'));
  await page.route('**/api/config', r => r.fulfill({ json: { turnstileSiteKey: null, model: 'mock', mockAi: true } }));
  await page.route('**/api/session', r => r.fulfill({ json: { session: '0f8c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b' } }));
  const wm = driver(page);
  await wm.start('radar-breaker', 'pilot');
  await page.evaluate(() => (window as unknown as { __wm: { connect(): Promise<unknown> } }).__wm.connect());
  return wm;
}

test('tactical questions stay local; strategic ones show a verdict', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', r => { if (r.url().includes('/api/advice')) calls.push(r.url()); });
  await page.route('**/api/advice', r => r.fulfill({ json: { reason: 'Two fighters ahead, two missiles left. Go north.', action: 'route_safest' } }));
  const wm = await setup(page);

  await wm.ask('fuel?');
  await expect(page.getByTestId('console')).toContainText('Fuel');
  expect(calls).toHaveLength(0);

  await wm.spawn({ type: 'fighters', count: 2, range_km: 8 });
  await wm.spawn({ type: 'ammo', missiles: 2 });
  await wm.step(6);
  await wm.ask('should I dogfight or avoid them?');
  expect(calls).toHaveLength(1);
  await expect(page.getByTestId('verdict-chip')).toHaveText(/AVOID|ENGAGE/);
  await expect(page.getByTestId('verdict-action')).toHaveText(/^Set route (north|south|east|west)\?$/);
  await expect(page.getByTestId('verdict-reason')).toHaveText(/missiles left/);
});

test('the number guardrail rejects invented numbers', async ({ page }) => {
  await page.route('**/api/advice', r => r.fulfill({ json: { reason: 'You have 9 missiles, so take all 4 fighters.', action: 'none' } }));
  const wm = await setup(page);
  await wm.spawn({ type: 'fighters', count: 2, range_km: 8 });
  await wm.step(6);
  await wm.ask('should I escape?');
  await expect(page.getByTestId('verdict-chip')).toBeVisible();
  await expect(page.getByTestId('verdict-reason')).not.toContainText('9 missiles');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-source', 'template');
});

test('template fallback when the budget says 429', async ({ page }) => {
  await page.route('**/api/advice', r => r.fulfill({ status: 429, json: { error: 'daily_ceiling' } }));
  const wm = await setup(page);
  await wm.ask('should I abort?');
  await expect(page.getByTestId('verdict-chip')).toHaveText(/CONTINUE|ABORT/);
  await expect(page.getByTestId('verdict-reason')).not.toBeEmpty();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-source', 'template');
});

test('accepting the suggested action sets the route', async ({ page }) => {
  await page.route('**/api/advice', r => r.fulfill({ status: 429, json: { error: 'daily_ceiling' } }));
  const wm = await setup(page);
  await wm.spawn({ type: 'damage', amount: 0.8 });
  await wm.step(6);
  await wm.ask('should I keep going?');
  await expect(page.getByTestId('verdict-chip')).toHaveText('ABORT');
  await expect(page.getByTestId('verdict-action')).toHaveText('Set route home?');
  await page.getByTestId('verdict-action').click();
  await expect(page.getByTestId('verdict')).toBeHidden();
  await expect(page.getByTestId('console')).toContainText('Route home');
});
