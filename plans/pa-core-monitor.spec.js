// plans/pa-core-monitor.spec.js
//
// Same checkout / modal / cart checks as monitor2, but only merch-cards whose checkout
// CTA references a PA from pa-monitor-config.js (not every card on the page).

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { offerCodes, buildAdobePlansUrl, monitorPages } = require('../pa-monitor-config.js');
const TestStateManager = require('./TestStateManager.js');

class PlansPage {
  constructor(page) {
    this.page = page;
    this.pageLoadOk = page.locator('div#page-load-ok-milo');
    this.tabs = page.locator('#tabs-plan button[role="tab"]').filter({ visible: true });
    this.tabContent = page.locator('.tab-content');
    this.tabPanel = this.tabContent.locator('.tabpanel').filter({ visible: true });
    this.merchCards = this.tabPanel.locator('merch-card').filter({ visible: true });
    this.modalCloseButton = page.locator('.dialog-modal .dialog-close').filter({ visible: true });
    this.modalIframe = page.locator('.milo-iframe iframe').filter({ visible: true });
  }

  async getTabPanel(tab) {
    const tabPanelId = await tab.getAttribute('aria-controls');
    return this.page.locator(`#${tabPanelId}`).first();
  }

  async getMerchCards(tabPanel) {
    return tabPanel.locator('merch-card').filter({ visible: true }).all();
  }
}

class MerchCard {
  constructor(card) {
    this.card = card;
    this.productName = card.locator('h3');
    this.price = card
      .locator('span[is="inline-price"][data-template="price"] .price:not(.price-strikethrough)')
      .filter({ visible: true });
    this.checkoutLink = card.locator('a[is="checkout-link"]');
  }
}

class Modal {
  constructor(modal) {
    this.modal = modal;
    this.tabs = modal.locator('[role="tab"]').filter({ visible: true });
    this.selectedTab = modal.locator('[role="tab"][aria-selected="true"]').first();
    this.priceOptions = modal.locator('div[data-testid="main-price"]').filter({ visible: true });
    this.selectedPriceOption = modal
      .locator('[data-testid="is-selected"] div[data-testid="main-price"]')
      .filter({ visible: true });
    this.continueButton = modal.locator('button[data-testid="primary-cta-button"]').filter({ visible: true });
    this.modalCloseButton = modal.locator('[data-testid="header-close"]').filter({ visible: true });
  }
}

class CartPage {
  constructor(page) {
    this.page = page;
    this.cartTotal = page
      .locator('[class*="CartTotals__total-amount-plus-tax"] [data-testid="price-full-display"]')
      .filter({ visible: true });
    this.itemRemoveButton = page.locator('[data-testid="cart-item-remove-btn"]').filter({ visible: true });
    this.confirmButton = page.locator('[data-testid="modal"] [data-variant="primary"]').filter({ visible: true });
  }
}

const CSO_CRITICAL_PRODUCTS = [
  'Creative Cloud Pro',
  'Acrobat Pro',
  'Acrobat Studio',
  'Photoshop',
  'Photography',
  'Adobe Premiere',
  'Adobe Firefly Pro',
  'Illustrator',
  'Lightroom',
  'After Effects',
  'Express',
  'Adobe Stock',
  'Adobe Express Premium',
  'Acrobat Standard',
];

function isCSOCritical(productName) {
  return CSO_CRITICAL_PRODUCTS.some(critical => productName.includes(critical));
}

function isCSOCriticalError(errorMessage, productName) {
  const csoErrorTypes = [
    'does not match card price',
    'does not match option price',
    'Modal iframe not found',
    'Modal price options not found',
    'No price displayed',
  ];

  return isCSOCritical(productName) && csoErrorTypes.some(errorType => errorMessage.includes(errorType));
}

