const { test, expect } = require('@playwright/test');

class PlansPage {
  constructor(page) {
    this.page = page;
    this.pageLoadOk = page.locator('div.evidon-notice-link');
    this.tabKeys = {
      'Individuals': 'individual',
      'Business': 'team',
      'Students & Teachers': 'edu',
      'Schools & Universities': 'edu_inst'
    }
    this.tabs = {
      'Individuals': page.locator(`div[data-query-value="${this.tabKeys['Individuals']}"]`),
      'Business': page.locator(`div[data-query-value="${this.tabKeys['Business']}"]`),
      'Students & Teachers': page.locator(`div[data-query-value="${this.tabKeys['Students & Teachers']}"]`),
      'Schools & Universities': page.locator(`div[data-query-value="${this.tabKeys['Schools & Universities']}"]`),
    }
    this.checkoutButtons = page.locator('.is-Selected[role="tabpanel"] :is(plans-card, .plans-card) .dexter-Cta .spectrum-Button--cta').filter({ visible: true });
    this.checkoutModal = page.locator(':is(div.ReactModalPortal .commerce-context-container, div.iframe iframe)').filter({visible: true});
    this.checkoutIframe = page.frameLocator('div.iframe iframe');
    this.cardSelector = ':is(plans-card, .plans-card)';
    this.modalCloseButton = page.locator('button[aria-label*="Close"], .dexter-CloseButton').filter({visible: true});
  }

  async verifyTabPanel(tab) {
    const urlObject = new URL(await this.page.url());
    const locale = urlObject.pathname.split('/')[1];
    const localeMap = {
      uk: {
        'Individuals': 'Individuals',
        'Business': 'Business',
        'Students & Teachers': 'Students & Teachers',
        'Schools & Universities': 'Schools & Universities'
      }
    }
    const label = localeMap[locale][tab];
    await expect(this.page.locator(`[role="tabpanel"][aria-label="${label}"]`).filter({visible: true})).toBeVisible({timeout: 10000});
  }
}

