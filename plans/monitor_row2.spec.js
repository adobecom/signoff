const { test, expect } = require('@playwright/test');

class PlansPage {
  constructor(page) {
    this.page = page;
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
    this.price = card.locator('span[data-wcs-type="price"]').filter({visible: true});
    this.checkoutLink = card.locator('.dexter-Cta .spectrum-Button--cta').filter({visible: true});
  }
}

class Modal {
  constructor(modal) {
    this.modal = modal;
    this.tabs = modal.locator('[role="tab"]').filter({visible: true});
    this.selectedTab = modal.locator('[role="tab"][aria-selected="true"]').first();
    this.priceOptions = modal.locator('.subscription-panel-offer-price [data-wcs-type="price"]').filter({visible: true});
    this.selectedPriceOption = modal.locator('input[checked] + label [data-wcs-type="price"]').filter({visible: true});
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

test.describe('Creative Cloud Plans Page Monitoring', () => {

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

  test('should check all price options are consistent', async ({ page }) => {
    test.setTimeout(1800 * 1000);

    const plansPage = new PlansPage(page);

    const tabResults = [];
    const cardResults = [];
    const optionResults = [];

    const tabs = await plansPage.tabs.all();

    console.log(`Found ${tabs.length} tabs to test`);

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const tabTitle = await tab.textContent();

      const tabResult = {
        tabIndex: i,
        tabTitle: tabTitle,
        cardCount: 0,
      };

      await tab.click();
      await page.waitForTimeout(1000);
      const tabPanel = await plansPage.getTabPanel(tab);
      const merchCards = await plansPage.getMerchCards(tabPanel);
      console.log(`Found ${merchCards.length} merch cards to test`);  

      tabResult.cardCount = merchCards.length;

      await page.screenshot({ path: `screenshots/plans-tab-${i + 1}.png`});

      for (let j = 0; j < merchCards.length; j++) {
        const merchCard = new MerchCard(merchCards[j]);
        await merchCard.productName.first().waitFor({ state: 'visible', timeout: 10000 });
        const productName = await merchCard.productName.first().textContent();
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📦 Product: ${productName}`);
        let cardPrice = 'N/A';

        await merchCard.price.first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => null);
        if (await merchCard.price.count() > 0) {
          cardPrice = await merchCard.price.first().textContent();
        }
        console.log(`   Card Price: ${cardPrice}`);

        const cardResult = {
          tabIndex: i,
          tabTitle: tabTitle,
          cardIndex: j,
          cardTitle: productName,
          cardPrice: cardPrice,
        };

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
        cardResults.push(cardResult);
      }
      tabResults.push(tabResult);
    }

    // if cardResults or optionResults has any error, print the error and fail the test
    const errorResults = cardResults.concat(optionResults).filter(result => result.error);
    if (errorResults.length > 0) {
      console.log(`Error results: ${errorResults.map(result => result.error).join('\n')}`);
      expect(errorResults.length).toBe(0);
    }
  });
});  