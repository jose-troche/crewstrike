import type { Page } from '@playwright/test';
import { test, expect, isTouch, ready } from './fixtures';

type W = { __wm: { screen(): string; audio(): { id: string; text: string }[] } };

/** Page forward with → until the bubble shows the given step. */
async function goTo(page: Page, id: string): Promise<void> {
  const bubble = page.locator('.tour-bubble');
  for (let n = 0; n < 40; n++) {
    const cur = await bubble.getAttribute('data-step');
    if (cur === id) return;
    await page.keyboard.press('ArrowRight');
    await expect(bubble).not.toHaveAttribute('data-step', cur!);
  }
  throw new Error(`tour step ${id} not found`);
}

test('cockpit tour walks every instrument by keyboard, then starts training', async ({ page, wm }, info) => {
  test.skip(isTouch(info.project.name), 'desktop projects');
  await page.goto('/');
  await ready(page);
  await page.getByTestId('tour-btn').click();
  const bubble = page.locator('.tour-bubble');
  await expect(bubble).toHaveAttribute('data-step', 'welcome');
  const s0 = await wm.snapshot();

  // Arrow keys page the tour; they must not fly the frozen jet.
  await page.keyboard.press('ArrowRight');
  await expect(bubble).toHaveAttribute('data-step', 'sight');
  await expect(page.getByTestId('tour-spot')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(bubble).toHaveAttribute('data-step', 'welcome');
  expect((await wm.snapshot()).own.heading).toBe(s0.own.heading);
  expect(await page.evaluate(() => (window as unknown as W).__wm.screen())).toBe('tour');

  const seen: string[] = [];
  for (;;) {
    const id = (await bubble.getAttribute('data-step'))!;
    seen.push(id);
    if (id === 'done') break;
    await page.keyboard.press('ArrowRight');
    await expect(bubble).not.toHaveAttribute('data-step', id);
  }
  for (const id of ['speed', 'fuel', 'altitude', 'damage', 'radar', 'threat-ring', 'cannon', 'missile', 'strike', 'flare', 'console', 'keys']) {
    expect(seen).toContain(id);
  }
  await page.getByTestId('tour-training').click();
  await expect(page.getByTestId('tour')).toBeHidden();
  expect((await wm.snapshot()).missionId).toBe('training');
});

test('tour bubbles show live key bindings and stage an inbound missile', async ({ page, wm: _wm }, info) => {
  test.skip(isTouch(info.project.name), 'desktop projects');
  await page.goto('/');
  await ready(page);
  await page.getByTestId('tour-btn').click();
  const bubble = page.locator('.tour-bubble');
  await goTo(page, 'threat-ring');
  await expect(page.locator('.threat-ring .wedge[data-level="red"]')).toBeVisible();
  await goTo(page, 'cannon');
  await expect(bubble.locator('p kbd').first()).toHaveText('Space');
  await expect(page.locator('.threat-ring .wedge[data-level="red"]')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Main menu' })).toBeVisible();
});

test('read aloud narrates the current bubble', async ({ page, wm: _wm }, info) => {
  test.skip(isTouch(info.project.name), 'desktop projects');
  await page.goto('/');
  await ready(page);
  await page.getByTestId('tour-btn').click();
  await page.keyboard.press('KeyR');
  await expect(page.getByTestId('tour-narrate')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as W).__wm.audio())).filter(e => e.id === 'tour').at(-1)?.text ?? '')
    .toContain('Gun sight');
});

test('the mouse neither steers nor fires', async ({ page, wm }, info) => {
  test.skip(isTouch(info.project.name), 'desktop projects');
  await wm.start('radar-breaker', 'pilot');
  const s0 = await wm.snapshot();
  await page.mouse.move(100, 100);
  await page.mouse.move(1200, 200, { steps: 5 });
  await page.mouse.down();
  await wm.step(90);
  await page.mouse.up();
  const s1 = await wm.snapshot();
  expect(s1.weapons.rounds).toBe(s0.weapons.rounds);
  expect(Math.abs(((s1.own.heading - s0.own.heading + 540) % 360) - 180)).toBeLessThan(5);
});
