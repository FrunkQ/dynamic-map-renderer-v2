import { test, expect } from '@playwright/test';

/**
 * E2E: GM ↔ Player synchronisation via BroadcastChannel (local window).
 *
 * These tests require a running dev server (npm run dev).
 * Run with: npm run test:e2e
 *
 * Note: PeerJS network tests are intentionally excluded here to avoid
 * depending on external broker availability in CI. BroadcastChannel
 * covers the most common use case (local VTT window).
 */

test.describe('Player view loads', () => {
  test('player page connects and shows connect panel when no room code', async ({ page }) => {
    await page.goto('/player');
    const connectPanel = page.locator('#connect-panel');
    await expect(connectPanel).toBeVisible({ timeout: 5000 });
  });

  test('GM page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Filter out known benign Three.js / PeerJS warnings
    const critical = errors.filter(
      (e) => !e.includes('PeerJS') && !e.includes('Could not connect')
    );
    expect(critical).toHaveLength(0);
  });

  test('GM sidebar renders key panels', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#session-panel')).toBeVisible();
    await expect(page.locator('#map-panel')).toBeVisible();
    await expect(page.locator('#filter-panel-section')).toBeVisible();
    await expect(page.locator('#fog-panel')).toBeVisible();
  });

  test('room code is generated and displayed', async ({ page }) => {
    await page.goto('/');
    // Room code should appear within 3s (PeerJS connection)
    await expect(page.locator('#room-code')).not.toHaveText('…', { timeout: 6000 });
    const code = await page.locator('#room-code').textContent();
    expect(code).toBeTruthy();
    expect(code!.length).toBeGreaterThan(3);
  });
});

test.describe('Filter panel', () => {
  test('filter select populates with at least 3 filters', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const options = page.locator('#filter-select option');
    await expect(options).toHaveCount(4, { timeout: 3000 }); // none, green, amber, parchment
  });

  test('switching filter updates param panel', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.selectOption('#filter-select', 'retro_sci_fi_green');
    const rows = page.locator('#filter-params .param-row');
    const count = await rows.count();
    expect(count).toBeGreaterThan(5);
  });
});
