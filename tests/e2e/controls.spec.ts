import { test, expect, isTouch } from './fixtures';

test('keyboard throttle and boost change speed', async ({ page, wm }, info) => {
  test.skip(isTouch(info.project.name), 'keyboard projects');
  await wm.start('radar-breaker', 'pilot');
  await wm.step(5);
  const s0 = await wm.snapshot();
  await page.keyboard.press('KeyW');
  await wm.step(240);
  const s1 = await wm.snapshot();
  expect(s1.own.throttle).toBe(2);
  expect(s1.own.speed).toBeGreaterThan(s0.own.speed + 30);
  await page.keyboard.down('ShiftLeft');
  await wm.step(120);
  const s2 = await wm.snapshot();
  await page.keyboard.up('ShiftLeft');
  expect(s2.own.boost).toBe(true);
  expect(s2.own.speed).toBeGreaterThan(s1.own.speed + 40);
  await page.keyboard.press('KeyS');
  await page.keyboard.press('KeyS');
  await wm.step(5);
  expect((await wm.snapshot()).own.throttle).toBe(0);
});

test('arrow keys steer the jet', async ({ page, wm }, info) => {
  test.skip(isTouch(info.project.name), 'keyboard projects');
  await wm.start('radar-breaker', 'pilot');
  const h0 = (await wm.snapshot()).own.heading;
  await page.keyboard.down('ArrowRight');
  await wm.step(90);
  await page.keyboard.up('ArrowRight');
  const h1 = (await wm.snapshot()).own.heading;
  expect((h1 - h0 + 360) % 360).toBeGreaterThan(20);
});

test('autopilot hands back on stick input', async ({ page, wm }, info) => {
  test.skip(isTouch(info.project.name), 'keyboard projects');
  await wm.start('radar-breaker', 'cadet');
  await page.keyboard.press('KeyR');
  await wm.step(10);
  expect((await wm.snapshot()).own.autopilot).toBe(true);
  await page.keyboard.down('ArrowLeft');
  await wm.step(5);
  await page.keyboard.up('ArrowLeft');
  expect((await wm.snapshot()).own.autopilot).toBe(false);
});

test('touch stick steers', async ({ page, wm }, info) => {
  test.skip(!isTouch(info.project.name), 'touch projects');
  await wm.start('radar-breaker', 'pilot');
  const h0 = (await wm.snapshot()).own.heading;
  const zone = (await page.getByTestId('touch-stick').boundingBox())!;
  const x = zone.x + zone.width * 0.55;
  const y = zone.y + zone.height * 0.6;
  await page.getByTestId('touch-stick').dispatchEvent('pointerdown', { pointerId: 7, clientX: x, clientY: y, isPrimary: true, pointerType: 'touch' });
  await page.getByTestId('touch-stick').dispatchEvent('pointermove', { pointerId: 7, clientX: x + 60, clientY: y, isPrimary: true, pointerType: 'touch' });
  await wm.step(90);
  await page.getByTestId('touch-stick').dispatchEvent('pointerup', { pointerId: 7, clientX: x + 60, clientY: y, isPrimary: true, pointerType: 'touch' });
  const h1 = (await wm.snapshot()).own.heading;
  expect((h1 - h0 + 360) % 360).toBeGreaterThan(20);
});

test('touch flare button fires a flare', async ({ page, wm }, info) => {
  test.skip(!isTouch(info.project.name), 'touch projects');
  await wm.start('radar-breaker', 'pilot');
  await page.getByTestId('touch-flare').dispatchEvent('pointerdown', { pointerId: 3, pointerType: 'touch' });
  await wm.step(3);
  expect((await wm.snapshot()).weapons.flares).toBe(15);
});

test('gamepad steers and fires (mocked)', async ({ page, wm }, info) => {
  test.skip(isTouch(info.project.name), 'desktop projects');
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false }));
    const pad = { id: 'mock', index: 0, connected: true, mapping: 'standard', axes: [0.9, 0, 0, 0], buttons, timestamp: 0 };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
  });
  await wm.start('radar-breaker', 'pilot');
  const s0 = await wm.snapshot();
  await page.evaluate(() => { (window as unknown as { __pad: { buttons: { pressed: boolean }[] } }).__pad.buttons[4]!.pressed = true; });
  await wm.step(60);
  const s1 = await wm.snapshot();
  expect((s1.own.heading - s0.own.heading + 360) % 360).toBeGreaterThan(10);
  expect(s1.weapons.flares).toBe(15); // left bumper fires one flare (edge-triggered)
});
