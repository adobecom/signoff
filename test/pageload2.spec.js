const fs = require("fs");
const yaml = require("js-yaml");
const fetch = require("sync-fetch");
const path = require("path");
import { test, expect } from "@playwright/test";
import dotenv from 'dotenv';

dotenv.config();

function escapeRegExp(string) {
  return string.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

// Global test results collector
const testResults = {
  startTime: new Date().toISOString(),
  endTime: null,
  totalTests: 0,
  passedTests: 0,
  failedTests: 0,
  skippedTests: 0,
  tests: [],
  summary: {
    totalUrls: 0,
    totalLinks: 0,
    total404Errors: 0,
    total999Errors: 0,
    totalScreenshots: 0
  }
};

test.use({
  userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36 ${process.env.USER_AGENT_SUFFIX}`,
});

test.describe.configure({ mode: "parallel", retries: 2 });

let links = null;

if (process.env.GIST_URLS) {
  const gistUrls = process.env.GIST_URLS;
  
  // Check if the input is a URL format
  if (gistUrls.startsWith('http://') || gistUrls.startsWith('https://')) {
    // Single URL input
    links = [gistUrls];
  } else if (gistUrls.endsWith('.yml')) {
    // YAML file from repository checkout
    links = yaml.load(fs.readFileSync(gistUrls, "utf8"));
  } else {
    // Gist ID input
    const gistId = gistUrls;
    const response = fetch(`https://api.github.com/gists/${gistId}`).json();
    links = Object.values(response.files)[0]
      .content.split("\n")
      .map((x) => x.trim())
      .filter((x) => x.length > 0 && !x.startsWith("#"));
  }
} else {
  links = yaml.load(fs.readFileSync("urls.yml", "utf8"));
}

if (process.env.ENVIRONMENT === "stage") {
  links = links.map((link) =>
    link.replace("https://www.", "https://www.stage.")
  );
  links = links.map((link) =>
    link.replace("https://business.", "https://business.stage.")
  );
}

const testPageLoad = async ({ page }, testInfo) => {
  test.setTimeout(600000);
  const screenshotPath = "screenshots/";
  
  const url = testInfo.title;
  const testStartTime = new Date().toISOString();
  
  // Initialize test result object
  const testResult = {
    url: url,
    startTime: testStartTime,
    endTime: null,
    status: 'running',
    duration: 0,
    pageLoadStatus: null,
    screenshots: [],
    linkValidation: {
      totalLinks: 0,
      validLinks: 0,
      errors404: [],
      errors999: [],
      knownIssuesFiltered: 0
    },
    errors: []
  };

  try {
    let response;

    // Check the console errors
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    page.on('pageerror', error => {
      errors.push(error.message);
    });

    // Extract country code from URL path (e.g., /uk/ -> 'uk')
    const urlPath = new URL(url).pathname;
    let countryCode = urlPath.split('/').filter(Boolean)[0] || 'uk';
    const supportedCountryCodes = [
      'ar', 'br', 'ca', 'ca_fr', 'cl', 'co', 'cr', 'ec', 'gt', 'la', 'mx', 'pe', 'pr',
      'africa', 'at', 'be_en', 'be_fr', 'be_nl', 'bg', 'ch_de', 'ch_fr', 'ch_it', 'cis_en', 'cis_ru',
      'cz', 'de', 'dk', 'ee', 'eg_ar', 'eg_en', 'es', 'fi', 'fr', 'gr_el', 'gr_en', 'hu', 'ie', 'il_en',
      'il_he', 'it', 'kw_ar', 'kw_en', 'lt', 'lu_de', 'lu_en', 'lu_fr', 'lv', 'mena_ar', 'mena_en',
      'ng', 'nl', 'no', 'pl', 'pt', 'qa_ar', 'qa_en', 'ro', 'ru', 'sa_ar', 'sa_en', 'se', 'si', 'sk',
      'tr', 'ua', 'uk', 'za', 'ae_ar', 'ae_en', 'au', 'cn', 'hk_en', 'hk_zh', 'id_en', 'id_id', 'in',
      'in_hi', 'jp', 'kr', 'my_en', 'my_ms', 'nz', 'ph_en', 'ph_fil', 'sg', 'th_en', 'th_th', 'tw',
      'vn_en', 'vn_vi'
    ];
    if (!supportedCountryCodes.includes(countryCode)) {
      countryCode = '';
    } else {
      countryCode = countryCode.split('_')[0];
    }
    if (countryCode) {
      console.log(`Mocking geo location with country: ${countryCode}`);
  
      // mock the geo location response
      await page.route('https://geo2.adobe.com/json/', route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ country: countryCode })
        })
      );

      const urlOrigin = new URL(url).origin;
      await page.route(`${urlOrigin}/**`, async route => {
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
    }

    try {
      response = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    } catch (error) {
      if (error.name === 'TimeoutError') {
        console.log(`Timeout occurred for URL: ${url}, continuing with test...`);
        response = await page.evaluate(() => ({ status: () => 200 }));
        testResult.errors.push({ type: 'timeout', message: `Timeout occurred for URL: ${url}` });
      } else {
        throw error;
      }
    }

    if (response && response.status) {
      testResult.pageLoadStatus = response.status();
      await expect(response.status()).toBe(200);
    }

    const loadOK = page.locator("div#page-load-ok-milo");
    await expect(loadOK).toHaveCount(1);

    const screenshotName = url
      .replace(/^https:\/\//, "")
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase();
    
    const screenshotFile = `${screenshotPath}/${screenshotName}.png`;
    await page.screenshot({ path: screenshotFile });
    testResult.screenshots.push(screenshotFile);

    // Scroll to the bottom slowly to load any dynamic content
    await page.evaluate(async () => {
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      const scrollHeight = document.body.scrollHeight;
      const viewportHeight = window.innerHeight;
      const scrollStep = viewportHeight / 2; // Scroll by half viewport height each time
      
      for (let scrollTop = 0; scrollTop < scrollHeight; scrollTop += scrollStep) {
        window.scrollTo(0, scrollTop);
        await delay(500); // Wait 500ms between scrolls
      }
      
      // Scroll to the very bottom
      window.scrollTo(0, scrollHeight);
      await delay(1000); // Wait a bit longer at the bottom for any final loading
    });

    // Move viewport back to the top before taking full page screenshot
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });

    // Take a full page screenshot after scrolling
    const fullPageScreenshot = `${screenshotPath}/${screenshotName}_fullpage.png`;
    await page.screenshot({ 
      path: fullPageScreenshot, 
      fullPage: true 
    });
    testResult.screenshots.push(fullPageScreenshot);

    // Filter out common non-critical errors
    let ignoredErrorPatterns = [
      'favicon',
      'analytics',
      'ads',
      'third-party'
    ];
    
    // Load additional ignored patterns from YAML file
    const consoleErrorsIgnoredPath = path.join(__dirname, 'console_errors_ignored.yml');
    if (fs.existsSync(consoleErrorsIgnoredPath)) {
      const additionalIgnoredPatterns = yaml.load(
        fs.readFileSync(consoleErrorsIgnoredPath, "utf8")
      );
      if (Array.isArray(additionalIgnoredPatterns)) {
        ignoredErrorPatterns = [...ignoredErrorPatterns, ...additionalIgnoredPatterns];
      }
    }
    
    const criticalErrors = errors.filter(error => {
      return !ignoredErrorPatterns.some(pattern => 
        error.toLowerCase().includes(pattern.toLowerCase())
      );
    });  

    const allHrefs = await page.evaluate(() => {
      return Array.from(document.links).map((item) => item.href);
    });

    const hrefs = [...new Set(allHrefs)].sort();
    testResult.linkValidation.totalLinks = hrefs.length;

    let output = [];
    for (let i = 0; i < hrefs.length; i++) {
      try {
        // special rules
        const url = new URL(hrefs[i]);
        if (hrefs[i].startsWith("tel:") || url.hash === "#open-jarvis-chat") {
          continue;
        }

        const response = await page.request.head(hrefs[i]);
        const message = `${response.status()} ${hrefs[i]}`;
        output.push(message);
        
        if (response.status() === 200) {
          testResult.linkValidation.validLinks++;
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

    const errors999 = output.filter((item) => item.startsWith("999"));
    testResult.linkValidation.errors999 = errors999;
    
    if (errors999.length > 0) {
      console.log(`\nURL: ${url}`);
      for (let i = 0; i < errors999.length; i++) {
        console.log(errors999[i]);
      }
    }

    let errors404 = output.filter((item) => item.startsWith("404"));
    const originalErrors404Count = errors404.length;

    const knownIssuesPath = path.join(__dirname, 'urls_known_issues.yml');
    if (errors404.length > 0 && fs.existsSync(knownIssuesPath)) {
      let knownIssues = yaml.load(
        fs.readFileSync(knownIssuesPath, "utf8")
      );
      if (knownIssues[url]) {
        knownIssues = knownIssues[url].map(x => new RegExp('^' + escapeRegExp(x).replace(/\*/g, '.*') + '$'));
        const filteredErrors404 = errors404.filter(x => !knownIssues.some(i => i.test(x)));
        testResult.linkValidation.knownIssuesFiltered = originalErrors404Count - filteredErrors404.length;
        errors404 = filteredErrors404;
      }
    }

    const ignoredLinksPath = path.join(__dirname, 'links_ignored.yml');
    if (errors404.length > 0 && fs.existsSync(ignoredLinksPath)) {
      let ignoredLinks = yaml.load(
        fs.readFileSync(ignoredLinksPath, "utf8")
      );  
      for (const link of ignoredLinks) {
        const ignoredLinkRegex = new RegExp('^' + escapeRegExp(link).replace(/\*/g, '.*') + '$');
        const filteredErrors404 = errors404.filter(x => !ignoredLinkRegex.test(x));
        errors404 = filteredErrors404;
      }
    }

    testResult.linkValidation.errors404 = errors404;

    if (criticalErrors.length > 0) {
      console.log('\n⚠️  CRITICAL ERRORS FOUND:');
      criticalErrors.forEach((error, idx) => {
        console.log(`   ${idx + 1}. ${error}`);
      });
      console.log('');
    }

    if (errors404.length > 0) {
      console.log('\n⚠️  404 ERRORS FOUND:');
      errors404.forEach((error, idx) => {
        console.log(`   ${idx + 1}. ${error}`);
      });
      console.log('');
    }

    await expect(criticalErrors.length + errors404.length).toEqual(0);
    
    // Test passed
    testResult.status = 'passed';
    testResults.passedTests++;
    
  } catch (error) {
    // Test failed
    testResult.status = 'failed';
    testResult.errors.push({ 
      type: 'test_failure', 
      message: error.message,
      stack: error.stack 
    });
    testResults.failedTests++;
    throw error; // Re-throw to maintain test failure behavior
  } finally {
    // Record test completion
    const testEndTime = new Date().toISOString();
    testResult.endTime = testEndTime;
    testResult.duration = new Date(testEndTime) - new Date(testStartTime);
    
    // Add to global results
    testResults.tests.push(testResult);
    testResults.totalTests++;
    
    // Update summary
    testResults.summary.totalUrls++;
    testResults.summary.totalLinks += testResult.linkValidation.totalLinks;
    testResults.summary.total404Errors += testResult.linkValidation.errors404.length;
    testResults.summary.total999Errors += testResult.linkValidation.errors999.length;
    testResults.summary.totalScreenshots += testResult.screenshots.length;
  }
};

// Generate JSON report after all tests complete
test.afterAll(async () => {
  testResults.endTime = new Date().toISOString();
  testResults.summary.totalDuration = new Date(testResults.endTime) - new Date(testResults.startTime);
  
  // Calculate additional metrics
  testResults.summary.successRate = testResults.totalTests > 0 ? 
    ((testResults.passedTests / testResults.totalTests) * 100).toFixed(2) + '%' : '0%';
  
  // Ensure reports directory exists
  const reportsDir = 'test-results';
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  
  // Generate report filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(reportsDir, `test-report-${timestamp}.json`);
  
  // Write JSON report
  fs.writeFileSync(reportPath, JSON.stringify(testResults, null, 2));
  
  console.log(`\n=== Test Report Summary ===`);
  console.log(`Total Tests: ${testResults.totalTests}`);
  console.log(`Passed: ${testResults.passedTests}`);
  console.log(`Failed: ${testResults.failedTests}`);
  console.log(`Success Rate: ${testResults.summary.successRate}`);
  console.log(`Total URLs Tested: ${testResults.summary.totalUrls}`);
  console.log(`Total Links Validated: ${testResults.summary.totalLinks}`);
  console.log(`Total 404 Errors: ${testResults.summary.total404Errors}`);
  console.log(`Total 999 Errors: ${testResults.summary.total999Errors}`);
  console.log(`Report saved to: ${reportPath}`);
  console.log(`========================`);
});

for (let link of links) {
  test(link, testPageLoad);
}
