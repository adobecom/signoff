# Creative Cloud Plans Page Tests

Playwright test suite for monitoring Adobe Creative Cloud Plans pages, including US (monitor.spec.js) and international/ROW markets (monitor_row.spec.js).

## Test Files

- **monitor.spec.js** - US Plans page tests (https://www.adobe.com/creativecloud/plans.html)
- **monitor_row.spec.js** - International/ROW Plans page tests with geo-mocking and Jarvis chat disabled

## Running Tests Locally

### Prerequisites

```bash
npm install
npx playwright install
```

### Run Specific Test File

```bash
# US Plans page
npx playwright test plans/monitor.spec.js

# International/ROW Plans page
npx playwright test plans/monitor_row.spec.js
```

### Run with Custom URL

```bash
# US market
TEST_URL=https://www.adobe.com/creativecloud/plans.html npx playwright test plans/monitor.spec.js

# UK market
TEST_URL=https://www.adobe.com/uk/creativecloud/plans.html npx playwright test plans/monitor_row.spec.js

# Japan market
TEST_URL=https://www.adobe.com/jp/creativecloud/plans.html npx playwright test plans/monitor_row.spec.js
```

### Run Specific Test

```bash
npx playwright test plans/monitor.spec.js -g "should load plans page successfully"
```

### Run with UI Mode

```bash
npx playwright test plans/monitor.spec.js --ui
```

### Run in Headed Mode

```bash
npx playwright test plans/monitor.spec.js --headed
```

## Running Tests on BrowserStack

### Setup

1. Get your BrowserStack credentials (username and access key) from https://www.browserstack.com/accounts/settings
2. Set environment variables or use the .env file

```bash
export BROWSERSTACK_USERNAME=your_username
export BROWSERSTACK_ACCESS_KEY=your_access_key
```

### Install BrowserStack Playwright SDK

```bash
npm install -D @browserstack/playwright-runner
```

### Run Tests on BrowserStack

```bash
# Run specific test file
npx playwright-browserstack plans/monitor.spec.js config=playwright-bstack.config.ts

# With custom URL
TEST_URL=https://www.adobe.com/uk/creativecloud/plans.html npx playwright-browserstack plans/monitor_row.spec.js config=playwright-bstack.config.ts
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TEST_URL` | URL to test | US: `https://www.adobe.com/creativecloud/plans.html`<br>ROW: `https://www.adobe.com/uk/creativecloud/plans.html` |
| `TEST_TABS` | Comma-separated list of tabs to test | All tabs |

## Test Features

### Common Features (Both Tests)
- Page load verification
- Critical error detection
- Tab switching and content verification
- CTA button testing with price validation
- Full-page screenshot capture
- Slack notifications on success/failure

## Viewing Test Results

### Local Reports

```bash
# View HTML report
npx playwright show-report

# Screenshots are saved to screenshots/ directory
```

### BrowserStack Dashboard

View test results, logs, screenshots, and videos at:
https://automate.browserstack.com/dashboard/v2

## CI/CD Integration

Tests run automatically via GitHub Actions:

- **Daily Schedule**: Each locale runs at a specific hour (2-9 AM UTC)
- **Manual Trigger**: Run specific locale or all locales on demand

See `.github/workflows/plans-row-daily-monitor.yml` for configuration.
