// lingo-monitor-config.js
// CommonJS — readable by GitHub Actions `node -e "require('./lingo-monitor-config.js')"` and Playwright specs via require().
// Keep tier1Locales aligned with lingo-monitor-config.yml → tiers.tier1 for anyone still reading the YAML.
//
// Phase 2 (post ROW migration): add osiCodes per locale

/** PA / offer codes: PA-scoped monitors only exercise merch-cards whose checkout CTAs reference one of these. */
const offerCodes = [
  { pa: 'ccsn_direct_individual',   label: 'CC Pro' },
  { pa: 'ccle_direct_indirect_team', label: 'CC Pro Business' },
  { pa: 'phsp_direct_individual',    label: 'Photoshop' },
  { pa: 'apcc_direct_individual',    label: 'Acrobat Pro' },
  { pa: 'PA-128', label: 'Photography' },
];

/**
 * Pages available to monitors and CI.
 * `path` is the path after the locale segment (see buildAdobePlansUrl).
 */
const monitorPages = {
  acrobat: {
    id: 'acrobat',
    path: 'acrobat.html',
    spec: 'plans/pa-core-monitor.spec.js',
    rowSpec: 'plans/pa-core-monitor.spec.js',
  },
  acrobat_pricing: {
    id: 'acrobat-pricing',
    path: 'acrobat/pricing.html',
    spec: 'plans/pa-core-monitor.spec.js',
    rowSpec: 'plans/pa-core-monitor.spec.js',
  },
  acrobat_pro: {
    id: 'acrobat-pro',
    path: 'acrobat/acrobat-pro.html',
    spec: 'plans/pa-core-monitor.spec.js',
    rowSpec: 'plans/pa-core-monitor.spec.js',
  },
  acrobat_standard: {
    id: 'acrobat-standard',
    path: 'acrobat/acrobat-standard.html',
    spec: 'plans/pa-core-monitor.spec.js',
    rowSpec: 'plans/pa-core-monitor.spec.js',
  },
};

/**
 * Default pages per locale row when `pageKeys` is omitted.
 * ROW catalog-only: use pageKeys: ['catalog'] — URLs are `{locale}/products/catalog.html`.
 */
const lingoMonitorPageKeys = ['acrobat', 'acrobat_pricing', 'acrobat_pro', 'acrobat_standard'];

/**
 * Tier 1 locales for the scheduled PA core monitor (see .github/workflows/pa-core-monitor.yml).
 * `region`: `us` vs `row` selects monitorPages.*.spec vs rowSpec in workflow.
 * `pageKeys` (optional): subset of `plans` / `catalog`; defaults to lingoMonitorPageKeys for that row.
 */
const tier1Locales = [
  { locale: 'fr', label: 'FR', region: 'row' },
  // ROW catalog & plans disabled
  // { locale: 'uk', label: 'UK', region: 'row', pageKeys: ['catalog'] },
  // { locale: 'fr', label: 'FR', region: 'row', pageKeys: ['catalog'] },
  // { locale: 'de', label: 'DE', region: 'row', pageKeys: ['catalog'] },
  // { locale: 'au', label: 'AU', region: 'row', pageKeys: ['catalog'] },
  // { locale: 'jp', label: 'JP', region: 'row', pageKeys: ['catalog'] },
  // { locale: 'in', label: 'IN', region: 'row', pageKeys: ['catalog'] },
];

const ADOBE_ORIGIN = 'https://www.adobe.com';

/**
 * @param {string} locale - '' for US
 * @param {string} [pagePath] - defaults to monitorPages.plans.path
 */
function buildAdobePlansUrl(locale, pagePath = monitorPages.acrobat.path) {
  const prefix = locale ? `${locale}/` : '';
  return `${ADOBE_ORIGIN}/${prefix}${pagePath}`;
}

/** Matrix rows for GitHub Actions `strategy.matrix.include` (locale × configured pageKeys). */
const tier1GithubActionsMatrix = tier1Locales.flatMap(row => {
  const keys = row.pageKeys || lingoMonitorPageKeys;
  return keys.map(pageKey => ({
    locale: row.locale,
    label: row.label,
    region: row.region,
    pageKey,
    pageLabel: pageKey,
  }));
});

module.exports = {
  offerCodes,
  monitorPages,
  lingoMonitorPageKeys,
  tier1Locales,
  tier1GithubActionsMatrix,
  buildAdobePlansUrl,
};
