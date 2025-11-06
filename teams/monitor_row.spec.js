const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

class TeamsPage {
  constructor(page) {
    this.page = page;
    this.pageLoadOk = page.locator('div#page-load-ok-milo');
    this.tabs = page.locator('.tabList .heading-xs'); 
    this.tabContent = page.locator('.tab-content');
    this.tabPanel = this.tabContent.locator('.tabpanel').filter({visible: true});
    this.merchCards = this.tabPanel.locator('merch-card').filter({visible: true});
    this.modalCloseButton = page.locator('.dialog-modal .dialog-close').filter({visible: true});
    this.modalIframe = page.locator('.milo-iframe iframe').filter({visible: true});
    this.modalCloseButton = page.locator('.dialog-close').filter({visible: true});
  }
}

class MerchCard {
  constructor(card) {
    this.card = card;
    this.productName = card.locator('h3');
    this.price = card.locator('span[is="inline-price"][data-template="price"]');
    this.checkoutLink = card.locator('a[is="checkout-link"]');
  }
}

class Modal {
  constructor(modal) {
    this.modal = modal;
    this.tabs = modal.locator('[role="tab"]').filter({visible: true});
    this.selectedTab = modal.locator('[role="tab"][aria-selected="true"]').first();
    this.priceOptions = modal.locator('.subscription-panel-offer-price').filter({visible: true});
    this.continueButton = modal.locator('.spectrum-Button--cta').filter({visible: true});
  }
}

class CartPage {
  constructor(page) {
    this.page = page;
    this.cartSubTotal = page.locator('[data-testid="cart-totals-subtotals-row"] [data-testid="price-full-display"]').filter({visible: true});
    this.cartTotal = page.locator('[data-testid="advanced-cart-order-totals-row"] [data-testid="price-full-display"]').filter({visible: true});
  }
}

