import { test, expect, isTouch } from './fixtures';

test('typed instant commands act and confirm in one word', async ({ page, wm }, info) => {
  test.skip(isTouch(info.project.name), 'uses the / key');
  await wm.start('radar-breaker', 'pilot');
  await page.keyboard.press('Slash');
  const input = page.getByTestId('command-input');
  await expect(input).toBeFocused();
  await input.fill('flares');
  await input.press('Enter');
  await wm.step(2);
  await expect(page.getByTestId('console')).toContainText('Flares.');
  expect((await wm.snapshot()).weapons.flares).toBe(15);
  await wm.ask('full throttle');
  await wm.step(2);
  expect((await wm.snapshot()).own.throttle).toBe(2);
});

test('tactical and how-to answers make no network request and highlight the right control', async ({ page, wm }) => {
  const calls: string[] = [];
  page.on('request', r => { if (r.url().includes('/api/')) calls.push(r.url()); });
  await wm.start('radar-breaker', 'pilot');
  calls.length = 0;
  await wm.ask('fuel?');
  await expect(page.getByTestId('console')).toContainText(/Fuel \d+%, \d+ min to exit\./);
  await expect(page.locator('[data-zone="fuel"]')).toHaveClass(/glow/);
  await wm.ask('how many missiles?');
  await expect(page.getByTestId('console')).toContainText('6 missiles, 2 strike.');
  await wm.ask('How do I use the strike missile?');
  await expect(page.getByTestId('console')).toContainText('press G to lock');
  await expect(page.locator('[data-help="weapon-strike"]')).toHaveClass(/highlight/);
  await wm.ask('where is the target?');
  await expect(page.getByTestId('console')).toContainText(/Target \d+\.\d km, \d+ o'clock\./);
  expect(calls).toHaveLength(0);
});

test('autopilot and route commands by voice text', async ({ wm }) => {
  await wm.start('radar-breaker', 'cadet');
  await wm.ask('autopilot on');
  await wm.step(2);
  expect((await wm.snapshot()).own.autopilot).toBe(true);
  await wm.ask('head home');
  await wm.step(2);
  expect((await wm.snapshot()).own.autopilot).toBe(true);
});
