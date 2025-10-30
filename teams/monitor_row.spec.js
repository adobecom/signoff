const { test, expect } = require('@playwright/test');

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

test.describe('Creative Cloud Plans Page Monitoring', () => {

  const testUrl = process.env.TEST_URL || 'https://www.adobe.com/uk/creativecloud/business/teams.html';
  console.log(`Testing URL: ${testUrl}`);

  // Extract country code from URL path (e.g., /uk/ -> 'uk')
  const urlPath = new URL(testUrl).pathname;
  const countryCode = urlPath.split('/').filter(Boolean)[0] || 'uk';
  console.log(`Mocking geo location with country: ${countryCode}`);

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
      console.log('Critical errors found:', criticalErrors);
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
    
    console.log(`Found ${tabs.length} tabs to test`);
    
    // Track which tabs were successfully clicked
    const optionResults = [];
    const cardErrors = [];
    const cardSet = new Set();

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const tabText = await tab.textContent();

      try {
        console.log(`Clicking tab: ${tabText}`);
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
          console.log(`✓ Tab ${i + 1} \"${tabText}\" no merch cards found`);
          continue;           
        }
        const merchCards = await teamsPage.merchCards.all();
        console.log(`Found ${merchCards.length} merch cards in ${tabText} tab`);

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
            console.log(`Duplicate card found: ${productName}`);
            continue;
          }
          cardSet.add(productName);

          const checkoutLinkExists = await merchCard.checkoutLink.count() > 0;
          if (checkoutLinkExists) {
            console.log(`Clicking checkout link for ${productName}`);
            await merchCard.checkoutLink.first().click();
          } else {
            console.log(`No checkout link found for ${productName}`);
            continue;
          }
          await page.waitForTimeout(5000);
          const iframe = await teamsPage.modalIframe.contentFrame();
          const modal = new Modal(iframe);

          try {
            await modal.selectedTab.first().waitFor({state: 'visible', timeout: 10000});
            const tabTestId = await modal.selectedTab.first().getAttribute('data-query-value')
            console.log(`Selected tab test id: ${tabTestId}`);
            const isBusinessTab = tabTestId === 'team';
          } catch (error) {
            console.log(`No selected tab found for ${productName}`);        
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
            console.log(`No price options found for ${productName}`);
          }

          await page.screenshot({ 
            path: `screenshots/teams-tab-${i + 1}-card-${cardIndex + 1}-modal.png`
          });

          try {
            const continueBtn = modal.continueButton.first();
            await continueBtn.waitFor({state: 'visible', timeout: 10000});
            await expect(continueBtn).toBeEnabled({timeout: 10000});
            console.log(`Continue button is enabled for ${productName}`);          
          } catch (error) {
            console.log(`Continue button not ready for ${productName}`);
            await modal.modalCloseButton.first().click();
            await page.waitForTimeout(1000);
            continue;
          }
          const priceOptions = await modal.priceOptions.all();
          const priceOptionTexts = await Promise.all(priceOptions.map(async(x) => await x.textContent()));
          console.log(`Price options: ${priceOptionTexts}`);

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
        }

        console.log(`✓ Tab ${i + 1} \"${tabText}\" verified successfully`);
        
      } catch (error) {
        console.log(`✗ Tab ${i + 1} failed: ${error.message}`);
      }
    }
        
    // Expect at least one tab was found and verified
    expect(tabs.length).toBeGreaterThan(0);

    if (cardErrors.length > 0) {
      console.log(`Card errors: ${cardErrors.map(error => error.error).join('\n')}`);
      expect(cardErrors.length).toBe(0);
    }

    console.log(`Check out price options: ${optionResults.length}`);

    for (const optionResult of optionResults) {
      const tabIndex = optionResult.tabIndex;
      const tabText = optionResult.tabText;
      const cardIndex = optionResult.cardIndex;
      const cardText = optionResult.cardText;
      const optionIndex = optionResult.optionIndex;
      const priceOptionText = optionResult.priceOptionText;
      
      try {
        console.log(`Tab index: ${tabIndex}`);
        console.log(`Tab text: ${tabText}`);
        console.log(`Card index: ${cardIndex}`);
        console.log(`Card text: ${cardText}`);
        console.log(`Option index: ${optionIndex}`);
        console.log(`Price option text: ${priceOptionText}`);

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
        const cartTotal = await cartPage.cartTotal.first().textContent();
        console.log(`Cart sub total: ${cartSubTotal}`);
        console.log(`Cart total: ${cartTotal}`);

        await page.screenshot({ path: `screenshots/teams-tab-${tabIndex + 1}-card-${cardIndex + 1}-cart.png` }  );

        const digitOnlyPrice = priceOptionText.split('/')[0].replace(/[^\d]/g, '');
        if ((cartSubTotal.split('/')[0].replace(/[^\d]/g, '') !== digitOnlyPrice) && 
            (cartTotal.split('/')[0].replace(/[^\d]/g, '') !== digitOnlyPrice)) {
          optionResult.error = `Cart subtotal/total does not match option price ${priceOptionText} for tab \"${tabText}\" card \"${cardText}\"`;
          console.log(`✗ ${optionResult.error}`);
        }
      } catch (error) {
        console.log(`Error processing option result: ${error.message}`);
        await page.screenshot({ path: `screenshots/teams-tab-${tabIndex + 1}-card-${cardIndex + 1}-error.png` });
        optionResult.error = `Error processing option result: ${error.message}`;
        console.log(`✗ ${optionResult.error}`);
      }
    }

    const errorResults = optionResults.filter(result => result.error);
    if (errorResults.length > 0) {
      console.log(`Option results: ${errorResults.map(result => result.error).join('\n')}`);
      await expect(errorResults.length).toBe(0);
    }
  });
});
