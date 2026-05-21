const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const TestStateManager = require('./TestStateManager');

class PlansPage {
  constructor(page) {
    this.page = page;
    this.pageLoadOk = page.locator('div#page-load-ok-milo');
    this.tabs = page.locator('div[role="tablist"] button[role="tab"]').filter({visible: true}); 
    this.tabContent = page.locator('.tab-content');
    this.tabPanel = this.tabContent.locator('.tabpanel').filter({visible: true});
    this.modalCloseButton = page.locator('.dialog-modal .dialog-close').filter({visible: true});
    this.modalIframe = page.locator('div.iframe iframe').filter({visible: true});
    this.checkoutModal = page.locator('.milo-iframe iframe').filter({visible: true});
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
    this.priceOptions = modal.locator(':is(.subscription-panel-offer-price, [class*="CommitmentOptionCard__commitmentOptionCard__"] [data-testid="main-price"])').filter({visible: true});
    this.selectedPriceOption = modal.locator(':is(input[checked]+label :is(.subscription-panel-offer-price,.subscription-panel-promo-html) [data-wcs-type="price"]:not(i *, [class*="strikethrough"] *), [data-testid="is-selected"] div[data-testid="main-price"])').filter({visible: true});
    this.continueButton = modal.locator(':is(.spectrum-Button--cta, button[data-testid="primary-cta-button"])').filter({visible: true});
    this.modalCloseButton = modal.locator('[data-testid="header-close"]').filter({visible: true});
    this.commerceLink = modal.locator('a[href*="commerce.adobe.com"]').filter({visible: true});
  }
}

