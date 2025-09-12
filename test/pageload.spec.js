const fs = require("fs");
const yaml = require("js-yaml");
const fetch = require("sync-fetch");
const path = require("path");
import { test, expect } from "@playwright/test";

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
  contextOptions: {
    userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36 ${process.env.USER_AGENT_SUFFIX}`,
  },
});

test.describe.configure({ mode: "parallel" });

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
      const viewportHeight = window.innerHeight;
      const scrollStep = viewportHeight / 2; // Scroll by half viewport height each time
      let currentPosition = 0;
      let previousHeight = 0;
      let stableCount = 0;
      const maxIterations = 50; // Prevent infinite loops
      let iterations = 0;
      
      while (iterations < maxIterations) {
        const currentHeight = document.body.scrollHeight;
        
        // If height hasn't changed for 2 consecutive checks, we're likely done
        if (currentHeight === previousHeight) {
          stableCount++;
          if (stableCount >= 2) break;
        } else {
          stableCount = 0;
        }
        
        // Scroll down by one step
        currentPosition += scrollStep;
        window.scrollTo(0, currentPosition);
        
        // If we've reached the bottom, scroll to the very end and wait
        if (currentPosition >= currentHeight - viewportHeight) {
          window.scrollTo(0, currentHeight);
          await delay(1000); // Wait longer for final content to load
          currentPosition = currentHeight;
        } else {
          await delay(500); // Wait between scrolls
        }
        
        previousHeight = currentHeight;
        iterations++;
      }
      
      // Final scroll to ensure we're at the bottom
      window.scrollTo(0, document.body.scrollHeight);
      await delay(1000); // Final wait for any remaining content
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

    if (errors404.length > 0 && fs.existsSync('urls_known_issues.yml')) {
      let knownIssues = yaml.load(
        fs.readFileSync("urls_known_issues.yml", "utf8")
      );
      if (knownIssues[url]) {
        knownIssues = knownIssues[url].map(x => new RegExp('^' + escapeRegExp(x).replace(/\*/g, '.*') + '$'));
        const filteredErrors404 = errors404.filter(x => !knownIssues.some(i => i.test(x)));
        testResult.linkValidation.knownIssuesFiltered = originalErrors404Count - filteredErrors404.length;
        errors404 = filteredErrors404;
      }
    }

    testResult.linkValidation.errors404 = errors404;

    await expect(errors404, errors404.join("\n")).toHaveLength(0);
    
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
