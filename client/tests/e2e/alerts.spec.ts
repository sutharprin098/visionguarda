import { test, expect } from '@playwright/test';

// This environment has real alert history from prior camera activity, so
// these tests are deliberately non-destructive (no Clear All / Delete
// against real data) — they verify rendering and the safe, read-only
// interactions (snapshot lightbox, cross-page navigation).
test('alerts list renders with rule config section', async ({ page }) => {
  await page.goto('/alerts');
  await expect(page.getByRole('heading', { name: 'Alerts', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alert Rules — Zones & Line Crossings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Active Alerts' })).toBeVisible();
});

test('clicking an alert snapshot opens the lightbox preview', async ({ page }) => {
  await page.goto('/alerts');
  const firstSnapshot = page.locator('img[alt="Alert snapshot"]').first();
  const count = await firstSnapshot.count();
  test.skip(count === 0, 'no alerts with captured snapshots present');

  // force: true — the card has a hover-reveal overlay (opacity-0 ->
  // group-hover:opacity-100, no pointer-events:none) that Playwright's
  // strict actionability check treats as intercepting the click target.
  // In a real browser the click still bubbles from the overlay to the
  // parent's onClick handler exactly the same way, so this reflects real
  // user behavior rather than papering over a genuine bug.
  await firstSnapshot.click({ force: true });
  const lightbox = page.locator('img[alt="Snapshot preview"]');
  await expect(lightbox).toBeVisible();

  // Close via clicking the dark overlay backdrop (outside the image panel)
  await page.mouse.click(5, 5);
  await expect(lightbox).toHaveCount(0);
});

test('"Configure in Live Monitoring" navigates to /live', async ({ page }) => {
  await page.goto('/alerts');
  await page.getByRole('button', { name: 'Configure in Live Monitoring' }).click();
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByRole('heading', { name: 'Live Monitoring' })).toBeVisible();
});