class CartPage {
  constructor(page) {
    this.page = page;
    this.cartSubTotal = page.locator('[data-testid="cart-totals-subtotals-row"] [data-testid="price-full-display"]').filter({visible: true});
    this.cartTotal = page.locator('[class*="CartTotals__cart-totals-total-price"] [data-testid="price-full-display"]').filter({visible: true});
    this.cartTotalNext = page.locator('[data-testid="cart-totals-upcoming-dueNext-total"] [data-testid="price-full-display"]').filter({visible: true});
    this.itemRemoveButton = page.locator('[data-testid="cart-item-remove-btn"]').filter({visible: true});
    this.confirmButton = page.locator('[data-testid="modal"] [data-variant="primary"]').filter({visible: true});
    this.quantity = page.locator('[data-testid="quantity-dropdown-spectrum2"] [slot="label"]').filter({visible: true});
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

  const sanitizedTestName = testName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const reportPath = path.join(reportDir, `error-report-${sanitizedTestName}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(errorReport, null, 2));

  console.log(`\n📝 Error report saved to: ${reportPath}`);
  return reportPath;
}

async function gobackTabModal(page,url, tab, merchCard) {
  try {
    await page.evaluate(async () => { await localStorage.clear(); await sessionStorage.clear(); });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000, referer: undefined });
    await page.waitForTimeout(2000);
  } catch (err) {
  }
  await tab.click({ timeout: 10000 });
  if (merchCard) {
    await merchCard.card.waitFor({ state: 'visible', timeout: 10000 });
    await merchCard.checkoutLink.first().click({ timeout: 10000 });
  }
}

test.describe('Creative Cloud Plans Page Monitoring', () => {
  test.describe.configure({ retries: 2 });

  let testUrl = process.env.TEST_URL || 'https://www.adobe.com/uk/creativecloud/plans.html';
  console.log('\n' + '='.repeat(80));
  console.log('🎯 TEST CONFIGURATION');
  console.log('='.repeat(80));
  console.log(`URL: ${testUrl}`);
  console.log('='.repeat(80) + '\n');

  // Extract country code from URL path (e.g., /uk/ -> 'uk')
  const urlPath = new URL(testUrl).pathname;
  const countryCode = urlPath.split('/').filter(Boolean)[0] || 'uk';
  console.log('🌍 MOCKING GEO LOCATION:', countryCode);

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
      console.log(`❌ Page Load OK verification failed: Page load indicator (div#page-load-ok-milo) did not appear within 20 seconds. The page may not have loaded correctly. Original error: ${error.message}`);
      throw new Error(`div#page-load-ok-milo not found`);
    }

    const criticalErrors = errors.filter(error =>
      !error.includes('favicon') &&
      !error.includes('analytics') &&
      !error.includes('ads') &&
      !error.toLowerCase().includes('third-party') &&
      !error.includes('reading \'setAttribute\'') &&
      !error.includes('reading \'style\'') &&
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

      if (criticalErrors.length > 2) {
        saveErrorReport('Console Errors', criticalErrors, testUrl);
      }
    }

    expect(criticalErrors.length).toBeLessThanOrEqual(2);

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
      console.log('\n' + '🔄'.repeat(40));
      console.log(`🔄 RETRY DETECTED - Skipping ${stats.totalPassed} already passed card(s)`);
      console.log(`   Previous run timestamp: ${stats.timestamp}`);
      console.log('🔄'.repeat(40) + '\n');
    }

    const tabResults = [];
    const cardResults = [];
    const optionResults = [];

    let tabs = await plansPage.tabs.all();

    // get the page global variable ttMETA
    const ttMeta = await page.evaluate(() => window.ttMETA);
    console.log(`Target Test Campaign ttMeta:\n${JSON.stringify(ttMeta, null, 2)}`);

    console.log('\n' + '─'.repeat(80));
    console.log(`📑 TABS DISCOVERY: Found ${tabs.length} tabs to test`);
    console.log('─'.repeat(80));

    const origTestUrl = testUrl;

    for (let i = 0; i < tabs.length; i++) {
      if (process.env.TEST_TAB && parseInt(process.env.TEST_TAB) !== i) {
        console.log(`Skipping tab ${i} as TEST_TAB is set to ${process.env.TEST_TAB}`);
        continue;
      }
      if (process.env.SKIP_TAB && parseInt(process.env.SKIP_TAB) === i) {
        console.log(`Skipping tab ${i} as SKIP_TAB is set to ${process.env.SKIP_TAB}`);
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
          await page.goto(testUrl);
          await page.waitForTimeout(3000);
        }
      }

      const tab = tabs[i];
      const tabTitle = await tab.textContent();

      const tabResult = {
        tabIndex: i,
        tabTitle: tabTitle,
        cardCount: 0,
      };

      console.log(`\n  ┌─ Tab ${i + 1}/${tabs.length}: "${tabTitle}"`);

      await tab.click({ timeout: 10000 });
      await page.waitForTimeout(2000);
      const tabPanel = await plansPage.getTabPanel(tab);
      const merchCards = await plansPage.getMerchCards(tabPanel);
      console.log(`  │  Found ${merchCards.length} merch card${merchCards.length !== 1 ? 's' : ''} to test`);

      tabResult.cardCount = merchCards.length;

      await page.screenshot({ path: `screenshots/plans-tab-${i + 1}.png` });

      expect(merchCards.length, `Tab "${tabTitle}" should have at least 1 card`).toBeGreaterThanOrEqual(1);

      for (let j = 0; j < merchCards.length; j++) {
        if (process.env.TEST_CARD && parseInt(process.env.TEST_CARD) !== j) {
          console.log(`  │  Skipping card ${j} as TEST_CARD is set to ${process.env.TEST_CARD}`);
          continue;
        }
        if (stateManager.hasCardPassed(i, j)) {
          console.log(`  │  ⏭️  Skipping already passed card: Tab ${i + 1}, Card ${j + 1}`);
          continue;
        }

        let cardResult = {
          tabIndex: i,
          tabTitle: tabTitle,
          cardIndex: j,
        };

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
          let cardPrice = 'N/A';

          await merchCard.price.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
          if (await merchCard.price.count() > 0) {
            await expect(merchCard.price.first()).not.toBeEmpty({ timeout: 5000 });
            cardPrice = await merchCard.price.first().textContent();
          }

          console.log(`  │`);
          console.log(`  │  ├─ Card ${j + 1}/${merchCards.length}: "${productName}"`);
          console.log(`  │  │  Price: ${cardPrice}`);

          cardResult.cardTitle = productName;
          cardResult.cardPrice = cardPrice;

          await merchCard.card.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}.png` });

          if (await merchCard.checkoutLink.count() === 0) {
            console.log(`  │  │  ⚠️  No checkout link found`);
            cardResults.push(cardResult);
            continue;
          }

          cardResult.ctaText = await merchCard.checkoutLink.first().textContent();

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

            try {
              await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 20000 });
            } catch (err) {
              console.log('  │  │  Timeout on waiting for network idle!');
            }
            await tabs[i].click({ timeout: 10000 });
            await page.waitForTimeout(1000);
            continue;
          }

          if (newPage) {
            const newPageUrl = newPage.url();
            console.log(`  │  │  🔗 New page opened`);
            console.log(`  │  │     URL: ${newPageUrl}`);
            await newPage.waitForTimeout(5000);
            await newPage.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-new-page.png` });
            await newPage.close();
          } else if (newUrl.startsWith(testUrl)) {
            console.log(`  │  │  🎭 Modal opened`);
            await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-modal.png` });

            await expect(plansPage.checkoutModal).toBeVisible({ timeout: 10000 });
            const tagName = await plansPage.checkoutModal.evaluate(el => el.tagName);
            let modal = null;
            if (tagName === 'IFRAME') {
              const modalIframeSrc = await plansPage.checkoutModal.getAttribute('src');
              console.log(`  │  │     Iframe: ${modalIframeSrc}`);
              modal = new Modal(await plansPage.checkoutModal.contentFrame());
            } else {
              modal = new Modal(plansPage.checkoutModal);
            }

            await modal.priceOptions.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => null);
            const hasPriceOptions = await modal.priceOptions.count() > 0;

            if (!hasPriceOptions) {
              // New modal — look for a direct commerce.adobe.com link
              console.log(`   ℹ No subscription-panel-offer found for "${productName}" — checking for commerce link (new modal)`);
              let commerceHref = null;
              try {
                await modal.commerceLink.first().waitFor({ state: 'visible', timeout: 10000 });
                commerceHref = await modal.commerceLink.first().getAttribute('href');
              } catch (error) {
                cardResult.error = `No price options or commerce link found in modal for "${productName}" (Tab "${tabTitle}")`;
                console.log(`❌ ${cardResult.error}`);
              }

              if (commerceHref) {
                console.log(`  │  │     Commerce link: ${commerceHref}`);
                await page.goto(commerceHref, { waitUntil: 'networkidle', timeout: 20000 });
                await page.waitForTimeout(3000);
                await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-commerce.png` });

                const cartPage = new CartPage(page);
                const optionResult = {
                  tabIndex: i, tabTitle, cardIndex: j, cardTitle: productName,
                  optionIndex: 0, optionTitle: cardPrice, error: []
                };

                try {
                  try {
                    await cartPage.cartSubTotal.waitFor({ state: 'visible', timeout: 20000 });
                  } catch (error) {
                    throw new Error(`Cart subtotal not found`);
                  }
                  const cartSubTotal = await cartPage.cartSubTotal.first().textContent();
                  let cartTotal = 'N/A';
                  if (await cartPage.cartTotal.count() > 0) cartTotal = await cartPage.cartTotal.first().textContent();
                  let cartTotalNext = 'N/A';
                  if (await cartPage.cartTotalNext.count() > 0) cartTotalNext = await cartPage.cartTotalNext.first().textContent();
                  let quantity = 'N/A';
                  if (await cartPage.quantity.count() > 0) quantity = await cartPage.quantity.first().textContent();

                  console.log(`  │  │       → Option 1/1: ${cardPrice}`);
                  console.log(`  │  │          Quantity: ${quantity}`);
                  console.log(`  │  │          Cart Subtotal: ${cartSubTotal}`);
                  console.log(`  │  │          Cart Total: ${cartTotal}`);
                  console.log(`  │  │          Next Billing: ${cartTotalNext}`);

                  await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-commerce-cart.png` });

                  let digitOnlyPrice = cardPrice.split('/')[0].replace(/[^\d]/g, '');
                  if (parseInt(quantity) > 1) digitOnlyPrice = (parseInt(digitOnlyPrice) * parseInt(quantity)).toString();

                  const digitOnlySubTotal = cartSubTotal.split('/')[0].replace(/[^\d]/g, '');
                  const digitOnlyTotal = cartTotal.split('/')[0].replace(/[^\d]/g, '');
                  const digitOnlyTotalNext = cartTotalNext.split('/')[0].replace(/[^\d]/g, '');

                  if ((digitOnlySubTotal !== digitOnlyPrice) && (digitOnlyTotal !== digitOnlyPrice) && (digitOnlyTotalNext !== digitOnlyPrice)) {
                    optionResult.error.push(`Price mismatch. ${tabTitle} > ${productName} > Card: ${cardPrice}, Total: ${cartTotal}, Subtotal: ${cartSubTotal}, Next Billing: ${cartTotalNext}`);
                    console.log(`  │  │          ✗ ERROR: Price mismatch`);
                  } else {
                    console.log(`  │  │          ✓ Price matches`);
                  }
                } catch (error) {
                  await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-commerce-error.png` });
                  optionResult.error.push(`${error.message} for ${tabTitle} > ${productName} > ${cardPrice}`);
                  console.log(`  │  │          ✗ ERROR: ${optionResult.error}`);
                }

                if (optionResult.error.length > 0) {
                  optionResult.error = optionResult.error.join('\n');
                } else {
                  delete optionResult.error;
                }
                optionResults.push(optionResult);
              }
            } else {
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

              const selectedPriceOption = await modal.selectedPriceOption.first().textContent();
              console.log(`  │  │     Selected: ${selectedPriceOption}`);
              if (selectedPriceOption.split('/')[0].replace(/[^\d]/g, '') !== cardPrice.split('/')[0].replace(/[^\d]/g, '')) {
                cardResult.error = `Selected price option ${selectedPriceOption} does not match card price ${cardPrice} for tab \"${tabTitle}\" card \"${productName}\"`;
                console.log(`  │  │     ✗ ERROR: ${cardResult.error}`);
              } else {
                console.log(`  │  │     ✓ Price matches card price`);
              }

              const priceOptions = await modal.priceOptions.all();
              const productOptionResults = [];

              // Collect all option titles before iterating (to detect price changes after cart return)
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

                const priceOption = priceOptions[k];
                try {
                  await priceOption.waitFor({ state: 'visible', timeout: 10000 });
                  optionResult.optionTitle = await priceOption.textContent();
                } catch (error) {
                  optionResult.error.push(`Price not found for ${tabTitle} > ${productName} > Option ${k + 1}`);
                }
              }

              const optionTitles = productOptionResults.map(r => r.optionTitle).join(', ');
              console.log(`  │  │     Testing ${priceOptions.length} price option${priceOptions.length !== 1 ? 's' : ''}: [${optionTitles}]`);

              for (let k = 0; k < priceOptions.length; k++) {
                try {
                  await expect(plansPage.checkoutModal).toBeVisible({ timeout: 10000 });
                } catch (error) {
                  console.log(`  │  │  ⚠️  Modal not found for "${productName}" (Tab "${tabTitle}", Card ${j + 1}, Option ${k + 1})`);
                  await merchCard.checkoutLink.first().click({ timeout: 10000 });
                }

                const optionResult = productOptionResults[k];
                const priceOption = priceOptions[k];

                await priceOption.waitFor({ state: 'visible', timeout: 10000 });
                let priceTextAgain;

                let retry = 3;
                while (retry > 0) {
                  priceTextAgain = await priceOption.textContent();
                  if (priceTextAgain === optionResult.optionTitle) break;
                  await page.waitForTimeout(3000);
                  retry--;
                }
                if (priceTextAgain !== optionResult.optionTitle) {
                  await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-option-${k + 1}-price-change.png` });
                  const errorMessage = `Price changed to ${priceTextAgain} after going back from the cart for ${tabTitle} > ${productName} > Option ${k + 1}`;
                  console.log(`  │  │  ⚠️  ${errorMessage}`);
                  optionResult.error.push(errorMessage);
                }

                const priceOptionText = priceTextAgain;

                try {
                  await priceOption.waitFor({ state: 'visible', timeout: 10000 });
                  await priceOption.click({ timeout: 10000 });
                  await page.waitForTimeout(1000);
                  await expect(modal.continueButton.first()).toBeEnabled({ timeout: 20000 });
                  await modal.continueButton.first().click({ timeout: 15000 });
                } catch (error) {
                  //await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-option-${k + 1}-continue-error.png` });
                  const errorMessage = `${error.message} for ${tabTitle} > ${productName} > ${priceOptionText}`;
                  console.log(`  │  │  ⚠️  ${errorMessage}`);
                  optionResult.error.push(errorMessage);
                }

                await page.waitForTimeout(5000);
                await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-option-${k + 1}.png` });

                const cartPage = new CartPage(page);

                try {
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
                  let quantity = 'N/A';
                  if (await cartPage.quantity.count() > 0) {
                    quantity = await cartPage.quantity.first().textContent();
                  }

                  console.log(`  │  │       → Option ${k + 1}/${priceOptions.length}: ${priceOptionText}`);
                  console.log(`  │  │          Quantity: ${quantity}`);
                  console.log(`  │  │          Cart Subtotal: ${cartSubTotal}`);
                  console.log(`  │  │          Cart Total: ${cartTotal}`);
                  console.log(`  │  │          Next Billing: ${cartTotalNext}`);

                  await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-option-${k + 1}-cart.png` });

                  let digitOnlyPrice = priceOptionText.split('/')[0].replace(/[^\d]/g, '');
                  if (parseInt(quantity) > 1) {
                    digitOnlyPrice = (parseInt(digitOnlyPrice) * parseInt(quantity)).toString();
                  }

                  const digitOnlySubTotal = cartSubTotal.split('/')[0].replace(/[^\d]/g, '');
                  const digitOnlyTotal = cartTotal.split('/')[0].replace(/[^\d]/g, '');
                  const digitOnlyTotalNext = cartTotalNext.split('/')[0].replace(/[^\d]/g, '');

                  if ((digitOnlySubTotal !== digitOnlyPrice) &&
                      (digitOnlyTotal !== digitOnlyPrice) &&
                      (digitOnlyTotalNext !== digitOnlyPrice)) {
                    optionResult.error.push(`Price mismatch. ${tabTitle} > ${productName} > Card: ${priceOptionText}, Total: ${cartTotal}, Subtotal: ${cartSubTotal}, Next Billing: ${cartTotalNext}`);
                    console.log(`  │  │          ✗ ERROR: Price mismatch`);
                    cardHasOptionErrors = true;
                  } else {
                    console.log(`  │  │          ✓ Price matches`);
                  }

                } catch (error) {
                  await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-option-${k + 1}-price-error.png` });
                  const errorMessage = `${error.message} for ${tabTitle} > ${productName} > ${priceOptionText}`;
                  console.log(`  │  │          ✗ ERROR: ${errorMessage}`);
                  optionResult.error.push(errorMessage);
                } finally {
                  if (k === priceOptions.length - 1 && await cartPage.itemRemoveButton.count() > 0) {
                    await cartPage.itemRemoveButton.first().click({ timeout: 15000 });
                    await page.waitForTimeout(1000);
                    await expect(cartPage.confirmButton.first()).toBeVisible({ timeout: 10000 });
                    await cartPage.confirmButton.first().click({ timeout: 15000 });
                    await page.waitForTimeout(1000);
                    console.log(`  │  │          Removed the item from the cart`);
                  } else {
                    await gobackTabModal(page, testUrl, tabs[i], merchCard);
                  }
                }

                if (optionResult.error.length > 0) {
                  optionResult.error = optionResult.error.join('\n');
                  cardHasOptionErrors = true;
                } else {
                  delete optionResult.error;
                }

                if (k === priceOptions.length - 1) {
                  continue;
                }

                if (newUrl === testUrl) {
                  await merchCard.checkoutLink.first().waitFor({ state: 'visible', timeout: 10000 });
                  await merchCard.checkoutLink.first().click({ timeout: 10000 });
                  await page.waitForTimeout(5000);
                  try {
                    await modal.priceOptions.first().waitFor({ state: 'visible', timeout: 10000 });
                  } catch (error) {
                    const errorMessage = `Prices not found in the modal for ${tabTitle} > ${productName}`;
                    console.log(`  │  │  ⚠️  ${errorMessage}`);
                    throw new Error(errorMessage);
                  }
                  try {
                    await modal.continueButton.first().waitFor({ state: 'visible', timeout: 10000 });
                  } catch (error) {
                    const errorMessage = `Continue button not found in the modal for ${tabTitle} > ${productName}`;
                    console.log(`  │  │  ⚠️  ${errorMessage}`);
                    throw new Error(errorMessage);
                  }
                }
              }

              optionResults.push(...productOptionResults);
            } // end else (hasPriceOptions)

            await gobackTabModal(page, testUrl, tabs[i], null);
          } else {
            console.log(`  │  │  🔀 Redirected to: ${newUrl}`);
            await page.waitForTimeout(5000);
            await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-redirected.png` });

            if (cardPrice !== 'N/A') {
              const redirectedPageContent = await page.textContent('body');
              let normalizedCardPrice = cardPrice.split('/')[0];
              // locale il_he redirect to il_en
              if (countryCode === 'il_he') {
                normalizedCardPrice = normalizedCardPrice.replace(/[^\d.]/g, '');
              }
              if (redirectedPageContent.includes(normalizedCardPrice)) {
                console.log(`  │  │     ✓ Card price found in redirected page`);
              } else {
                cardResult.error = `Card price ${cardPrice} not found in the redirected page for ${tabTitle} > ${productName}`;
                console.log(`  │  │     ✗ ERROR: ${cardResult.error}`);
              }
            }

            await gobackTabModal(page,testUrl, tabs[i], null);
          }

          // Mark card as passed if no errors occurred (check both card errors and option errors)
          if (!cardResult.error && !cardHasOptionErrors) {
            stateManager.markCardPassed(i, j);
          }

        } catch (error) {
          const errorMessage = error.message;
          console.log(`  │  │  ⚠️  EXCEPTION: ${errorMessage}`);

          cardResult.error = errorMessage;
          cardResult.cardTitle = cardResult.cardTitle || `Card ${j + 1}`;

          if (errorMessage.includes('crash')) {
            console.log(`  │  │     Browser crashed`);
          } else {
            await page.screenshot({
              path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-exception.png`,
              timeout: 5000
            });
          }

          console.log(`  │  │  🔄 Card will be retried on next run`);

          await gobackTabModal(page, testUrl, tabs[i], null);
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

      const errorMessages = errorResults.map(r => r.error);
      saveErrorReport('Price Errors', errorMessages, testUrl);

      expect(errorResults.length).toBe(0);
    } else {
      console.log('\n✅ All tests passed successfully!');
      console.log('🧹 Clearing state file for next run...');
      stateManager.clear();
      console.log('='.repeat(80) + '\n');
    }
  });
});