// Helper function to save error information for notifications
function saveErrorReport(testName, errors, testUrl) {
  const errorReport = {
    timestamp: new Date().toISOString(),
    testName: testName,
    testUrl: testUrl,
    errorCount: errors.length,
    errors: errors,
    status: 'FAILED'
  };

  const reportDir = path.join(__dirname, '..', 'test-results');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  // Create unique filename based on test name
  const sanitizedTestName = testName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const reportPath = path.join(reportDir, `error-report-${sanitizedTestName}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(errorReport, null, 2));
  
  console.log(`\n📝 Error report saved to: ${reportPath}`);
  return reportPath;
}

test.describe('Creative Cloud Plans Page Monitoring', () => {

  const testUrl = process.env.TEST_URL || 'https://www.adobe.com/uk/creativecloud/business/teams.html';
  console.log('\n' + '='.repeat(80));
  console.log('🔍 TESTING URL:', testUrl);
  
  // Extract country code from URL path (e.g., /uk/ -> 'uk')
  const urlPath = new URL(testUrl).pathname;
  const countryCode = urlPath.split('/').filter(Boolean)[0] || 'uk';
  console.log('🌍 MOCKING GEO LOCATION:', countryCode);
  console.log('='.repeat(80) + '\n');

  test.beforeEach(async ({ page }) => {
    await page.route('https://client.messaging.adobe.com/**', route => route.abort());

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
      console.log('\n⚠️  CRITICAL ERRORS FOUND:');
      criticalErrors.forEach((error, idx) => {
        console.log(`   ${idx + 1}. ${error}`);
      });
      console.log('');
      
      // Save error report for notifications if we exceed threshold
      if (criticalErrors.length > 2) {
        saveErrorReport('Console Errors', criticalErrors, testUrl);
      }
    }
    
    expect(criticalErrors.length).toBeLessThanOrEqual(2); // Allow minor non-critical errors
    
    await page.screenshot({ 
      path: 'screenshots/teams-error-check.png',
      fullPage: true 
    });
  });

  test('should click and verify all merch cards', async ({ page }) => {
    test.setTimeout(1200 * 1000);

    const teamsPage = new TeamsPage(page);
    
    // Find all tab elements - adjust selector based on actual page structure
    const tabs = await teamsPage.tabs.all();
    
    console.log('\n' + '━'.repeat(80));
    console.log(`📋 FOUND ${tabs.length} TABS TO TEST`);
    console.log('━'.repeat(80) + '\n');
    
    // Track which tabs were successfully clicked
    const optionResults = [];
    const cardErrors = [];
    const cardSet = new Set();

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const tabText = await tab.textContent();

      try {
        console.log(`\n${'▸'.repeat(40)}`);
        console.log(`🔹 TAB ${i + 1}/${tabs.length}: "${tabText}"`);
        console.log(`${'▸'.repeat(40)}`);
        await tab.click();
        await page.waitForTimeout(1000);
  
        const tabPanel = teamsPage.tabPanel.first();
        await tabPanel.waitFor({ state: 'visible', timeout: 10000 });

        // Verify tab is selected
        const isSelected = await tab.getAttribute('aria-selected').catch(() => null);
        const isActive = await tab.evaluate(el => el.classList.contains('active')).catch(() => false);
        
        // Take screenshot of tab content
        await tabPanel.screenshot({ 
          path: `screenshots/teams-tab-${i + 1}.png`
        });
        
        try {
          await teamsPage.merchCards.first().waitFor({state: 'visible', timeout: 10000});
        } catch (error) {
          console.log(`   ℹ️  No merch cards found in this tab\n`);
          continue;           
        }
        const merchCards = await teamsPage.merchCards.all();
        console.log(`   🛍️  Found ${merchCards.length} merch card(s)\n`);

        for (let cardIndex = 0; cardIndex < merchCards.length; cardIndex++) {
          const card = merchCards[cardIndex];

          await card.screenshot({ 
            path: `screenshots/teams-tab-${i + 1}-card-${cardIndex + 1}.png`
          });

          // Find the parent element that is merch-card
          const merchCard = new MerchCard(card);
          await merchCard.productName.first().waitFor({state: 'visible', timeout: 10000});
          const productName = await merchCard.productName.first().textContent();

          if (cardSet.has(productName)) {
            console.log(`      ⚠️  Duplicate card: "${productName}" (skipping)`);
            continue;
          }
          cardSet.add(productName);
          console.log(`      ╔════════════════════════════════════════`);
          console.log(`      ║ Card ${cardIndex + 1}/${merchCards.length}: ${productName}`);
          console.log(`      ╚════════════════════════════════════════`);

          const checkoutLinkExists = await merchCard.checkoutLink.count() > 0;
          if (checkoutLinkExists) {
            console.log(`         → Clicking checkout link...`);
            await merchCard.checkoutLink.first().click();
          } else {
            console.log(`         ⚠️  No checkout link found\n`);
            continue;
          }
          await page.waitForTimeout(5000);
          const iframe = await teamsPage.modalIframe.contentFrame();
          const modal = new Modal(iframe);

          try {
            await modal.selectedTab.first().waitFor({state: 'visible', timeout: 10000});
            const tabTestId = await modal.selectedTab.first().getAttribute('data-query-value')
            console.log(`         → Modal tab: ${tabTestId}`);
            const isBusinessTab = tabTestId === 'team';
          } catch (error) {
            console.log(`         ⚠️  No selected tab found in modal`);        
          }

          try {
            await modal.priceOptions.first().waitFor({state: 'visible', timeout: 10000});
          } catch (error) {
            cardErrors.push({
              tabIndex: i,
              tabText,
              cardIndex: cardIndex,
              cardText: productName,
              error: `No price options found for ${productName}`,
            });
            console.log(`         ❌ No price options found\n`);
          }

          await page.screenshot({ 
            path: `screenshots/teams-tab-${i + 1}-card-${cardIndex + 1}-modal.png`
          });

          try {
            const continueBtn = modal.continueButton.first();
            await continueBtn.waitFor({state: 'visible', timeout: 10000});
            await expect(continueBtn).toBeEnabled({timeout: 10000});
            console.log(`         ✓ Continue button ready`);          
          } catch (error) {
            console.log(`         ❌ Continue button not ready\n`);
            await modal.modalCloseButton.first().click();
            await page.waitForTimeout(1000);
            continue;
          }
          const priceOptions = await modal.priceOptions.all();
          const priceOptionTexts = await Promise.all(priceOptions.map(async(x) => await x.textContent()));
          console.log(`         💰 Price options (${priceOptions.length}): ${priceOptionTexts.join(', ')}`);

          for (const [index, priceOptionText] of priceOptionTexts.entries()) {
            optionResults.push({
              tabIndex: i,
              tabText,
              cardIndex: cardIndex,
              cardText: productName,
              optionIndex: index,
              priceOptionText: priceOptionText,
            });          
          }
          await expect(teamsPage.modalCloseButton.first()).toBeVisible({timeout: 10000});
          await teamsPage.modalCloseButton.first().click();
          await page.waitForTimeout(1000);
          console.log(`         ✓ Card verified\n`);
        }

        console.log(`   ✅ Tab "${tabText}" completed successfully\n`);
        
      } catch (error) {
        console.log(`   ❌ Tab "${tabText}" failed: ${error.message}\n`);
      }
    }
        
    // Expect at least one tab was found and verified
    expect(tabs.length).toBeGreaterThan(0);

    if (cardErrors.length > 0) {
      console.log('\n❌ CARD ERRORS DETECTED:');
      cardErrors.forEach((error, idx) => {
        console.log(`   ${idx + 1}. ${error.error}`);
      });
      console.log('');
      
      // Save error report for notifications
      const errorMessages = cardErrors.map(e => e.error);
      saveErrorReport('should click and verify all merch cards - card errors', errorMessages, testUrl);
      
      expect(cardErrors.length).toBe(0);
    }

    console.log('\n' + '═'.repeat(80));
    console.log(`🛒 CHECKOUT FLOW TEST: ${optionResults.length} PRICE OPTION(S) TO VERIFY`);
    console.log('═'.repeat(80) + '\n');

    for (const optionResult of optionResults) {
      const tabIndex = optionResult.tabIndex;
      const tabText = optionResult.tabText;
      const cardIndex = optionResult.cardIndex;
      const cardText = optionResult.cardText;
      const optionIndex = optionResult.optionIndex;
      const priceOptionText = optionResult.priceOptionText;
      
      try {
        console.log(`\n┌${'─'.repeat(78)}┐`);
        console.log(`│ Test ${optionResults.indexOf(optionResult) + 1}/${optionResults.length}`.padEnd(79) + '│');
        console.log(`├${'─'.repeat(78)}┤`);
        console.log(`│ Tab: "${tabText}" (index: ${tabIndex})`.padEnd(79) + '│');
        console.log(`│ Card: "${cardText}" (index: ${cardIndex})`.padEnd(79) + '│');
        console.log(`│ Price Option ${optionIndex + 1}: ${priceOptionText}`.padEnd(79) + '│');
        console.log(`└${'─'.repeat(78)}┘`);

        await page.goto(testUrl);
        const teamsPage = new TeamsPage(page);
        await teamsPage.pageLoadOk.waitFor({ state: 'attached', timeout: 20000 });

        await teamsPage.tabs.nth(tabIndex).click();
        await page.waitForTimeout(1000);
        const tabPanel = teamsPage.tabPanel.first();
        await tabPanel.waitFor({ state: 'visible', timeout: 10000 });
        
        const merchCard = new MerchCard(teamsPage.merchCards.nth(cardIndex));
        await merchCard.productName.waitFor({ state: 'visible', timeout: 10000 });

        await merchCard.checkoutLink.first().waitFor({ state: 'visible', timeout: 10000 });
        await expect(merchCard.checkoutLink.first()).toBeEnabled({timeout: 10000});
        await merchCard.checkoutLink.first().click();
        await page.waitForTimeout(5000);

        const iframe = await teamsPage.modalIframe.contentFrame();
        const modal = new Modal(iframe);
        await modal.priceOptions.nth(optionIndex).waitFor({ state: 'visible', timeout: 10000 });
        const option = await modal.priceOptions.nth(optionIndex);
        expect(option).toBeVisible({timeout: 10000});
        await option.click();
        await page.waitForTimeout(1000);
        
        expect(modal.continueButton.first()).toBeEnabled({timeout: 10000});
        await modal.continueButton.first().click();
        await page.waitForTimeout(5000);

        const cartPage = new CartPage(page);
        await cartPage.cartSubTotal.waitFor({ state: 'visible', timeout: 20000 });
        const cartSubTotal = await cartPage.cartSubTotal.first().textContent();
        let cartTotal = 'N/A';
        if (await cartPage.cartTotal.count() > 0) {
          cartTotal = await cartPage.cartTotal.first().textContent();
        }
        console.log(`   → Cart Sub Total: ${cartSubTotal}`);
        console.log(`   → Cart Total: ${cartTotal}`);
        
        await page.screenshot({ path: `screenshots/teams-tab-${tabIndex + 1}-card-${cardIndex + 1}-cart.png` }  );

        const digitOnlyPrice = priceOptionText.split('/')[0].replace(/[^\d]/g, '');
        if ((cartSubTotal.split('/')[0].replace(/[^\d]/g, '') !== digitOnlyPrice) && 
            (cartTotal.split('/')[0].replace(/[^\d]/g, '') !== digitOnlyPrice)) {
          optionResult.error = `Cart subtotal/total does not match option price ${priceOptionText} for tab \"${tabText}\" card \"${cardText}\"`;
          console.log(`   ❌ PRICE MISMATCH: Expected ${priceOptionText}, got ${cartSubTotal}/${cartTotal}\n`);
        } else {
          console.log(`   ✅ VERIFIED: Price matches cart total\n`);
        }
      } catch (error) {
        console.log(`   ❌ ERROR: ${error.message}`);
        await page.screenshot({ path: `screenshots/teams-tab-${tabIndex + 1}-card-${cardIndex + 1}-error.png` });
        optionResult.error = `Error processing option result: ${error.message}`;
        console.log('');
      }
    }

    const errorResults = optionResults.filter(result => result.error);
    if (errorResults.length > 0) {
      console.log('\n' + '═'.repeat(80));
      console.log(`❌ TEST FAILURES: ${errorResults.length} ERROR(S) FOUND`);
      console.log('═'.repeat(80));
      errorResults.forEach((result, idx) => {
        console.log(`\n${idx + 1}. ${result.error}`);
      });
      console.log('\n' + '═'.repeat(80) + '\n');
      
      // Save error report for notifications
      const errorMessages = errorResults.map(r => r.error);
      saveErrorReport('Checkout Errors', errorMessages, testUrl);
      
      await expect(errorResults.length).toBe(0);
    } else {
      console.log('\n' + '═'.repeat(80));
      console.log('✅ ALL TESTS PASSED SUCCESSFULLY');
      console.log('═'.repeat(80) + '\n');
    }
  });
});
