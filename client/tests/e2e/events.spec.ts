import { test, expect } from '@playwright/test';

test('events search filters the timeline by text', async ({ page }) => {
  await page.goto('/events');
  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();

  const rowCount = async () => page.locator('.panel.divide-y > div').count();
  const initialCount = await rowCount();
  test.skip(initialCount === 0, 'no events present in this environment');

  const search = page.getByPlaceholder('Search events…');

  // A query that shouldn't match anything real should collapse to the
  // empty state — proves the search box actually filters, not just accepts input.
  await search.fill('zzzz_no_such_event_zzzz');
  await expect(page.getByText('No events found')).toBeVisible();

  // Clearing via the visible X button should restore the full list.
  await page.getByTitle('Clear search').click();
  await expect(search).toHaveValue('');
  await expect.poll(rowCount).toBe(initialCount);
});
