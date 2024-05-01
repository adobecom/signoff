const fs   = require('fs');
const yaml = require('js-yaml');
import { test, expect } from '@playwright/test';

test.use({
  contextOptions: {
    userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36 ${process.env.USER_AGENT_SUFFIX}`,
  },
});

test.describe.configure({ mode: 'parallel' });

let links = yaml.load(fs.readFileSync('urls.yml', 'utf8'));

if (process.env.ENVIRONMENT === 'stage') {
  links = links.map(link => link.replace('https://www.', 'https://www.stage.'));
  links = links.map(link => link.replace('https://business.', 'https://business.stage.'));
}

const testPageLoad = async ({page}, testInfo) => { 
    test.setTimeout(300000);
    const screenshotPath = 'screenshots/';

    const url = testInfo.title;

    const response = await page.goto(url, { waitUntil: 'networkidle' });

    await expect(response.status()).toBe(200);
  
    const loadOK = page.locator('div#page-load-ok-milo');
    await expect(loadOK).toHaveCount(1);

    const screenshotName = url.replace(/^https:\/\//, '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    await page.screenshot({ path: `${screenshotPath}/${screenshotName}.png` });

    const allHrefs = await page.evaluate(() => {
      return Array.from(document.links).map((item) => item.href);
    });
  
    const hrefs = [...new Set(allHrefs)].sort();
  
    let output = [];
    for (let i = 0; i < hrefs.length; i++) {
      try {
        // special rules
        if (hrefs[i].includes('localnav-acrobat-teams.html')) {
          hrefs[i] = hrefs[i].replace('.html', '');
        }
        if (hrefs[i].startsWith('tel:')) {
          continue;
        }
        
        let response = await page.goto(hrefs[i]);
        if (response === null) {
          response = await page.waitForResponse(() => true);
        }
  
        for (
          let request = response.request();
          request;
          request = request.redirectedFrom()
        ) {
          const message = `${(
            await request.response()
          ).status()} ${request.url()}`;
          output.push(message);
        }
      } catch (e) {
        console.log(e.message);
        const message = `999 ${hrefs[i]} no errorcode, offline?`;
        output.push(message);
      }
      if (process.env.REQUEST_DELAY) {
        const delay = parseInt(process.env.REQUEST_DELAY);
        await page.waitForTimeout(delay);
      }
    }

    await page.close();
  
    const errors999 = output.filter((item) => item.startsWith('999'));
    if (errors999.length > 0) {
      console.log('\n999 errors:');
      for (let i = 0; i < errors999.length; i++) {
        console.log(errors999[i]);
      }
    }

    const errors404 = output.filter((item) => item.startsWith('404'));

    await expect(errors404, errors404.join('\n')).toHaveLength(0);
  }

for (let link of links) {
  test(link, testPageLoad);
}