const fs = require('fs');
const path = require('path');
const { expect, browser } = require('@wdio/globals')
const PlansPage = require('./pages/plans.page')

describe('Plans Page Monitor', () => {
    it('should open the plans page', async () => {
        await PlansPage.open()

        await expect(PlansPage.pageLoadOk).toBeExisting()

        const screenshotPath = 'screenshots/plans.png';
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        await browser.saveScreenshot(screenshotPath);
    })

    it('should verify price consistency from merch card to shopping cart', async () => {
        await PlansPage.open();
        await expect(PlansPage.pageLoadOk).toBeExisting();
        
        const testUrl = await browser.getUrl();

        // Find the first merch card and get its price
        let firstMerchCard = await $('merch-card');
        await firstMerchCard.waitForDisplayed();
        await firstMerchCard.scrollIntoView({ block: 'center' });

        const cardPrice = await firstMerchCard.$('[is="inline-price"][data-template="price"]').getText();

        console.log(`Price: ${cardPrice}`);

        await browser.saveScreenshot('screenshots/before.png');

        // Click the "Select" button on the first merch card
        let selectButton = await firstMerchCard.$('[is="checkout-link"]');
        await selectButton.click();

        await browser.pause(5000);

        // Wait for modal to appear
        const iframeElement = await $('.milo-iframe iframe');
        const iframeSrc = await iframeElement.getAttribute('src');

        await expect(iframeSrc).toMatch(/^https:\/\/commerce.adobe.com\/store\/segmentation/);
        
        // Work around cross-origin issue. Open the iframe src. 
        await browser.url(iframeSrc)

        const modal = await $('[role="radiogroup"]');
        await modal.waitForDisplayed();
        await modal.scrollIntoView({ block: 'center' });

        await browser.saveScreenshot('screenshots/options.png');

        // Check price options in the modal and verify one matches the card price
        const priceOptions = await $$('[data-testid="main-price"]');
        const priceTexts = await priceOptions.map(option => option.getText());

        console.log(priceTexts);

        await expect(priceTexts).toContain(cardPrice)

        const continueButton = await $('button:not(:disabled)[data-testid="primary-cta-button-mobile"]');
        await continueButton.waitForClickable();

        // find the tab index of the continue button
        const tabindexes = await $$('[tabindex]');
        let buttonIndex = -1;
        for (let i=0; i < tabindexes.length; i++) {
            if (await continueButton.isEqual(tabindexes[i])) {
                buttonIndex = i;
                break;
            }
        }
        console.log(`Continue button has the tab index ${buttonIndex}`);
        await expect(buttonIndex).toBeGreaterThan(-1);

        // Go back to the test URL
        await browser.url(testUrl);

        firstMerchCard = await $('merch-card');
        await firstMerchCard.waitForDisplayed();
        selectButton = await firstMerchCard.$('[is="checkout-link"]'); 
        await selectButton.waitForClickable();
        await selectButton.click();
        await browser.pause(5000);      
        await (await $('.milo-iframe iframe')).waitForDisplayed();

        // Use tabs to go to continue button
        for (let i = 0; i < buttonIndex-1; i++) {
          await browser.keys('Tab');
          await browser.pause(1000);
          await browser.saveScreenshot(`screenshots/action-tab-${i}.png`);
        }
        
        // Verify the price in the shopping cart
        let retry = 2;
        let cartPrice;
        while (retry > 0) {
          await browser.keys('Return');
          await browser.pause(10000);
          await browser.saveScreenshot(`screenshots/action-enter.png`);
          try {
            cartPrice = await $('[class*="CartTotals__total-amount"]');
            await cartPrice.waitForDisplayed({ timeout: 60000, interval: 3000 });
            break;
          } catch (err) {
            console.log('Retry continue');
            retry -= 1;
          }
        }

        await cartPrice.scrollIntoView({ block: 'center' });
        await browser.pause(1000); 

        await browser.saveScreenshot(`screenshots/cart.png`);

        const cartPriceText = await cartPrice.getText();
        expect(cartPriceText.replace(/[^\d.,]/g, '')).toBe(cardPrice.replace(/[^\d.,]/g, ''));        
    })
})