function saveErrorReport(testName, errors, errorResults, testUrl) {
  const csoErrors = errorResults.filter(result => isCSOCriticalError(result.error, result.cardTitle || ''));

  const errorReport = {
    timestamp: new Date().toISOString(),
    testName,
    testUrl,
    errorCount: errors.length,
    errors,
    hasCSOCriticalErrors: csoErrors.length > 0,
    csoErrorCount: csoErrors.length,
    csoErrors: csoErrors.map(r => ({
      product: r.cardTitle,
      error: r.error,
    })),
    status: 'FAILED',
  };

  const reportDir = path.join(__dirname, '..', 'test-results');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const sanitizedTestName = testName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const reportPath = path.join(reportDir, `error-report-${sanitizedTestName}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(errorReport, null, 2));

  console.log(`\n📝 Error report saved to: ${reportPath}`);
  if (csoErrors.length > 0) {
    console.log(`⚠️  CSO-CRITICAL ERRORS DETECTED: ${csoErrors.length} error(s) in critical products`);
  }
  return reportPath;
}

async function getHrefFromLocator(loc) {
  try {
    const href = await loc.getAttribute('href');
    if (href) return href;
    return await loc.getAttribute('data-href');
  } catch {
    return null;
  }
}

function hrefMentionsPa(href, pa) {
  if (!href) return false;
  let h = href;
  try {
    h = decodeURIComponent(href);
  } catch {
    /* keep raw */
  }
  return h.includes(`pa=${pa}`) || h.includes(`&pa=${pa}`);
}

/** Ensures `georouting=off` on catalog loads (ACOM geo routing can leave CTAs disabled for automation). */
function appendGeoroutingOff(urlString) {
  try {
    const u = new URL(urlString);
    u.searchParams.set('georouting', 'off');
    return u.href;
  } catch {
    return urlString;
  }
}

/**
 * First checkout/buy control on the card whose href matches a configured PA.
 */
async function findConfiguredPaCheckout(cardLocator, codes) {
  const links = cardLocator.locator('a[is="checkout-link"], button[is="checkout-link"]');
  const n = await links.count();
  for (let i = 0; i < n; i++) {
    const loc = links.nth(i);
    const href = await getHrefFromLocator(loc);
    for (const entry of codes) {
      const pa = entry.pa;
      if (hrefMentionsPa(href, pa)) {
        return { pa, label: entry.label || pa, checkoutLocator: loc };
      }
    }
  }
  return null;
}

test.describe('Creative Cloud Plans — PA core monitor', () => {
  test.describe.configure({ retries: 2 });

  const pageKey = process.env.PA_MONITOR_PAGE_KEY || 'plans';
  const monitorPage = monitorPages[pageKey] || monitorPages.plans;
  const errorReportName = pageKey === 'catalog' ? 'Catalog' : 'Plans';

  const baseTestUrl =
    process.env.TEST_URL ||
    buildAdobePlansUrl(process.env.TEST_LOCALE || '', monitorPage.path);
  const testUrl =
    pageKey === 'catalog' ? appendGeoroutingOff(baseTestUrl) : baseTestUrl;

  console.log('\n' + '='.repeat(80));
  console.log('🎯 PA CORE MONITOR (PA-scoped, monitor2 flow)');
  console.log('='.repeat(80));
  console.log(`URL: ${testUrl}`);
  console.log(`Configured PA codes (${offerCodes.length}): ${offerCodes.map(o => o.pa).join(', ')}`);
  console.log('='.repeat(80) + '\n');

  test.beforeEach(async ({ page }) => {
    if (!offerCodes.length) {
      throw new Error('pa-monitor-config.js: offerCodes is empty — add at least one { pa, label } entry.');
    }
    try {
      await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 20000 });
    } catch (err) {
      console.log('⚠️  Warning: Timeout while waiting for network idle');
    }
  });

  test('should check price options for configured PA cards', async ({ page }) => {
    test.setTimeout(1800 * 1000);

    /** Catalog merch-cards often omit inline price; pricing appears in the commerce modal only. */
    const skipMainPagePriceChecks = pageKey === 'catalog';

    const plansPage = new PlansPage(page);
    try {
      await plansPage.pageLoadOk.waitFor({ state: 'attached', timeout: 20000 });
    } catch (error) {
      console.log(
        `❌ Page Load OK verification failed: Page load indicator (div#page-load-ok-milo) did not appear within 20 seconds. The page may not have loaded correctly. Original error: ${error.message}`
      );
      throw new Error('div#page-load-ok-milo not found');
    }

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

    const planTabs = await plansPage.tabs.all();
    const tabless = planTabs.length === 0;
    const tabCount = tabless ? 1 : planTabs.length;

    const ttMeta = await page.evaluate(() => window.ttMETA);
    console.log(`Target Test Campaign ttMeta:\n${JSON.stringify(ttMeta, null, 2)}`);

    console.log('\n' + '─'.repeat(80));
    if (tabless) {
      console.log('📑 PAGE MODE: No #tabs-plan tabs — scanning visible merch-cards on the page');
    } else {
      console.log(`📑 TABS DISCOVERY: Found ${planTabs.length} tabs to test`);
    }
    console.log('─'.repeat(80));

    for (let i = 0; i < tabCount; i++) {
      if (process.env.TEST_TAB && parseInt(process.env.TEST_TAB, 10) !== i) {
        console.log(`Skipping tab ${i} as TEST_TAB is set to ${process.env.TEST_TAB}`);
        continue;
      }
      const tab = tabless ? null : planTabs[i];
      const tabTitle = tabless ? 'Page' : await tab.textContent();

      const tabResult = {
        tabIndex: i,
        tabTitle,
        cardCount: 0,
      };

      console.log(`\n  ┌─ ${tabless ? 'Surface' : `Tab ${i + 1}/${tabCount}`}: "${tabTitle}"`);

      if (!tabless) {
        await tab.click({ timeout: 10000 });
        await page.waitForTimeout(1000);
      }
      const tabPanel = tabless ? null : await plansPage.getTabPanel(tab);
      const merchCards = tabless
        ? await page.locator('merch-card').filter({ visible: true }).all()
        : await plansPage.getMerchCards(tabPanel);
      console.log(
        `  │  Found ${merchCards.length} merch card${merchCards.length !== 1 ? 's' : ''} ${tabless ? 'on page' : 'on tab'}`
      );

      tabResult.cardCount = merchCards.length;

      await page.screenshot({ path: `screenshots/plans-tab-${i + 1}.png` });

      for (let j = 0; j < merchCards.length; j++) {
        if (process.env.TEST_CARD && parseInt(process.env.TEST_CARD, 10) !== j) {
          console.log(`  │  Skipping card ${j} as TEST_CARD is set to ${process.env.TEST_CARD}`);
          continue;
        }
        if (stateManager.hasCardPassed(i, j)) {
          console.log(`  │  ⏭️  Skipping already passed card: Tab ${i + 1}, Card ${j + 1}`);
          continue;
        }

        const paMatch = await findConfiguredPaCheckout(merchCards[j], offerCodes);
        if (!paMatch) {
          console.log(
            `  │  ⏭️  Skipping card ${j + 1} — no checkout CTA matches configured PA codes [${offerCodes.map(o => o.pa).join(', ')}]`
          );
          continue;
        }

        let cardResult = {
          tabIndex: i,
          tabTitle,
          cardIndex: j,
          pa: paMatch.pa,
          paLabel: paMatch.label,
        };

        let cardHasOptionErrors = false;

        try {
          const merchCard = new MerchCard(merchCards[j]);
          try {
            await merchCard.productName.waitFor({ state: 'visible', timeout: 10000 });
          } catch (error) {
            console.log(
              `❌ Product name loading failed for Card ${j + 1} in Tab "${tabTitle}": Product name element (h3) did not become visible within 10 seconds. Original error: ${error.message}`
            );
            throw new Error(`Product name is not found for Card ${j + 1} in Tab "${tabTitle}"`);
          }
          const productName = await merchCard.productName.textContent();
          let cardPrice = 'N/A';
          if ((await merchCard.price.count()) > 0) {
            cardPrice = await merchCard.price.first().textContent();
          }
          console.log(`  │`);
          console.log(`  │  ├─ Card ${j + 1}/${merchCards.length}: "${productName}" [PA ${paMatch.pa}]`);
          console.log(`  │  │  Price: ${cardPrice}`);

          cardResult.cardTitle = productName;
          cardResult.cardPrice = cardPrice;

          if (!skipMainPagePriceChecks && cardPrice === 'N/A' && isCSOCritical(productName)) {
            cardResult.error = `No price displayed for "${productName}" (Tab "${tabTitle}", Card ${j + 1})`;
            console.log(`  │  │  ⚠️  CSO-CRITICAL: No price displayed`);
          }
          if (skipMainPagePriceChecks && cardPrice === 'N/A') {
            console.log(`  │  │  ⏭️  Catalog: no inline card price (expected); validating in modal/cart only`);
          }

          await merchCard.card.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}.png` });

          const checkoutLocator = paMatch.checkoutLocator;

          let newPage = null;
          let newUrl = null;

          try {
            [newPage] = await Promise.all([
              page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null),
              checkoutLocator.click({ timeout: 10000 }),
            ]);
            newUrl = page.url();
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
            if (!tabless) await planTabs[i].click({ timeout: 10000 });
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

            try {
              await plansPage.modalIframe.waitFor({ state: 'visible', timeout: 10000 });
            } catch (error) {
              console.log(
                `❌ Modal iframe not found for "${productName}" (Tab "${tabTitle}", Card ${j + 1}): Modal iframe (.milo-iframe iframe) did not become visible within 10 seconds. Original error: ${error.message}`
              );
              throw new Error(`Modal iframe not found for "${productName}"`);
            }
            const modalIframeSrc = await plansPage.modalIframe.getAttribute('src');
            console.log(`  │  │     Iframe: ${modalIframeSrc}`);
            if (!modalIframeSrc.startsWith('https://commerce.adobe.com/store/segmentation')) {
              cardResult.error = `Iframe src ${modalIframeSrc} is not valid`;
              console.log(`  │  │     ✗ ERROR: ${cardResult.error}`);
            }

            const frame = await plansPage.modalIframe.contentFrame();
            const modal = new Modal(frame);
            try {
              await modal.priceOptions.first().waitFor({ state: 'visible', timeout: 10000 });
            } catch (error) {
              console.log(
                `❌ Modal price options not found for "${productName}" (Tab "${tabTitle}", Card ${j + 1}): Price options did not become visible within 10 seconds. Original error: ${error.message}`
              );
              throw new Error(`Modal price options not found for "${productName}"`);
            }
            try {
              await modal.continueButton.first().waitFor({ state: 'visible', timeout: 10000 });
            } catch (error) {
              console.log(
                `❌ Modal continue button not found for "${productName}" (Tab "${tabTitle}", Card ${j + 1}): Continue button did not become visible within 10 seconds. Original error: ${error.message}`
              );
              throw new Error(`Modal continue button not found for "${productName}"`);
            }

            try {
              await modal.selectedPriceOption.waitFor({ state: 'visible', timeout: 10000 });
            } catch (error) {
              console.log(
                `❌ Selected price option not found for "${productName}" (Tab "${tabTitle}", Card ${j + 1}): Selected price option did not become visible within 10 seconds. Original error: ${error.message}`
              );
              throw new Error(`Selected price option not found for "${productName}"`);
            }
            const selectedPriceOption = await modal.selectedPriceOption.first().textContent();
            console.log(`  │  │     Selected: ${selectedPriceOption}`);
            if (!skipMainPagePriceChecks) {
              if (selectedPriceOption.replace(/[^\d.]/g, '') !== cardPrice.replace(/[^\d.]/g, '')) {
                cardResult.error = `Selected price option ${selectedPriceOption} does not match card price ${cardPrice} for tab \"${tabTitle}\" card \"${productName}\"`;
                console.log(`  │  │     ✗ ERROR: ${cardResult.error}`);
              } else {
                console.log(`  │  │     ✓ Price matches card price`);
              }
            } else {
              console.log(`  │  │     ⏭️  Catalog: skipped matching modal selection to main card price`);
            }

            const priceOptions = await modal.priceOptions.all();
            const priceOptionTexts = await Promise.all(priceOptions.map(async x => x.textContent()));
            console.log(
              `  │  │     Testing ${priceOptions.length} price option${priceOptions.length !== 1 ? 's' : ''}: [${priceOptionTexts.join(', ')}]`
            );

            for (let k = 0; k < priceOptions.length; k++) {
              const optionResult = {
                tabIndex: i,
                tabTitle,
                cardIndex: j,
                cardTitle: productName,
                pa: paMatch.pa,
                optionIndex: k,
                optionTitle: priceOptionTexts[k],
              };

              const priceOption = priceOptions[k];
              await priceOption.click({ timeout: 15000 });
              await page.waitForTimeout(1000);
              await expect(modal.continueButton.first()).toBeEnabled({ timeout: 10000 });
              await modal.continueButton.first().click({ timeout: 15000 });
              await page.waitForTimeout(5000);

              await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-option-${k + 1}.png` });

              const cartPage = new CartPage(page);
              try {
                await cartPage.cartTotal.waitFor({ state: 'visible', timeout: 10000 });
              } catch (error) {
                console.log(
                  `❌ Cart page load failed for "${productName}" option "${priceOptionTexts[k]}" (Tab "${tabTitle}", Card ${j + 1}, Option ${k + 1}): Cart total did not become visible within 10 seconds. The checkout may have failed. Original error: ${error.message}`
                );
                throw new Error(`Cart total not found for "${productName}" option "${priceOptionTexts[k]}"`);
              }
              const cartTotal = await cartPage.cartTotal.first().textContent();
              console.log(`  │  │       → Option ${k + 1}/${priceOptions.length}: ${priceOptionTexts[k]}`);
              console.log(`  │  │          Cart total: ${cartTotal}`);

              const digitOnlyCardPrice = priceOptionTexts[k].replace(/[^\d.]/g, '');
              const digitOnlyCartTotal = cartTotal.replace(/[^\d.]/g, '');

              if (digitOnlyCartTotal !== digitOnlyCardPrice) {
                const priceDirection =
                  parseFloat(digitOnlyCardPrice) < parseFloat(digitOnlyCartTotal) ? '[CARD_LOWER]' : '[CARD_HIGHER]';

                optionResult.error = `${priceDirection} Cart total does not match option price for ${tabTitle} > ${productName} > Card: ${priceOptionTexts[k]}, Cart: ${cartTotal}`;
                console.log(`  │  │          ✗ ERROR: Price mismatch ${priceDirection}`);
                cardHasOptionErrors = true;
              } else {
                console.log(`  │  │          ✓ Price matches`);
              }

              optionResults.push(optionResult);

              if (k === priceOptions.length - 1 && (await cartPage.itemRemoveButton.count()) > 0) {
                await cartPage.itemRemoveButton.first().click({ timeout: 15000 });
                await page.waitForTimeout(1000);
                await expect(cartPage.confirmButton.first()).toBeVisible({ timeout: 10000 });
                await cartPage.confirmButton.first().click({ timeout: 15000 });
                await page.waitForTimeout(1000);
                console.log(`  │  │          Removed the item from the cart`);
                continue;
              } else {
                await page.goBack();
                await page.waitForTimeout(2000);
              }

              if (k === priceOptions.length - 1) {
                continue;
              }

              if (newUrl === testUrl) {
                await checkoutLocator.click({ timeout: 15000 });
                await page.waitForTimeout(5000);
                try {
                  await modal.priceOptions.first().waitFor({ state: 'visible', timeout: 10000 });
                } catch (error) {
                  console.log(
                    `❌ Modal reload failed after returning from cart for "${productName}" (Tab "${tabTitle}", Card ${j + 1}): Price options did not reappear within 10 seconds. Original error: ${error.message}`
                  );
                  throw new Error(`Modal price options not found after cart return for "${productName}"`);
                }
                try {
                  await modal.continueButton.first().waitFor({ state: 'visible', timeout: 10000 });
                } catch (error) {
                  console.log(
                    `❌ Modal reload failed after returning from cart for "${productName}" (Tab "${tabTitle}", Card ${j + 1}): Continue button did not reappear within 10 seconds. Original error: ${error.message}`
                  );
                  throw new Error(`Modal continue button not found after cart return for "${productName}"`);
                }
              }
            }

            try {
              await page.evaluate(async () => {
                await localStorage.clear();
                await sessionStorage.clear();
              });
              await page.waitForTimeout(2000);
              await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 20000, referer: undefined });
              await page.waitForTimeout(2000);
            } catch (err) {
              /* continue */
            }
            if (!tabless) await planTabs[i].click({ timeout: 10000 });
            await page.waitForTimeout(1000);
          } else {
            console.log(`  │  │  🔀 Redirected to: ${newUrl}`);
            await page.waitForTimeout(5000);
            await page.screenshot({ path: `screenshots/plans-tab-${i + 1}-card-${j + 1}-redirected.png` });

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
              timeout: 5000,
            });
          }

          console.log(`  │  │  🔄 Card will be retried on next run`);

          try {
            await page.evaluate(async () => {
              await localStorage.clear();
              await sessionStorage.clear();
            });
            await page.waitForTimeout(2000);
            await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 20000, referer: undefined });
            await page.waitForTimeout(2000);
          } catch (err) {
            /* continue */
          }
          if (!tabless) await planTabs[i].click({ timeout: 10000 });
          await page.waitForTimeout(1000);
        }

        cardResults.push(cardResult);
      }
      tabResults.push(tabResult);
    }

    const errorResults = cardResults.concat(optionResults).filter(result => result.error);

    console.log('\n' + '─'.repeat(80));
    console.log('  └─ Completed testing all tabs');
    console.log('\n' + '='.repeat(80));
    console.log('📊 TEST SUMMARY (PA-scoped cards only)');
    console.log('='.repeat(80));
    console.log(`Tabs tested: ${tabResults.length}`);
    console.log(`PA-matched cards exercised: ${cardResults.length}`);
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
      // Filename error-report-<pageKey>.json must match pa-core-monitor.yml Slack step
      saveErrorReport(errorReportName, errorMessages, errorResults, testUrl);

      expect(errorResults.length).toBe(0);
    } else {
      console.log('\n✅ All PA-scoped checks passed!');
      console.log('🧹 Clearing state file for next run...');
      stateManager.clear();
      console.log('='.repeat(80) + '\n');
    }
  });
});
