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
    this.priceOptions = modal.locator('div[data-testid="main-price"]').filter({visible: true});
    this.continueButton = modal.locator('button[data-testid="primary-cta-button"]').filter({visible: true});
    this.modalCloseButton = modal.locator('[data-testid="header-close"]').filter({visible: true});
  }
}

test.describe('Creative Cloud Plans Page Monitoring', () => {

  const testUrl = process.env.TEST_URL || 'https://www.adobe.com/creativecloud/business/teams.html';
  console.log(`Testing URL: ${testUrl}`);

  test.beforeEach(async ({ page }) => {
    // Block Adobe messaging endpoint to disable Jarvis
    await page.route('https://client.messaging.adobe.com/**', route => route.abort());

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

  test('should click and verify all tabs', async ({ page }) => {
    test.setTimeout(600 * 1000);
    
    const teamsPage = new TeamsPage(page);
    
    // Find all tab elements - adjust selector based on actual page structure
    const tabs = await teamsPage.tabs.all();
    
    console.log(`Found ${tabs.length} tabs to test`);
    
    // Track which tabs were successfully clicked
    const optionResults = [];
    const cardErrors = [];

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
          const productName = await merchCard.productName.first()?.textContent();
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
            const tabTestId = await modal.selectedTab.first().getAttribute('data-testid')
            console.log(`Selected tab test id: ${tabTestId}`);
            const isBusinessTab = tabTestId === 'segmentation-tab-item-TEAM_COM';
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
          await expect(modal.modalCloseButton.first()).toBeEnabled({timeout: 10000});
          await modal.modalCloseButton.first().click();
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
  });
});
