import { test, expect } from '@playwright/test';

// Requires the "E2E Screenshot Test" camera to exist and be active (an
// "upload" source pointed at a small real video file) — see the setup
// commands in the session notes / memory for how it was seeded, since
// screenshare/webcam camera types can't produce real frames without an
// actual browser screen-capture session or hardware.
test('camera snapshot button downloads a real captured frame', async ({ page }) => {
  await page.goto('/live');
  await expect(page.getByRole('heading', { name: 'Live Monitoring' })).toBeVisible();

  // Scope everything to this camera's own grid tile — other cameras in this
  // environment are paused/sourceless screenshare tiles whose own "Take
  // snapshot" button is a no-op (captureSnapshot bails on naturalWidth=0),
  // and .first() across the whole page can hit one of those instead of the
  // one real, actively-streaming camera.
  const img = page.locator('img[alt="E2E Screenshot Test"]');
  const imgCount = await img.count();
  test.skip(imgCount === 0, 'E2E Screenshot Test camera not present — see seed instructions');

  const tile = page.locator('.relative.aspect-video', { has: img });

  // Wait for the MJPEG <img> to actually load real frame data before
  // snapshotting — otherwise captureSnapshot() bails out on naturalWidth=0.
  await expect
    .poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 })
    .toBeGreaterThan(0);

  const snapshotBtn = tile.getByTitle('Take snapshot');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    snapshotBtn.click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/\.jpg$/);
  const path = await download.path();
  expect(path).toBeTruthy();
});
