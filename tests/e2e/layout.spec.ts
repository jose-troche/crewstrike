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

  test('every instrument and control fits on screen', async ({ page, wm }, info) => {
    await wm.start();
    await wm.step(10);
    const vp = page.viewportSize()!;
    // On a phone the weapon and flare counts ride on the fire buttons instead of their own panels.
    const hiddenOnPhone = new Set(['weapons', 'flares']);
    const items = [...await page.locator('[data-zone]').all(), ...await page.locator('[data-testid="cockpit"] button').all()];
    for (const zone of items) {
      const name = (await zone.getAttribute('data-zone')) ?? (await zone.getAttribute('data-testid')) ?? (await zone.getAttribute('aria-label')) ?? '';
      if (info.project.name === 'phone' && hiddenOnPhone.has(name)) continue;
      if (!(await zone.getAttribute('data-zone')) && !(await zone.isVisible())) continue;
      const b = (await zone.boundingBox())!;
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
      await expect(page.getByTestId('cockpit')).toHaveAttribute('data-mode', info.project.name === 'phone' ? 'phone' : 'touch');
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
    const expected = { desktop: 'wide', laptop: 'compact', tablet: 'touch', phone: 'phone' }[info.project.name];
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

test.describe('phone', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'phone', 'phone only');
  });

  test('the page never scrolls', async ({ page, wm }) => {
    await wm.start();
    await wm.step(10);
    const size = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, w: innerWidth, h: innerHeight,
    }));
    expect(size.sw).toBeLessThanOrEqual(size.w);
    expect(size.sh).toBeLessThanOrEqual(size.h);
  });

  test('fire buttons are at least 10 px apart and show what is left', async ({ page, wm }) => {
    await wm.start();
    await wm.step(10);
    const ids = ['touch-cannon', 'touch-missile', 'touch-strike', 'touch-flare', 'touch-boost', 'touch-autopilot', 'touch-mic', 'touch-keyboard'];
    const circles = await Promise.all(ids.map(async id => {
      const b = (await page.getByTestId(id).boundingBox())!;
      return { id, x: b.x + b.width / 2, y: b.y + b.height / 2, r: b.width / 2 };
    }));
    for (const a of circles) {
      for (const b of circles) {
        if (a.id >= b.id) continue;
        const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
        expect(gap, `${a.id} to ${b.id}`).toBeGreaterThanOrEqual(10);
      }
    }
    await expect(page.getByTestId('touch-cannon').locator('.tb-count')).toHaveText('600');
    await expect(page.getByTestId('touch-flare').locator('.tb-count')).toHaveText('16');
    await expect(page.getByTestId('touch-strike')).toHaveClass(/off/);
  });
});
