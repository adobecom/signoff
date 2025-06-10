const fs = require("fs");
const yaml = require("js-yaml");
const fetch = require("sync-fetch");
import { test, expect } from "@playwright/test";

function escapeRegExp(string) {
  return string.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

test.use({
  contextOptions: {
    userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36 ${process.env.USER_AGENT_SUFFIX}`,
  },
});

test.describe.configure({ mode: "parallel" });

let links = null;

if (process.env.GIST_URLS) {
  const gistId = process.env.GIST_URLS;
  const response = fetch(`https://api.github.com/gists/${gistId}`).json();
  links = Object.values(response.files)[0]
    .content.split("\n")
    .map((x) => x.trim());
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

  const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

  await expect(response.status()).toBe(200);

  const loadOK = page.locator("div#page-load-ok-milo");
  await expect(loadOK).toHaveCount(1);

  const screenshotName = url
    .replace(/^https:\/\//, "")
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();
  await page.screenshot({ path: `${screenshotPath}/${screenshotName}.png` });

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

  const allHrefs = await page.evaluate(() => {
    return Array.from(document.links).map((item) => item.href);
  });

  const hrefs = [...new Set(allHrefs)].sort();

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
  if (errors999.length > 0) {
    console.log(`\nURL: ${url}`);
    for (let i = 0; i < errors999.length; i++) {
      console.log(errors999[i]);
    }
  }

  let errors404 = output.filter((item) => item.startsWith("404"));

  if (errors404.length > 0 && fs.existsSync('urls_known_issues.yml')) {
    let knownIssues = yaml.load(
      fs.readFileSync("urls_known_issues.yml", "utf8")
    );
    if (knownIssues[url]) {
      knownIssues = knownIssues[url].map(x => new RegExp('^' + escapeRegExp(x).replace(/\*/g, '.*') + '$'));
      errors404 = errors404.filter(x => !knownIssues.some(i => i.test(x)));
    }
  }

  await expect(errors404, errors404.join("\n")).toHaveLength(0);
};

for (let link of links) {
  test(link, testPageLoad);
}
