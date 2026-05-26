# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Plans Directory Purpose

The `/plans` folder contains specialized monitoring scripts for Adobe Creative Cloud plans pages. These scripts focus on testing interactive features, pricing displays, modal/checkout flows, and plan comparison. There are three primary scripts, split by locale and platform (Milo vs Dexter).

## Monitoring Scripts

### 1. monitor.spec.js — US
- Tests the US Creative Cloud plans page (`https://www.adobe.com/creativecloud/plans.html`)
- Platform: **Milo** (uses `div#page-load-ok-milo`)
- Workflow: `plans-daily-monitor.yml`

### 2. monitor_row2.spec.js — ROW (Dexter locales)
- Tests ROW locales hosted on the **Dexter** platform
- Uses Dexter selectors (e.g. `div.evidon-notice-link`, `plans-card`)
- Workflow: `plans-row-daily-monitor-2.yml`
- Scheduled locales: `uk`, `jp`, `de`, `es`, `it`, `in`
- All supported locales (manual dispatch):
  `ae_ar`, `ae_en`, `africa`, `ar`, `at`, `au`,
  `be_en`, `be_nl`, `bg`,
  `ch_de`, `ch_it`, `cl`, `cn`, `co`, `cr`, `cz`,
  `de`, `dk`,
  `ec`, `ee`, `eg_ar`, `eg_en`, `es`,
  `fi`,
  `gr_el`, `gr_en`, `gt`,
  `hk_en`, `hk_zh`, `hu`,
  `id_en`, `id_id`, `ie`, `il_en`, `il_he`, `in`, `in_hi`, `it`,
  `jp`,
  `kr`, `kw_ar`, `kw_en`,
  `la`, `lt`, `lu_de`, `lu_en`, `lv`,
  `mena_ar`, `mena_en`, `mx`, `my_en`, `my_ms`,
  `ng`, `nl`, `no`, `nz`,
  `pe`, `ph_en`, `ph_fil`, `pl`, `pr`, `pt`,
  `qa_ar`, `qa_en`,
  `ro`, `ru`,
  `sa_ar`, `sa_en`, `se`, `sg`, `si`, `sk`,
  `th_en`, `th_th`, `tr`, `tw`,
  `ua`, `uk`,
  `vn_en`, `vn_vi`,
  `za`

### 3. monitor_row_milo.spec.js — ROW (Milo locales)
- Tests ROW locales hosted on the **Milo** platform
- Locales: `fr`, `br`, `ca`, `be_fr`, `ca_fr`, `ch_fr`, `lu_fr`
- Uses Milo selectors (e.g. `div#page-load-ok-milo`, `merch-card`)
- Workflow: `plans-row-daily-monitor-milo.yml`

## Development Commands

- `npx playwright test plans/monitor.spec.js` - Run the US monitoring script
- `npx playwright test plans/monitor_row2.spec.js` - Run the ROW Dexter script
- `npx playwright test plans/monitor_row_milo.spec.js` - Run the ROW Milo script
- Add `--headed` for visual debugging, `--workers 1` for detailed single-run debugging

## Test Focus Areas

- Plan pricing and feature display accuracy
- Interactive plan comparison tools
- Modal and checkout flow validation
- Card price vs. cart price consistency (CSO detection)
- Loading states and performance metrics

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.