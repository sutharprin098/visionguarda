import { test, expect } from '@playwright/test';

test('preview quality slider + apply button work', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Live Preview Quality' })).toBeVisible();

  const slider = page.locator('input[type="range"]');
  await slider.fill('1280');
  await expect(page.getByText('1280px wide')).toBeVisible();

  const applyBtn = page.getByRole('button', { name: /Apply to \d+ Active Feed/ });
  await applyBtn.click();
  // No active cameras in a fresh env means this resolves immediately with
  // no network call — just confirm the button doesn't error/hang.
  await expect(applyBtn).toBeEnabled({ timeout: 5000 });
});

test('system status refresh button works', async ({ page }) => {
  await page.goto('/settings');
  // Scope to the System Status card so we hit its refresh icon button (and
  // its own "Online" badge) specifically, not the global Topbar refresh or
  // the "System Online" text that also contains the substring "Online".
  const card = page.locator('.panel', { has: page.getByRole('heading', { name: 'System Status' }) });
  await expect(card.getByText('Online', { exact: true })).toBeVisible();

  await card.getByRole('button').click(); // should not throw; status re-fetches
  await expect(card.getByText('Online', { exact: true })).toBeVisible();
});
