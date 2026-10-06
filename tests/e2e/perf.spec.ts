import { test, expect } from './fixtures';

type W = { __wm: { step(n: number, render?: boolean): void; resume(): void } };

test('frame budget and frame-rate smoke @perf', async ({ page, wm }, info) => {
  test.skip(info.project.name !== 'desktop' && info.project.name !== 'phone', 'desktop and phone projects');
  await wm.start('bridge-fall', 'cadet');
  await page.keyboard.press('KeyR');
  // CPU side of a frame: one fixed game step plus the agents (inline in test builds) must fit easily in 16 ms.
  const msPerStep = await page.evaluate(() => {
    const w = (window as unknown as W).__wm;
    const t0 = performance.now();
    w.step(600, false);
    return (performance.now() - t0) / 600;
  });
  test.info().annotations.push({ type: 'ms per step', description: msPerStep.toFixed(3) });
  expect(msPerStep).toBeLessThan(4);

  // Real-time rendering. Headless runs use software WebGL, so fps is recorded, not asserted against 60.
  await page.evaluate(() => (window as unknown as W).__wm.resume());
  const fps = await page.evaluate(() => new Promise<number>(resolve => {
    let frames = 0;
    const t0 = performance.now();
    const tick = (): void => {
      frames++;
      if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
      else resolve((frames * 1000) / (performance.now() - t0));
    };
    requestAnimationFrame(tick);
  }));
  test.info().annotations.push({ type: 'fps (software GL)', description: fps.toFixed(1) });
  expect(fps).toBeGreaterThan(0);
});
