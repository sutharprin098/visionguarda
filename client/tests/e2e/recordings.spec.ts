import { test, expect } from '@playwright/test';

test('recordings page filters work', async ({ page }) => {
  await page.goto('/recordings');
  await expect(page.getByRole('heading', { name: 'Recordings' })).toBeVisible();

  const typeFilter = page.locator('select').nth(1);
  await typeFilter.selectOption('continuous');
  await expect(page.getByText(/^\d+ recordings?$/)).toBeVisible();

  await typeFilter.selectOption('all');
});

test('clicking a recording opens the playback modal and the video actually loads', async ({ page }) => {
  await page.goto('/recordings');

  // Target the deterministic seed recording (server/scripts/seed_test_recording.py)
  // rather than "whatever's newest" — a live camera's own recording depends
  // on real frames actually being pushed to it (e.g. an active screenshare
  // WebSocket session), which this suite doesn't simulate, so an organic
  // "newest" recording can legitimately be a zero-frame stub. The seed
  // script writes real frames through the same _H264Writer the app uses,
  // so this deterministically tests the real encode+serve+play path.
  const cameraFilter = page.locator('select').first();
  const options = await cameraFilter.locator('option').allTextContents();
  test.skip(!options.includes('E2E Seed Camera'), 'run server/scripts/seed_test_recording.py first');
  await cameraFilter.selectOption({ label: 'E2E Seed Camera' });

  const firstCard = page.locator('.panel.cursor-pointer').first();
  const count = await firstCard.count();
  test.skip(count === 0, 'seed recording not found for E2E Seed Camera');

  await firstCard.click();
  const video = page.locator('video');
  await expect(video).toBeVisible();

  // Confirm the browser actually resolved and started loading real video
  // data from the server (readyState > 0 = HAVE_METADATA or further),
  // not just that a <video> tag with a src attribute exists on the page.
  await expect
    .poll(async () => video.evaluate((el: HTMLVideoElement) => el.readyState), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // Close via the dark overlay backdrop (outside the modal panel)
  await page.mouse.click(5, 5);
  await expect(video).toHaveCount(0);
});
