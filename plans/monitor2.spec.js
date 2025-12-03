const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const TestStateManager = require('./TestStateManager');

class PlansPage {
  constructor(page) {
    this.page = page;
    this.pageLoadOk = page.locator('div#page-load-ok-milo');
    this.tabs = page.locator('#tabs-plan button[role="tab"]').filter({visible: true}); 
    this.tabContent = page.locator('.tab-content');
    this.tabPanel = this.tabContent.locator('.tabpanel').filter({visible: true});
    this.merchCards = this.tabPanel.locator('merch-card').filter({visible: true});
    this.modalCloseButton = page.locator('.dialog-modal .dialog-close').filter({visible: true});
    this.modalIframe = page.locator('.milo-iframe iframe').filter({visible: true});
  }

  async getTabPanel(tab) {
    const tabPanelId = await tab.getAttribute('aria-controls');
    return await this.page.locator(`#${tabPanelId}`).first();
  }

  async getMerchCards(tabPanel) {
    return await tabPanel.locator('merch-card').filter({visible: true}).all();
  }
}

class MerchCard {
  constructor(card) {
    this.card = card;
    this.productName = card.locator('h3');
    this.price = card.locator('span[is="inline-price"][data-template="price"] .price:not(.price-strikethrough)').filter({visible: true});
    this.checkoutLink = card.locator('a[is="checkout-link"]');
  }
}

class Modal {
  constructor(modal) {
    this.modal = modal;
    this.tabs = modal.locator('[role="tab"]').filter({visible: true});
    this.selectedTab = modal.locator('[role="tab"][aria-selected="true"]').first();
    this.priceOptions = modal.locator('div[data-testid="main-price"]').filter({visible: true});
    this.selectedPriceOption = modal.locator('[data-testid="is-selected"] div[data-testid="main-price"]').filter({visible: true});
    this.continueButton = modal.locator('button[data-testid="primary-cta-button"]').filter({visible: true});
    this.modalCloseButton = modal.locator('[data-testid="header-close"]').filter({visible: true});
  }
}

