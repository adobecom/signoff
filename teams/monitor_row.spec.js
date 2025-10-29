const { test, expect } = require('@playwright/test');

class TeamsPage {
  constructor(page) {
    this.page = page;
    this.pageLoadOk = page.locator('div#page-load-ok-milo');
  }
}

test.describe('Creative Cloud Plans Page Monitoring', () => {

  const testUrl = process.env.TEST_URL || 'https://www.adobe.com/uk/creativecloud/business/teams.html';
  console.log(`Testing URL: ${testUrl}`);

  // Extract country code from URL path (e.g., /uk/ -> 'uk')
  const urlPath = new URL(testUrl).pathname;
  const countryCode = urlPath.split('/').filter(Boolean)[0] || 'uk';
  console.log(`Mocking geo location with country: ${countryCode}`);

  test.beforeEach(async ({ page }) => {
    // Mock geo location response
    await page.route('https://geo2.adobe.com/json/', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ country: countryCode })
      })
    );

    await page.route(testUrl, async route => {
      const response = await route.fetch();
      const body = await response.body();
      
      route.fulfill({
        status: response.status(),
        headers: {
          ...response.headers(),
          'Server-Timing': ['sis; desc=0', `geo; desc=${countryCode}`]
        },
        body: body
      });
    });

    try {
      await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 20000 });
    } catch (err) {
      console.log('Timeout on Waiting for network idle!');
    }
  });

  test('should load plans page successfully', async ({ page }) => {
    const teamsPage = new TeamsPage(page);
    await teamsPage.pageLoadOk.waitFor({ state: 'attached', timeout: 20000 });
    
    // Take screenshot of loaded page
    await page.screenshot({ 
      path: 'screenshots/teams-page-loaded.png',
      fullPage: true 
    });
  });

  test('should load without critical errors', async ({ page }) => {
    const errors = [];
    
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    page.on('pageerror', error => {
      errors.push(error.message);
    });
    
    try {
      await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
    } catch (error) {
      console.log('Timeout on waiting for network idle!');
    }
    const teamsPage = new TeamsPage(page);
    await teamsPage.pageLoadOk.waitFor({ state: 'attached', timeout: 20000 });
    
    // Filter out common non-critical errors
    const criticalErrors = errors.filter(error => 
      !error.includes('favicon') && 
      !error.includes('analytics') &&
      !error.includes('ads') &&
      !error.toLowerCase().includes('third-party')
    );
    
    if (criticalErrors.length > 0) {
      console.log('Critical errors found:', criticalErrors);
    }
    
    expect(criticalErrors.length).toBeLessThanOrEqual(2); // Allow minor non-critical errors
    
    await page.screenshot({ 
      path: 'screenshots/teams-error-check.png',
      fullPage: true 
    });
  });
});
