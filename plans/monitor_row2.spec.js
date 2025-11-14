const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// State management for tracking passed cards across retries
class TestStateManager {
  constructor(testName) {
    this.stateDir = path.join(__dirname, '..', 'test-results', '.test-state');
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
    
    // Create unique state file per test URL
    const sanitizedName = testName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    this.stateFile = path.join(this.stateDir, `state-${sanitizedName}.json`);
    
    // Load existing state or create new
    this.state = this.loadState();
  }
  
  loadState() {
    if (fs.existsSync(this.stateFile)) {
      try {
        const content = fs.readFileSync(this.stateFile, 'utf-8');
        return JSON.parse(content);
      } catch (err) {
        console.log(`⚠️  Could not load state file: ${err.message}`);
      }
    }
    return { passedCards: [], timestamp: new Date().toISOString() };
  }
  
  saveState() {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
    } catch (err) {
      console.log(`⚠️  Could not save state file: ${err.message}`);
    }
  }
  
  hasCardPassed(tabIndex, cardIndex) {
    const cardKey = `tab${tabIndex}-card${cardIndex}`;
    return this.state.passedCards.includes(cardKey);
  }
  
  markCardPassed(tabIndex, cardIndex) {
    const cardKey = `tab${tabIndex}-card${cardIndex}`;
    if (!this.state.passedCards.includes(cardKey)) {
      this.state.passedCards.push(cardKey);
      this.saveState();
      console.log(`   ✅ Card marked as passed: ${cardKey}`);
    }
  }
  
  clear() {
    if (fs.existsSync(this.stateFile)) {
      fs.unlinkSync(this.stateFile);
    }
  }
  
  getStats() {
    return {
      totalPassed: this.state.passedCards.length,
      timestamp: this.state.timestamp
    };
  }
}

class PlansPage {
  constructor(page) {
    this.page = page;
    this.pageLoadOk = page.locator('div.evidon-notice-link');
    this.tabs = page.locator('[data-name="segments"] [role="tab"]').filter({visible: true}); 
    this.tabContent = page.locator('.tab-content');
    this.tabPanel = this.tabContent.locator('.tabpanel').filter({visible: true});
    this.modalCloseButton = page.locator('svg.close-button-modal, .dexter-CloseButton').filter({visible: true});
    this.modalIframe = page.locator('div.iframe iframe').filter({visible: true});
    this.checkoutModal = page.locator(':is(div.ReactModalPortal .commerce-context-container, div.iframe iframe)').filter({visible: true});
  }

  async getTabPanel(tab) {
    return await this.page.locator(`.is-Selected[role="tabpanel"]`).filter({visible: true}).first();
  }

  async getMerchCards(tabPanel) {
    return await tabPanel.locator(':is(plans-card, .plans-card)').filter({visible: true}).all();
  }
}

class MerchCard {
  constructor(card) {
    this.card = card;
    this.productName = card.locator('h3').filter({visible: true}); // JP price is H3
    this.price = card.locator(':not([class*="strikethrough"])>span[data-wcs-type="price"]').filter({visible: true});
    this.checkoutLink = card.locator('.dexter-Cta .spectrum-Button--cta').filter({visible: true});
  }
}

class Modal {
  constructor(modal) {
    this.modal = modal;
    this.tabs = modal.locator('[role="tab"]').filter({visible: true});
    this.selectedTab = modal.locator('[role="tab"][aria-selected="true"]').first();
    this.priceOptions = modal.locator('.subscription-panel-offer [data-wcs-type="price"]:not(i *, [class*="strikethrough"] *)').filter({visible: true});
    this.selectedPriceOption = modal.locator('input[checked]+label [data-wcs-type="price"]:not(i *, [class*="strikethrough"] *)').filter({visible: true});
    this.continueButton = modal.locator('.spectrum-Button--cta').filter({visible: true});
  }
}

