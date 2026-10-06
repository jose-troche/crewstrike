import { test, expect } from '@playwright/test';
import { ready } from './fixtures';

test('explainer appears on first visit only', async ({ page }) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: /your mission/i });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('cockpit')).toBeVisible(); // cockpit live behind it
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Main menu' })).toBeVisible();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Help' }).click(); // the ? button reopens it
  await expect(dialog).toBeVisible();
});

test('three cards: mission, crew, then controls with a difficulty picker', async ({ page }) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: /your mission/i });
  await expect(dialog.getByRole('heading', { name: 'Your mission' })).toBeVisible();
  await expect(dialog).toContainText('Fly in, destroy the target, get out.');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('heading', { name: 'Your AI crew' })).toBeVisible();
  await expect(dialog).toContainText('Six AI agents');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('heading', { name: 'Fly' })).toBeVisible();
  const cadet = dialog.getByRole('radio', { name: 'Cadet' });
  await expect(cadet).toHaveAttribute('aria-checked', 'true'); // Cadet preselected
  await dialog.getByRole('radio', { name: 'Pilot' }).click();
  await expect(dialog.getByRole('radio', { name: 'Pilot' })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('button', { name: 'Start mission' })).toBeVisible();
});

test('training flight starts from the explainer', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const dialog = page.getByRole('dialog', { name: /your mission/i });
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: 'Training flight' }).click();
  await expect(dialog).toBeHidden();
  const mission = await page.evaluate(() => (window as unknown as { __wm: { snapshot(): { missionId: string; training: boolean } } }).__wm.snapshot());
  expect(mission.missionId).toBe('training');
  await expect(page.getByTestId('training-hint')).toContainText('Fly through the three rings');
});