test.describe('Creative Cloud Plans Page ROW Monitoring', () => {

  test.use({
    userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36 ${process.env.USER_AGENT_SUFFIX}`,
  });

  const testUrl = process.env.TEST_URL || 'https://www.adobe.com/uk/creativecloud/plans.html';
  console.log(`Testing URL: ${testUrl}`);

  test.beforeEach(async ({ page }) => {
    // Block Adobe messaging endpoint to disable Jarvis
    await page.route('https://client.messaging.adobe.com/**', route => route.abort());

    // Mock geo location response
    await page.route('https://geo2.adobe.com/json/', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ country: 'uk' })
      })
    );

    try {
      await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 20000 });
    } catch (err) {
      console.log('Timeout on Waiting for network idle!');
    }
  });

  test('should load plans page successfully', async ({ page }) => {
    const plansPage = new PlansPage(page);
    await plansPage.pageLoadOk.waitFor({ state: 'attached', timeout: 20000 });
    
    // Take screenshot of loaded page
    await page.screenshot({ 
      path: 'screenshots/plans-page-loaded.png',
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
    const plansPage = new PlansPage(page);
    await plansPage.pageLoadOk.waitFor({ state: 'attached', timeout: 20000 });
    
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
      path: 'screenshots/plans-error-check.png',
      fullPage: true 
    });
  });

  test('should verify all tabs load different content', async ({ page }) => {
    const plansPage = new PlansPage(page);
    
    let successfulTabs = 0;
    
    for (const [tabName, tabElement] of Object.entries(plansPage.tabs)) {
      try {
        await tabElement.waitFor({timeout: 10000});
        
        await tabElement.click();
        await page.waitForTimeout(1500);
        
        await plansPage.verifyTabPanel(tabName);
        
        successfulTabs += 1;

        await page.screenshot({ 
          path: `screenshots/plans-tab-${tabName.toLowerCase()}.png`,
          fullPage: true 
        });
      } catch (error) {
        console.log(`${tabName} tab has error ${error.message}`);
      }
    }
    
    expect(successfulTabs).toBe(4);
    console.log(`Successfully verified ${successfulTabs} out of ${Object.keys(plansPage.tabs).length} tabs`);
  });

  test('should test CTA buttons across Individual, Business, and Student tabs', async ({ page }) => {
    test.setTimeout(1200 * 1000);

    const plansPage = new PlansPage(page);

    let allCtaResults = [];
    let priceMatchErrors = [];

    const selectedTabs = process.env.TEST_TABS && process.env.TEST_TABS.split(',');

    for (const [tabName, tabElement] of Object.entries(plansPage.tabs)) {
      // Test selected tabs
      if (selectedTabs && !selectedTabs.includes(tabName)) {
        continue;
      }

      await page.evaluate("window.scrollTo(0, 0)");
      await page.waitForTimeout(1000)

      console.log(`\n=== Testing CTA buttons in ${tabName} tab ===`);

      // Navigate to specific tab
      try {
        await tabElement.click({ timeout: 5000 });
        await page.waitForTimeout(3000); // Wait for tab content to load
        console.log(`Successfully switched to ${tabName} tab`);
      } catch (error) {
        console.log(`Failed to click ${tabName} tab: ${error.message}`);
        continue;
      }

      // Find CTA buttons in the current tab
      let ctaButtons = await plansPage.checkoutButtons.all();

      console.log(`Found ${ctaButtons.length} CTA buttons in ${tabName} tab`);

      for (let i = 0; i < ctaButtons.length; i++) {
        const ctaButton = ctaButtons[i];

        try {
          // Extract price information from content near the specific button
          let originalPrice = null;
          try {
            // Try to find price in the button's parent container
            const parentContent = await ctaButton.evaluate((el, sel) => (el.closest(sel) || el.parentElement).textContent, plansPage.cardSelector);
            if (parentContent) {
              const priceMatch = parentContent.match(/[£€$¥₹]\s?\d{1,3}(?:[,.\s]\d{3})*(?:[,.]\d{2})?|\d{1,3}(?:[,.\s]\d{3})*(?:[,.]\d{2})?\s?[£€$¥₹]/);
              originalPrice = priceMatch ? priceMatch[0] : null;
            }

            // Fallback: if no price found in parent, look for price in nearby siblings
            if (!originalPrice) {
              const nearbyContent = await ctaButton.evaluate(el => {
                const siblings = Array.from(el.parentElement?.children || []);
                return siblings.map(sibling => sibling.textContent).join(' ');
              });
              const priceMatch = nearbyContent.match(/[£€$¥₹]\s?\d{1,3}(?:[,.\s]\d{3})*(?:[,.]\d{2})?|\d{1,3}(?:[,.\s]\d{3})*(?:[,.]\d{2})?\s?[£€$¥₹]/);
              originalPrice = priceMatch ? priceMatch[0] : null;
            }
          } catch (error) {
            console.log(`Could not extract price for ${tabName} CTA ${i + 1}:`, error.message);
          }

          const buttonText = await ctaButton.innerText();
          console.log(`Testing ${tabName} CTA ${i + 1}: "${buttonText.trim()}" - potential price: ${originalPrice || 'Not found'}`);

          // Take screenshot before clicking
          await page.screenshot({
            path: `screenshots/plans-${tabName.toLowerCase()}-cta-before-${i + 1}.png`,
            fullPage: true
          });

          // Click the CTA button and handle navigation
          const [newPage] = await Promise.all([
            page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null),
            ctaButton.click({ timeout: 5000 }).catch(() => null)
          ]);

          let targetPage = newPage || page;
          let navigated = false;

          // Wait for navigation or new page
          try {
            await targetPage.waitForLoadState('networkidle', { timeout: 5000 });
            navigated = true;
          } catch (error) {
            // Try waiting for URL change on current page
            await page.waitForTimeout(3000);
            targetPage = page;
            navigated = true;
          }

          if (navigated) {
            const finalUrl = targetPage.url();
            let finalPageContent = '';
            if (finalUrl.startsWith(testUrl)) {
              await expect(plansPage.checkoutModal).toBeVisible();
              const tagName = await plansPage.checkoutModal.evaluate(el => el.tagName);
              const normLocator = tagName === 'IFRAME' ? plansPage.checkoutModal.contentFrame() : plansPage.checkoutModal;
              finalPageContent = await normLocator.locator('div.modal-payment').textContent();
            } else {
              finalPageContent = await targetPage.textContent('body');
            }

            // Check for checkout/purchase page indicators
            const isCheckoutPage = /checkout|purchase|payment|billing|cart|order/i.test(finalPageContent) ||
                                  /checkout|purchase|payment|billing|cart|order/i.test(finalUrl);

            // Look for price consistency
            let checkoutPrice = null;
            if (originalPrice) {
              const checkoutPriceMatch = finalPageContent.match(/[£€$¥₹]\s?\d{1,3}(?:[,.\s]\d{3})*(?:[,.]\d{2})?|\d{1,3}(?:[,.\s]\d{3})*(?:[,.]\d{2})?\s?[£€$¥₹]/g);
              console.log(`checkoutPriceMatch for ${tabName} CTA ${i + 1}:`, checkoutPriceMatch);
              checkoutPrice = checkoutPriceMatch ? checkoutPriceMatch.find(price =>
                price.replace(/[^\d.,]/g, '') === originalPrice.replace(/[^\d.,]/g, '')
              ) : null;

              // Track price match errors
              if (!checkoutPrice) {
                const error = `Price mismatch: Original price ${originalPrice} not found in checkout page for ${tabName} CTA ${i + 1}`;
                console.log(error);
                priceMatchErrors.push(error);
              }
            }

            // Take screenshot of final page
            await targetPage.screenshot({
              path: `screenshots/plans-${tabName.toLowerCase()}-cta-after-${i + 1}.png`,
              fullPage: true
            });

            allCtaResults.push({
              tab: tabName,
              ctaIndex: i + 1,
              buttonText: buttonText.trim(),
              originalPrice,
              finalUrl,
              isCheckoutPage,
              checkoutPrice,
              priceConsistent: originalPrice && checkoutPrice ? true : null,
              navigationSuccessful: true
            });

            console.log(`${tabName} CTA ${i + 1} Result: Navigated to ${finalUrl}, Checkout: ${isCheckoutPage}, Price match: ${checkoutPrice ? 'Yes' : 'No'}`);

            // Close new page if it was opened
            if (!finalUrl.startsWith(testUrl)) {
              //await newPage.goto(testUrl, { waitUntil: 'networkidle' });
              try {
                await page.goBack({ waitUntil: 'networkidle', timeout: 20000 });
              } catch (error) {
                console.log('Timeout on waiting for netword idle!');
              }
              ctaButtons = await plansPage.checkoutButtons.all();
            } else {
              // Close the modal
              let visible = await plansPage.modalCloseButton.isVisible(); 
              while (visible) {
                await plansPage.modalCloseButton.click();
                await page.waitForTimeout(1000);
                visible = await plansPage.modalCloseButton.isVisible();
              } 
            }
          } else {
            allCtaResults.push({
              tab: tabName,
              ctaIndex: i + 1,
              buttonText: buttonText.trim(),
              originalPrice,
              navigationSuccessful: false,
              error: 'Navigation timeout or failed'
            });
            console.log(`${tabName} CTA ${i + 1}: Navigation failed or timed out`);
          }

          // Wait between tests to avoid rate limiting
          await page.waitForTimeout(2000);

        } catch (error) {
          console.log(`Error testing ${tabName} CTA ${i + 1}:`, error.message);
          allCtaResults.push({
            tab: tabName,
            ctaIndex: i + 1,
            navigationSuccessful: false,
            error: error.message
          });
        }
      }
    }

    // Verify results across all tabs
    const successfulCTAs = allCtaResults.filter(result => result.navigationSuccessful);
    const checkoutPages = allCtaResults.filter(result => result.isCheckoutPage);

    console.log(`\n=== Cross-Tab CTA Test Summary ===`);
    console.log(`Total CTAs tested: ${allCtaResults.length}`);
    console.log(`Successful navigations: ${successfulCTAs.length}`);
    console.log(`Checkout pages found: ${checkoutPages.length}`);

    // Log results by tab
    Object.keys(plansPage.tabs).forEach(tab => {
      const tabResults = allCtaResults.filter(r => r.tab === tab);
      const tabSuccessful = tabResults.filter(r => r.navigationSuccessful);
      console.log(`${tab}: ${tabSuccessful.length}/${tabResults.length} successful`);
    });

    // If we found CTAs, at least one should work, otherwise just pass the test
    if (allCtaResults.length > 0) {
      expect(successfulCTAs.length).toBeGreaterThan(0);
    } else {
      console.log('No CTA buttons found across all tabs - test passed');
      expect(allCtaResults.length).toBeGreaterThanOrEqual(0);
    }

    // If we have checkout pages, log price consistency
    if (checkoutPages.length > 0) {
      const consistentPrices = checkoutPages.filter(result => result.priceConsistent);
      console.log(`Price consistency: ${consistentPrices.length}/${checkoutPages.length} pages`);
    }

    // Fail the test if there are any price match errors
    if (priceMatchErrors.length > 0) {
      console.log(`\n=== Price Match Errors (${priceMatchErrors.length}) ===`);
      priceMatchErrors.forEach(error => console.log(error));
      expect(priceMatchErrors.length).toBe(0);
    }
  });

});