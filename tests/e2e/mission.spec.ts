import { test, expect } from './fixtures';

type Hooks = {
  step(n: number, r?: boolean): void;
  controls(c: Record<string, boolean> | null): void;
  snapshot(): { status: string; weapons: { strikeAvailable: boolean; strikeLock: string }; threats: { kind: string; km: number }[]; own: { autopilot: boolean } };
};

test('Cadet with autopilot completes Radar Breaker from scripted inputs', async ({ page, wm }, info) => {
  test.setTimeout(150_000);
  test.skip(info.project.name !== 'desktop' && info.project.name !== 'phone', 'one desktop and one phone run');
  await wm.start('radar-breaker', 'cadet');
  await page.keyboard.press('KeyR'); // autopilot
  await wm.step(2);
  expect((await wm.snapshot()).own.autopilot).toBe(true);
  const status = await page.evaluate(() => {
    const w = (window as unknown as { __wm: Hooks }).__wm;
    // Scripted pilot: the autopilot flies; we press G twice in the zone and flare at close missiles.
    for (let t = 0; t < 60 * 420; t += 10) {
      const s = w.snapshot();
      if (s.status !== 'playing') return s.status;
      const press: Record<string, boolean> = {};
      if (s.weapons.strikeAvailable && t % 40 === 0) press.strike = true;
      if (s.threats.some(x => x.kind === 'missile' && x.km < 2.5) && t % 60 === 0) press.flare = true;
      w.controls(Object.keys(press).length ? press : null);
      w.step(1, false);
      w.controls(null);
      w.step(9, false);
    }
    return w.snapshot().status;
  });
  expect(status).toBe('won');
  const results = page.getByRole('dialog', { name: 'Mission results' });
  await expect(results).toBeVisible();
  await expect(results.getByRole('heading')).toHaveText('Mission complete');
  await expect(results.getByTestId('recap').locator('li')).toHaveCount(3);
  await expect(results.getByLabel(/of 3 stars/)).toBeVisible();

  // Save the score to the local D1 and see it on the board.
  await results.getByLabel('Callsign').fill(`E2E ${info.project.name}`.slice(0, 16));
  await results.getByRole('button', { name: 'Submit score' }).click();
  await expect(results).toContainText('Score saved.');
  await expect(results.getByRole('table', { name: 'Leaderboard' })).toContainText(`E2E ${info.project.name}`);
});

test('pause works at any moment and Esc resumes', async ({ page, wm }, info) => {
  test.skip(info.project.name === 'tablet' || info.project.name === 'phone', 'keyboard');
  await wm.start();
  await page.evaluate(() => (window as unknown as { __wm: { resume(): void } }).__wm.resume());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeHidden();
});
