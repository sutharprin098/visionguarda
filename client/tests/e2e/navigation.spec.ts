import { test, expect } from '@playwright/test';

// Every sidebar route must load without throwing/console-erroring and must
// render its own Topbar title — catches orphaned pages, broken imports, and
// runtime crashes that a build/typecheck pass alone would not.
const PAGES: { path: string; title: string }[] = [
  { path: '/', title: 'Dashboard' },
  { path: '/live', title: 'Live Monitoring' },
  { path: '/cameras', title: 'Cameras' },
  { path: '/analytics', title: 'AI Analytics' },
  { path: '/events', title: 'Events' },
  { path: '/alerts', title: 'Alerts' },
  { path: '/recordings', title: 'Recordings' },
  { path: '/reports', title: 'Reports' },
  { path: '/users', title: 'Users' },
  { path: '/settings', title: 'Settings' },
];

for (const page of PAGES) {
  test(`navigates to ${page.path} without console errors`, async ({ page: p }) => {
    const consoleErrors: string[] = [];
    p.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    p.on('pageerror', (err) => consoleErrors.push(err.message));

    await p.goto(page.path);
    // Not waitForLoadState('networkidle') — this app keeps a persistent
    // WebSocket + polling queries (5-15s refetchInterval) alive, so network
    // activity never truly goes idle and networkidle would hang until
    // timeout. Waiting for the page's own heading is the correct signal.
    await expect(p.getByRole('heading', { name: page.title, exact: true })).toBeVisible();

    const realErrors = consoleErrors.filter(
      (e) => !e.includes('WebSocket') && !e.includes('Failed to load resource') // WS reconnect noise in a fresh test session is expected
    );
    expect(realErrors, `console errors on ${page.path}: ${realErrors.join('; ')}`).toEqual([]);
  });
}

test('sidebar collapse toggle works', async ({ page }) => {
  await page.goto('/');
  const sidebar = page.locator('aside');
  await expect(sidebar).toHaveClass(/w-\[236px\]/);

  await page.getByTitle('Collapse sidebar').click();
  await expect(sidebar).toHaveClass(/w-\[64px\]/);

  await page.getByTitle('Expand sidebar').click();
  await expect(sidebar).toHaveClass(/w-\[236px\]/);
});
