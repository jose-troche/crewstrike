import { test, expect } from './fixtures';

type A = { __wm: { audio(): { kind: string; id: string }[] } };

test('voice modes cycle with M and the speaker button', async ({ page, wm }) => {
  await wm.start();
  const btn = page.getByTestId('voice-toggle');
  await expect(btn).toHaveAttribute('aria-label', 'Voice: critical'); // default
  await page.keyboard.press('KeyM');
  await expect(btn).toHaveAttribute('aria-label', 'Voice: all');
  await page.keyboard.press('KeyM');
  await expect(btn).toHaveAttribute('aria-label', 'Voice: off');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-label', 'Voice: critical');
  await page.reload();
  await expect(page.getByTestId('voice-toggle')).toHaveAttribute('aria-label', 'Voice: critical'); // remembered
});

test('a missile launch plays the critical clip', async ({ page, wm }) => {
  await wm.start('radar-breaker', 'pilot');
  await wm.step(6);
  await wm.spawn({ type: 'missile', bearing: -90, range_km: 4 });
  await wm.step(6);
  const log = await page.evaluate(() => (window as unknown as A).__wm.audio());
  expect(log.some(e => e.kind === 'clip' && /^missile_(left|behind)$/.test(e.id))).toBe(true);
});

test('voice off stays silent', async ({ page, wm }) => {
  await wm.start('radar-breaker', 'pilot');
  await page.keyboard.press('KeyM');
  await page.keyboard.press('KeyM'); // critical -> all -> off
  await expect(page.getByTestId('voice-toggle')).toHaveAttribute('aria-label', 'Voice: off');
  await wm.spawn({ type: 'missile', bearing: -90, range_km: 4 });
  await wm.step(12);
  const log = await page.evaluate(() => (window as unknown as A).__wm.audio());
  expect(log.filter(e => e.kind === 'clip')).toHaveLength(0);
});