class CartPage {
  constructor(page) {
    this.page = page;
    this.cartSubTotal = page.locator('[data-testid="cart-totals-subtotals-row"] [data-testid="price-full-display"]').filter({visible: true});
    this.cartTotal = page.locator('[class*="CartTotals__cart-totals-total-price"] [data-testid="price-full-display"]').filter({visible: true});
    this.cartTotalNext = page.locator('[data-testid="cart-totals-upcoming-dueNext-total"] [data-testid="price-full-display"]').filter({visible: true});
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
  // Enable retries - only failed cards will be retested
  test.describe.configure({ retries: 2 });

  const testUrl = process.env.TEST_URL || 'https://www.adobe.com/uk/creativecloud/plans.html';
  console.log(`Testing URL: ${testUrl}`);

  // Extract country code from URL path (e.g., /uk/ -> 'uk')
  const urlPath = new URL(testUrl).pathname;
  const countryCode = urlPath.split('/').filter(Boolean)[0] || 'uk';
  console.log(`Mocking geo location with country: ${countryCode}`);
  
  test.beforeEach(async ({ page }) => {
    // Block Adobe messaging endpoint to disable Jarvis
    await page.route('https://client.messaging.adobe.com/**', route => route.abort());

    // Mock geo location response
    await page.route('https://geo2.adobe.com/json/', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ country: countryCode })
      })
    );

    try {
      await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 20000 });
    } catch (err) {
      console.log('Timeout on Waiting for network idle!');
    }
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
      !error.toLowerCase().includes('third-party') &&
      !error.includes('reading \'setAttribute\'') && // Cannot read properties of null (reading 'setAttribute')
      !error.includes('reading \'style\'') // Cannot read properties of null (reading 'style')
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
      path: 'screenshots/plans-error-check.png',
      fullPage: true 
    });
  });

  test('should check all price options are consistent', async ({ page }) => {
    test.setTimeout(1800 * 1000);

    const plansPage = new PlansPage(page);
    
    // Initialize state manager for tracking passed cards
    const stateManager = new TestStateManager(testUrl);
    const stats = stateManager.getStats();
    
    if (stats.totalPassed > 0) {
      console.log(`\n🔄 RETRY DETECTED - Skipping ${stats.totalPassed} already passed card(s)`);
      console.log(`   Previous run timestamp: ${stats.timestamp}\n`);
    }

    const tabResults = [];
    const cardResults = [];
    const optionResults = [];

    const tabs = await plansPage.tabs.all();

    console.log(`Found ${tabs.length} tabs to test`);

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const tabTitle = await tab.textContent();

      console.log(`\n${'='.repeat(80)}`);
      console.log(`🔍 Testing Tab ${i + 1}/${tabs.length}: "${tabTitle}"`);
      console.log(`${'='.repeat(80)}`);

      const tabResult = {
        tabIndex: i,
        tabTitle: tabTitle,
        cardCount: 0,
      };

      await tab.click();
      await page.waitForTimeout(2000);
      const tabPanel = await plansPage.getTabPanel(tab);
      const merchCards = await plansPage.getMerchCards(tabPanel);
      console.log(`📋 Found ${merchCards.length} merch card${merchCards.length !== 1 ? 's' : ''} in this tab`);  

      tabResult.cardCount = merchCards.length;

      await page.screenshot({ path: `screenshots/plans-tab-${i + 1}.png`});

      expect(merchCards.length, `Tab "${tabTitle}" should have at least 1 card`).toBeGreaterThanOrEqual(1);

      for (let j = 0; j < merchCards.length; j++) {
        // Check if this card already passed in a previous run
        if (stateManager.hasCardPassed(i, j)) {
          console.log(`\n⏭️  Skipping already passed card: Tab ${i + 1}, Card ${j + 1}`);
          continue;
        }
        
        let cardResult = {
          tabIndex: i,
          tabTitle: tabTitle,
          cardIndex: j,
        };
        
        // Track if any option has errors for this card (for pass/fail determination)
        let cardHasOptionErrors = false;
        
        try {
          const merchCard = new MerchCard(merchCards[j]);
          await merchCard.productName.first().waitFor({ state: 'visible', timeout: 10000 });
          const productName = await merchCard.productName.first().textContent();
          console.log(`\n${'='.repeat(60)}`);
          console.log(`📦 Product: ${productName}`);
          let cardPrice = 'N/A';

          await merchCard.price.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
          if (await merchCard.price.count() > 0) {
            await expect(merchCard.price.first()).not.toBeEmpty({ timeout: 5000 });
            cardPrice = await merchCard.price.first().textContent();
          }
          console.log(`   Card Price: ${cardPrice}`);

          cardResult.cardTitle = productName;
          cardResult.cardPrice = cardPrice;

          await merchCard.card.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}.png`});

          if (await merchCard.checkoutLink.count() === 0) {
            console.log(`No checkout link found for ${productName}`);
            cardResults.push(cardResult);
            continue;
          }

          cardResult.ctaText = await merchCard.checkoutLink.first().textContent();

          // checkout link could open a new page or a model. need to handle both cases.
          const [newPage] = await Promise.all([
            page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null),
            merchCard.checkoutLink.first().click()
          ]);

          const newUrl = await page.url();
          
          if (newPage) {
            console.log(`New page opened for ${productName}`);
            const newPageUrl = newPage.url();
            console.log(`New page URL: ${newPageUrl}`);
            await newPage.waitForTimeout(5000);
            await newPage.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-new-page.png`});
            await newPage.close();
          } else if (newUrl.startsWith(testUrl)) {       
            await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-modal.png`});

            await expect(plansPage.checkoutModal).toBeVisible({timeout: 10000});
            const tagName = await plansPage.checkoutModal.evaluate(el => el.tagName);
            let modal = null;
            if (tagName === 'IFRAME') {
              const modalIframeSrc = await plansPage.checkoutModal.getAttribute('src');
              if (!modalIframeSrc.startsWith('https://commerce.adobe.com/store/segmentation')) {
                //cardResult.error = `Iframe src ${modalIframeSrc} is not valid`;
                //console.log(`✗ ${cardResult.error}`);
              }            
              modal = new Modal(await plansPage.checkoutModal.contentFrame());
            } else {
              modal = new Modal(plansPage.checkoutModal);
            }

            await modal.priceOptions.first().waitFor({ state: 'visible', timeout: 10000 });
            await modal.continueButton.first().waitFor({ state: 'visible', timeout: 10000 });

            await modal.selectedPriceOption.first().waitFor({ state: 'visible', timeout: 10000 });
            if (await modal.selectedPriceOption.count() > 1) {
              const selectedPriceOptions = await modal.selectedPriceOption.all();
              const prices = await Promise.all(selectedPriceOptions.map(async(x) => await x.textContent()));
              cardResult.error = `Two or more prices ${prices.join(', ')} in an option found for tab \"${tabTitle}\" card \"${productName}\"`;
              console.log(`\n   ✗ ERROR: ${cardResult.error}`);
            }
            const selectedPriceOption = await modal.selectedPriceOption.first().textContent();
            console.log(`   Selected Option: ${selectedPriceOption}`);
            if (selectedPriceOption.split('/')[0].replace(/[^\d]/g, '') !== cardPrice.split('/')[0].replace(/[^\d]/g, '')) {
              cardResult.error = `Selected price option ${selectedPriceOption} does not match card price ${cardPrice} for tab \"${tabTitle}\" card \"${productName}\"`;
              console.log(`\n   ✗ ERROR: ${cardResult.error}`);
            }
            
            const priceOptions = await modal.priceOptions.all();
            const priceOptionTexts = await Promise.all(priceOptions.map(async(x) => await x.textContent()));
            console.log(`   Available Options: ${priceOptionTexts.join(' | ')}`);
            
            for (let k = 0; k < priceOptions.length; k++) {
              const priceOption = priceOptions[k];
              const priceOptionText = priceOptionTexts[k];

              const optionResult = {
                tabIndex: i,
                tabTitle: tabTitle,
                cardIndex: j,
                cardTitle: productName,
                optionIndex: k,
                optionTitle: priceOptionText,
              };
              
              await priceOption.click();
              await page.waitForTimeout(1000);
              await expect(modal.continueButton.first()).toBeEnabled({timeout: 10000});
              await modal.continueButton.first().click();
              await page.waitForTimeout(5000);

              await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-option-${k + 1}.png`});

              const cartPage = new CartPage(page);
              await cartPage.cartSubTotal.waitFor({ state: 'visible', timeout: 20000 });
              const cartSubTotal = await cartPage.cartSubTotal.first().textContent();
              let cartTotal = 'N/A';
              if (await cartPage.cartTotal.count() > 0) {
                cartTotal = await cartPage.cartTotal.first().textContent();
              }
              let cartTotalNext = 'N/A';
              if (await cartPage.cartTotalNext.count() > 0) {
                cartTotalNext = await cartPage.cartTotalNext.first().textContent();
              }
              console.log(`\n   🛒 Testing Option: ${priceOptionText}`);
              console.log(`      ├─ Cart Subtotal: ${cartSubTotal}`);
              console.log(`      ├─ Cart Total: ${cartTotal}`);
              console.log(`      └─ Next Billing: ${cartTotalNext}`);
              
              await page.screenshot({ path: `screenshots/teams-tab-${i + 1}-card-${j + 1}-option-${k + 1}-cart.png` }  );

              const digitOnlyPrice = priceOptionText.split('/')[0].replace(/[^\d]/g, '');
              if ((cartSubTotal.split('/')[0].replace(/[^\d]/g, '') !== digitOnlyPrice) && 
                  (cartTotal.split('/')[0].replace(/[^\d]/g, '') !== digitOnlyPrice) &&
                  (cartTotalNext.split('/')[0].replace(/[^\d]/g, '') !== digitOnlyPrice)) {
                optionResult.error = `Cart subtotal/total does not match option price ${priceOptionText} for tab \"${tabTitle}\" card \"${productName}\"`;
                console.log(`\n      ✗ ERROR: ${optionResult.error}`);
                cardHasOptionErrors = true;
              } else {
                console.log(`      ✓ Price validation passed`);
              }

              optionResults.push(optionResult);

              await page.goBack();
              await page.waitForTimeout(1000);

              if (newUrl === testUrl) {
                await merchCard.checkoutLink.first().click();
                await page.waitForTimeout(5000);
                await modal.priceOptions.first().waitFor({ state: 'visible', timeout: 10000 });
                await modal.continueButton.first().waitFor({ state: 'visible', timeout: 10000 });
              }
            }
            
            await plansPage.modalCloseButton.first().click();
          } else {
            console.log(`Redirected to URL ${newUrl}`);
            await page.waitForTimeout(5000);
            await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-redirected.png`});

            if (cardPrice !== 'N/A') {
              const redirectedPageContent = await page.textContent('body');
              if (redirectedPageContent.includes(cardPrice.split('/')[0])) {
                console.log(`Card price found in redirected page content`);
              } else {
                cardResult.error = `Card price ${cardPrice} not found in redirected page content for tab \"${tabTitle}\" card \"${productName}\"`;
                console.log(`✗ ${cardResult.error}`);
              }
            }
            await page.goBack();
            await page.waitForTimeout(1000);
          }
          
          // Mark card as passed if no errors occurred (check both card errors and option errors)
          if (!cardResult.error && !cardHasOptionErrors) {
            stateManager.markCardPassed(i, j);
          }
          
        } catch (error) {
          // Catch any exception during card testing
          const errorMessage = `Exception during card test: ${error.message}`;
          console.log(`\n   ⚠️  EXCEPTION: ${errorMessage}`);
          console.log(`   Stack: ${error.stack}`);
          
          cardResult.error = errorMessage;
          cardResult.cardTitle = cardResult.cardTitle || `Card ${j + 1}`;
          
          // Take screenshot of current state for debugging
          try {
            await page.screenshot({ 
              path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-exception.png`,
              fullPage: true 
            });
          } catch (screenshotError) {
            console.log(`   Failed to capture exception screenshot: ${screenshotError.message}`);
          }
          
          // Card will NOT be marked as passed, so it will be retried
          console.log(`   🔄 Card will be retried on next run`);

          try {
            await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 20000 });
          } catch (err) {
            console.log('Timeout on Waiting for network idle!');
          }
          await tabs[i].click();
          await page.waitForTimeout(1000);
        }
        
        cardResults.push(cardResult);
      }
      
      console.log(`\n✅ Completed Tab ${i + 1}/${tabs.length}: "${tabTitle}" (${merchCards.length} cards tested)`);
      console.log(`${'='.repeat(80)}\n`);
      
      tabResults.push(tabResult);
    }

    // if cardResults or optionResults has any error, print the error and fail the test
    const errorResults = cardResults.concat(optionResults).filter(result => result.error);
    if (errorResults.length > 0) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`❌ TEST FAILED: ${errorResults.length} ERROR${errorResults.length > 1 ? 'S' : ''} FOUND`);
      console.log(`${'='.repeat(80)}\n`);
      errorResults.forEach((result, index) => {
        console.log(`${index + 1}. ${result.error}\n`);
      });
      console.log(`${'='.repeat(80)}`);
      console.log(`Total Errors: ${errorResults.length}`);
      console.log(`${'='.repeat(80)}\n`);
      
      // Save error report for notifications with detailed error information
      const errorMessages = errorResults.map(r => r.error);
      saveErrorReport('Price Errors', errorMessages, testUrl);
      
      expect(errorResults.length).toBe(0);
    } else {
      // Test passed completely - clear the state file for next run
      console.log(`\n✅ All cards passed! Clearing state file.`);
      stateManager.clear();
    }
  });
});  