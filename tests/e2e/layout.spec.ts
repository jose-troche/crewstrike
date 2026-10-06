import { test, expect, isTouch } from './fixtures';

test('portrait shows only the rotate prompt and pauses', async ({ page, wm }, info) => {
  test.skip(info.project.name !== 'portrait', 'portrait only');
  await wm.start();
  await expect(page.getByTestId('rotate-prompt')).toBeVisible();
  await expect(page.getByTestId('rotate-prompt')).toContainText('Turn your device');
  expect(await page.evaluate(() => (window as unknown as { __wm: { screen(): string } }).__wm.screen())).toBe('paused');
});

test.describe('landscape', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name === 'portrait', 'landscape only');
  });

  test('no instrument overlaps the aiming area', async ({ page, wm }) => {
    await wm.start();
    await wm.step(30);
    const center = (await page.getByTestId('aim-area').boundingBox())!;
    expect(center.width).toBeGreaterThan(50);
    for (const zone of await page.locator('[data-zone]:not([data-zone="threat-ring"])').all()) {
      const b = await zone.boundingBox();
      if (!b) continue;
      const overlaps = b.x < center.x + center.width && b.x + b.width > center.x && b.y < center.y + center.height && b.y + b.height > center.y;
      expect(overlaps, (await zone.getAttribute('data-zone')) ?? '').toBe(false);
    }
  });

  test('every instrument fits on screen', async ({ page, wm }) => {
    await wm.start();
    await wm.step(10);
    const vp = page.viewportSize()!;
    for (const zone of await page.locator('[data-zone]').all()) {
      const b = (await zone.boundingBox())!;
      const name = (await zone.getAttribute('data-zone')) ?? '';
      expect(b, name).not.toBeNull();
      expect(b.x, name).toBeGreaterThanOrEqual(-1);
      expect(b.y, name).toBeGreaterThanOrEqual(-1);
      expect(b.x + b.width, name).toBeLessThanOrEqual(vp.width + 1);
      expect(b.y + b.height, name).toBeLessThanOrEqual(vp.height + 1);
    }
  });

  test('touch controls only in touch mode', async ({ page, wm }, info) => {
    await wm.start();
    const fire = page.getByTestId('touch-fire');
    if (isTouch(info.project.name)) {
      await expect(page.getByTestId('cockpit')).toHaveAttribute('data-mode', 'touch');
      await expect(fire).toBeVisible();
      await expect(page.getByTestId('touch-throttle')).toBeVisible();
    } else {
      await expect(page.getByTestId('cockpit')).not.toHaveAttribute('data-mode', 'touch');
      await expect(fire).toBeHidden();
    }
  });

  test('layout mode follows the screen', async ({ page, wm }, info) => {
    await wm.start();
    const mode = await page.getByTestId('cockpit').getAttribute('data-mode');
    const expected = { desktop: 'wide', laptop: 'compact', tablet: 'touch', phone: 'touch' }[info.project.name];
    expect(mode).toBe(expected);
  });

  test('touch targets are at least 44 px', async ({ page, wm }) => {
    await wm.start();
    for (const b of await page.locator('[data-testid="cockpit"] button').all()) {
      if (!(await b.isVisible())) continue;
      const box = (await b.boundingBox())!;
      const name = (await b.getAttribute('aria-label')) ?? (await b.textContent()) ?? '';
      expect(box.width, name).toBeGreaterThanOrEqual(43.5);
      expect(box.height, name).toBeGreaterThanOrEqual(43.5);
    }
  });
});
