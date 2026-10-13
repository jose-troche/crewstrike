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

test('a thumb slides from Fire onto Flare without lifting', async ({ page, wm }, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout');
  await wm.start('radar-breaker', 'pilot');
  const pad = page.getByTestId('touch-fire');
  const fire = (await page.getByTestId('touch-cannon').boundingBox())!;
  const flare = (await page.getByTestId('touch-flare').boundingBox())!;
  const at = (b: { x: number; y: number; width: number; height: number }) => ({ clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 });
  await page.getByTestId('touch-cannon').dispatchEvent('pointerdown', { pointerId: 11, pointerType: 'touch', ...at(fire) });
  await wm.step(30);
  const s1 = await wm.snapshot();
  expect(s1.weapons.rounds).toBeLessThan(600);
  await pad.dispatchEvent('pointermove', { pointerId: 11, pointerType: 'touch', ...at(flare) });
  await wm.step(3);
  const s2 = await wm.snapshot();
  expect(s2.weapons.flares).toBe(15);
  await wm.step(30);
  expect((await wm.snapshot()).weapons.rounds).toBe(s2.weapons.rounds); // cannon stopped when the thumb left Fire
  await pad.dispatchEvent('pointerup', { pointerId: 11, pointerType: 'touch', ...at(flare) });
});

test('a slightly-off touch lands on the nearest button', async ({ page, wm }, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout');
  await wm.start('radar-breaker', 'pilot');
  const flare = (await page.getByTestId('touch-flare').boundingBox())!;
  // Just outside the flare button's circle, in the gap of the cluster.
  const p = { clientX: flare.x + flare.width / 2, clientY: flare.y - 8 };
  await page.getByTestId('touch-fire').dispatchEvent('pointerdown', { pointerId: 12, pointerType: 'touch', ...p });
  await wm.step(3);
  await page.getByTestId('touch-fire').dispatchEvent('pointerup', { pointerId: 12, pointerType: 'touch', ...p });
  expect((await wm.snapshot()).weapons.flares).toBe(15);
});

test('touch throttle rocker sets the notch', async ({ page, wm }, info) => {
  test.skip(!isTouch(info.project.name), 'touch projects');
  await wm.start('radar-breaker', 'pilot');
  await page.getByRole('button', { name: 'Throttle slow' }).dispatchEvent('pointerdown', { pointerId: 13, pointerType: 'touch' });
  await page.getByTestId('touch-throttle').dispatchEvent('pointerup', { pointerId: 13, pointerType: 'touch' });
  await wm.step(3);
  expect((await wm.snapshot()).own.throttle).toBe(0);
});
