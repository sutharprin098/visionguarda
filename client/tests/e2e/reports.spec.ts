import { test, expect } from '@playwright/test';

test('reports page renders and CSV export produces a real file', async ({ page }) => {
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();

  const exportBtn = page.getByRole('button', { name: 'Export CSV' });
  const isDisabled = await exportBtn.isDisabled();
  test.skip(isDisabled, 'no cameras configured — nothing to export');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportBtn.click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/^camai_report_\d+\.csv$/);
  const path = await download.path();
  expect(path).toBeTruthy();
});
