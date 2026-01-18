const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const TestStateManager = require('./TestStateManager');

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
    this.priceOptions = modal.locator('.subscription-panel-offer').filter({visible: true});
    this.selectedPriceOption = modal.locator('input[checked]+label .subscription-panel-offer-price [data-wcs-type="price"]:not(i *, [class*="strikethrough"] *)').filter({visible: true});
    this.continueButton = modal.locator('.spectrum-Button--cta').filter({visible: true});
  }
}

class PriceOption {
  constructor(option) {
    this.option = option
    this.price = option.locator('.subscription-panel-offer-price [data-wcs-type="price"]:not(i *, [class*="strikethrough"] *)').filter({visible: true});
    this.priceInPromoHtml = option.locator('.subscription-panel-promo-html [data-wcs-type="price"]:not(i *, [class*="strikethrough"] *)').filter({visible: true});
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

  let testUrl = process.env.TEST_URL || 'https://www.adobe.com/uk/creativecloud/plans.html';
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
    try {
      await plansPage.pageLoadOk.waitFor({ state: 'attached', timeout: 20000 });
    } catch (error) {
      console.log(`❌ Page Load OK verification failed: Cookie notice element (div.evidon-notice-link) did not appear within 20 seconds. The page may not have loaded correctly. Original error: ${error.message}`);
      throw new Error(`div.evidon-notice-link not found`);
    }
    
    // Filter out common non-critical errors
    const criticalErrors = errors.filter(error => 
      !error.includes('favicon') && 
      !error.includes('analytics') &&
      !error.includes('ads') &&
      !error.toLowerCase().includes('third-party') &&
      !error.includes('reading \'setAttribute\'') && // Cannot read properties of null (reading 'setAttribute')
      !error.includes('reading \'style\'') && // Cannot read properties of null (reading 'style')
      !error.startsWith('X') &&
      !error.includes('Failed to load resource: net::ERR_FAILED') &&
      !error.includes('https://cdn.cookielaw.org/')
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

    let tabs = await plansPage.tabs.all();

    console.log(`Found ${tabs.length} tabs to test`);

    const origTestUrl = testUrl;

    for (let i = 0; i < tabs.length; i++) {
      if (process.env.TEST_TAB && parseInt(process.env.TEST_TAB) !== i) {
        console.log(`Skipping tab ${i} as TEST_TAB is set to ${process.env.TEST_TAB}`);
        continue;
      }
      // For JP, use a specialized testUrl for tab 0
      if (countryCode === 'jp') {
        if (i === 0) {
          testUrl = testUrl + '?plan=individual&filter=all';
        } else {
          testUrl = origTestUrl;
        }
        console.log(`JP Test URL: ${testUrl}`);
        const currUrl = await page.url();
        if (currUrl !== testUrl) {
          await page.goto(testUrl)
          await page.waitForTimeout(3000);
        }
      }

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
        // if TEST_CARD is set, use it to skip the card
        if (process.env.TEST_CARD && parseInt(process.env.TEST_CARD) !== j) {
          console.log(`Skipping card ${j} as TEST_CARD is set to ${process.env.TEST_CARD}`);
          continue;
        }
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
          try {
            await merchCard.productName.first().waitFor({ state: 'visible', timeout: 10000 });
          } catch (error) {
            console.log(`❌ Product name loading failed for Card ${j + 1} in Tab "${tabTitle}": Product name element (h3) did not become visible within 10 seconds. Original error: ${error.message}`);
            throw new Error(`Product name is not found for Card ${j + 1} in Tab "${tabTitle}"`);
          }
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
              await modal.selectedPriceOption.first().waitFor({ state: 'visible', timeout: 10000 });
            } catch (error) {
              console.log(`❌ Selected price option not found for "${productName}" (Tab "${tabTitle}", Card ${j + 1}): Selected price option did not become visible within 10 seconds. Original error: ${error.message}`);
              throw new Error(`Selected price option not found for "${productName}"`);
            }
            //if (await modal.selectedPriceOption.count() > 1) {
            //  const selectedPriceOptions = await modal.selectedPriceOption.all();
            //  const prices = await Promise.all(selectedPriceOptions.map(async(x) => await x.textContent()));
            //  cardResult.error = `Two or more prices ${prices.join(', ')} in an option found for tab \"${tabTitle}\" card \"${productName}\"`;
            //  console.log(`\n   ✗ ERROR: ${cardResult.error}`);
            //}
            const selectedPriceOption = await modal.selectedPriceOption.first().textContent();
            console.log(`   Selected Option: ${selectedPriceOption}`);
            if (selectedPriceOption.split('/')[0].replace(/[^\d]/g, '') !== cardPrice.split('/')[0].replace(/[^\d]/g, '')) {
              cardResult.error = `Selected price option ${selectedPriceOption} does not match card price ${cardPrice} for tab \"${tabTitle}\" card \"${productName}\"`;
              console.log(`\n   ✗ ERROR: ${cardResult.error}`);
            }
            
            const priceOptions = await modal.priceOptions.all();
            const productOptionResults = [];

            // Save the current price options in the modal.
            // Check if the price options are the same when going back from the cart.
            for (let k = 0; k < priceOptions.length; k++) {
              const optionResult = {
                tabIndex: i,
                tabTitle: tabTitle,
                cardIndex: j,
                cardTitle: productName,
                optionIndex: k,
                optionTitle: 'N/A',
                error: []
              };
              productOptionResults.push(optionResult);

              const priceOption = new PriceOption(priceOptions[k]);
              try {
                await priceOption.price.first().waitFor({ state: 'visible', timeout: 10000 });
                const price = await priceOption.price.first();
                const priceText = await price.textContent();
                optionResult.optionTitle = priceText;
              } catch (error) {
                optionResult.error.push(`Price not found for ${tabTitle} > ${productName} > Option ${k + 1}`);
                try {
                  await priceOption.priceInPromoHtml.first().waitFor({ state: 'visible', timeout: 10000 });
                  const priceInPromoHtml = await priceOption.priceInPromoHtml.first();
                  const priceInPromoHtmlText = await priceInPromoHtml.textContent();
                  optionResult.optionTitle = priceInPromoHtmlText;
                  optionResult.error.push(`Price ${priceInPromoHtmlText} was found in the promo text instead of the price element`);
                } catch (error) {
                  // ignore
                }
              }
            }
            console.log(`   Available Options: ${productOptionResults.map(result => result.optionTitle).join(' | ')}`);
            
            for (let k = 0; k < priceOptions.length; k++) {

              const optionResult = productOptionResults[k];
              const priceOption = new PriceOption(priceOptions[k]);

              let priceTextAgain;
              let price = null;
              try {
                await priceOption.price.first().waitFor({ state: 'visible', timeout: 10000 });
                price = await priceOption.price.first();
                priceTextAgain = await price.textContent();
              } catch (error) {
                try {
                  await priceOption.priceInPromoHtml.first().waitFor({ state: 'visible', timeout: 10000 });
                  const priceInPromoHtml = await priceOption.priceInPromoHtml.first();
                  const priceInPromoHtmlText = await priceInPromoHtml.textContent();
                  price = priceInPromoHtml;
                  priceTextAgain = priceInPromoHtmlText;
                } catch (error) {
                  // ignore
                }
              }

              if (priceTextAgain !== optionResult.optionTitle) {
                await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-option-${k + 1}-price-change.png`});
                const errorMessage = `Price changed to ${priceTextAgain} after going back from the cart for ${tabTitle} > ${productName} > Option ${k + 1}`;
                console.log(`❌ ${errorMessage}`);
                optionResult.error.push(errorMessage);
              }

              const priceOptionText = priceTextAgain;

              try {
                await priceOption.option.waitFor({ state: 'visible', timeout: 10000 });
                //await priceOption.option.click();
                await price.click();
                await page.waitForTimeout(1000);
                await expect(modal.continueButton.first()).toBeEnabled({timeout: 10000});
                await modal.continueButton.first().click();
              } catch (error) {
                await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-option-${k + 1}-continue-error.png`});
                const errorMessage = `${error.message} for ${tabTitle} > ${productName} > ${priceOptionText}`;
                console.log(`❌ ${errorMessage}`);
                optionResult.error.push(errorMessage);
              }

              await page.waitForTimeout(5000);
              await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-option-${k + 1}.png`});

              try {
                const cartPage = new CartPage(page);
                try {
                  await cartPage.cartSubTotal.waitFor({ state: 'visible', timeout: 20000 });
                } catch (error) {
                  throw new Error(`Cart subtotal not found`);
                }
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
                
                await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-option-${k + 1}-cart.png` }  );

                const digitOnlyPrice = priceOptionText.split('/')[0].replace(/[^\d]/g, '');
                const digitOnlySubTotal = cartSubTotal.split('/')[0].replace(/[^\d]/g, '');
                const digitOnlyTotal = cartTotal.split('/')[0].replace(/[^\d]/g, '');
                const digitOnlyTotalNext = cartTotalNext.split('/')[0].replace(/[^\d]/g, '');
                
                if ((digitOnlySubTotal !== digitOnlyPrice) && 
                    (digitOnlyTotal !== digitOnlyPrice) &&
                    (digitOnlyTotalNext !== digitOnlyPrice)) {
                  // Determine which cart price to compare (prefer subtotal, then total, then next)
                  let cartPriceToCompare = digitOnlySubTotal !== '' ? digitOnlySubTotal : (digitOnlyTotal !== '' ? digitOnlyTotal : digitOnlyTotalNext);
                  let cartPriceDisplay = digitOnlySubTotal !== '' ? cartSubTotal : (digitOnlyTotal !== '' ? cartTotal : cartTotalNext);
                  
                  // Determine direction: card_lower means card price < cart price (worse for customer)
                  const priceDirection = parseInt(digitOnlyPrice) < parseInt(cartPriceToCompare) ? '[CARD_LOWER]' : '[CARD_HIGHER]';
                  
                  optionResult.error.push(`${priceDirection} Cart subtotal/total does not match for ${tabTitle} > ${productName} > Card: ${priceOptionText}, Cart: ${cartPriceDisplay}`);
                  console.log(`\n      ✗ ERROR: ${optionResult.error}`);
                } else {
                  console.log(`      ✓ Price validation passed`);
                }
              } catch (error) {
                await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-option-${k + 1}-price-error.png`});
                const errorMessage = `${error.message} for ${tabTitle} > ${productName} > ${priceOptionText}`;
                console.log(`❌ ${errorMessage}`);
                optionResult.error.push(errorMessage);
              } finally {
                await page.goBack();
                await page.waitForTimeout(3000);
              }

              if (optionResult.error.length > 0) {
                optionResult.error = optionResult.error.join('\n');
                cardHasOptionErrors = true;
              } else {
                delete optionResult.error;
              }

              if (newUrl === testUrl) {
                await merchCard.checkoutLink.first().waitFor({ state: 'visible', timeout: 10000 });
                await merchCard.checkoutLink.first().click();
                await page.waitForTimeout(5000);
                try {
                  await modal.priceOptions.first().waitFor({ state: 'visible', timeout: 10000 });
                } catch (error) {
                  const errorMessage = `Prices not found in the modal for ${tabTitle} > ${productName}`;
                  console.log(`❌ ${errorMessage}`);
                  throw new Error(errorMessage);
                }
                try {
                  await modal.continueButton.first().waitFor({ state: 'visible', timeout: 10000 });
                } catch (error) {
                  const errorMessage = `Continue button not found in the modal for ${tabTitle} > ${productName}`;
                  console.log(`❌ ${errorMessage}`);
                  throw new Error(errorMessage);
                }
              }
            }
            
            optionResults.push(...productOptionResults);

            await plansPage.modalCloseButton.first().click();
          } else {
            console.log(`Redirected to URL ${newUrl}`);
            await page.waitForTimeout(5000);
            await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-redirected.png`});

            if (cardPrice !== 'N/A') {
              const redirectedPageContent = await page.textContent('body');
              let normalizedCardPrice = cardPrice.split('/')[0];
              // locale il_he redirect to il_en
              if (countryCode === 'il_he') {
                normalizedCardPrice = normalizedCardPrice.replace(/[^\d.]/g, '');
              }
              if (redirectedPageContent.includes(normalizedCardPrice)) {
                console.log(`Card price found in redirected page content`);
              } else {
                cardResult.error = `Card price ${cardPrice} not found in the redirected page for ${tabTitle} > ${productName}`;
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
          const errorMessage = error.message;
          console.log(`\n   ⚠️  EXCEPTION: ${errorMessage}`);
          
          cardResult.error = errorMessage;
          cardResult.cardTitle = cardResult.cardTitle || `Card ${j + 1}`;
          
          // Take screenshot of current state for debugging
          try {
            await page.screenshot({ 
              path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-exception.png`,
              timeout: 5000
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