class CartPage {
  constructor(page) {
    this.page = page;
    this.cartTotal = page.locator('[class*="CartTotals__total-amount-plus-tax"] [data-testid="price-full-display"]').filter({visible: true});
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

  const testUrl = process.env.TEST_URL || 'https://www.adobe.com/creativecloud/plans.html';
  console.log('\n' + '='.repeat(80));
  console.log('🎯 TEST CONFIGURATION');
  console.log('='.repeat(80));
  console.log(`URL: ${testUrl}`);
  console.log('='.repeat(80) + '\n');

  test.beforeEach(async ({ page }) => {
    try {
      await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 20000 });
    } catch (err) {
      console.log('⚠️  Warning: Timeout while waiting for network idle');
    }
  });

  test('should check all price options are consistent', async ({ page }) => {
    test.setTimeout(1800 * 1000);

    const plansPage = new PlansPage(page);
    try {
      await plansPage.pageLoadOk.waitFor({ state: 'attached', timeout: 20000 });
    } catch (error) {
      console.log(`❌ Page Load OK verification failed: Page load indicator (div#page-load-ok-milo) did not appear within 20 seconds. The page may not have loaded correctly. Original error: ${error.message}`);
      throw new Error(`div#page-load-ok-milo not found`);
    }
    
    // Initialize state manager for tracking passed cards
    const stateManager = new TestStateManager(testUrl);
    const stats = stateManager.getStats();
    
    if (stats.totalPassed > 0) {
      console.log('\n' + '🔄'.repeat(40));
      console.log(`🔄 RETRY DETECTED - Skipping ${stats.totalPassed} already passed card(s)`);
      console.log(`   Previous run timestamp: ${stats.timestamp}`);
      console.log('🔄'.repeat(40) + '\n');
    }

    const tabResults = [];
    const cardResults = [];
    const optionResults = [];

    const tabs = await plansPage.tabs.all();

    console.log('\n' + '─'.repeat(80));
    console.log(`📑 TABS DISCOVERY: Found ${tabs.length} tabs to test`);
    console.log('─'.repeat(80));

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const tabTitle = await tab.textContent();

      const tabResult = {
        tabIndex: i,
        tabTitle: tabTitle,
        cardCount: 0,
      };

      console.log(`\n  ┌─ Tab ${i + 1}/${tabs.length}: "${tabTitle}"`);
      
      await tab.click();
      await page.waitForTimeout(1000);
      const tabPanel = await plansPage.getTabPanel(tab);
      const merchCards = await plansPage.getMerchCards(tabPanel);
      console.log(`  │  Found ${merchCards.length} merch card${merchCards.length !== 1 ? 's' : ''} to test`);  

      tabResult.cardCount = merchCards.length;

      await page.screenshot({ path: `screenshots/plans-tab-${i + 1}.png`});

      for (let j = 0; j < merchCards.length; j++) {
        // Check if this card already passed in a previous run
        if (stateManager.hasCardPassed(i, j)) {
          console.log(`  │  ⏭️  Skipping already passed card: Tab ${i + 1}, Card ${j + 1}`);
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
          try {
            await merchCard.productName.waitFor({ state: 'visible', timeout: 10000 });
          } catch (error) {
            console.log(`❌ Product name loading failed for Card ${j + 1} in Tab "${tabTitle}": Product name element (h3) did not become visible within 10 seconds. Original error: ${error.message}`);
            throw new Error(`Product name is not found for Card ${j + 1} in Tab "${tabTitle}"`);
          }
          const productName = await merchCard.productName.textContent();
          let cardPrice = 'N/A';
          if (await merchCard.price.count() > 0) {
            cardPrice = await merchCard.price.first().textContent();
          }
          console.log(`  │`);
          console.log(`  │  ├─ Card ${j + 1}/${merchCards.length}: "${productName}"`);
          console.log(`  │  │  Price: ${cardPrice}`);

          cardResult.cardTitle = productName;
          cardResult.cardPrice = cardPrice;

          await merchCard.card.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}.png`});

          if (await merchCard.checkoutLink.count() === 0) {
            console.log(`  │  │  ⚠️  No checkout link found`);
            cardResults.push(cardResult);
            continue;
          }

          cardResult.ctaText = await merchCard.checkoutLink.first().textContent();

          // checkout link could open a new page or a model. need to handle both cases.
          let newPage = null;
          let newUrl = null;
          
          try {
            [newPage] = await Promise.all([
              page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null),
              merchCard.checkoutLink.first().click({ timeout: 10000 })
            ]);
            newUrl = await page.url();
          } catch (clickError) {
            console.log(`  │  │  ⚠️  Click failed: ${clickError.message}`);
            console.log(`  │  │  Skipping this card and continuing to next...`);
            cardResult.error = `Checkout link click failed: ${clickError.message}`;
            cardResults.push(cardResult);
            
            // Navigate back to the plans page to continue with next cards
            try {
              await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 20000 });
            } catch (err) {
              console.log('  │  │  Timeout on waiting for network idle!');
            }
            await tabs[i].click();
            await page.waitForTimeout(1000);
            continue;
          }
          
          // If click succeeded, continue with the checkout flow
          if (newPage) {
            const newPageUrl = newPage.url();
            console.log(`  │  │  🔗 New page opened`);
            console.log(`  │  │     URL: ${newPageUrl}`);
            await newPage.waitForTimeout(5000);
            await newPage.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-new-page.png`});
            await newPage.close();
          } else if (newUrl.startsWith(testUrl)) {
            console.log(`  │  │  🎭 Modal opened`);
            await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-modal.png`});

            try {
              await plansPage.modalIframe.waitFor({ state: 'visible', timeout: 10000 });
            } catch (error) {
              console.log(`❌ Modal iframe not found for "${productName}" (Tab "${tabTitle}", Card ${j + 1}): Modal iframe (.milo-iframe iframe) did not become visible within 10 seconds. Original error: ${error.message}`);
              throw new Error(`Modal iframe not found for "${productName}"`);
            }
            const modalIframeSrc = await plansPage.modalIframe.getAttribute('src');
            console.log(`  │  │     Iframe: ${modalIframeSrc}`);
            if (!modalIframeSrc.startsWith('https://commerce.adobe.com/store/segmentation')) {
              cardResult.error = `Iframe src ${modalIframeSrc} is not valid`;
              console.log(`  │  │     ✗ ERROR: ${cardResult.error}`);
            }

            const modal = new Modal(await plansPage.modalIframe.contentFrame());
            try {
              await modal.priceOptions.first().waitFor({ state: 'visible', timeout: 10000 });
            } catch (error) {
              console.log(`❌ Modal price options not found for "${productName}" (Tab "${tabTitle}", Card ${j + 1}): Price options did not become visible within 10 seconds. Original error: ${error.message}`);
              throw new Error(`Modal price options not found for "${productName}"`);
            }
            try {
              await modal.continueButton.first().waitFor({ state: 'visible', timeout: 10000 });
            } catch (error) {
              console.log(`❌ Modal continue button not found for "${productName}" (Tab "${tabTitle}", Card ${j + 1}): Continue button did not become visible within 10 seconds. Original error: ${error.message}`);
              throw new Error(`Modal continue button not found for "${productName}"`);
            }

            try {
              await modal.selectedPriceOption.waitFor({ state: 'visible', timeout: 10000 });
            } catch (error) {
              console.log(`❌ Selected price option not found for "${productName}" (Tab "${tabTitle}", Card ${j + 1}): Selected price option did not become visible within 10 seconds. Original error: ${error.message}`);
              throw new Error(`Selected price option not found for "${productName}"`);
            }
            const selectedPriceOption = await modal.selectedPriceOption.first().textContent();
            console.log(`  │  │     Selected: ${selectedPriceOption}`);
            if (selectedPriceOption.replace(/[^\d.]/g, '') !== cardPrice.replace(/[^\d.]/g, '')) {
              cardResult.error = `Selected price option ${selectedPriceOption} does not match card price ${cardPrice} for tab \"${tabTitle}\" card \"${productName}\"`;
              console.log(`  │  │     ✗ ERROR: ${cardResult.error}`);
            } else {
              console.log(`  │  │     ✓ Price matches card price`);
            }
            
            const priceOptions = await modal.priceOptions.all();
            const priceOptionTexts = await Promise.all(priceOptions.map(async(x) => await x.textContent()));
            console.log(`  │  │     Testing ${priceOptions.length} price option${priceOptions.length !== 1 ? 's' : ''}: [${priceOptionTexts.join(', ')}]`);
            
            for (let k = 0; k < priceOptions.length; k++) {
              const optionResult = {
                tabIndex: i,
                tabTitle: tabTitle,
                cardIndex: j,
                cardTitle: productName,
                optionIndex: k,
                optionTitle: priceOptionTexts[k],
              };
              
              const priceOption = priceOptions[k];
              await priceOption.click();
              await page.waitForTimeout(1000);
              await expect(modal.continueButton.first()).toBeEnabled({timeout: 10000});
              await modal.continueButton.first().click();
              await page.waitForTimeout(5000);

              await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-option-${k + 1}.png`});

              const cartPage = new CartPage(page);
              try {
                await cartPage.cartTotal.waitFor({ state: 'visible', timeout: 10000 });
              } catch (error) {
                console.log(`❌ Cart page load failed for "${productName}" option "${priceOptionTexts[k]}" (Tab "${tabTitle}", Card ${j + 1}, Option ${k + 1}): Cart total did not become visible within 10 seconds. The checkout may have failed. Original error: ${error.message}`);
                throw new Error(`Cart total not found for "${productName}" option "${priceOptionTexts[k]}"`);
              }
              const cartTotal = await cartPage.cartTotal.first().textContent();
              console.log(`  │  │       → Option ${k + 1}/${priceOptions.length}: ${priceOptionTexts[k]}`);
              console.log(`  │  │          Cart total: ${cartTotal}`);

              if (cartTotal.replace(/[^\d.]/g, '') !== priceOptionTexts[k].replace(/[^\d.]/g, '')) {
                optionResult.error = `Cart total ${cartTotal} does not match option price ${priceOptionTexts[k]} for tab \"${tabTitle}\" card \"${productName}\"`;
                console.log(`  │  │          ✗ ERROR: Price mismatch`);
                cardHasOptionErrors = true;
              } else {
                console.log(`  │  │          ✓ Price matches`);
              }

              optionResults.push(optionResult);

              await page.goBack();
              await page.waitForTimeout(2000);

              if (newUrl === testUrl) {
                await merchCard.checkoutLink.first().click();
                await page.waitForTimeout(5000);
                try {
                  await modal.priceOptions.first().waitFor({ state: 'visible', timeout: 10000 });
                } catch (error) {
                  console.log(`❌ Modal reload failed after returning from cart for "${productName}" (Tab "${tabTitle}", Card ${j + 1}): Price options did not reappear within 10 seconds. Original error: ${error.message}`);
                  throw new Error(`Modal price options not found after cart return for "${productName}"`);
                }
                try {
                  await modal.continueButton.first().waitFor({ state: 'visible', timeout: 10000 });
                } catch (error) {
                  console.log(`❌ Modal reload failed after returning from cart for "${productName}" (Tab "${tabTitle}", Card ${j + 1}): Continue button did not reappear within 10 seconds. Original error: ${error.message}`);
                  throw new Error(`Modal continue button not found after cart return for "${productName}"`);
                }
              }
            }
            
            await plansPage.modalCloseButton.first().click();
          } else {
            console.log(`  │  │  🔀 Redirected to: ${newUrl}`);
            await page.waitForTimeout(5000);
            await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-redirected.png`});

            if (cardPrice !== 'N/A') {
              const redirectedPageContent = await page.textContent('body');
              if (redirectedPageContent.includes(cardPrice)) {
                console.log(`  │  │     ✓ Card price found in redirected page`);
              } else {
                cardResult.error = `Card price ${cardPrice} not found in redirected page content for tab \"${tabTitle}\" card \"${productName}\"`;
                console.log(`  │  │     ✗ ERROR: ${cardResult.error}`);
              }
            }
            await page.goBack();
          }
          
          // Mark card as passed if no errors occurred (check both card errors and option errors)
          if (!cardResult.error && !cardHasOptionErrors) {
            stateManager.markCardPassed(i, j);
          }
          
        } catch (error) {
          // Catch any exception during card testing
          const errorMessage = error.message;
          console.log(`  │  │  ⚠️  EXCEPTION: ${errorMessage}`);
          
          cardResult.error = errorMessage;
          cardResult.cardTitle = cardResult.cardTitle || `Card ${j + 1}`;
          
          // Take screenshot of current state for debugging
          try {
            await page.screenshot({ 
              path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-exception.png`,
              fullPage: true 
            });
          } catch (screenshotError) {
            console.log(`  │  │     Failed to capture exception screenshot: ${screenshotError.message}`);
          }
          
          // Card will NOT be marked as passed, so it will be retried
          console.log(`  │  │  🔄 Card will be retried on next run`);

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
      tabResults.push(tabResult);
    }

    // if cardResults or optionResults has any error, print the error and fail the test
    const errorResults = cardResults.concat(optionResults).filter(result => result.error);
    
    console.log('\n' + '─'.repeat(80));
    console.log(`  └─ Completed testing all tabs`);
    console.log('\n' + '='.repeat(80));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`Tabs tested: ${tabResults.length}`);
    console.log(`Cards tested: ${cardResults.length}`);
    console.log(`Price options tested: ${optionResults.length}`);
    console.log(`Errors found: ${errorResults.length}`);
    
    if (errorResults.length > 0) {
      console.log('\n' + '⚠️  ERRORS DETECTED'.padEnd(80, ' '));
      console.log('─'.repeat(80));
      errorResults.forEach((result, index) => {
        console.log(`\n${index + 1}. ${result.error}`);
      });
      console.log('\n' + '='.repeat(80) + '\n');
      
      // Save error report for notifications with detailed error information
      const errorMessages = errorResults.map(r => r.error);
      saveErrorReport('Price Errors', errorMessages, testUrl);
      
      expect(errorResults.length).toBe(0);
    } else {
      // Test passed completely - clear the state file for next run
      console.log('\n✅ All tests passed successfully!');
      console.log('🧹 Clearing state file for next run...');
      stateManager.clear();
      console.log('='.repeat(80) + '\n');
    }
  });
});  