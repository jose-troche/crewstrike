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

test('touch tour: buttons and swipes page it, and try-it steps tick when used', async ({ page, wm }, info) => {
  test.skip(info.project.name !== 'phone', 'phone');
  await page.goto('/');
  await ready(page);
  await page.getByTestId('tour-btn').click();
  const bubble = page.locator('.tour-bubble');
  await expect(bubble).toHaveAttribute('data-step', 'welcome');
  await expect(bubble.locator('kbd')).toHaveCount(0); // no keyboard keys on a phone

  // A left swipe goes forward, a right swipe back.
  const swipe = async (dx: number): Promise<void> => {
    const tour = page.getByTestId('tour');
    await tour.dispatchEvent('pointerdown', { pointerId: 1, clientX: 400, clientY: 150, pointerType: 'touch' });
    await tour.dispatchEvent('pointerup', { pointerId: 1, clientX: 400 + dx, clientY: 155, pointerType: 'touch' });
  };
  await swipe(-120);
  await expect(bubble).toHaveAttribute('data-step', 'stick');
  await swipe(120);
  await expect(bubble).toHaveAttribute('data-step', 'welcome');

  const s0 = await wm.snapshot();
  const seen: string[] = [];
  for (;;) {
    const id = (await bubble.getAttribute('data-step'))!;
    seen.push(id);
    // Every bubble settles fully on the screen (it glides between spots).
    const vp = page.viewportSize()!;
    await expect.poll(async () => {
      const b = (await bubble.boundingBox())!;
      return b.y >= 0 && b.y + b.height <= vp.height && b.x >= 0 && b.x + b.width <= vp.width;
    }, { message: id }).toBe(true);
    if (id === 'cannon') {
      const fire = page.getByTestId('touch-cannon');
      await expect(page.getByTestId('tour-try')).toHaveAttribute('data-done', 'false');
      await fire.dispatchEvent('pointerdown', { pointerId: 5, pointerType: 'touch' });
      await expect(page.getByTestId('tour-try')).toHaveAttribute('data-done', 'true');
      await page.getByTestId('touch-fire').dispatchEvent('pointerup', { pointerId: 5, pointerType: 'touch' });
    }
    if (id === 'done') break;
    await page.getByTestId('tour-next').click();
    await expect(bubble).not.toHaveAttribute('data-step', id);
  }
  for (const id of ['stick', 'throttle', 'speed', 'fuel', 'radar', 'threat-ring', 'fire-cluster', 'cannon', 'missile', 'strike', 'flare', 'boost', 'autopilot', 'talk']) {
    expect(seen).toContain(id);
  }
  expect((await wm.snapshot()).weapons.rounds).toBe(s0.weapons.rounds); // the frozen jet never fired
  await page.getByTestId('tour-training').click();
  await expect(page.getByTestId('tour')).toBeHidden();
  expect((await wm.snapshot()).missionId).toBe('training');
});
