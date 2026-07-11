import { test, expect } from '@playwright/test';

// Exercises the full camera lifecycle through real UI interactions against
// the real backend (no mocking) — add, toggle active, rename, delete.
test('camera add / toggle active / rename / delete lifecycle', async ({ page }) => {
  const camName = `E2E Test Cam ${Date.now()}`;
  const renamedName = `${camName} Renamed`;

  await page.goto('/cameras');
  await expect(page.getByRole('heading', { name: 'Cameras' })).toBeVisible();

  // --- Add ---
  await page.getByRole('button', { name: 'Add Camera' }).click();
  await expect(page.getByRole('heading', { name: 'Add Camera' })).toBeVisible();

  await page.getByPlaceholder('e.g. Front Gate Entrance').fill(camName);
  await page.getByRole('button', { name: 'Screen Share' }).click();
  await page.getByRole('button', { name: 'Add Camera', exact: true }).last().click();

  const row = page.locator('tr', { hasText: camName });
  await expect(row).toBeVisible({ timeout: 10_000 });

  // --- Toggle active off then back on ---
  // Wait for each mutation to fully round-trip (aria-checked reflects the
  // server-confirmed state) before proceeding — otherwise a still-in-flight
  // toggle response can resolve after the edit modal below has opened and
  // silently close it (see the toggleActiveMutation fix in Cameras.tsx).
  const toggle = row.getByRole('switch');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  // --- Rename via edit modal ---
  await row.getByTitle('Rename / change source').click();
  await expect(page.getByRole('heading', { name: 'Edit Camera' })).toBeVisible();
  const nameInput = page.getByPlaceholder('e.g. Front Gate Entrance');
  await nameInput.fill(renamedName);
  await page.getByRole('button', { name: 'Save Changes' }).click();

  const renamedRow = page.locator('tr', { hasText: renamedName });
  await expect(renamedRow).toBeVisible({ timeout: 10_000 });

  // --- Delete ---
  await renamedRow.getByTitle('Remove camera').click();
  await expect(page.locator('tr', { hasText: renamedName })).toHaveCount(0, { timeout: 10_000 });
});

test('add camera form rejects empty required fields', async ({ page }) => {
  await page.goto('/cameras');
  await page.getByRole('button', { name: 'Add Camera' }).click();

  // Name + Source are both `required` — submitting empty should not close the modal
  // (native HTML5 validation blocks the submit).
  await page.getByRole('button', { name: 'Add Camera', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Add Camera' })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Add Camera' })).toHaveCount(0);
});
