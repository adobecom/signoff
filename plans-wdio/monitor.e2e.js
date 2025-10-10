const fs = require('fs');
const path = require('path');
const { expect } = require('@wdio/globals')
const PlansPage = require('./pages/plans.page')

describe('Plans Page Monitor', () => {
    it('should open the plans page', async () => {
        await PlansPage.open()

        await expect(PlansPage.pageLoadOk).toBeExisting()

        const screenshotPath = 'screenshots/plans.png';
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        await browser.saveScreenshot(screenshotPath);
    })
})

